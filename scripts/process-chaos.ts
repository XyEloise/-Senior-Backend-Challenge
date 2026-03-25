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



import 'reflect-metadata';
import fs from 'fs/promises';
import path from 'path';
import { Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsInt,
  IsNumber,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateIf,
  ValidationError,
  validate,
} from 'class-validator';

/**
 * ===============================
 * 1) DTO 定义
 * ===============================
 *
 * 关键点：
 * - 不使用 @IsOptional()
 *   因为 @IsOptional() 会把 null 也跳过校验
 * - 这里使用 @ValidateIf((_, value) => value !== undefined)
 *   语义是：只有字段“缺失”时才跳过；如果字段存在，即使是 null，也必须校验并报错
 *
 * 这更符合题目中对 dirty data 的描述：
 * - 有些 age 是 25
 * - 有些 age 是 "25+"
 * - 有些 age 是 null
 * 上述 null 应该视为脏数据，而不是默默放过
 */
class ChaosRecordDto {
  @IsString()
  @MinLength(1)
  id!: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  age?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  gender?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  country?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  city?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ValidateIf((_, value) => value !== undefined)
  @IsNumber()
  @Min(0)
  @Max(1)
  engagementScore?: number;

  @ValidateIf((_, value) => value !== undefined)
  @IsEmail()
  email?: string;
}

/**
 * 失败记录结构
 * 用于写入 failed-records/batch-xxx.json
 */
interface FailedRecordEntry {
  recordId: string | null;
  traceId: string;
  reason: Array<{
    field: string;
    message: string;
    rawValue: unknown;
  }>;
  rawPayload: unknown;
  timestamp: string;
}

/**
 * ===============================
 * 2) Logger
 * ===============================
 *
 * 按题目要求：
 * - 不再使用 console.log / console.error
 * - 使用结构化日志
 * - 每条日志都带 traceId
 */
const logger = new Logger('ProcessChaosScript');

/**
 * 统一输出结构化日志
 */
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
    default:
      logger.log(message);
  }
}

/**
 * ===============================
 * 3) 工具函数：安全获取嵌套字段值
 * ===============================
 *
 * 例如 path = "tags.0" 时，尝试从原始对象里取值
 */
function getValueByPath(obj: unknown, fieldPath: string): unknown {
  if (!fieldPath) {
    return obj;
  }

  const segments = fieldPath.split('.');
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return current;
    }

    if (typeof current !== 'object') {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/**
 * ===============================
 * 4) 将 class-validator 错误扁平化
 * ===============================
 *
 * 输出格式示例：
 * [
 *   { field: "age", message: "age must not be less than 1", rawValue: "25+" }
 * ]
 */
function flattenValidationErrors(
  errors: ValidationError[],
  rootPayload: unknown,
  parentPath = ''
): Array<{ field: string; message: string; rawValue: unknown }> {
  const flattened: Array<{ field: string; message: string; rawValue: unknown }> =
    [];

  for (const error of errors) {
    const currentPath = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;

    if (error.constraints) {
      for (const message of Object.values(error.constraints)) {
        flattened.push({
          field: currentPath,
          message,
          rawValue: getValueByPath(rootPayload, currentPath),
        });
      }
    }

    if (error.children && error.children.length > 0) {
      flattened.push(
        ...flattenValidationErrors(error.children, rootPayload, currentPath)
      );
    }
  }

  return flattened;
}

/**
 * ===============================
 * 5) 单条记录校验
 * ===============================
 *
 * - 使用 plainToInstance 将原始对象转为 DTO
 * - whitelist: false，因为题目没要求裁剪未知字段
 * - forbidUnknownValues: true，用于拒绝明显不合法的顶层值
 */
async function validateRecord(
  rawRecord: unknown
): Promise<{
  isValid: boolean;
  dto?: ChaosRecordDto;
  errors?: Array<{ field: string; message: string; rawValue: unknown }>;
}> {
  const dto = plainToInstance(ChaosRecordDto, rawRecord);

  const validationErrors = await validate(dto, {
    whitelist: false,
    forbidUnknownValues: true,
  });

  if (validationErrors.length > 0) {
    return {
      isValid: false,
      errors: flattenValidationErrors(validationErrors, rawRecord),
    };
  }

  return {
    isValid: true,
    dto,
  };
}

/**
 * ===============================
 * 6) 主流程
 * ===============================
 */
async function main(): Promise<void> {
  /**
   * 题目要求 traceId 从 LegacyApp 透传。
   * 这个独立脚本没有真实上游调用方，因此这里生成一个 batch 级 traceId 来模拟。
   */
  const traceId = `chaos-batch-${Date.now()}`;

  /**
   * 路径说明：
   * 假设本脚本位于 scripts/process-chaos.ts
   * 数据位于 debug-payloads/chaos-data-samples.json
   * 输出位于 failed-records/
   */
  const projectRoot = path.resolve(__dirname, '..');
  const inputPath = path.join(projectRoot, 'debug-payloads', 'chaos-data-samples.json');
  const failedDir = path.join(projectRoot, 'failed-records');

  await fs.mkdir(failedDir, { recursive: true });

  logStructured('log', {
    event: 'BatchStarted',
    traceId,
    inputPath,
  });

  const rawFileContent = await fs.readFile(inputPath, 'utf-8');
  const parsed = JSON.parse(rawFileContent) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('Input JSON must be an array of records.');
  }

  const records = parsed;

  let processed = 0;
  let skipped = 0;

  const failedRecords: FailedRecordEntry[] = [];

  for (const rawRecord of records) {
    const recordId =
      rawRecord &&
      typeof rawRecord === 'object' &&
      'id' in rawRecord &&
      typeof (rawRecord as Record<string, unknown>).id === 'string'
        ? ((rawRecord as Record<string, unknown>).id as string)
        : null;

    try {
      const result = await validateRecord(rawRecord);

      if (!result.isValid) {
        skipped++;

        logStructured('warn', {
          event: 'ValidationFailed',
          traceId,
          jobId: 'chaos-data-batch',
          recordId,
          errors: result.errors,
        });

        failedRecords.push({
          recordId,
          traceId,
          reason: result.errors ?? [],
          rawPayload: rawRecord,
          timestamp: new Date().toISOString(),
        });

        continue;
      }

      /**
       * 这里模拟“正常处理”
       * 面试题重点不是业务处理逻辑，而是：
       * - 校验
       * - 日志
       * - 跳过坏数据
       * - dead letter
       */
      processed++;

      logStructured('log', {
        event: 'RecordProcessed',
        traceId,
        jobId: 'chaos-data-batch',
        recordId: result.dto?.id ?? recordId,
      });
    } catch (error) {
      /**
       * 防御式编程：
       * 即使单条记录处理过程中出现非校验类异常，也不能让整个 batch 崩掉
       */
      skipped++;

      const message =
        error instanceof Error ? error.message : 'Unknown processing error';

      logStructured('error', {
        event: 'RecordProcessingCrashed',
        traceId,
        jobId: 'chaos-data-batch',
        recordId,
        error: message,
      });

      failedRecords.push({
        recordId,
        traceId,
        reason: [
          {
            field: '_record',
            message,
            rawValue: rawRecord,
          },
        ],
        rawPayload: rawRecord,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * ===============================
   * 7) Dead Letter 输出
   * ===============================
   */
  let failedOutputRelativePath = 'N/A';

  if (failedRecords.length > 0) {
    const batchFileName = `batch-${Date.now()}.json`;
    const failedOutputPath = path.join(failedDir, batchFileName);

    await fs.writeFile(
      failedOutputPath,
      JSON.stringify(failedRecords, null, 2),
      'utf-8'
    );

    failedOutputRelativePath = `failed-records/${batchFileName}`;

    logStructured('warn', {
      event: 'DeadLetterWritten',
      traceId,
      outputPath: failedOutputRelativePath,
      failedCount: failedRecords.length,
    });
  }

  /**
   * ===============================
   * 8) 结果输出
   * ===============================
   *
   * 注意：
   * 按题意严格处理 null 等脏数据后，
   * 这份样本更合理的结果应是：
   *   Processed: 5
   *   Skipped: 7
   *
   * 因为 present-but-null 不应被当成“正常缺失”
   */
  logger.log(`✅ Processed: ${processed} records`);
  logger.log(`⚠️ Skipped (validation failed): ${skipped} records`);

  if (failedRecords.length > 0) {
    logger.log(`📁 Failed records saved to: ${failedOutputRelativePath}`);
  } else {
    logger.log('📁 No failed records');
  }

  logStructured('log', {
    event: 'BatchCompleted',
    traceId,
    processed,
    skipped,
    failedRecordsOutput: failedOutputRelativePath,
  });
}

/**
 * 顶层兜底：
 * 只处理“批次级”致命异常，例如：
 * - 文件不存在
 * - JSON 格式非法
 *
 * 这种异常说明整个输入环境有问题，脚本应退出非 0
 */
main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown fatal error';

  logger.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event: 'BatchFatalError',
      traceId: `fatal-${Date.now()}`,
      error: message,
    })
  );

  process.exit(1);
});