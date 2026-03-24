# 第三部分：可观测性与容错

## 脏数据分析

<!-- 分析 chaos-data-samples.json 中的数据问题 -->

### 发现的问题类型

| 记录 ID | 问题字段 | 期望类型 | 实际值 | 问题描述 |
|---------|----------|----------|--------|----------|
| record-002 | age | number | "25+" | 字符串而非数字 |
| record-002 | tags | string[] | "tech,gaming,esports" | 应为数组但为字符串 |
| record-002 | engagementScore | number | "0.72" | 字符串而非数字 |
| record-003 | email | string(email) | "invalid-email" | 非法邮箱格式 |
| record-005 | age | number | "thirty" | 非数字字符串 |
| record-007 | age | number | -5 | 非法负数 |
| record-007 | engagementScore | number (0-1) | 1.5 | 超出范围 |
| record-012 | age | number | "18-24" | 非数字格式 |
| record-012 | tags | string[] | "kpop,beauty,skincare" | 应为数组但为字符串 |
| record-012 | engagementScore | number | "high" | 非数字字符串 |

---
## 我的解决方案

### 1. Runtime Validation 实现

<!-- 描述你的校验方案，推荐使用 Zod -->

```typescript
import { z } from 'zod';

const RecordSchema = z.object({
  id: z.string(),
  age: z.number().int().positive().nullable().optional(),
  gender: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  engagementScore: z.number().min(0).max(1).nullable().optional(),
  email: z.string().email().nullable().optional(),
});
```

### 2. 错误处理策略

<!-- 描述无效数据如何处理 -->]- 使用 `safeParse` 进行校验，避免抛出异常导致程序中断  
- 对每条记录单独处理，确保单条错误不会影响整个批次  
- 校验失败的数据：
  - 记录错误信息（字段、原因）
  - 收集到 `failedRecords` 列表
  - 最终写入 `failed-records/batch-xxx.json`
- 合法数据继续处理

---

### 3. 日志改进

<!-- 展示你改进后的日志格式 -->

```typescript
// Before
console.log('Error happened');

// After
function log(level: 'info' | 'warn' | 'error', payload: Record<string, unknown>) {
  console[level](JSON.stringify({
    timestamp: new Date().toISOString(),
    ...payload,
  }));
}

// 使用示例
log('warn', {
  event: 'ValidationFailed',
  traceId,
  recordId: raw.id,
  errors,
});
```

### 4. Trace ID 透传

<!-- 如果实现了 Trace ID，请描述方案 -->

- 在脚本启动时生成全局 `traceId`
- 每条日志统一携带该 `traceId`
- 失败记录文件中也包含 `traceId`
- 便于排查同一批数据处理流程中的所有日志

---

## 验收结果

```bash
pnpm run process:chaos

✅ Processed: 5 records
⚠️ Skipped (validation failed): 7 records
📁 Failed records saved to: failed-records/batch-1774323066793.json
```
