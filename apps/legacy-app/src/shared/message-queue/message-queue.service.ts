import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import type { AnalysisRequestedEvent } from '@senior-challenge/shared-types';

// const QUEUE_DIR = path.join(process.cwd(), 'local-queue');
const QUEUE_DIR = path.resolve(__dirname, '../../../../../local-queue');

/**
 * Message Queue service - simulates SQS for local development.
 * In production, this would use AWS SQS SDK.
 */
@Injectable()
export class MessageQueueService {
    private readonly logger = new Logger(MessageQueueService.name);

    constructor() {
        // Ensure queue directory exists
        if (!fs.existsSync(QUEUE_DIR)) {
            fs.mkdirSync(QUEUE_DIR, { recursive: true });
        }
    }

    /**
     * Publishes an event to the message queue.
     * In local dev, this writes to a file that the worker will poll.
     */
    async publishEvent(event: AnalysisRequestedEvent): Promise<void> {
        const filename = `${event.jobId}-${Date.now()}.json`;
        const filepath = path.join(QUEUE_DIR, filename);

        fs.writeFileSync(filepath, JSON.stringify(event, null, 2));
        this.logger.log(`📤 Published event: ${event.eventType} -> ${filename}`);
    }
}
