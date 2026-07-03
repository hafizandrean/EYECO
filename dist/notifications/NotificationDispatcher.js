"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationDispatcher = void 0;
const OutboxEvent_1 = require("../database/models/OutboxEvent");
class NotificationDispatcher {
    /**
     * Queues a new report notification event into the transactional outbox database.
     * Background OutboxWorker will consume this asynchronously.
     */
    static async dispatch(report) {
        console.log(`[NotificationDispatcher] Queuing outbox event for Report #${report.id}...`);
        try {
            await OutboxEvent_1.OutboxEventModel.create({
                aggregateType: 'Report',
                aggregateId: report.id.toString(),
                eventType: 'CREATED',
                payload: {
                    sentChannels: []
                },
                status: 'PENDING',
                retryCount: 0,
                processedAt: null
            });
            console.log(`[NotificationDispatcher] Outbox event written successfully for Report #${report.id}.`);
        }
        catch (err) {
            console.error(`[NotificationDispatcher] Failed to write outbox event for Report #${report.id}:`, err.message);
            throw err;
        }
    }
}
exports.NotificationDispatcher = NotificationDispatcher;
