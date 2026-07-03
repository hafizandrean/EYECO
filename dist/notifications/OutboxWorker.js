"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutboxWorker = void 0;
const OutboxEvent_1 = require("../database/models/OutboxEvent");
const Report_1 = require("../database/models/Report");
const WebNotificationChannel_1 = require("./WebNotificationChannel");
const TelegramNotificationChannel_1 = require("./TelegramNotificationChannel");
class OutboxWorker {
    static channels = [
        new WebNotificationChannel_1.WebNotificationChannel(),
        new TelegramNotificationChannel_1.TelegramNotificationChannel()
    ];
    static isRunning = false;
    static intervalId = null;
    /**
     * Starts the Outbox background worker.
     */
    static start(intervalMs = 5000) {
        if (this.intervalId)
            return;
        console.log(`[OutboxWorker] Starting background worker with interval ${intervalMs}ms...`);
        this.intervalId = setInterval(() => this.processQueue(), intervalMs);
    }
    /**
     * Stops the Outbox background worker.
     */
    static stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('[OutboxWorker] Background worker stopped.');
        }
    }
    /**
     * Processes all pending outbox events.
     */
    static async processQueue() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        try {
            // Ambil seluruh event yang statusnya PENDING
            const pendingEvents = await OutboxEvent_1.OutboxEventModel.find({ status: 'PENDING' }).exec();
            for (const event of pendingEvents) {
                await this.processEvent(event);
            }
        }
        catch (err) {
            console.error('[OutboxWorker] Error processing queue:', err.message);
        }
        finally {
            this.isRunning = false;
        }
    }
    /**
     * Process a single outbox event with channel status tracking.
     */
    static async processEvent(event) {
        try {
            if (event.aggregateType !== 'Report' || event.eventType !== 'CREATED') {
                // Unknown event type, mark as processed to clear it
                event.status = 'PROCESSED';
                event.processedAt = new Date();
                await event.save();
                return;
            }
            // Temukan data Laporan terkait
            const report = await Report_1.ReportModel.findOne({ id: Number(event.aggregateId) }).exec();
            if (!report) {
                console.error(`[OutboxWorker] Report #${event.aggregateId} not found. Skipping event.`);
                event.status = 'FAILED';
                await event.save();
                return;
            }
            // Pastikan payload terinisialisasi
            if (!event.payload) {
                event.payload = { sentChannels: [] };
            }
            if (!event.payload.sentChannels) {
                event.payload.sentChannels = [];
            }
            const sentChannels = event.payload.sentChannels;
            let allSucceeded = true;
            for (const channel of this.channels) {
                // Lewati jika channel ini sudah sukses dikirim sebelumnya
                if (sentChannels.includes(channel.name)) {
                    continue;
                }
                try {
                    console.log(`[OutboxWorker] Sending Report #${report.id} notification via ${channel.name}...`);
                    const success = await channel.send(report);
                    if (success) {
                        sentChannels.push(channel.name);
                        event.markModified('payload');
                        await event.save();
                    }
                    else {
                        allSucceeded = false;
                    }
                }
                catch (err) {
                    console.error(`[OutboxWorker] Channel ${channel.name} threw an error:`, err.message);
                    allSucceeded = false;
                }
            }
            if (allSucceeded && sentChannels.length === this.channels.length) {
                event.status = 'PROCESSED';
                event.processedAt = new Date();
                await event.save();
                console.log(`[OutboxWorker] Event #${event._id} successfully processed for Report #${report.id}.`);
            }
            else {
                // Salah satu channel gagal, increment retryCount
                event.retryCount += 1;
                if (event.retryCount >= 10) {
                    // Pindahkan ke Dead Letter Queue (DLQ) / Failed permanen
                    event.status = 'FAILED';
                    console.error(`[OutboxWorker] Event #${event._id} failed permanently after 10 attempts. Moved to DLQ.`);
                }
                await event.save();
            }
        }
        catch (err) {
            console.error(`[OutboxWorker] Failed to process event #${event._id}:`, err.message);
            event.retryCount += 1;
            if (event.retryCount >= 10) {
                event.status = 'FAILED';
            }
            await event.save();
        }
    }
}
exports.OutboxWorker = OutboxWorker;
