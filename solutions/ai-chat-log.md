# AI Debug Conversation Log

## Question 1
左图是第一个任务【共5个】，有图是架构【包含所有需要处理的问题】，帮我分析下这个任务是什么，结果是什么，以及我需要快速熟悉这个项目的逻辑和解决问题的思路。

好，这一题其实是一个典型后端系统调试 + 工具化能力考察，而不是让你“修 bug”，而是看你有没有工程思维。

我帮你用“面试官视角 + 快速上手策略”给你拆清楚👇

一、这个任务到底在考什么？
👉 本质一句话：

把“线上调试”变成“本地可复现”

1️⃣ 当前痛点（他们为什么出这题）

现在流程是：

改代码 → 部署 → 等5分钟 → 触发 → 看日志 → 再改

👉 问题：

❌ 调试慢（5 min+）
❌ 不可复现（数据变了）
❌ 日志不够（只看到 error）
❌ 不知道是哪条数据坏了
2️⃣ 你要做的事情（核心任务）

👉 构建一个：

“Capture & Replay（抓包 + 回放）工具链”

二、任务拆解（你到底要写什么）
✅ Part 1：Capture（抓包）

📍位置：

apps/worker-service/src/middleware/capture.middleware.ts
要做什么？

当 worker 收到 SQS 消息时：

👉 如果环境变量开启：

CAPTURE_MODE=true

👉 就把这条消息完整保存：

debug-payloads/job-xxx.json
👉 本质：

把“线上输入数据”存下来

✅ Part 2：Replay（回放）

📍位置：

scripts/replay-event.ts
要做什么？

👉 从文件读取：

debug-payloads/job-xxx.json

👉 然后：

直接调用 worker handler
（绕过 SQS）
👉 本质：

用本地数据“模拟线上执行”

三、最终结果（验收标准）

你完成后，应该可以做到👇

✅ Step 1：抓数据
CAPTURE_MODE=true pnpm run start:worker

👉 触发一次请求后：

debug-payloads/job-xxx.json  ✅ 出现
✅ Step 2：本地复现
pnpm run replay -- --file=debug-payloads/job-xxx.json

👉 你应该看到：

worker handler 被执行
有完整日志
❗不需要 SQS / 云环境
🎯 核心能力体现：

👉 你把系统变成：

线上 → dump 输入 → 本地复现

这在工程上是 非常高级的能力（debug infra）

四、系统架构你要怎么理解（超重要）

你现在要搞清楚这条链路👇

用户请求
   ↓
LegacyApp（REST API）
   ↓
发 SQS 消息（AnalysisRequested）
   ↓
WorkerService（消费）
   ↓
调用 processors（核心逻辑）
   ↓
写 MongoDB
⚠️ 当前问题（题目已经告诉你）
1️⃣ 数据不一致

👉 两个服务都写 MongoDB（竞态）

2️⃣ 调试困难

👉 只能靠 CloudWatch

3️⃣ 第三方 API 崩

👉 数据结构不稳定

4️⃣ 无法排查

👉 日志只有：

Error happened
👉 所以 Capture & Replay 是第一步！

因为：

❗你连“复现问题”都做不到，就别谈修 bug

五、你现在该怎么快速上手（重点！）

我给你一个30分钟通关策略👇

🚀 Step 1：找到 worker handler

去看：

apps/worker-service/src/

重点找：

handler / consumer
processors/

👉 你要搞清楚：

一条消息 → 怎么被处理
🚀 Step 2：写 capture middleware（最简单）

逻辑：

if (process.env.CAPTURE_MODE === 'true') {
  saveToFile(message)
}

👉 保存格式：

{
  "timestamp": "...",
  "payload": { ...SQS message... }
}
🚀 Step 3：写 replay 脚本

核心：

import { handler } from '../apps/worker-service/...'

const payload = JSON.parse(fs.readFileSync(file))

await handler(payload)

👉 本质：

模拟 SQS 调用

🚀 Step 4：打通流程

测试：

触发一个请求（LegacyApp）
生成 payload
replay


queue-poller.ts
TypeScript
capture.middleware.ts
TypeScript
worker没打印📨 Processing message: 但是local-queue/中有json：{
  "eventType": "AnalysisRequested",
  "jobId": "5cd4cc70-dff5-4e27-8c37-90816cf4e958",
  "userId": "user-123",
  "dataUrl": "https://example.com/data.json",
  "timestamp": "2026-03-24T00:39:33.702Z"
}
已思考 32s

对，这样就把问题范围缩得很小了：

既然你的 queue-poller.ts 里已经在处理前调用了 capturePayload(event) ，而 capture.middleware.ts 一进函数就会先打印 CAPTURE_MODE ，那么现在既没有看到

📨 Processing message: ...
也没有看到 CAPTURE_MODE = true

就说明：

Worker 根本没有读到你看到的那份 local-queue/*.json。

不是 capture 逻辑没写对，而是 poller 正在看的目录 和你手动查看的目录，很可能不是同一个。

最可能的原因

你这两处代码都用了：

path.join(process.cwd(), 'local-queue')
path.join(process.cwd(), 'debug-payloads')

也就是路径完全依赖当前工作目录 process.cwd()。

这在 monorepo 里很容易出问题：

你以为它看的是项目根目录的 local-queue/
实际运行时，process.cwd() 可能是 apps/worker-service/
那它真正看的就变成了
apps/worker-service/local-queue/

所以会出现你现在这个现象：

根目录 local-queue/ 里有 json
但 worker 没有任何 Processing message 日志
因为它其实盯着另一个目录
你先做这个确认

启动 worker 时，第一行应该会打印：

📡 Queue poller started, watching: ...

你把那一行看清楚，重点不是“started”，而是后面的完整路径。

如果它打印的是类似：

... senior-backend-challenge/apps/worker-service/local-queue

那就找到了，问题就是路径错位。

最直接的修法

不要用 process.cwd()，改成固定相对项目根目录的路径。

改 queue-poller.ts

把：

const QUEUE_DIR = path.join(process.cwd(), 'local-queue');

改成：

const QUEUE_DIR = path.resolve(__dirname, '../../../local-queue');

如果你是直接跑 src 下的 ts，这个路径通常会指向项目根目录下的 local-queue。如果你跑的是编译后的 dist，层级可能需要再调一次，但思路就是：别依赖 cwd，改成相对文件位置算路径。

你可以顺手先临时加一行：

console.log('Resolved QUEUE_DIR =', QUEUE_DIR);
改 capture.middleware.ts

把：

const DEBUG_PAYLOAD_DIR = path.join(process.cwd(), 'debug-payloads');

改成：

const DEBUG_PAYLOAD_DIR = path.resolve(__dirname, '../../../debug-payloads');

也同样加一行：

console.log('Resolved DEBUG_PAYLOAD_DIR =', DEBUG_PAYLOAD_DIR);
更稳的写法

如果你想最稳，不去猜层级，可以在两个文件里都统一用一个 helper，找项目根目录，比如从当前目录往上找 package.json 或 pnpm-workspace.yaml。但对这个 challenge 来说，先把路径固定住就够了。

你现在先别急着改一堆东西，先做这 3 步

第一步，启动 worker，看它打印的 watching: 后面到底是哪条路径。
第二步，在那个实际路径下看看有没有 local-queue 和消息文件。
第三步，如果路径不对，就把 process.cwd() 改掉。

为什么我现在基本能确定是路径问题

因为从你给我的代码看：

只要读到文件，就一定会打印 📨 Processing message: ${event.jobId}
只要进了 capture，就一定会打印 CAPTURE_MODE = ...

而你两个都没看到，但根目录 local-queue 里有文件。
这最符合“worker 在看另一个 local-queue”这个情况。

把 worker 启动时那条完整的 watching: 日志贴给我，我可以直接告诉你现在它到底在看哪个目录。

显示的是📡 Queue poller started, watching: D:\shuaibaole\jobs\2026\crowdcore\exam\-Senior-Backend-Challenge\apps\worker-service\local-queue

找到了，问题就是这个。

Worker 现在盯着的是：

D:\...\-Senior-Backend-Challenge\apps\worker-service\local-queue

但你看到有消息的目录是项目根目录下的 local-queue/。
所以：

LegacyApp 把消息写到了 根目录的 local-queue/
Worker 却在看 apps/worker-service/local-queue/
两边不是一个地方，自然消费不到

这也解释了为什么：

没有 📨 Processing message
没有 capture 日志
debug-payloads/ 也没新文件
你现在该怎么改

要把 Worker 和 Capture 都改成固定指向项目根目录，不要再用 process.cwd()。

1）修改 apps/worker-service/src/queue-poller.ts

把原来的：

const QUEUE_DIR = path.join(process.cwd(), 'local-queue');

改成：

const QUEUE_DIR = path.resolve(__dirname, '../../../local-queue');

为了便于确认，再加一行日志：

console.log('Resolved QUEUE_DIR =', QUEUE_DIR);

你这部分开头可以写成：

import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisRequestedEvent } from '@senior-challenge/shared-types';
import type { MessageProcessor } from './processors/processor.interface';
import { capturePayload } from './middleware/capture.middleware';

// 不再依赖 process.cwd()，而是基于当前文件位置回到项目根目录
const QUEUE_DIR = path.resolve(__dirname, '../../../local-queue');
const POLL_INTERVAL_MS = 1000;
2）修改 apps/worker-service/src/middleware/capture.middleware.ts

把原来的：

const DEBUG_PAYLOAD_DIR = path.join(process.cwd(), 'debug-payloads');

改成：

const DEBUG_PAYLOAD_DIR = path.resolve(__dirname, '../../../debug-payloads');

也加一行日志方便确认：

console.log('Resolved DEBUG_PAYLOAD_DIR =', DEBUG_PAYLOAD_DIR);

开头可以改成：

import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisRequestedEvent } from '@senior-challenge/shared-types';

// 固定写到项目根目录下的 debug-payloads
const DEBUG_PAYLOAD_DIR = path.resolve(__dirname, '../../../debug-payloads');
为什么是 ../../../

因为这两个文件都在：

apps/worker-service/src/queue-poller.ts
apps/worker-service/src/middleware/capture.middleware.ts

从这里回到项目根目录：

src -> worker-service -> apps -> 根目录

正好三级。

改完之后你应该看到什么

重新启动 worker 后，日志应该像这样：

Resolved QUEUE_DIR = D:\...\-Senior-Backend-Challenge\local-queue
📡 Queue poller started, watching: D:\...\-Senior-Backend-Challenge\local-queue

然后你再 POST 一次任务：

Invoke-RestMethod -Method POST http://localhost:3000/api/analysis -ContentType "application/json" -Body '{"userId":"user-123","dataUrl":"https://example.com/data.json"}'

正常情况下，worker 应该会打印：

📨 Processing message: ...
CAPTURE_MODE = true
Resolved DEBUG_PAYLOAD_DIR = D:\...\-Senior-Backend-Challenge\debug-payloads
📦 Captured payload to ...

然后根目录下的 debug-payloads/ 就会有新的 json。


## Question 2
左图是第2个任务即要求【共5个】，有图是架构【包含所有需要处理的问题】，帮我分析下这个任务是什么，结果是什么，以及我需要快速熟悉这个项目的逻辑和解决问题的思路
已思考 19s

这个第 2 个任务本质上是在考你：

能不能看出一个“架构层面的脏设计”导致的数据竞争问题，并把系统改成只有一个地方负责真相写入。

也就是题目里说的 Single Source of Truth。

从你给的说明和代码看，这一题不是单纯修一个 bug，而是要你证明你有这几种能力：

能快速看懂现有系统的数据流
能定位“为什么会闪烁/不一致”
能做合理的架构收敛，而不是打补丁
能考虑并发覆盖问题，而不只是“看起来能跑”
这道题到底是什么

当前系统流程是：

LegacyApp 接收 REST 请求
它创建 job，写 MongoDB
然后发一个 AnalysisRequested 事件到队列
WorkerService 消费这个事件，再处理 job

问题在于：现在 LegacyApp 和 Worker 都在写同一条 analysis job 的 demographics 字段。

在 analysis.service.ts 里，createAnalysis() 在 API 层先做了一个假“快速计算” calculateQuickDemographics()，然后把这个结果直接写进数据库；而且还在 2 秒后执行 delayedUpdate() 再写一次。

同时在 analysis.processor.ts 里，Worker 的 process() 也会调用第三方 API、转换结果，再把最终 demographics 写回数据库并把状态设成 COMPLETED。

所以现在的真实问题不是“某一行代码写错”，而是：

同一份业务结果被两个服务同时当成自己该负责的输出。

这就是题目标题里的架构治理。

这个任务要你最后做到什么结果

题目要求的目标可以直接翻译成一句话：

让 Worker 成为唯一负责分析结果计算和写入的人，LegacyApp 只负责接单和派单。

也就是说最终应该变成：

LegacyApp：
生成 jobId
创建一条初始记录
状态写成 PENDING
不算 demographics
不写最终结果
发消息给队列
Worker：
收到任务后把状态更新为 PROCESSING
调用第三方 API
做清洗/转换/校验
把最终 demographics 写入
状态更新为 COMPLETED

最终用户看到的数据库状态流应该是：

PENDING → PROCESSING → COMPLETED

而且从头到尾只有 Worker 会写分析结果字段。这个也是题目写得很明确的验收点。

你现在应该怎么理解这个 bug
1. 根因不是“延迟写入慢”，而是“职责重复”

AnalysisService.createAnalysis() 现在做了四件事：

生成 id
快速计算 demographics
保存到数据库
发消息给 Worker

题目自己在代码注释里都写了：这个方法做了太多事情。

而 Worker 的 process() 又会再算一遍 demographics 并写数据库。

所以 bug 根因是：

API 服务和异步 Worker 同时承担了“分析结果生产者”的角色。

这在异步系统里几乎一定会出问题。

2. “闪烁”是怎么发生的

一个典型时序是这样：

用户调用 POST 创建 analysis
LegacyApp 立刻写入一条带 quickDemographics 的记录
Worker 很快处理完，写入真正结果，状态变成 COMPLETED
两秒后，LegacyApp 里的 setTimeout -> delayedUpdate() 又执行
它把旧的、假的 quick demographics 再覆盖回去

所以前端如果这时候刷新，就会看到：

第一次看是一个值
再刷新又变成另一个值

这就是题目说的数据“闪烁”。

而且 delayedUpdate() 是无条件覆盖，根本不检查当前状态，也不检查是不是已经完成了。

3. 为什么这是架构问题，不是简单 if 判断能解决的

你当然可以想“那我在 delayedUpdate 里判断一下状态是不是 COMPLETED”。

但这仍然不是最优解，因为：

API 层依然在做不该做的计算
API 层依然在写结果字段
系统依然存在双写路径
以后再改字段、再加逻辑，还会继续分叉

所以面试官更想看到的答案不是：

“我给 delayedUpdate 加了个 if。”

而是：

“我消除了双写源头，把写入职责收敛到 Worker，一个服务只做一件事。”

你需要快速熟悉这个项目的逻辑

你现在先不要一上来改代码，先把系统脑图建立起来。最快方式是按下面这个顺序看。

第一层：先看整体职责

从你的目录图看，最核心的就两个地方：

apps/legacy-app/src/analysis/analysis.service.ts
apps/worker-service/src/processors/analysis.processor.ts

这两个文件就是本题主战场。

你可以先把它们分别理解成：

analysis.service.ts：入口、建单、发消息
analysis.processor.ts：消费消息、执行业务、写最终结果
第二层：看数据流，而不是先看细节语法

你应该先问自己四个问题：

job 是在哪创建的？
队列消息是在哪发的？
Worker 是拿什么字段找到这条 job 的？
哪些地方会写 demographics 和 status？

只要这四个问题答清楚，这题已经理解 70% 了。

从代码上看：

LegacyApp 的 createAnalysis() 创建 job、写 DB、发事件。
Worker 的 process() 收到事件，用 jobId 更新状态并写结果。
第三层：看字段级别的 ownership

你要开始有“字段所有权”的意识：

status 谁改？
demographics 谁改？
updatedAt 谁改？
completedAt 谁改？

面试题其实就在问你：

能不能把这些字段的 owner 设计清楚。

比较合理的 owner 是：

LegacyApp 只负责：jobId/userId/dataUrl/status=PENDING/createdAt/updatedAt
Worker 负责：status=PROCESSING/COMPLETED/FAILED、demographics、completedAt
你这题的解决思路，建议这样答

你在面试文档或思路描述里，最好分成三层来讲。

第一层：先说架构原则

先写一句最重要的话：

分析结果的计算和持久化必须有且只有一个写入点，WorkerService 应作为 demographics 的唯一真相来源。

这句话很关键，因为它比“我删了一个函数”更像架构治理。

第二层：再说代码改造方向
对 LegacyApp 的改造

你应该去掉：

calculateQuickDemographics()
delayedUpdate()
createAnalysis() 里对 demographics 的写入
setTimeout(...)

保留：

创建空 job
初始状态 PENDING
发 AnalysisRequested 事件

也就是说，创建出来的 job 最好类似：

status: 'PENDING'
demographics: undefined 或根本不写
其余元数据正常保留

这样 LegacyApp 就退化成一个“任务入口 + 派发器”。

对 Worker 的改造

Worker 才是真正执行业务的人，所以它应该：

拿到消息后先更新状态为 PROCESSING
调第三方 API
清洗并校验数据
统一转换成 Demographics
写入 COMPLETED + demographics + completedAt

如果失败：

写 FAILED
记录可定位日志
第三层：最后说并发保护

题目还要求“解决竞态条件，使用 optimistic locking 或版本号防止脏写”。

这个点说明：即使你把 LegacyApp 的双写删掉了，面试官还是想看你有没有并发意识。

比较好的思路有两个。

方案 A：按状态做条件更新

比如 Worker 更新 PROCESSING 时要求当前状态必须是 PENDING。

更新 COMPLETED 时要求当前状态必须是 PROCESSING。

Mongo 里可以做成类似：

updateOne({ jobId, status: 'PENDING' }, { $set: { status: 'PROCESSING' ... }})
updateOne({ jobId, status: 'PROCESSING' }, { $set: { status: 'COMPLETED', demographics ... }})

这样至少状态流不会乱跳。

方案 B：加 version 字段做 optimistic locking

更完整一点就是：

job 初始 version = 0
每次更新时带条件 version = currentVersion
更新成功后 $inc: { version: 1 }

这样如果多个写同时发生，后写的人会因为版本不匹配失败，不会静默覆盖。

如果题目要的是“防止脏写”，这个回答会更像高级后端思路。

这题里你还要顺手看到的另外两个隐藏问题

虽然题目主线是 Single Source of Truth，但 Worker 文件里还有两个明显坑，面试官可能想看你顺手提到。

1. 第三方 API 脏数据没有校验

callThirdPartyApi() 明确模拟了脏数据：

age: '25+'
tags: 'lifestyle,food'
score: '0.72'
age: null
gender: undefined

而 transformApiResponse() 却直接强制断言：

data.age as number
data.tags as string[]
data.score as number

这会导致：

数据错误
ageRange 可能变成不合理值
某些场景直接抛异常

这些问题代码里写得非常明显。

所以你在方案里可以顺带说一句：

在 Worker 成为唯一真相来源后，还需要在 Worker 内部增加输入校验与脏数据归一化，否则只是把错误集中到了一个地方。

2. 日志不可观测

现在日志几乎全是：

Processing job: xxx
Job completed: xxx
Error happened

这类日志没有上下文，定位不了问题。analysis.service.ts 的 delayedUpdate() 失败时甚至只打印 Error happened。

所以你做题时也可以顺手体现一点工程意识：

带 jobId
带 status
带 stage
带错误 message / stack
最好结构化

虽然这是 Part 3 更偏 observability 的内容，但你在 Part 2 提一嘴会显得你很完整。

你现在真正该怎么下手

建议你按这个顺序做，最快。

第一步：先写出“当前错误数据流”

你先在纸上或文档里写：

POST /analysis
LegacyApp createAnalysis
写 PENDING + fake demographics
publish event
Worker process
写 PROCESSING
调 API
写 COMPLETED + real demographics
2 秒后 LegacyApp delayedUpdate
再覆盖 demographics

只要你能把这条链讲清楚，文档就已经很好看了。

第二步：先做最核心重构

先只改最关键的：

LegacyApp 删除 quick calculation 和 delayedUpdate
LegacyApp 创建 job 时不再写 demographics
Worker 成为唯一写 demographics 的地方

先把 Single Source of Truth 做出来。

第三步：再补状态约束

然后给 Worker 更新状态时加条件，保证状态流只允许：

PENDING → PROCESSING
PROCESSING → COMPLETED
PROCESSING → FAILED

这样即使重复消费或异常重试，也不容易写乱。

第四步：最后补数据校验

把 transformApiResponse() 改成安全转换，而不是直接断言。

比如：

age 如果是 number，正常算区间
age 如果是 '25+'，尝试解析成 25
tags 如果是字符串，就 split(',')
score 如果是字符串，就 parseFloat
缺字段时给默认值或判失败

这会让你的方案显得不只是“修竞态”，而是真正把 Worker 做成可靠的真相来源。

代码里有个 delayedUpdate，好像是 setTimeout 2 秒后再写一次，这个是不是问题的关键？还是说就算没有这个 delay，也会有问题？

这个问题你问得非常关键，而且这是这道题的核心理解分水岭👇

✅ 结论先说清楚

👉 delayedUpdate 不是根因，但它把问题“放大并暴露出来”。

❌ 没有 delayedUpdate → 仍然是错误架构（双写）
❌ 有 delayedUpdate → 问题变成用户可见的“闪烁”
✅ 真正根因 → 两个服务同时写同一个字段（demographics）
🧠 分两种情况讲清楚
🚨 情况 1：有 delayedUpdate（你现在这个）
发生什么：
T0: Legacy 写 quick result
T1: Worker 写正确结果
T2: Legacy delayedUpdate 再写旧结果 ❌覆盖

👉 结果：

用户看到：
正确 → 又变错 → 再刷新又变
明显闪烁（visible bug）

👉 这就是你题目描述里的：

用户看到数据会“闪烁”

⚠️ 情况 2：没有 delayedUpdate（很多人误以为就没问题了）

比如你删掉 delay，只剩：

T0: Legacy 写 quick result
T1: Worker 写正确结果

👉 看起来好像没问题？

但其实：

❌ 仍然是错误设计（只是“暂时没炸”）

原因：

1. 仍然是双写（违反 Single Source of Truth）
Legacy 写了一次
Worker 又写了一次

👉 谁才是真正数据来源？不明确

2. 顺序不保证（异步系统本质问题）

如果发生：

T0: Worker 比 Legacy 快（极端情况）
T1: Worker 写正确结果
T2: Legacy 写 quick result ❌覆盖

👉 即使没有 delay，也可能发生覆盖

3. 数据语义混乱

你现在有两种“demographics”：

quick（粗糙估算）
real（第三方 API）

👉 存在问题：

API 返回的到底是哪种？
用户看到的哪个才可信？

题目还提到 optimistic locking，我有点不太理解：如果我已经只让 Worker 写数据了，为什么还需要 locking？是因为可能有多个 worker 同时处理同一个 job 吗？

对，你理解得已经很接近了。

是的，就算已经改成“只有 Worker 写数据”，仍然可能需要 optimistic locking，因为“单写者”不等于“单实例、单次执行”。

为什么单写还不够

你现在解决的是：

LegacyApp 不再写 demographics
Worker 成为唯一负责结果写入的服务

这解决的是职责冲突。

但 optimistic locking 解决的是另一类问题：

同一个 Worker 任务，可能被执行多次，或者被多个 Worker 实例同时执行。

典型场景 1：多个 worker 同时处理同一个 job

比如队列系统里，出现了这些情况：

消息被重复投递
两个 worker 实例都拿到了同一个 job
一个 worker 处理慢，另一个先完成
网络抖动导致消息重试

时间线可能是这样：

T0: job 状态 = PENDING, version = 0
T1: Worker A 读到 job
T2: Worker B 也读到 job
T3: Worker A 更新为 PROCESSING
T4: Worker B 也尝试更新
T5: Worker A 写入 COMPLETED
T6: Worker B 也想再写一次

如果没有 locking，那就可能：

两个 worker 都处理成功
后写的人覆盖先写的人
重复调用第三方 API
状态和结果不一致
典型场景 2：同一个消息被重复消费

很多消息系统本来就不保证“绝对只消费一次”，而是更接近：

at-least-once delivery

也就是说：

同一个消息，系统宁可多投一次，也不想丢
所以你的代码必须能应对“同一 job 被处理两次”

这时候 optimistic locking 就是在说：

“只有版本对得上的那个更新才允许落库，其他重复执行直接失败退出。”

典型场景 3：状态跳转被乱序覆盖

就算只有一个 worker 实例，也可能有这种情况：

任务刚更新到 PROCESSING
某个旧逻辑或重试逻辑又拿着旧状态来更新
没有条件限制的话，就可能把新状态覆盖掉

所以你现在写的这种条件更新：

{ jobId, status: 'PENDING', version: 0 }

本质是在保证：

只有“我以为它还是旧状态”的那次更新才有效
如果别人先改了，我这次更新就失效
为什么用 optimistic locking，而不是“反正只有一个 worker”

因为在真实系统里，通常不能假设：

永远只有一个 worker 进程
消息永远不重复
重试永远不会发生
同一个 job 永远只会被处理一次

面试官提 optimistic locking，其实是在看你有没有这种分布式系统意识：

单一职责解决的是“谁该写”，乐观锁解决的是“写的时候怎么防并发冲突”。

你可以怎么理解这两者的区别
Single Source of Truth

解决的是：

谁有资格写这个字段？

答案是：

只有 Worker 写 demographics
Optimistic Locking

解决的是：

如果有两个执行者都“以为自己能写”，怎么防止脏写？

答案是：

用 version 或条件状态判断，只允许一个成功
一个很好的类比

你可以把它想成改共享文档：

Single Source of Truth：规定只有“编辑组”能改，不让“查看组”也去改
Optimistic Locking：即使都在编辑组里，也要防止两个人同时保存，把彼此内容覆盖




## Question 3
左图是第3个任务即要求【共5个】，有图是架构【包含所有需要处理的问题】，帮我分析下这个任务是什么，结果是什么，以及我需要快速熟悉这个项目的逻辑和解决问题的思路

很好，这个第 3 题其实是整个面试里最“工程能力”的一题（比前两个更像真实 production 问题）。我帮你拆成 3 层讲清楚👇：

🧠 一、这个任务本质在考什么？

一句话总结：

👉 你能不能把一个“会崩”的系统，改成“可观测 + 可容错”的生产级系统

🔥 当前系统的问题（你必须先理解）

从题目 + 架构图可以提炼出 4 个核心痛点：

1️⃣ 脏数据直接把系统干崩

例如你给的 sample：

"age": "25+" ❌（字符串）
"age": null ❌
"email": "invalid-email" ❌
"engagementScore": "high" ❌

👉 当前代码：没有 validation → 直接 crash

📌 证据：
中就有这些问题数据

2️⃣ 批处理是“全有或全无”（致命）

现在是：

👉 一条坏数据 → 整批失败

正确应该是：

👉 坏数据跳过，好的继续处理

3️⃣ 完全不可观测（Observability = 0）

现在日志：

Error happened

👉 问题：

不知道哪个字段错
不知道哪条 record 错
没 traceId（跨服务无法追踪）
4️⃣ 没有 Dead Letter（失败数据丢失）

👉 出错的数据直接消失

生产环境这是大事故级问题

🎯 二、这个任务你最终要做到什么（结果）

题目已经给了验收标准，其实就是你的“target system behavior”：

✅ 目标输出（非常重要，面试官会看这个）
Processed: 95 records
Skipped (validation failed): 5 records
Failed records saved to: failed-records/batch-xxx.json
📌 对应能力点
能力	你要做的
容错	invalid → skip
数据质量	runtime validation
可观测性	structured log + traceId
可恢复性	dead letter
🧩 三、你需要改哪些地方（代码层）

结合项目结构👇：

apps/
  legacy-app/
  worker-service/
    processors/   👈 核心
    middleware/   👈 可以加 validation/logging
🧱 1. Worker 是主战场（重点）

👉 所有处理逻辑都在这里

你要改：

worker-service/src/processors/
🧪 2. 加 Runtime Validation（核心）

建议用：

👉 Zod（更简单，面试加分）

✔️ 你要做的

定义 schema：

const UserSchema = z.object({
  id: z.string(),
  age: z.number().int().positive().optional(),
  email: z.string().email().optional(),
  engagementScore: z.number().min(0).max(1).optional(),
  tags: z.array(z.string()).optional()
});
✔️ 处理逻辑（关键）
try {
  const parsed = UserSchema.parse(raw);
  // 正常处理
} catch (err) {
  // ❗不要 throw
  // ❗记录 + skip
}
🪵 3. 日志系统（必须结构化）

题目要求你替换：

console.log
console.error
✔️ 正确日志格式
logger.warn({
  event: 'ValidationFailed',
  jobId,
  field: 'age',
  rawValue: '25+',
  traceId
});

📌 核心点：

必须 JSON
必须带 traceId（从 LegacyApp 传）
💀 4. Dead Letter（关键加分点）

👉 保存失败数据

✔️ 文件路径
failed-records/batch-xxx.json
✔️ 内容示例
{
  "record": {...},
  "error": "Invalid email",
  "timestamp": "...",
  "traceId": "..."
}
🔁 5. 批处理逻辑必须改（非常重要）

当前（错误逻辑）：

for (...) {
  process(record) // 一旦 throw → 整批挂
}
✔️ 正确写法
let processed = 0;
let skipped = 0;
const failed = [];

for (const record of records) {
  try {
    validate + process
    processed++;
  } catch (err) {
    skipped++;
    failed.push({ record, error: err.message });
  }
}
⚡ 四、你如何“快速理解项目逻辑”（重点）

你时间只有 30 分钟，必须用正确策略👇

🧭 Step 1：理解数据流（最重要）
LegacyApp
   ↓
SQS Queue
   ↓
WorkerService  👈 你要改
   ↓
MongoDB

👉 结论：

LegacyApp = 入口
Worker = 核心处理
MongoDB = 存储
🔍 Step 2：只看 3 个地方
1️⃣ process-chaos.ts

👉 数据入口（用来测试）

2️⃣ worker-service/processors

👉 真正处理逻辑（主战场）

3️⃣ Mongo 写入代码

👉 找 .save() / .insert

题目说一条坏数据会导致整个 batch 失败，为什么不能只跳过这一条？是因为现在没有 try/catch，还是说整个处理是绑在一起的？

两种情况都可能，但更核心的原因通常是：当前代码没有把“单条失败”和“整批失败”隔离开。

你可以这样理解：

1. 为什么“一条坏数据会拖垮整个 batch”

假设现在代码像这样：

for (const record of records) {
  processRecord(record); // 这里一旦 throw
}
saveBatchResult();

如果 processRecord(record) 处理到某一条坏数据时直接抛异常：

throw new Error('invalid email');

那循环会立刻中断，后面的记录根本没机会处理。
于是表现出来就是：

当前这条没处理成功
后面的也没处理
整个 batch 提前退出

这就是“一条坏数据导致整个 batch 失败”。

2. 是因为没有 try/catch 吗？

通常是很重要的直接原因之一。

因为如果没有这种单条隔离：

for (const record of records) {
  try {
    processRecord(record);
  } catch (err) {
    // 记录错误，跳过这一条，继续下一条
  }
}

那任何一条记录里的异常都会冒泡到最外层，最后整个脚本退出。

所以你可以说：

是，缺少 per-record 的 try/catch / safeParse 隔离，往往就是 batch 被拖垮的直接技术原因。

3. 还是因为“整个处理绑在一起”？

也可能是。

有些 batch 逻辑不是“每条单独处理”，而是“先整体转换，再整体写入”，例如：

const normalized = records.map(normalizeRecord); // 一条出错，整个 map 直接失败
await db.insertMany(normalized);                 // 前面失败，这里根本不会执行

或者：

const validated = schema.array().parse(records);

这种写法是整批一起校验。只要数组里有一条不合法，整个 parse 就失败。

这时就不是单纯 try/catch 的问题，而是处理模型本身就是 all-or-nothing。

4. 这题里更合理的理解

这题强调：

脏数据来自第三方
当前系统会被脏数据打崩
你要做到 invalid record skip，valid record continue

所以它要你改成这种模式：

以前
batch-level validation
batch-level failure
一条坏数据 = 全部停
现在
record-level validation
record-level failure isolation
一条坏数据 = 只跳过这一条
5. 一句话总结

你可以这样记：

不是因为坏数据“天然”必须让整个 batch 失败，而是因为当前实现把错误传播成了 batch 级别。

常见原因有两个：

没有对单条记录做 try/catch / safeParse 隔离
处理逻辑本身是整批绑定的，比如整批 parse、整批 map、整批写入
6. 最直白的区别
会拖垮整个 batch 的写法
const parsed = schema.array().parse(records);
只跳过坏数据的写法
for (const record of records) {
  const result = schema.safeParse(record);
  if (!result.success) {
    skipped++;
    continue;
  }
  processed++;
}

我其实没怎么用过 Zod，这个是用来做 runtime type check 吗？和 TypeScript 的类型有什么区别？

很好，这个问题问得很关键 👍
很多人第一次用 Zod 都会疑惑这个点。

我帮你用最直接、工程角度讲清楚👇

🧠 一句话区别

👉 TypeScript 类型：只在编译时存在（开发时）
👉 Zod：在运行时检查真实数据（生产时）

🧩 1. TypeScript 在干什么？

比如你写：

type User = {
  age: number;
};

然后：

const user: User = JSON.parse(input);

👉 TypeScript会“假装”这是对的，但实际上：

input = { "age": "25+" }

运行时：

user.age === "25+" // ❗字符串

👉 不会报错！！

因为：

TypeScript 在编译后会被完全删除（erased）

⚠️ 关键问题

👉 TS 不会保护你免受脏数据攻击

这正是你这题的核心：

数据来自第三方 API
可能是错的
TS 完全管不了
🔥 2. Zod 在干什么？

Zod 是：

👉 运行时 schema validator

你写：

const schema = z.object({
  age: z.number()
});

然后：

schema.parse({ age: "25+" });

👉 运行时直接报错：

ZodError: Expected number, received string
🧪 safeParse（你这题用的）
const result = schema.safeParse(data);

if (!result.success) {
  // validation failed
}

👉 不会 throw，适合 batch processing

🧠 3. 用一句话理解

👉 TypeScript 是：

“我相信你写的代码是对的”

👉 Zod 是：

“我不相信外部数据，我要检查”

Dead Letter 这一块我有点不太理解：如果已经 skip 了坏数据，为什么还要把它存到 failed-records？这个是为了后面人工处理吗？生产环境一般是怎么做的？这个 traceId 是从哪里来的？LegacyApp 传过来的吗？

对，skip 和存 failed-records 不是重复动作，它们解决的是两个不同问题。

先说结论
skip：保证当前 batch 不被拖垮，继续处理好数据
failed-records / dead letter：保证坏数据不丢，后面还能查、补、重放、修复

所以它们通常是配套出现的。

为什么已经 skip 了，还要存下来

因为如果你只是 skip：

if (!valid) continue;

那这条数据就等于直接消失了。之后会有几个问题：

1. 你不知道到底丢了什么

比如业务方来问：

为什么今天少了 5 条用户画像？
为什么报表数量不对？
为什么某个客户的数据没入库？

如果没有 failed record，你根本没法回答。

2. 你没法后续修复

有些坏数据其实不是“彻底没救”，而是：

第三方字段格式临时变了
某个字段为空但后面能补
邮箱格式问题可以人工修正
schema 改了以后其实可以重新处理

如果没存下来，就没法重跑。

3. 你没法做根因分析

dead letter 能帮你统计：

最常见失败字段是什么
是哪个上游系统最常出错
是某次发布后才开始坏的
是单条偶发还是系统性格式漂移
你说的“为了后面人工处理吗？”

是，但不只是人工处理。

常见用途有三类：

1. 人工排查

开发或运营查看失败文件，确认原因。

2. 自动重试 / 重放

修完代码后，把 failed records 再喂一遍处理器。

3. 上游治理

拿失败样本去找第三方或上游团队，说：

你们返回了 "age": "25+"
你们把数组改成了逗号分隔字符串
你们最近多了非法邮箱格式
生产环境一般怎么做

不是都像你这题一样写成本地 failed-records/*.json，但思想完全一样。

常见做法 1：消息队列的 Dead Letter Queue

如果系统是 MQ/Kafka/SQS 这类架构：

正常消息处理失败
超过重试次数
自动送进 DLQ

然后后面：

监控告警
人工排查
批量 replay

这是最经典的生产方案。

常见做法 2：失败表 / error table

如果是数据库批处理：

正常数据进主表
失败数据进 failed_records 表

字段通常包括：

原始 payload
error code / error message
source
batch id / trace id
created_at
retry_count
status
常见做法 3：对象存储

像你这题的 failed-records/batch-xxx.json，生产里可能对应：

S3
GCS
Blob Storage

适合保存原始大 payload，后续做批量分析。

什么时候只 skip 不需要 dead letter？

只有在失败数据完全不重要时才可能这样做，比如：

临时脚本
测试数据
明确允许丢失的低价值日志

但只要数据和业务有关，通常都不应该静默丢弃。

traceId 是从哪里来的？

这取决于系统架构。

在真正的服务链路里

通常是请求入口生成，然后一路往后传。

比如：

Client -> LegacyApp -> Queue -> Worker -> DB / Logs

最常见是：

网关生成
或 LegacyApp 收到请求时生成
然后写进请求头、消息体、日志上下文里
Worker 继续沿用这个 traceId

所以你说的：

LegacyApp 传过来的吗？

对，生产里很可能就是 LegacyApp 或更前面的入口传过来。

为什么要从上游传，而不是每个服务自己乱生成？

因为 traceId 的目的就是把同一条业务链路串起来。

如果：

LegacyApp 一个 id
Queue 一个 id
Worker 又自己一个 id

那你就没法把这些日志关联成同一次请求。

你这题里为什么可以自己生成 traceId？

因为你现在做的是一个独立脚本：

pnpm run process:chaos

没有真正的 LegacyApp -> Worker 调用链，所以最简单做法是：

脚本启动时生成一个 batch 级别的 traceId
整个批次共用它

比如：

const traceId = `chaos-${Date.now()}`

这更准确地说，其实有点像 batchId / runId，只是你用 traceId 的形式表达。

这题里更合理的理解
如果你只做 process-chaos.ts

那 traceId 可以来自：

当前脚本启动时生成的批次 id
如果题目真接入 LegacyApp / Worker

那 traceId 更合理应该：

LegacyApp 生成
放进消息 payload 或 metadata
Worker 读取并继续写日志
failed record 里也保存它
你可以这样理解三者关系
traceId：这条处理链是谁
skip：别让它拖垮别人
dead letter：别让它无声消失

## Question 4

左图是第4个任务即要求【共5个】，有图是架构【包含所有需要处理的问题】，帮我分析下这个任务是什么，结果是什么，以及我需要快速熟悉这个项目的逻辑和解决问题的思路
已思考若干秒

这个第 4 个任务，本质上是在考你：

你能不能快速定位“第三方 API 明明返回了数据，但你们系统里却变成了 null”这种集成类问题。

它不是让你重做整个架构，而是让你沿着一条很具体的调用链，把“数据在哪一层丢了”查出来，然后把那一层修好。题目已经明确提示，最可能出问题的是 facade-audience.service.ts，而根因是第三方返回格式不一致，你当前代码只兼容了一种格式。

你可以把这个任务理解成三句话：

复现一个只影响少数 mediaId 的线上隐蔽 bug
沿调用链追踪，确认不是 API 没数据，而是你们解析错了
把 facade 层改成同时兼容新旧两种响应格式，并补上日志与保护逻辑
这个任务到底在做什么

系统链路很简单：

run-audience-test.ts
→ audience.service.ts
→ facade-audience.service.ts
→ mock-audience-api.ts

其中：

run-audience-test.ts 是入口脚本，负责跑一批测试数据
audience.service.ts 是业务层，向 facade 要 audience 数据
facade-audience.service.ts 是包装层，负责通过 Playwright 调第三方 API，再从 response 里取出真正要的 audience
mock-audience-api.ts 是模拟第三方接口，专门用来复现 bug 的

这个题的关键点是：

第三方接口没有挂，也不是 500，不是超时，不是鉴权失败。它返回 200 OK，而且有数据。
但你们 facade 层从 response 里取数据时，路径写死了，所以当返回结构稍微变一下时，就取不到了，于是业务层看到的就是 null。

预期结果是什么

你做完后，应该达到两个层面的结果。

1. 功能结果

运行：

pnpm simulate:audience-bug

修复前，某个特定 mediaId，比如 12345，会失败并返回 null。
修复后，所有测试数据都应该成功，不再出现错误。题目要求最终 Errors: 0。

2. 工程结果

你的代码不只是“刚好能跑”，还应该体现出：

能兼容两种 API response format
遇到未知格式时有清晰日志
不会因为某个字段不存在就悄悄吞掉问题
最好加上 TypeScript 类型保护，避免以后再犯一样的错
你需要先快速熟悉这个项目的逻辑

你现在不要一上来就改代码。最快的方法是先搞清楚：

第一层：业务目标

系统是要拿到 influencer 的 audience demographics，比如 gender 之类的分布数据。
业务层并不关心第三方接口具体长什么样，它只想拿到一个统一的 audience 结果。

所以 facade 的职责 就是：

去调第三方
把第三方各种奇怪格式整理成系统内部统一格式
出错时给出可排查的信息
第二层：bug 发生在哪

题目已经给你非常强的提示：

某些 mediaId 总是 null
第三方其实返回了 200 和数据
去看 [FacadeService] Raw response:
对比成功与失败数据结构差异
bug 很可能在 facade-audience.service.ts

这说明：
问题不在入口，不在业务层，不在 mock server“没返回”，而是在 facade 的 response parsing。

第三层：真正的根因

题目直接把两种格式给你了：

新格式：

{
  "status": "success",
  "data": {
    "audience": {
      "gender": [...]
    }
  }
}

老格式：

{
  "status": "success",
  "audience_data": {
    "demographics": {
      "gender": [...]
    }
  }
}

也就是说，你现在的代码大概率只写了类似：

response.data.audience

但遇到老格式时，真正数据在：

response.audience_data.demographics

所以自然就拿不到。

最快的解决思路

你可以按这个顺序排查，最快。

第一步：先复现

先跑：

pnpm simulate:audience-bug

确认哪个 mediaId 失败。题目里说典型是 12345。

第二步：看原始日志，不要先猜

重点看 facade 层打印的：

成功 case 的 raw response
失败 case 的 raw response

然后只问一个问题：

真正的 audience 数据分别藏在哪个字段路径里？

你会很快看到：成功和失败不是“有没有数据”的区别，而是“字段路径不同”的区别。

第三步：只修 facade，不要乱改别层

因为这个问题的本质是第三方响应适配问题，所以正确修复位置就是 facade。

不要在 audience.service.ts 里写一堆 if。
也不要改 mock server 去“统一成你喜欢的格式”，因为题目就是在模拟真实第三方不稳定。

第四步：把提取逻辑做成兼容式

核心思想是：

先判断是不是新格式
再判断是不是老格式
都不是就打 warning / error log
返回统一结果

比如伪代码思路：

if (response?.data?.audience) {
  return response.data.audience;
}

if (response?.audience_data?.demographics) {
  return response.audience_data.demographics;
}

log unexpected response shape;
return null;
第五步：补日志

这个题很看重日志质量。评分标准里专门写了日志和错误处理。

你至少应该让日志回答这几个问题：

当前处理的是哪个 mediaId
原始响应顶层 keys 是什么
命中了新格式还是老格式
如果没命中，缺的是什么字段

这样以后线上再出问题，几乎不用再靠猜。

pnpm simulate:audience-bug

> senior-backend-challenge@1.0.0 simulate:audience-bug D:\shuaibaole\jobs\2026\crowdcore\exam\-Senior-Backend-Challenge
> tsx apps/worker-service/src/audience-integration/run-audience-test.ts

============================================================
🎯 Audience Data Integration Test
============================================================

[MockAudienceAPI] Running on http://localhost:3001
✅ Mock API server started

📊 Testing with 3 influencers:
   1. instagram_id: 67890, tiktok_id: 11111
   2. instagram_id: 12345, tiktok_id: N/A
   3. instagram_id: 99999, tiktok_id: 22222

🚀 Starting batch fetch...

[AudienceService] Batch fetching for 3 influencers
[AudienceService] Fetching audience for instagram:67890
[FacadeService] Fetching audience for instagram:67890
[FacadeService] Using auth: slave1@test.com
[FacadeService] Raw response: {"status":"success","data":{"audience":{"gender":[{"label":"male","value":0.42},{"label":"female","value":0.58}],"age":[{"label":"18-24","value":0.35},{"label":"25-34","value":0.45},{"label":"35-44","
[AudienceService] ✅ Successfully fetched and mapped audience data
[AudienceService] Fetching audience for tiktok:11111
[FacadeService] Fetching audience for tiktok:11111
[FacadeService] Using auth: slave2@test.com
[FacadeService] Raw response: {"status":"success","data":{"audience":{"gender":[{"label":"male","value":0.42},{"label":"female","value":0.58}],"age":[{"label":"18-24","value":0.35},{"label":"25-34","value":0.45},{"label":"35-44","
[AudienceService] ✅ Successfully fetched and mapped audience data
[AudienceService] Fetching audience for instagram:12345
[FacadeService] Fetching audience for instagram:12345
[FacadeService] Using auth: slave3@test.com
[FacadeService] Raw response: {"status":"success","audience_data":{"demographics":{"gender":[{"label":"male","value":0.45},{"label":"female","value":0.55}]}}}
[FacadeService] ⚠️ Audience data is NULL - why??
[FacadeService] Available keys: [ 'status', 'audience_data' ]
[AudienceService] ❌ No data returned from facade layer
[AudienceService] mediaId: 12345
[AudienceService] platform: instagram
[AudienceService] Fetching audience for instagram:99999
[FacadeService] Fetching audience for instagram:99999
[FacadeService] Using auth: slave1@test.com
[FacadeService] Raw response: {"status":"success","data":{"audience":{"gender":[{"label":"male","value":0.42},{"label":"female","value":0.58}],"age":[{"label":"18-24","value":0.35},{"label":"25-34","value":0.45},{"label":"35-44","
[AudienceService] ✅ Successfully fetched and mapped audience data
[AudienceService] Fetching audience for tiktok:22222
[FacadeService] Fetching audience for tiktok:22222
[FacadeService] Using auth: slave2@test.com
[FacadeService] Raw response: {"status":"success","data":{"audience":{"gender":[{"label":"male","value":0.42},{"label":"female","value":0.58}],"age":[{"label":"18-24","value":0.35},{"label":"25-34","value":0.45},{"label":"35-44","
[AudienceService] ✅ Successfully fetched and mapped audience data

============================================================
📈 RESULTS
============================================================
✅ Success: 4/4.5 requests
❌ Errors: 1

🐛 Failed Requests:
   1. Platform: instagram, MediaId: 12345

💡 Hint: Check the logs above to see where the data became null
💡 Try adding console.logs in facade-audience.service.ts to see the raw response
✨ Successful Data (sample):
{
  "platform": "instagram",
  "mediaId": "67890",
  "gender": [
    {
      "label": "male",
      "value": 0.42
    },
    {
      "label": "female",
      "value": 0.58
    }
  ],
  "age": [
    {
      "label": "18-24",
      "value": 0.35
    },
    {
      "label": "25-34",
      "value": 0.45...
 ELIFECYCLE  Command failed with exit code 1.根据上面的log信息，原因可能是1）instagram_id: 12345, tiktok_id: N/A的tiktokid是NULL 2）"data":{"audience":{"gender":和"audience_data":{"demographics":{"gender":这俩数据格式不一致
已思考 4s

是 第 2 个原因，不是第 1 个原因。

你这个判断里，真正的根因就是响应格式不一致；tiktok_id: N/A 只是这个 influencer 没有 TikTok 数据，所以系统根本不会去请求 TikTok，不会导致这次失败。

为什么不是 tiktok_id 为 null 导致的

在 batchFetchAudienceData 里，只有当 data.tiktok_id 存在时才会调用：

if (data.tiktok_id) {
    const result = await this.fetchAudienceData('tiktok', data.tiktok_id);
}

所以第二条测试数据 { instagram_id: '12345' } 根本不会触发 TikTok 请求。失败的是这条 Instagram 请求本身，不是因为缺少 TikTok ID。

而且 run-audience-test.ts 也明确写了：

{ instagram_id: '12345' } 这个 case 预期就是“会返回 null（老格式）”
题目注释已经直接提示是老数据格式问题。
为什么就是“数据格式不一致”

你的日志已经把证据给全了：

成功 case 的 raw response 是：

{"status":"success","data":{"audience":{...}}}

失败 case 12345 的 raw response 是：

{"status":"success","audience_data":{"demographics":{"gender":[...]}}}

而 facade-audience.service.ts 里当前写死的提取逻辑是：

const extracted = audienceData.data?.audience;

也就是说它只会认 data.audience 这条路径。
当返回老格式 audience_data.demographics 时，audienceData.data 根本不存在，所以 extracted 就变成 undefined，然后一路传到 AudienceService，最后显示成 “No data returned from facade layer”。

同时，mock 第三方 API 也明确写了：
当 mediaId === '12345' 时，它故意返回 legacy 格式：

{
  status: 'success',
  audience_data: {
    demographics: { ... }
  }
}

正常情况才返回：

{
  status: 'success',
  data: {
    audience: { ... }
  }
}

这次 bug 的完整链路

可以这样理解：

run-audience-test.ts 传入 instagram_id: 12345
AudienceService 调用 facade 获取原始 audience 数据
mock API 对 12345 返回老格式 audience_data.demographics
FacadeAudienceService 只取 audienceData.data?.audience，没兼容老格式
提取结果是 undefined
AudienceService 看到 rawData 为空，报错并把这次请求记为失败

