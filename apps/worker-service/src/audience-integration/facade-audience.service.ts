/**
 * Facade Service - 包装第三方 Audience API 调用
 *
 * 模拟真实的 facade-upfluence.service.ts 逻辑：
 * - 使用 Playwright browser context
 * - Auth management
 * - 错误处理
 * - 兼容新旧两种 API 响应格式
 */

import { chromium, Browser, BrowserContext } from 'playwright';
import { MockAuthPool } from './mock-auth-pool';

type AudienceMetrics = {
    gender?: Array<{ label: string; value: number }>;
    age?: Array<{ label: string; value: number }>;
    geography?: {
        countries?: Array<{ name: string; code: string; percentage: number }>;
    };
};

type NewAudienceResponse = {
    status: string;
    data?: {
        audience?: AudienceMetrics;
        meta?: {
            media_id: string;
            platform: string;
            last_updated: string;
        };
    };
    error?: string;
};

type LegacyAudienceResponse = {
    status: string;
    audience_data?: {
        demographics?: AudienceMetrics;
    };
    error?: string;
};

type AudienceApiResponse = NewAudienceResponse | LegacyAudienceResponse;

export class FacadeAudienceService {
    private authPool: MockAuthPool;
    private sharedBrowser: Browser | null = null;

    constructor() {
        this.authPool = new MockAuthPool();
    }

    /**
     * 从第三方响应中提取统一 audience 数据
     */
    private extractAudienceData(
        audienceData: AudienceApiResponse,
        mediaType: 'instagram' | 'tiktok',
        mediaId: string,
    ): AudienceMetrics | null {
        const newFormatData = audienceData.data?.audience;
        if (newFormatData) {
            console.log(
                `[FacadeService] Parsed NEW audience format for ${mediaType}:${mediaId}`
            );
            return newFormatData;
        }

        const legacyFormatData = audienceData.audience_data?.demographics;
        if (legacyFormatData) {
            console.warn(
                `[FacadeService] Parsed LEGACY audience format for ${mediaType}:${mediaId}`
            );
            return legacyFormatData;
        }

        console.error(
            `[FacadeService] Unsupported audience response format for ${mediaType}:${mediaId}`
        );
        console.error('[FacadeService] Available top-level keys:', Object.keys(audienceData));

        if (audienceData.data) {
            console.error(
                '[FacadeService] data keys:',
                Object.keys(audienceData.data)
            );
        }

        if (audienceData.audience_data) {
            console.error(
                '[FacadeService] audience_data keys:',
                Object.keys(audienceData.audience_data)
            );
        }

        return null;
    }

    /**
     * 获取 Audience 数据
     *
     * @param mediaType - instagram | tiktok
     * @param mediaId - 媒体ID
     * @param context - 可选的共享浏览器上下文
     */
    async getAudienceV1ByPlaywright(
        mediaType: 'instagram' | 'tiktok',
        mediaId: string,
        context?: BrowserContext,
    ): Promise<AudienceMetrics | null> {
        const url = `http://localhost:3001/api/v1/audience?media_type=${mediaType}&media_id=${mediaId}`;

        let browser: Browser | null = null;
        let shouldCloseBrowser = false;

        try {
            const auth = await this.authPool.getNextAuth();
            const token = await this.authPool.getToken(auth);

            console.log(`[FacadeService] Fetching audience for ${mediaType}:${mediaId}`);
            console.log(`[FacadeService] Using auth: ${auth.username}`);

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

            if (!response.ok()) {
                console.error(
                    `[FacadeService] HTTP request failed for ${mediaType}:${mediaId}, status=${response.status()}`
                );
                return null;
            }

            const audienceData = (await response.json()) as AudienceApiResponse;

            console.log(
                '[FacadeService] Raw response:',
                JSON.stringify(audienceData).substring(0, 200)
            );

            if (audienceData.status !== 'success') {
                console.error(
                    `[FacadeService] API returned non-success status for ${mediaType}:${mediaId}`
                );
                if ('error' in audienceData && audienceData.error) {
                    console.error('[FacadeService] API error:', audienceData.error);
                }
                return null;
            }

            const extracted = this.extractAudienceData(audienceData, mediaType, mediaId);

            if (!extracted) {
                console.error(
                    `[FacadeService] ⚠️ Failed to extract audience data for ${mediaType}:${mediaId}`
                );
                return null;
            }

            return extracted;
        } catch (error) {
            console.error(
                `[FacadeService] Failed to fetch audience for ${mediaType}:${mediaId}:`,
                (error as Error).message
            );
            throw error;
        } finally {
            if (shouldCloseBrowser && browser) {
                await browser.close();
            }
        }
    }

    /**
     * 批量获取 - 模拟真实场景中的并发问题
     */
    async batchGetAudience(requests: Array<{ mediaType: 'instagram' | 'tiktok'; mediaId: string }>) {
        console.log(`[FacadeService] Batch fetching ${requests.length} audience datasets`);

        const results = await Promise.all(
            requests.map(req =>
                this.getAudienceV1ByPlaywright(req.mediaType, req.mediaId)
            )
        );

        const successCount = results.filter(r => r !== null).length;
        console.log(`[FacadeService] Batch complete: ${successCount}/${requests.length} succeeded`);

        return results;
    }

    async cleanup() {
        if (this.sharedBrowser) {
            await this.sharedBrowser.close();
        }
    }
}