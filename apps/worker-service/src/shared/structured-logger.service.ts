import { Injectable, Logger } from '@nestjs/common';
 
@Injectable()
export class StructuredLoggerService {
    /**
     * 【修改点1】
     * 不再在每个业务 class 里 new Logger(ClassName)，
     * 而是统一在这个 Provider 内部持有一个 Logger 实例。
     * context 由调用方在每次 log 调用时传入，对应 NestJS Logger 的第二个参数。
     */
    private readonly logger = new Logger();
 
    log(context: string, event: string, payload: Record<string, unknown> = {}): void {
        this.logger.log(
            JSON.stringify({
                event,
                timestamp: new Date().toISOString(),
                ...payload,
            }),
            context, // NestJS Logger 原生支持 context 参数，会在输出里显示 [ClassName]
        );
    }
 
    warn(context: string, event: string, payload: Record<string, unknown> = {}): void {
        this.logger.warn(
            JSON.stringify({
                event,
                timestamp: new Date().toISOString(),
                ...payload,
            }),
            context,
        );
    }
 
    error(context: string, event: string, payload: Record<string, unknown> = {}): void {
        this.logger.error(
            JSON.stringify({
                event,
                timestamp: new Date().toISOString(),
                ...payload,
            }),
            context,
        );
    }
}