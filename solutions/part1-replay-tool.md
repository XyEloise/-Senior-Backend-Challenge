# 第一部分：Replay 工具实现记录

## 我的方案

我的实现分为两个部分：

### 1. Capture（消息捕获）

在 Worker 侧的 `QueuePoller` 中，当消费到一条消息时：

- 将完整的 `AnalysisRequestedEvent` payload 保存为 JSON 文件  
- 存储在项目根目录的 `debug-payloads/` 中  
- 使用 `jobId + timestamp` 作为文件名，避免冲突  

该功能通过环境变量控制：

```
CAPTURE_MODE=true
```

只有开启时才会保存 payload，不影响正常运行。

---

### 2. Replay（消息重放）

实现一个 CLI 脚本 `scripts/replay-event.ts`，支持：

```
pnpm run replay -- --file=debug-payloads/job-xxx.json
```

Replay 的核心逻辑是：

1. 读取 JSON 文件  
2. 解析为 `AnalysisRequestedEvent`  
3. 创建 `AnalysisProcessor`  
4. **直接调用 `processor.process(event)`**  
5. 输出处理日志  

整个过程：

- 不依赖 `QueuePoller`  
- 不依赖 `local-queue`  
- 不需要 LegacyApp  

实现了真正的本地快速复现。

---

### 3. 队列路径统一（关键修复）

由于该项目使用文件系统模拟 SQS，必须保证：

- Producer（LegacyApp）  
- Consumer（WorkerService）  

指向同一个 `local-queue` 目录。

我将两者统一为：

```
项目根目录/local-queue
```

通过使用 `path.resolve(__dirname, ...)` 替代 `process.cwd()`，避免不同服务运行目录不一致的问题。

---

## 关键代码

### 1. Capture Middleware

```ts
export function capturePayload(event: AnalysisRequestedEvent): void {
    if (process.env.CAPTURE_MODE !== 'true') {
        return;
    }

    const dir = path.resolve(__dirname, '../../../debug-payloads');

    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const filename = `${event.jobId}-${Date.now()}.json`;
    const filepath = path.join(dir, filename);

    fs.writeFileSync(filepath, JSON.stringify(event, null, 2), 'utf-8');

    console.log(`📦 Captured payload to ${filepath}`);
}
```

---

### 2. QueuePoller 中调用 Capture

```ts
const event: AnalysisRequestedEvent = JSON.parse(content);

console.log(`📨 Processing message: ${event.jobId}`);

capturePayload(event);

await this.processor.process(event);
```

---

### 3. Replay 脚本核心逻辑

```ts
const content = fs.readFileSync(absoluteFilePath, 'utf-8');
const event: AnalysisRequestedEvent = JSON.parse(content);

const processor = new AnalysisProcessor();

await processor.process(event);

console.log(`✅ Replay finished for job: ${event.jobId}`);
```

---

## 遇到的问题和解决方法

### 问题 1：Worker 无法消费消息

**现象：**

- `pollLoop()` 正常运行  
- 未打印 `📨 Processing message`  
- `local-queue` 中存在 JSON 文件  

**原因：**

LegacyApp 和 Worker 使用了不同的队列目录：

- LegacyApp：`apps/legacy-app/local-queue`  
- Worker：`root/local-queue`  

**解决方案：**

统一路径：

```ts
// LegacyApp
path.resolve(__dirname, '../../../../../local-queue')

// Worker
path.resolve(__dirname, '../../../local-queue')
```

---

## 验收结果

```bash
pnpm run replay -- --file=debug-payloads/73550d8d-ede7-4a59-8a1e-a67daa4627ea-1774315874551.json

> senior-backend-challenge@1.0.0 replay
> tsx scripts/replay-event.ts "--file=debug-payloads/..."

🔁 Replaying payload from: D:\...\debug-payloads\73550d8d-....json
Processing job: 73550d8d-ede7-4a59-8a1e-a67daa4627ea
Connected to MongoDB
Job completed: 73550d8d-ede7-4a59-8a1e-a67daa4627ea
✅ Replay finished for job: 73550d8d-ede7-4a59-8a1e-a67daa4627ea
```
