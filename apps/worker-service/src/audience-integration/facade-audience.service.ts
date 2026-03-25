/**
 * Facade Service - 包装第三方 Audience API 调用
 *
 * 模拟真实的 facade-upfluence.service.ts 逻辑：
 * - 使用 Playwright browser context
 * - Auth management
 * - 错误处理
 * - 兼容新旧两种 API 响应格式
 * 
 * 修复：
 * 1. 修复根因：兼容两种第三方响应格式
 * 2. 不使用 fallback（如 [] / 0 / 'unknown'）伪装成功
 * 3. 使用 Type Guards 做 schema narrowing
 * 4. 使用 Nest 原生 Logger
 * 5. 对未知/损坏 payload 显式抛出带 context 的异常，由上层接管
 */
import { Browser, BrowserContext, chromium } from 'playwright';
import { Logger } from '@nestjs/common';
import { MockAuthPool } from './mock-auth-pool';

// 平台类型
type MediaType = 'instagram' | 'tiktok';

/**
 * audience 分桶的最小单元。
 * 例如：
 * { label: 'male', value: 0.42 }
 * { label: '18-24', value: 0.35 }
 */
type AudienceBucket = {
    label: string;
    value: number;
};

/**
 * 系统内部统一后的 audience 数据结构。
 *
 * 注意：
 * - 当前仅建模已经在真实 payload 中出现的字段：gender / age
 * - 字段保持 optional，是为了兼容 legacy 响应可能只返回部分维度
 * - 但整个 audience 不能是“空壳对象”，这会在 type guard 中被拦掉
 */
type AudienceMetrics = {
    gender?: AudienceBucket[];
    age?: AudienceBucket[];
};

/**
 * 新格式响应：
 * {
 *   status: 'success',
 *   data: {
 *     audience: { ... }
 *   }
 * }
 */
type NewAudienceResponse = {
    status: 'success';
    data: {
        audience: AudienceMetrics;
        meta?: {
            media_id: string;
            platform: string;
            last_updated: string;
        };
    };
};

/**
 * 旧格式响应：
 * {
 *   status: 'success',
 *   audience_data: {
 *     demographics: { ... }
 *   }
 * }
 */
type LegacyAudienceResponse = {
    status: 'success';
    audience_data: {
        demographics: AudienceMetrics;
    };
};

/**
 * 第三方 API 业务失败时的宽松响应类型。
 *
 * 这里故意写得较宽松，因为第三方错误结构不一定稳定，
 * 只能把它当成“不可信输入”做识别，而不能强依赖。
 */
type AudienceApiErrorResponse = {
    status?: string;
    error?: string;
};

// 统一错误类型，便于日志和上层分类处理。
type AudienceApiErrorType =
    | 'http_request_failed'
    | 'business_status_failed'
    | 'unsupported_response_format'
    | 'unexpected_error';

// context-rich error
class AudienceApiError extends Error {
    constructor(
        message: string,
        public readonly type: AudienceApiErrorType,
        public readonly context: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'AudienceApiError';
    }
}

export class FacadeAudienceService {
    private readonly logger = new Logger(FacadeAudienceService.name);
    private authPool: MockAuthPool;
    private sharedBrowser: Browser | null = null;

    constructor() {
        this.authPool = new MockAuthPool();
    }

    /**
     * ========= 基础安全工具 =========
     */

    /**
     * 把 unknown 安全转成 Record
     * - 避免直接访问未知 payload 的属性
     * - 避免 Object.keys(null/undefined) 之类的运行时错误
     */
    private toRecord(value: unknown): Record<string, unknown> {
        return typeof value === 'object' && value !== null
            ? (value as Record<string, unknown>)
            : {};
    }

    // 判断是否为非空字符串
    private isNonEmptyString(value: unknown): value is string {
        return typeof value === 'string' && value.trim().length > 0;
    }

    // 判断是否为有效 number
    private isNumber(value: unknown): value is number {
        return typeof value === 'number' && Number.isFinite(value);
    }

    /**
     * ========= 深层结构校验 =========
     * 不只是判断“有没有”，而是判断“是不是合法结构”
     */

    // 单个 audience bucket 的严格校验
    private isAudienceBucket(value: unknown): value is AudienceBucket {
        const record = this.toRecord(value);
        return this.isNonEmptyString(record.label) && this.isNumber(record.value);
    }

    // audience bucket 数组校验
    private isAudienceBucketArray(value: unknown): value is AudienceBucket[] {
        return Array.isArray(value) && value.every(item => this.isAudienceBucket(item));
    }

    /**
     * audience metrics 的严格校验：
     * - 必须是 object
     * - 允许 partial（兼容 legacy）
     * - 但一旦字段存在，结构必须合法
     * - 至少要有一个合法 audience 维度，不能是空壳
     */
    private isAudienceMetrics(value: unknown): value is AudienceMetrics {
        if (typeof value !== 'object' || value === null) {
            return false;
        }

        const record = this.toRecord(value);
        let hasAtLeastOneValidDimension = false;

        if ('gender' in record) {
            if (!this.isAudienceBucketArray(record.gender)) {
                return false;
            }
            hasAtLeastOneValidDimension = true;
        }

        if ('age' in record) {
            if (!this.isAudienceBucketArray(record.age)) {
                return false;
            }
            hasAtLeastOneValidDimension = true;
        }

        return hasAtLeastOneValidDimension;
    }

    // 统一结构化日志输出
    private log(
        level: 'log' | 'warn' | 'error',
        event: string,
        context: Record<string, unknown> = {},
    ): void {
        const payload = JSON.stringify({
            event,
            ...context,
        });

        if (level === 'error') {
            this.logger.error(payload);
            return;
        }

        if (level === 'warn') {
            this.logger.warn(payload);
            return;
        }

        this.logger.log(payload);
    }

    // 当 payload 不符合预期 schema 时，日志里保留关键上下文
    private buildPayloadDebugContext(
        payload: unknown,
        mediaType: MediaType,
        mediaId: string,
    ): Record<string, unknown> {
        const record = this.toRecord(payload);
        return {
            mediaType,
            mediaId,
            responseStatus: record.status,
            topLevelKeys: Object.keys(record),
            dataKeys: Object.keys(this.toRecord(record.data)),
            audienceDataKeys: Object.keys(this.toRecord(record.audience_data)),
            rawResponsePreview: JSON.stringify(payload).substring(0, 300),
        };
    }

    /**
     * ========= Type Guards =========
     */

    /**
     * 判断是否为“新格式”响应
     * - status 必须是 success
     * - data 必须是 object
     * - data.audience 必须存在且通过深层结构校验
     */
    private isNewAudienceResponse(payload: unknown): payload is NewAudienceResponse {
        const record = this.toRecord(payload);

        if (record.status !== 'success') {
            return false;
        }

        if (typeof record.data !== 'object' || record.data === null) {
            return false;
        }

        const data = this.toRecord(record.data);

        if (typeof data.audience !== 'object' || data.audience === null) {
            return false;
        }

        return this.isAudienceMetrics(data.audience);
    }

    /**
     * 判断是否为“旧格式”响应。
     * - 先校验 audience_data 本身
     * - 再校验 demographics
     * - 最后做深层 metrics 校验
     */
    private isLegacyAudienceResponse(payload: unknown): payload is LegacyAudienceResponse {
        const record = this.toRecord(payload);

        if (record.status !== 'success') {
            return false;
        }

        if (typeof record.audience_data !== 'object' || record.audience_data === null) {
            return false;
        }

        const audienceData = this.toRecord(record.audience_data);

        if (
            typeof audienceData.demographics !== 'object' ||
            audienceData.demographics === null
        ) {
            return false;
        }

        return this.isAudienceMetrics(audienceData.demographics);
    }

    /**
     * 判断是否像第三方错误响应。
     * 这里保持宽松，因为错误 payload 的稳定性通常比 success payload 更差。
     */
    private isAudienceApiErrorResponse(payload: unknown): payload is AudienceApiErrorResponse {
        const record = this.toRecord(payload);

        const hasStatus = 'status' in record;
        const hasError = 'error' in record;

        if (!hasStatus && !hasError) {
            return false;
        }

        if (hasStatus && record.status !== undefined && typeof record.status !== 'string') {
            return false;
        }

        if (hasError && record.error !== undefined && typeof record.error !== 'string') {
            return false;
        }

        return true;
    }

    /**
     * 统一提取 audience 数据
     * 这里是 trust boundary：
     * - 命中新格式 -> 返回
     * - 命中旧格式 -> 返回
     * - 其他任何情况 -> 直接抛异常
     *
     * 不能 fallback 成空对象或 null 假装成功。
     */
    private extractAudienceData(
        payload: unknown,
        mediaType: MediaType,
        mediaId: string,
    ): AudienceMetrics {
        if (this.isNewAudienceResponse(payload)) {
            this.log('log', 'parsed_new_audience_format', {
                mediaType,
                mediaId,
            });

            return payload.data.audience;
        }

        if (this.isLegacyAudienceResponse(payload)) {
            this.log('warn', 'parsed_legacy_audience_format', {
                mediaType,
                mediaId,
            });

            return payload.audience_data.demographics;
        }

        const debugContext = this.buildPayloadDebugContext(payload, mediaType, mediaId);

        this.log('error', 'unsupported_audience_response_format', debugContext);

        throw new AudienceApiError(
            `Unsupported audience response format for ${mediaType}:${mediaId}`,
            'unsupported_response_format',
            debugContext,
        );
    }

    /**
     * 获取 Audience 数据
     *
     * @param mediaType - instagram | tiktok
     * @param mediaId - 媒体ID
     * @param context - 可选的共享浏览器上下文
     */
    async getAudienceV1ByPlaywright(
        mediaType: MediaType,
        mediaId: string,
        context?: BrowserContext,
    ): Promise<AudienceMetrics> {
        const url = `http://localhost:3001/api/v1/audience?media_type=${mediaType}&media_id=${mediaId}`;

        let browser: Browser | null = null;
        let shouldCloseBrowser = false;

        try {
            const auth = await this.authPool.getNextAuth();
            const token = await this.authPool.getToken(auth);

            this.log('log', 'fetch_audience_started', {
                mediaType,
                mediaId,
                authUser: auth.username,
            });

            // 如果没有传入共享 context，就在这里自己创建并在 finally 里释放
            if (!context) {
                browser = await chromium.launch({ headless: true });
                context = await browser.newContext();
                shouldCloseBrowser = true;
            }

            const response = await context.request.get(url, {
                headers: {
                    authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            // HTTP 层失败：直接抛异常，不能伪装成“没数据”
            if (!response.ok()) {
                throw new AudienceApiError(
                    `Audience API HTTP request failed for ${mediaType}:${mediaId}`,
                    'http_request_failed',
                    {
                        mediaType,
                        mediaId,
                        statusCode: response.status(),
                    },
                );
            }

            // 第三方返回先视为 unknown，再通过 type guard 判断
            const payload: unknown = await response.json();

            this.log('log', 'audience_raw_response_received', {
                mediaType,
                mediaId,
                rawResponsePreview: JSON.stringify(payload).substring(0, 200),
            });

            const record = this.toRecord(payload);

            /**
             * HTTP 200 不代表业务成功。
             * 如果业务 status 不是 success，也要显式抛错。
             */
            if (this.isAudienceApiErrorResponse(payload) && record.status !== 'success') {
                throw new AudienceApiError(
                    `Audience API returned non-success status for ${mediaType}:${mediaId}`,
                    'business_status_failed',
                    {
                        mediaType,
                        mediaId,
                        statusCode: response.status(),
                        responseStatus: record.status,
                        apiError: record.error,
                    },
                );
            }

            return this.extractAudienceData(payload, mediaType, mediaId);
        } catch (error) {
            // 已知异常：记录完整上下文并继续向上抛
            if (error instanceof AudienceApiError) {
                this.log('error', 'fetch_audience_failed', {
                    mediaType,
                    mediaId,
                    errorType: error.type,
                    errorName: error.name,
                    errorMessage: error.message,
                    errorContext: error.context,
                });
                throw error;
            }

            // 未知异常：统一封装后抛出
            const unexpectedError = new AudienceApiError(
                `Unexpected audience fetch failure for ${mediaType}:${mediaId}`,
                'unexpected_error',
                {
                    mediaType,
                    mediaId,
                    originalErrorMessage: (error as Error).message,
                },
            );

            this.log('error', 'fetch_audience_failed_unexpected', {
                mediaType,
                mediaId,
                errorType: unexpectedError.type,
                errorName: unexpectedError.name,
                errorMessage: unexpectedError.message,
                errorContext: unexpectedError.context,
            });

            throw unexpectedError;
        } finally {
            // 只有在本方法里创建的 browser 才由本方法关闭
            if (shouldCloseBrowser && browser) {
                await browser.close();
            }
        }
    }

    // 批量获取 - 模拟真实场景中的并发问题
    async batchGetAudience(
        requests: Array<{ mediaType: MediaType; mediaId: string }>,
    ): Promise<AudienceMetrics[]> {
        this.log('log', 'batch_fetch_started', {
            requestCount: requests.length,
        });

        const results = await Promise.all(
            requests.map(req => this.getAudienceV1ByPlaywright(req.mediaType, req.mediaId)),
        );

        this.log('log', 'batch_fetch_completed', {
            requestCount: requests.length,
            successCount: results.length,
        });

        return results;
    }

    // 清理共享 browser
    async cleanup() {
        if (this.sharedBrowser) {
            await this.sharedBrowser.close();
        }
    }
}