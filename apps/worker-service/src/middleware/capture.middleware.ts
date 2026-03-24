import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisRequestedEvent } from '@senior-challenge/shared-types';

// const DEBUG_PAYLOAD_DIR = path.join(process.cwd(), 'debug-payloads');
const DEBUG_PAYLOAD_DIR = path.resolve(__dirname, '../../../../debug-payloads');
// const DEBUG_PAYLOAD_DIR = path.resolve(__dirname, '../../../debug-payloads');

export function capturePayload(event: AnalysisRequestedEvent): void {
    console.log("CAPTURE_MODE =", process.env.CAPTURE_MODE);
    
    // 未开启捕获模式时，直接跳过。
    if (process.env.CAPTURE_MODE !== 'true') {
        return;
    }

    // 如果目录不存在，则自动创建。
    if (!fs.existsSync(DEBUG_PAYLOAD_DIR)) {
        fs.mkdirSync(DEBUG_PAYLOAD_DIR, { recursive: true });
    }

    // 使用 jobId + 时间戳来命名，避免文件名冲突。
    const filename = `${event.jobId}-${Date.now()}.json`;
    const filepath = path.join(DEBUG_PAYLOAD_DIR, filename);

    // 保存格式化后的 JSON，方便人工查看与调试。
    fs.writeFileSync(filepath, JSON.stringify(event, null, 2), 'utf-8');

    console.log(`📦 Captured payload to ${filepath}`);
}
