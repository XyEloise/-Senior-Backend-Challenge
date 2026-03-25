import mongoose from 'mongoose';
import { Logger } from '@nestjs/common';
import type {
    AnalysisRequestedEvent,
    Demographics,
    ThirdPartyApiResponse,
} from '@senior-challenge/shared-types';
import type { MessageProcessor } from './processor.interface';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/analysis_db';

type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

type JobDocument = {
    jobId: string;
    status: JobStatus;
    version?: number;
    [key: string]: unknown;
};

/**
 * 严格校验后的第三方 audience payload 结构。
 *
 * 这里不再允许“缺字段时给默认值继续跑”，
 * 而是要求进入 demographics 计算之前，数据必须满足最基本的业务契约。
 */
type StrictAudiencePayload = {
    age: number;
    gender: string;
    country: string;
    city?: string | null;
    tags: string[];
    score: number;
};

/**
 * 带上下文的第三方数据校验异常。
 *
 * 目的：
 * - 不再 silent fallback
 * - 直接把 schema 问题暴露给上层
 * - 便于日志、DLQ、重试、排障
 */
class ThirdPartyPayloadValidationError extends Error {
    readonly context: Record<string, unknown>;

    constructor(message: string, context: Record<string, unknown>) {
        super(message);
        this.name = 'ThirdPartyPayloadValidationError';
        this.context = context;
    }
}

/**
 * Analysis Processor - processes analysis jobs from the queue.
 *
 * 修复内容：
 * 1. Worker 成为 demographics 的唯一计算与写入入口
 * 2. 使用 version + 条件更新实现乐观锁，避免脏写
 * 3. 增加结构化日志，提升可观测性
 * 4. 对第三方 API 脏数据进行清洗与校验
 */
export class AnalysisProcessor implements MessageProcessor {
    private readonly logger = new Logger(AnalysisProcessor.name);
    private connection: mongoose.Connection | null = null;

    constructor() {
        void this.initializeDatabase();
    }

    private formatLog(
        level: 'log' | 'warn' | 'error',
        message: string,
        context: Record<string, unknown> = {},
    ): string {
        return JSON.stringify({
            level,
            component: AnalysisProcessor.name,
            message,
            timestamp: new Date().toISOString(),
            ...context,
        });
    }

    private async initializeDatabase(): Promise<void> {
        try {
            await mongoose.connect(MONGODB_URI);
            this.connection = mongoose.connection;
            this.logger.log(
                this.formatLog('log', 'Connected to MongoDB', {
                    stage: 'DB_CONNECT',
                    mongoUri: MONGODB_URI,
                }),
            );
        } catch (error) {
            const err = error as Error;
            this.logger.error(
                this.formatLog('error', 'Failed to connect to MongoDB', {
                    stage: 'DB_CONNECT',
                    mongoUri: MONGODB_URI,
                    errorMessage: err.message,
                    stack: err.stack,
                }),
            );
        }
    }

    /**
     * 处理分析任务。
     *
     * 状态流：
     * PENDING -> PROCESSING -> COMPLETED / FAILED
     *
     * 改动点：
     * - 如果第三方 payload 非法，不再伪装成成功结果
     * - 直接进入 catch，记录失败，并由 markJobFailed 持久化
     */
    async process(event: AnalysisRequestedEvent): Promise<void> {
        const { jobId, dataUrl, traceId } = event;
        const logContext = {
            jobId,
            traceId: traceId ?? jobId,
            dataUrl,
        };

        this.logger.log(
            this.formatLog('log', 'Received analysis event', {
                ...logContext,
                stage: 'EVENT_RECEIVED',
            }),
        );

        try {
            const currentJob = await this.findJob(jobId);
            if (!currentJob) {
                this.logger.error(
                    this.formatLog('error', 'Job not found', {
                        ...logContext,
                        stage: 'LOAD_JOB',
                    }),
                );
                return;
            }

            const currentVersion = typeof currentJob.version === 'number' ? currentJob.version : 0;

            const locked = await this.transitionJobStatus(
                jobId,
                currentVersion,
                'PENDING',
                'PROCESSING',
                {
                    ...logContext,
                    stage: 'SET_PROCESSING',
                },
            );

            if (!locked) {
                this.logger.warn(
                    this.formatLog('warn', 'Skipped processing because optimistic lock failed', {
                        ...logContext,
                        stage: 'SET_PROCESSING',
                        expectedVersion: currentVersion,
                        status: 'PENDING',
                    }),
                );
                return;
            }

            const apiResponse = await this.callThirdPartyApi(dataUrl);

            this.logger.log(
                this.formatLog('log', 'Third-party API responded', {
                    ...logContext,
                    stage: 'THIRD_PARTY_RESPONSE',
                    apiSuccess: apiResponse.success,
                    rawData: apiResponse.data ?? null,
                }),
            );

            const demographics = this.transformApiResponseSafe(apiResponse, logContext);

            this.logger.log(
                this.formatLog('log', 'Normalized demographics payload', {
                    ...logContext,
                    stage: 'NORMALIZATION_COMPLETED',
                    demographics,
                }),
            );

            const completed = await this.updateJobWithResults(
                jobId,
                currentVersion + 1,
                demographics,
                {
                    ...logContext,
                    stage: 'PERSIST_RESULT',
                },
            );

            if (!completed) {
                this.logger.warn(
                    this.formatLog('warn', 'Skipped final write because optimistic lock failed', {
                        ...logContext,
                        stage: 'PERSIST_RESULT',
                        expectedVersion: currentVersion + 1,
                        status: 'PROCESSING',
                    }),
                );
                return;
            }

            this.logger.log(
                this.formatLog('log', 'Job completed', {
                    ...logContext,
                    stage: 'COMPLETED',
                    status: 'COMPLETED',
                    demographics,
                }),
            );
        } catch (error) {
            const err = error as Error;

            const extraContext =
                error instanceof ThirdPartyPayloadValidationError
                    ? { validationContext: error.context }
                    : {};

            this.logger.error(
                this.formatLog('error', 'Processing failed', {
                    ...logContext,
                    ...extraContext,
                    stage: 'FAILED',
                    status: 'FAILED',
                    errorName: err.name,
                    errorMessage: err.message,
                    stack: err.stack,
                }),
            );

            await this.markJobFailed(jobId, err.message, {
                ...logContext,
                ...extraContext,
                stage: 'FAILED_PERSIST',
            });
        }
    }

    /**
     * Simulates calling a third-party API.
     * Returns "dirty" data with various format issues.
     */
    private async callThirdPartyApi(dataUrl: string): Promise<ThirdPartyApiResponse> {
        await new Promise((resolve) => setTimeout(resolve, 500 + Math.random() * 1000));

        const scenarios: ThirdPartyApiResponse[] = [
            {
                success: true,
                data: {
                    age: 28,
                    gender: 'female',
                    country: 'US',
                    city: 'New York',
                    tags: ['fashion', 'travel'],
                    score: 0.85,
                },
            },
            {
                success: true,
                data: {
                    age: '25+',
                    gender: 'male',
                    country: 'UK',
                    city: null,
                    tags: 'lifestyle,food',
                    score: '0.72',
                },
            },
            {
                success: true,
                data: {
                    age: null,
                    gender: undefined,
                    country: 'CA',
                    city: 'Toronto',
                    tags: null,
                    score: null,
                },
            },
        ];

        return scenarios[Math.floor(Math.random() * scenarios.length)];
    }

    /**
     * ✅ 修复：安全转换第三方 API 响应
     * - 不再直接 data.age as number
     * - 不再直接 data.tags as string[]
     * - 不再直接 data.score as number
     * 坏数据 -> 抛异常 -> 任务失败 -> 上层处理
     */
    private transformApiResponseSafe(
        response: ThirdPartyApiResponse,
        logContext: Record<string, unknown>,
    ): Demographics {
        const payload = this.validateAndParseThirdPartyPayload(response, logContext);

        return {
            ageRange: this.calculateAgeRange(payload.age),
            gender: payload.gender,
            location: this.buildLocation(payload.country, payload.city),
            interests: payload.tags,
            confidence: payload.score,
        };
    }

    /**
     * 对第三方返回做严格校验并解析。
     *
     * 只要有关键字段不满足契约，就直接抛出异常。
     * 不再用 unknown / [] / 0 伪装成一个“看起来正常”的结果。
     */
    private validateAndParseThirdPartyPayload(
        response: ThirdPartyApiResponse,
        logContext: Record<string, unknown>,
    ): StrictAudiencePayload {
        if (!response.success) {
            throw new ThirdPartyPayloadValidationError(
                'Third-party API responded with success=false',
                {
                    ...logContext,
                    stage: 'VALIDATE_THIRD_PARTY_RESPONSE',
                    apiSuccess: response.success,
                },
            );
        }

        if (!this.isRecord(response.data)) {
            throw new ThirdPartyPayloadValidationError(
                'Third-party API payload is missing or not an object',
                {
                    ...logContext,
                    stage: 'VALIDATE_THIRD_PARTY_RESPONSE',
                    receivedDataType: typeof response.data,
                    receivedData: response.data ?? null,
                },
            );
        }

        const data = response.data;

        return {
            age: this.requireFiniteNumber(data.age, 'age', logContext),
            gender: this.requireNonEmptyString(data.gender, 'gender', logContext).toLowerCase(),
            country: this.requireNonEmptyString(data.country, 'country', logContext),
            city: this.optionalNullableString(data.city, 'city', logContext),
            tags: this.requireStringArray(data.tags, 'tags', logContext),
            score: this.requireFiniteNumber(data.score, 'score', logContext),
        };
    }

    /**
     * 判断一个 unknown 是否为 object record。
     */
    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    /**
     * 要求字段必须是有限 number。
     * 否则抛出带上下文异常。
     */
    private requireFiniteNumber(
        value: unknown,
        fieldName: string,
        logContext: Record<string, unknown>,
    ): number {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }

        throw new ThirdPartyPayloadValidationError(
            `Invalid third-party field: ${fieldName} must be a finite number`,
            {
                ...logContext,
                stage: 'VALIDATE_FIELD',
                fieldName,
                receivedType: typeof value,
                receivedValue: value ?? null,
            },
        );
    }

    /**
     * 要求字段必须是非空字符串。
     * 否则抛出带上下文异常。
     */
    private requireNonEmptyString(
        value: unknown,
        fieldName: string,
        logContext: Record<string, unknown>,
    ): string {
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }

        throw new ThirdPartyPayloadValidationError(
            `Invalid third-party field: ${fieldName} must be a non-empty string`,
            {
                ...logContext,
                stage: 'VALIDATE_FIELD',
                fieldName,
                receivedType: typeof value,
                receivedValue: value ?? null,
            },
        );
    }

    /**
     * 可选字段：允许 string / null / undefined。
     * 如果是别的类型，说明 schema 仍然有问题，也应直接暴露。
     */
    private optionalNullableString(
        value: unknown,
        fieldName: string,
        logContext: Record<string, unknown>,
    ): string | null {
        if (value === undefined || value === null) {
            return null;
        }

        if (typeof value === 'string') {
            return value.trim();
        }

        throw new ThirdPartyPayloadValidationError(
            `Invalid third-party field: ${fieldName} must be string | null | undefined`,
            {
                ...logContext,
                stage: 'VALIDATE_FIELD',
                fieldName,
                receivedType: typeof value,
                receivedValue: value,
            },
        );
    }

    /**
     * 要求 tags 必须是 string[]。
     * 不再接受逗号拼接字符串并偷偷 split。
     *
     * 这是故意的：
     * - 以前这种做法属于 silent recovery
     * - 现在要把 schema 问题直接暴露出来
     */
    private requireStringArray(
        value: unknown,
        fieldName: string,
        logContext: Record<string, unknown>,
    ): string[] {
        if (
            Array.isArray(value) &&
            value.every((item) => typeof item === 'string' && item.trim().length > 0)
        ) {
            return value.map((item) => item.trim());
        }

        throw new ThirdPartyPayloadValidationError(
            `Invalid third-party field: ${fieldName} must be a non-empty string array`,
            {
                ...logContext,
                stage: 'VALIDATE_FIELD',
                fieldName,
                receivedType: Array.isArray(value) ? 'array' : typeof value,
                receivedValue: value ?? null,
            },
        );
    }

    /**
     * 年龄段计算。
     *
     * 这里不再需要 safe fallback，
     * 因为 age 在进入这里之前已经完成严格校验。
     */
    private calculateAgeRange(age: number): string {
        if (age < 0) {
            throw new Error('Age cannot be negative after validation');
        }

        if (age < 18) return 'under-18';
        if (age < 25) return '18-24';
        if (age < 35) return '25-34';
        if (age < 45) return '35-44';
        if (age < 55) return '45-54';
        return '55+';
    }

    /**
     * 位置拼接逻辑。
     *
     * 这里不是 fallback：
     * - country 是必填并且已经通过严格校验
     * - city 是可选补充信息
     */
    private buildLocation(country: string, city?: string | null): string {
        if (city && city.length > 0) {
            return `${country}, ${city}`;
        }

        return country;
    }

    private async findJob(jobId: string): Promise<JobDocument | null> {
        const collection = this.connection?.collection<JobDocument>('analysis_jobs');

        if (!collection) {
            throw new Error('Database not connected');
        }

        return collection.findOne({ jobId });
    }

    private async transitionJobStatus(
        jobId: string,
        expectedVersion: number,
        fromStatus: JobStatus,
        toStatus: JobStatus,
        logContext: Record<string, unknown>,
    ): Promise<boolean> {
        const collection = this.connection?.collection('analysis_jobs');

        if (!collection) {
            throw new Error('Database not connected');
        }

        const result = await collection.updateOne(
            { jobId, status: fromStatus, version: expectedVersion },
            {
                $set: {
                    status: toStatus,
                    updatedAt: new Date().toISOString(),
                },
                $inc: {
                    version: 1,
                },
            },
        );

        this.logger.log(
            this.formatLog('log', 'Attempted job status transition', {
                ...logContext,
                fromStatus,
                toStatus,
                expectedVersion,
                matchedCount: result.matchedCount,
                modifiedCount: result.modifiedCount,
            }),
        );

        return result.modifiedCount === 1;
    }

    private async updateJobWithResults(
        jobId: string,
        expectedVersion: number,
        demographics: Demographics,
        logContext: Record<string, unknown>,
    ): Promise<boolean> {
        const collection = this.connection?.collection('analysis_jobs');

        if (!collection) {
            throw new Error('Database not connected');
        }

        const now = new Date().toISOString();

        const result = await collection.updateOne(
            { jobId, status: 'PROCESSING', version: expectedVersion },
            {
                $set: {
                    status: 'COMPLETED',
                    demographics,
                    updatedAt: now,
                    completedAt: now,
                },
                $inc: {
                    version: 1,
                },
            },
        );

        this.logger.log(
            this.formatLog('log', 'Attempted to persist final job result', {
                ...logContext,
                expectedVersion,
                matchedCount: result.matchedCount,
                modifiedCount: result.modifiedCount,
            }),
        );

        return result.modifiedCount === 1;
    }

    private async markJobFailed(
        jobId: string,
        errorMessage: string,
        logContext: Record<string, unknown>,
    ): Promise<void> {
        const collection = this.connection?.collection('analysis_jobs');

        if (!collection) {
            return;
        }

        const result = await collection.updateOne(
            { jobId },
            {
                $set: {
                    status: 'FAILED',
                    error: errorMessage,
                    updatedAt: new Date().toISOString(),
                },
                $inc: {
                    version: 1,
                },
            },
        );

        this.logger.log(
            this.formatLog('log', 'Marked job as FAILED', {
                ...logContext,
                matchedCount: result.matchedCount,
                modifiedCount: result.modifiedCount,
                errorMessage,
            }),
        );
    }
}

