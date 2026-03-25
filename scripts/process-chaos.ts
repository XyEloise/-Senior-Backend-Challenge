// /**
//  * Process Chaos Data Script
//  *
//  * 🎯 任务：处理 debug-payloads/chaos-data-samples.json 中的脏数据。
//  *
//  * 当前期望的输出：
//  *   ✅ Processed: X records
//  *   ⚠️ Skipped (validation failed): Y records
//  *   📁 Failed records saved to: failed-records/batch-xxx.json
//  *
//  * TODO: 候选人需要实现以下功能：
//  * 1. 读取 chaos-data-samples.json
//  * 2. 使用 Zod 或 class-validator 校验每条记录
//  * 3. 有效记录正常处理
//  * 4. 无效记录记录到 failed-records/ 目录，包含失败原因
//  * 5. 输出统计信息
//  */

// import fs from 'fs/promises';
// import path from 'path';
// import { z } from 'zod';

// /**
//  * ===============================
//  * 1. 定义数据 Schema（核心）
//  * ===============================
//  */
// const RecordSchema = z.object({
//   id: z.string(),

//   age: z.number().int().positive().optional(),

//   gender: z.string().optional(),

//   country: z.string().optional(),
//   city: z.string().optional(),

//   tags: z.array(z.string()).optional(),

//   engagementScore: z.number().min(0).max(1).optional(),

//   email: z.string().email().optional(),
// });

// /**
//  * ===============================
//  * 2. 简单结构化日志
//  * ===============================
//  */
// function log(
//   level: 'info' | 'warn' | 'error',
//   payload: Record<string, unknown>
// ) {
//   console[level](
//     JSON.stringify({
//       timestamp: new Date().toISOString(),
//       ...payload,
//     })
//   );
// }

// /**
//  * ===============================
//  * 3. 主流程
//  * ===============================
//  */
// async function main() {
//   const traceId = `chaos-${Date.now()}`;

//   const inputPath = path.join(
//     __dirname,
//     '../debug-payloads/chaos-data-samples.json'
//   );

//   const failedDir = path.join(__dirname, '../failed-records');

//   // 确保目录存在
//   await fs.mkdir(failedDir, { recursive: true });

//   // 读取数据
//   const rawData = await fs.readFile(inputPath, 'utf-8');
//   const records = JSON.parse(rawData);

//   let processed = 0;
//   let skipped = 0;

//   const failedRecords: any[] = [];

//   for (const raw of records) {
//     const result = RecordSchema.safeParse(raw);

//     if (!result.success) {
//       skipped++;

//       const errors = result.error.issues.map((e) => ({
//         field: e.path.join('.'),
//         message: e.message,
//       }));

//       log('warn', {
//         event: 'ValidationFailed',
//         traceId,
//         recordId: raw.id,
//         errors,
//       });

//       failedRecords.push({
//         recordId: raw.id,
//         traceId,
//         reason: errors,
//         rawPayload: raw,
//         timestamp: new Date().toISOString(),
//       });

//       continue;
//     }

//     // 模拟“正常处理”
//     processed++;

//     log('info', {
//       event: 'RecordProcessed',
//       traceId,
//       recordId: result.data.id,
//     });
//   }

//   /**
//    * ===============================
//    * 4. 保存 Dead Letter
//    * ===============================
//    */
//   const batchFile = `batch-${Date.now()}.json`;
//   const failedPath = path.join(failedDir, batchFile);

//   if (failedRecords.length > 0) {
//     await fs.writeFile(
//       failedPath,
//       JSON.stringify(failedRecords, null, 2),
//       'utf-8'
//     );
//   }

//   /**
//    * ===============================
//    * 5. 输出统计
//    * ===============================
//    */
//   console.log('');
//   console.log(`✅ Processed: ${processed} records`);
//   console.log(`⚠️ Skipped (validation failed): ${skipped} records`);

//   if (failedRecords.length > 0) {
//     console.log(`📁 Failed records saved to: failed-records/${batchFile}`);
//   } else {
//     console.log(`📁 No failed records`);
//   }
// }

// main().catch((err) => {
//   console.error('Fatal error:', err);
//   process.exit(1);
// });


// // console.log('🚧 This script is not implemented yet!');
// // console.log('📝 Your task: Implement chaos data processing with validation.');
// // console.log('');
// // console.log('Requirements:');
// // console.log('  1. Use Zod or class-validator for runtime validation');
// // console.log('  2. Valid records should be processed normally');
// // console.log('  3. Invalid records should be saved to failed-records/');
// // console.log('  4. Each failed record should include the reason for failure');
// // console.log('');
// // console.log('Expected output format:');
// // console.log('  ✅ Processed: 7 records');
// // console.log('  ⚠️ Skipped (validation failed): 5 records');
// // console.log('  📁 Failed records saved to: failed-records/batch-1234567890.json');

// // process.exit(1);


/**
 * process-chaos.ts
 *
 * 目标：
 * 1. 读取 chaos-data-samples.json
 * 2. 使用 class-validator 做 runtime validation
 * 3. 合法记录正常处理
 * 4. 非法记录不 crash 整个 batch，而是记录日志并写入 failed-records/
 * 5. 所有日志都带 traceId，且使用 Nest Logger 而不是 console
 */

import fs from 'fs/promises';
import path from 'path';
import { Logger } from '@nestjs/common';
import 'reflect-metadata';
import {
  IsArray,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validate,
  ValidationError,
} from 'class-validator';
import { plainToInstance } from 'class-transformer';

/**
 * ===============================
 * 1. DTO / Schema 定义
 * ===============================
 *
 * 说明：
 * - 这里用 class-validator 代替 zod，贴近 NestJS 生态
 * - 不做 fallback，不把脏数据偷偷转成“看起来正常”
 * - 字段 optional 表示“可缺失”
 * - 但如果字段出现了，就必须满足类型和约束
 */
class ChaosRecordDto {
  @IsString()
  @MinLength(1)
  id!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  age?: number;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  engagementScore?: number;

  @IsOptional()
  @IsEmail()
  email?: string;
}

/**
 * 失败记录结构
 */
interface FailedRecordEntry {
  recordId: string | null;
  traceId: string;
  batchTraceId: string;
  reason: Array<{
    field: string;
    messages: string[];
    value: unknown;
  }>;
  rawPayload: unknown;
  timestamp: string;
}

/**
 * 输入文件整体可能是纯数组，也可能未来扩展成：
 * { traceId, records: [...] }
 * 所以这里专门做一个解析函数，支持 traceId 透传。
 */
interface ParsedInput {
  batchTraceId: string;
  records: unknown[];
}

/**
 * ===============================
 * 2. Logger 封装
 * ===============================
 *
 * 说明：
 * - 底层使用 Nest Logger
 * - 输出结构化 JSON 字符串
 * - 避免再手写 console.log / console.error
 */
const logger = new Logger('ProcessChaosScript');

function logStructured(
  level: 'log' | 'warn' | 'error',
  payload: Record<string, unknown>
): void {
  const message = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...payload,
  });

  switch (level) {
    case 'log':
      logger.log(message);
      break;
    case 'warn':
      logger.warn(message);
      break;
    case 'error':
      logger.error(message);
      break;
  }
}

/**
 * ===============================
 * 3. 工具函数
 * ===============================
 */

/**
 * 将 class-validator 的错误格式整理成更适合日志 / DLQ 的结构
 */
function formatValidationErrors(
  errors: ValidationError[],
  raw: Record<string, unknown>
): Array<{ field: string; messages: string[]; value: unknown }> {
  return errors.map((error) => ({
    field: error.property,
    messages: error.constraints ? Object.values(error.constraints) : ['Unknown validation error'],
    value: raw[error.property],
  }));
}

/**
 * 解析输入文件。
 *
 * 支持两种输入形式：
 * 1) 直接数组：[{...}, {...}]
 * 2) 包装对象：{ traceId: "...", records: [{...}, {...}] }
 *
 * 注意：
 * - 这里不做“数据修复型 fallback”
 * - 如果整体文件结构错了，直接抛异常，让 main 的 catch 接管
 */
function parseInputFile(parsedJson: unknown): ParsedInput {
  if (Array.isArray(parsedJson)) {
    return {
      batchTraceId: `chaos-batch-${Date.now()}`,
      records: parsedJson,
    };
  }

  if (
    typeof parsedJson === 'object' &&
    parsedJson !== null &&
    'records' in parsedJson &&
    Array.isArray((parsedJson as { records: unknown[] }).records)
  ) {
    const obj = parsedJson as { traceId?: unknown; records: unknown[] };

    return {
      batchTraceId:
        typeof obj.traceId === 'string' && obj.traceId.trim().length > 0
          ? obj.traceId
          : `chaos-batch-${Date.now()}`,
      records: obj.records,
    };
  }

  throw new Error(
    'Invalid input file format: expected an array of records or an object with a records array.'
  );
}

/**
 * 单条记录校验。
 *
 * 说明：
 * - forbidUnknownValues: true，避免奇怪对象绕过
 * - whitelist: false，因为题目没有要求删除未知字段
 * - 不做 transform / implicit conversion，
 *   因为 "25+"、"0.72" 这类数据不应该被偷偷转成 number
 */
async function validateRecord(raw: unknown): Promise<{
  success: true;
  data: ChaosRecordDto;
} | {
  success: false;
  errors: Array<{ field: string; messages: string[]; value: unknown }>;
}> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      success: false,
      errors: [
        {
          field: 'record',
          messages: ['Record must be a non-null object'],
          value: raw,
        },
      ],
    };
  }

  const instance = plainToInstance(ChaosRecordDto, raw);

  const errors = await validate(instance, {
    whitelist: false,
    forbidUnknownValues: true,
    validationError: {
      target: false,
      value: false,
    },
  });

  if (errors.length > 0) {
    return {
      success: false,
      errors: formatValidationErrors(errors, raw as Record<string, unknown>),
    };
  }

  return {
    success: true,
    data: instance,
  };
}

/**
 * 模拟业务处理。
 *
 * 真实项目里，这里可能会：
 * - 调用 service
 * - 写数据库
 * - 发消息到队列
 *
 * 这里不做默认值补全，保证“坏数据不会伪装成好数据”
 */
async function processValidRecord(record: ChaosRecordDto, traceId: string): Promise<void> {
  logStructured('log', {
    event: 'RecordProcessed',
    traceId,
    recordId: record.id,
  });
}

/**
 * ===============================
 * 4. 主流程
 * ===============================
 */
async function main(): Promise<void> {
  const inputPath = path.resolve(process.cwd(), 'debug-payloads/chaos-data-samples.json');
  const failedDir = path.resolve(process.cwd(), 'failed-records');

  await fs.mkdir(failedDir, { recursive: true });

  const rawFileContent = await fs.readFile(inputPath, 'utf-8');
  const parsedJson: unknown = JSON.parse(rawFileContent);

  const { batchTraceId, records } = parseInputFile(parsedJson);

  logStructured('log', {
    event: 'ChaosBatchStarted',
    traceId: batchTraceId,
    inputPath,
    totalRecords: records.length,
  });

  let processed = 0;
  let skipped = 0;

  const failedRecords: FailedRecordEntry[] = [];

  for (const rawRecord of records) {
    /**
     * 单条记录也支持透传 traceId；
     * 若没有，则回退到 batchTraceId。
     *
     * 这里的“回退”不是业务字段 fallback，
     * 而是 observability 上的 trace 继承，这是合理的。
     */
    const recordTraceId =
      typeof rawRecord === 'object' &&
      rawRecord !== null &&
      'traceId' in rawRecord &&
      typeof (rawRecord as { traceId?: unknown }).traceId === 'string'
        ? ((rawRecord as { traceId: string }).traceId)
        : batchTraceId;

    const validationResult = await validateRecord(rawRecord);

    if (!validationResult.success) {
      skipped++;

      const recordId =
        typeof rawRecord === 'object' &&
        rawRecord !== null &&
        'id' in rawRecord &&
        typeof (rawRecord as { id?: unknown }).id === 'string'
          ? (rawRecord as { id: string }).id
          : null;

      logStructured('warn', {
        event: 'ValidationFailed',
        traceId: recordTraceId,
        batchTraceId,
        recordId,
        errors: validationResult.errors,
      });

      failedRecords.push({
        recordId,
        traceId: recordTraceId,
        batchTraceId,
        reason: validationResult.errors,
        rawPayload: rawRecord,
        timestamp: new Date().toISOString(),
      });

      continue;
    }

    await processValidRecord(validationResult.data, recordTraceId);
    processed++;
  }

  let failedRelativePath: string | null = null;

  if (failedRecords.length > 0) {
    const batchFile = `batch-${Date.now()}.json`;
    const failedPath = path.join(failedDir, batchFile);

    await fs.writeFile(failedPath, JSON.stringify(failedRecords, null, 2), 'utf-8');
    failedRelativePath = `failed-records/${batchFile}`;

    logStructured('warn', {
      event: 'DeadLetterSaved',
      traceId: batchTraceId,
      failedCount: failedRecords.length,
      outputPath: failedRelativePath,
    });
  }

  logger.log('');
  logger.log(`✅ Processed: ${processed} records`);
  logger.log(`⚠️ Skipped (validation failed): ${skipped} records`);
  logger.log(
    failedRelativePath
      ? `📁 Failed records saved to: ${failedRelativePath}`
      : '📁 No failed records',
  );
}

/**
 * 顶层异常只负责处理“批次级致命错误”，例如：
 * - 文件不存在
 * - JSON 解析失败
 * - 输入格式整体错误
 *
 * 单条坏记录不应该走这里，而应进入 validation + DLQ
 */
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown fatal error';
  const stack = error instanceof Error ? error.stack : undefined;

  logger.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'ChaosBatchFatalError',
      message,
      stack,
    })
  );

  process.exit(1);
});