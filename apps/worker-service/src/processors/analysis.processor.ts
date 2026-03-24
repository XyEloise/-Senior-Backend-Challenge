import mongoose from 'mongoose';
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
 * Analysis Processor - processes analysis jobs from the queue.
 *
 * 修复内容：
 * 1. Worker 成为 demographics 的唯一计算与写入入口
 * 2. 使用 version + 条件更新实现乐观锁，避免脏写
 * 3. 增加结构化日志，提升可观测性
 * 4. 对第三方 API 脏数据进行清洗与校验
 */
export class AnalysisProcessor implements MessageProcessor {
    private connection: mongoose.Connection | null = null;

    constructor() {
        void this.initializeDatabase();
    }

    private log(level: 'log' | 'warn' | 'error', message: string, context: Record<string, unknown> = {}): void {
        const entry = {
            level,
            component: 'AnalysisProcessor',
            message,
            timestamp: new Date().toISOString(),
            ...context,
        };

        const line = JSON.stringify(entry);
        if (level === 'error') {
            console.error(line);
            return;
        }
        if (level === 'warn') {
            console.warn(line);
            return;
        }
        console.log(line);
    }

    private async initializeDatabase(): Promise<void> {
        try {
            await mongoose.connect(MONGODB_URI);
            this.connection = mongoose.connection;
            this.log('log', 'Connected to MongoDB', {
                stage: 'DB_CONNECT',
                mongoUri: MONGODB_URI,
            });
        } catch (error) {
            const err = error as Error;
            this.log('error', 'Failed to connect to MongoDB', {
                stage: 'DB_CONNECT',
                mongoUri: MONGODB_URI,
                errorMessage: err.message,
                stack: err.stack,
            });
        }
    }

    /**
     * Processes an analysis request.
     *
     * 状态流：PENDING -> PROCESSING -> COMPLETED / FAILED
     */
    async process(event: AnalysisRequestedEvent): Promise<void> {
        const { jobId, dataUrl, traceId } = event;
        const logContext = {
            jobId,
            traceId: traceId ?? jobId,
            dataUrl,
        };

        this.log('log', 'Received analysis event', {
            ...logContext,
            stage: 'EVENT_RECEIVED',
        });

        try {
            const currentJob = await this.findJob(jobId);
            if (!currentJob) {
                this.log('error', 'Job not found', {
                    ...logContext,
                    stage: 'LOAD_JOB',
                });
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
                this.log('warn', 'Skipped processing because optimistic lock failed', {
                    ...logContext,
                    stage: 'SET_PROCESSING',
                    expectedVersion: currentVersion,
                    status: 'PENDING',
                });
                return;
            }

            const apiResponse = await this.callThirdPartyApi(dataUrl);

            this.log('log', 'Third-party API responded', {
                ...logContext,
                stage: 'THIRD_PARTY_RESPONSE',
                apiSuccess: apiResponse.success,
                rawData: apiResponse.data ?? null,
            });

            const demographics = this.transformApiResponseSafe(apiResponse, logContext);

            this.log('log', 'Normalized demographics payload', {
                ...logContext,
                stage: 'NORMALIZATION_COMPLETED',
                demographics,
            });

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
                this.log('warn', 'Skipped final write because optimistic lock failed', {
                    ...logContext,
                    stage: 'PERSIST_RESULT',
                    expectedVersion: currentVersion + 1,
                    status: 'PROCESSING',
                });
                return;
            }

            this.log('log', 'Job completed', {
                ...logContext,
                stage: 'COMPLETED',
                status: 'COMPLETED',
                demographics,
            });
        } catch (error) {
            const err = error as Error;

            this.log('error', 'Processing failed', {
                ...logContext,
                stage: 'FAILED',
                status: 'FAILED',
                errorMessage: err.message,
                stack: err.stack,
            });

            await this.markJobFailed(jobId, err.message, {
                ...logContext,
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
     */
    private transformApiResponseSafe(
        response: ThirdPartyApiResponse,
        logContext: Record<string, unknown>,
    ): Demographics {
        if (!response.success || !response.data) {
            this.log('warn', 'Third-party API returned empty or unsuccessful payload', {
                ...logContext,
                stage: 'NORMALIZE_RESPONSE',
                apiSuccess: response.success,
            });

            return {
                ageRange: 'unknown',
                gender: 'unknown',
                location: 'unknown',
                interests: [],
                confidence: 0,
            };
        }

        const data = response.data;

        const age = this.normalizeAge(data.age, logContext);
        const gender = this.normalizeGender(data.gender, logContext);
        const location = this.normalizeLocation(data.country, data.city, logContext);
        const interests = this.normalizeTags(data.tags, logContext);
        const confidence = this.normalizeScore(data.score, logContext);

        return {
            ageRange: this.calculateAgeRangeSafe(age),
            gender,
            location,
            interests,
            confidence,
        };
    }

    private normalizeAge(age: unknown, logContext: Record<string, unknown>): number | null {
        if (typeof age === 'number' && Number.isFinite(age)) {
            return age;
        }

        if (typeof age === 'string') {
            const parsed = Number.parseInt(age, 10);
            if (!Number.isNaN(parsed)) {
                this.log('warn', 'Normalized non-numeric age string', {
                    ...logContext,
                    stage: 'NORMALIZE_AGE',
                    originalAge: age,
                    normalizedAge: parsed,
                });
                return parsed;
            }
        }

        this.log('warn', 'Age missing or invalid', {
            ...logContext,
            stage: 'NORMALIZE_AGE',
            originalAge: age ?? null,
        });

        return null;
    }

    private normalizeGender(gender: unknown, logContext: Record<string, unknown>): string {
        if (typeof gender === 'string' && gender.trim().length > 0) {
            return gender.trim().toLowerCase();
        }

        this.log('warn', 'Gender missing or invalid, defaulted to unknown', {
            ...logContext,
            stage: 'NORMALIZE_GENDER',
            originalGender: gender ?? null,
            normalizedGender: 'unknown',
        });

        return 'unknown';
    }

    private normalizeLocation(
        country: unknown,
        city: unknown,
        logContext: Record<string, unknown>,
    ): string {
        if (typeof country === 'string' && country.trim().length > 0) {
            return country.trim();
        }

        if (typeof city === 'string' && city.trim().length > 0) {
            this.log('warn', 'Country missing, fallback to city', {
                ...logContext,
                stage: 'NORMALIZE_LOCATION',
                originalCountry: country ?? null,
                originalCity: city,
                normalizedLocation: city.trim(),
            });
            return city.trim();
        }

        this.log('warn', 'Location missing, defaulted to unknown', {
            ...logContext,
            stage: 'NORMALIZE_LOCATION',
            originalCountry: country ?? null,
            originalCity: city ?? null,
            normalizedLocation: 'unknown',
        });

        return 'unknown';
    }

    private normalizeTags(tags: unknown, logContext: Record<string, unknown>): string[] {
        if (Array.isArray(tags)) {
            return tags
                .filter((tag): tag is string => typeof tag === 'string')
                .map((tag) => tag.trim())
                .filter(Boolean);
        }

        if (typeof tags === 'string') {
            const normalizedTags = tags
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean);

            this.log('warn', 'Normalized string tags into array', {
                ...logContext,
                stage: 'NORMALIZE_TAGS',
                originalTags: tags,
                normalizedTags,
            });

            return normalizedTags;
        }

        this.log('warn', 'Tags missing or invalid, defaulted to empty array', {
            ...logContext,
            stage: 'NORMALIZE_TAGS',
            originalTags: tags ?? null,
            normalizedTags: [],
        });

        return [];
    }

    private normalizeScore(score: unknown, logContext: Record<string, unknown>): number {
        if (typeof score === 'number' && Number.isFinite(score)) {
            return score;
        }

        if (typeof score === 'string') {
            const parsed = Number.parseFloat(score);
            if (!Number.isNaN(parsed)) {
                this.log('warn', 'Normalized string score into number', {
                    ...logContext,
                    stage: 'NORMALIZE_SCORE',
                    originalScore: score,
                    normalizedScore: parsed,
                });
                return parsed;
            }
        }

        this.log('warn', 'Score missing or invalid, defaulted to 0', {
            ...logContext,
            stage: 'NORMALIZE_SCORE',
            originalScore: score ?? null,
            normalizedScore: 0,
        });

        return 0;
    }

    /**
     * ✅ 修复：安全年龄段计算
     * 避免 null / 非法值导致错误年龄段
     */
    private calculateAgeRangeSafe(age: number | null): string {
        if (age === null || !Number.isFinite(age) || age < 0) {
            return 'unknown';
        }

        if (age < 18) return 'under-18';
        if (age < 25) return '18-24';
        if (age < 35) return '25-34';
        if (age < 45) return '35-44';
        if (age < 55) return '45-54';
        return '55+';
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

        this.log('log', 'Attempted job status transition', {
            ...logContext,
            fromStatus,
            toStatus,
            expectedVersion,
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
        });

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

        this.log('log', 'Attempted to persist final job result', {
            ...logContext,
            expectedVersion,
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
        });

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

        this.log('log', 'Marked job as FAILED', {
            ...logContext,
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
            errorMessage,
        });
    }
}
