/**
 * Replay Event Script
 *
 * 🎯 任务：实现这个脚本，使其能够从 debug-payloads/ 目录读取 JSON 文件，
 * 并直接调用 Worker 的处理逻辑（绕过消息队列）。
 *
 * 用法：pnpm run replay -- --file=debug-payloads/job-xxx.json
 *
 * TODO: 候选人需要实现以下功能：
 * 1. 解析命令行参数获取文件路径
 * 2. 读取 JSON 文件内容
 * 3. 初始化 AnalysisProcessor
 * 4. 调用 processor.process(event)
 * 5. 输出处理结果
 */
import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisRequestedEvent } from '@senior-challenge/shared-types';
import { AnalysisProcessor } from '../apps/worker-service/src/processors/analysis.processor';


// read json files from param --file=... 
function getReplayFilePath(args: string[]): string {
  const fileArg = args.find((arg) => arg.startsWith('--file='));

  if (!fileArg) {
      throw new Error('Missing required argument: --file=path/to/file.json');
  }

  const filePath = fileArg.slice('--file='.length).trim();

  if (!filePath) {
      throw new Error('Replay file path cannot be empty');
  }

  return filePath;
}

/**
 * Replay 主流程。
 *
 * 这里要做的事情很简单：
 * 1. 读取捕获好的 JSON payload
 * 2. 初始化 Worker 的 processor
 * 3. 直接调用 processor.process(event)
 *
 * 注意：这里是“绕过队列”的，这正是 replay 工具的价值所在。
 */
async function main(): Promise<void> {
  try {
      const args = process.argv.slice(2);
      const relativeFilePath = getReplayFilePath(args);
      const absoluteFilePath = path.resolve(process.cwd(), relativeFilePath);

      if (!fs.existsSync(absoluteFilePath)) {
          throw new Error(`Replay file not found: ${absoluteFilePath}`);
      }

      console.log(`🔁 Replaying payload from: ${absoluteFilePath}`);

      // 读取并解析之前 capture 下来的完整 payload。
      const rawContent = fs.readFileSync(absoluteFilePath, 'utf-8');
      const event: AnalysisRequestedEvent = JSON.parse(rawContent);

      // 初始化真正的业务处理器。
      const processor = new AnalysisProcessor();

      // 直接调用 Worker 的处理逻辑，绕过 SQS / local queue。
      await processor.process(event);

      console.log(`✅ Replay finished for job: ${event.jobId}`);
  } catch (error) {
      console.error('❌ Replay failed:', error);
      process.exit(1);
  }
}

void main();

// console.log('🚧 This script is not implemented yet!');
// console.log('📝 Your task: Implement the replay functionality.');
// console.log('');
// console.log('Hint: You should be able to run:');
// console.log('  pnpm run replay -- --file=debug-payloads/job-xxx.json');
// console.log('');
// console.log('And it should:');
// console.log('  1. Read the JSON file');
// console.log('  2. Call AnalysisProcessor.process() directly');
// console.log('  3. Show the processing logs');
// console.log('  4. NOT require the queue poller to be running');

// process.exit(1);
