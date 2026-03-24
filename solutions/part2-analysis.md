# 第二部分：架构治理分析

## 问题根因分析

LegacyApp 和 WorkerService 同时对同一条分析记录的 demographics 字段进行写入，导致数据存在多个“写入源”，违反了 Single Source of Truth 原则。

### 1. 发现的问题点

- LegacyApp 在接收请求后立即执行“快速计算”，并写入数据库
- WorkerService 在异步处理任务后再次计算并写入同一字段
- LegacyApp 还存在延迟写入逻辑（delayed update），可能覆盖 Worker 的正确结果
- 两个服务对同一字段缺乏写入顺序控制与版本控制
- 日志缺乏上下文（仅有简单字符串），难以排查问题
- 第三方 API 返回数据未做校验，直接强制类型转换

### 2. 竞态条件详解

<!-- 请画图或用文字描述竞态条件是如何发生的 -->

时间线：

T0: 用户调用 POST 创建 analysis
T1: LegacyApp 立刻写入一条带 quickDemographics 的记录  
T2: LegacyApp 发送消息到队列  
T3: WorkerService 开始处理任务  
T4: Worker 很快处理完，写入真正结果，状态变成 COMPLETED  
T5: LegacyApp 的延迟写入触发  
T6: LegacyApp 用旧数据覆盖 Worker 的结果  

结果：前端如果这时候刷新，就会看到：第一次看是一个值，再刷新又变成另一个值，也就是用户刷新时看到数据“闪烁”

---

## 我的重构方案

### 1. 设计原则

- Single Source of Truth：仅允许一个服务写核心业务数据
- 职责分离：API 只负责接单，Worker 负责处理
- 幂等与并发安全：通过 version 实现乐观锁
- 可观测性：结构化日志 + traceId
- 数据鲁棒性：对外部数据进行校验与归一化

---

### 2. 具体修改

<!-- 列出你对每个文件的修改 -->

#### LegacyApp 修改

- 删除 calculateDemographics 相关逻辑
- 删除 delayedUpdate 逻辑
- 创建任务时不再写 demographics
- 初始化 status = PENDING，version = 0
- 只负责发送 AnalysisRequested 事件
- 引入结构化日志（包含 jobId、traceId、stage）

#### WorkerService 修改

- 成为唯一的 demographics 计算与写入入口
- 状态流：PENDING → PROCESSING → COMPLETED
- 使用 version + 条件更新实现乐观锁
- 新增 transformApiResponseSafe 进行数据清洗：
  - '25+' → 25
  - 'a,b' → ['a','b']
  - '0.72' → 0.72
  - null/undefined → 默认值
- 引入结构化日志：
  - stage（PROCESSING / NORMALIZE / COMPLETED）
  - error message + stack

---

### 3. 状态机设计

状态流转如下：
PENDING → PROCESSING → COMPLETED  
                     ↘ FAILED  

约束：
- 只有 Worker 可以修改状态
- 状态更新必须带 version 条件
- 非法跳转（如 PENDING → COMPLETED）不允许

---

## 验收结果

<!-- 请证明重构后数据不会"闪烁" -->
通过测试验证：

- 创建任务后初始状态为 PENDING，且无 demographics
- Worker 处理后状态变为 COMPLETED，version 从 0 → 2
- 多次刷新结果一致，无数据闪烁
- 脏数据（如 null / '25+'）被正确归一化
- 日志包含完整上下文（jobId、traceId、stage）

结论：系统已从“双写不一致”升级为“单一真相源 + 并发安全 + 可观测”的稳定架构