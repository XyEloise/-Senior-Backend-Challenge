/**
 * Process Chaos Data Script
 *
 * 🎯 任务：处理 debug-payloads/chaos-data-samples.json 中的脏数据。
 *
 * 当前期望的输出：
 *   ✅ Processed: X records
 *   ⚠️ Skipped (validation failed): Y records
 *   📁 Failed records saved to: failed-records/batch-xxx.json
 *
 * TODO: 候选人需要实现以下功能：
 * 1. 读取 chaos-data-samples.json
 * 2. 使用 Zod 或 class-validator 校验每条记录
 * 3. 有效记录正常处理
 * 4. 无效记录记录到 failed-records/ 目录，包含失败原因
 * 5. 输出统计信息
 */

import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';

/**
 * ===============================
 * 1. 定义数据 Schema（核心）
 * ===============================
 */
const RecordSchema = z.object({
  id: z.string(),

  age: z.number().int().positive().optional(),

  gender: z.string().optional(),

  country: z.string().optional(),
  city: z.string().optional(),

  tags: z.array(z.string()).optional(),

  engagementScore: z.number().min(0).max(1).optional(),

  email: z.string().email().optional(),
});

/**
 * ===============================
 * 2. 简单结构化日志
 * ===============================
 */
function log(
  level: 'info' | 'warn' | 'error',
  payload: Record<string, unknown>
) {
  console[level](
    JSON.stringify({
      timestamp: new Date().toISOString(),
      ...payload,
    })
  );
}

/**
 * ===============================
 * 3. 主流程
 * ===============================
 */
async function main() {
  const traceId = `chaos-${Date.now()}`;

  const inputPath = path.join(
    __dirname,
    '../debug-payloads/chaos-data-samples.json'
  );

  const failedDir = path.join(__dirname, '../failed-records');

  // 确保目录存在
  await fs.mkdir(failedDir, { recursive: true });

  // 读取数据
  const rawData = await fs.readFile(inputPath, 'utf-8');
  const records = JSON.parse(rawData);

  let processed = 0;
  let skipped = 0;

  const failedRecords: any[] = [];

  for (const raw of records) {
    const result = RecordSchema.safeParse(raw);

    if (!result.success) {
      skipped++;

      const errors = result.error.issues.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));

      log('warn', {
        event: 'ValidationFailed',
        traceId,
        recordId: raw.id,
        errors,
      });

      failedRecords.push({
        recordId: raw.id,
        traceId,
        reason: errors,
        rawPayload: raw,
        timestamp: new Date().toISOString(),
      });

      continue;
    }

    // 模拟“正常处理”
    processed++;

    log('info', {
      event: 'RecordProcessed',
      traceId,
      recordId: result.data.id,
    });
  }

  /**
   * ===============================
   * 4. 保存 Dead Letter
   * ===============================
   */
  const batchFile = `batch-${Date.now()}.json`;
  const failedPath = path.join(failedDir, batchFile);

  if (failedRecords.length > 0) {
    await fs.writeFile(
      failedPath,
      JSON.stringify(failedRecords, null, 2),
      'utf-8'
    );
  }

  /**
   * ===============================
   * 5. 输出统计
   * ===============================
   */
  console.log('');
  console.log(`✅ Processed: ${processed} records`);
  console.log(`⚠️ Skipped (validation failed): ${skipped} records`);

  if (failedRecords.length > 0) {
    console.log(`📁 Failed records saved to: failed-records/${batchFile}`);
  } else {
    console.log(`📁 No failed records`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});


// console.log('🚧 This script is not implemented yet!');
// console.log('📝 Your task: Implement chaos data processing with validation.');
// console.log('');
// console.log('Requirements:');
// console.log('  1. Use Zod or class-validator for runtime validation');
// console.log('  2. Valid records should be processed normally');
// console.log('  3. Invalid records should be saved to failed-records/');
// console.log('  4. Each failed record should include the reason for failure');
// console.log('');
// console.log('Expected output format:');
// console.log('  ✅ Processed: 7 records');
// console.log('  ⚠️ Skipped (validation failed): 5 records');
// console.log('  📁 Failed records saved to: failed-records/batch-1234567890.json');

// process.exit(1);
