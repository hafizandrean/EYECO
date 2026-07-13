"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MaintenanceScheduler = void 0;
const AiInferenceMetrics_1 = require("../../database/models/AiInferenceMetrics");
const AiSystemMetrics_1 = require("../../database/models/AiSystemMetrics");
const SystemSettings_1 = require("../../database/models/SystemSettings");
const crypto_1 = __importDefault(require("crypto"));
class MaintenanceScheduler {
    static intervalId = null;
    static instanceId = crypto_1.default.randomUUID();
    static isRunning = false;
    /**
     * Starts the background maintenance scheduler.
     */
    static start(intervalMs = 3600000) {
        if (this.intervalId)
            return;
        console.log(`[MaintenanceScheduler] Maintenance Scheduler started (${intervalMs}ms intervals).`);
        this.intervalId = setInterval(async () => {
            await this.runMaintenance();
        }, intervalMs);
        // Initial run check soon after start
        setTimeout(() => this.runMaintenance(), 10000);
    }
    /**
     * Stops the maintenance scheduler.
     */
    static stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('[MaintenanceScheduler] Maintenance Scheduler stopped.');
        }
    }
    /**
     * Executes the database cleanup cycle under a distributed lock.
     */
    static async runMaintenance() {
        if (this.isRunning)
            return;
        this.isRunning = true;
        // Try to acquire distributed scheduler lock
        const now = new Date();
        let lockAcquired = null;
        try {
            lockAcquired = await SystemSettings_1.SystemSettingsModel.findOneAndUpdate({
                key: 'scheduler.lock',
                $or: [
                    { 'value.locked': false },
                    { 'value.expiresAt': { $lt: now } }
                ]
            }, {
                $set: {
                    value: {
                        locked: true,
                        lockedBy: this.instanceId,
                        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5-minute lease
                    }
                }
            }, { new: true }).exec();
            if (!lockAcquired) {
                console.log('[MaintenanceScheduler] Skip maintenance: Distributed lock held by another scheduler instance.');
                this.isRunning = false;
                return;
            }
        }
        catch (err) {
            console.warn('[MaintenanceScheduler] Failed to check distributed lock:', err.message);
            this.isRunning = false;
            return;
        }
        try {
            console.log('[MaintenanceScheduler] Executing daily database maintenance and metrics cleanup...');
            // Retrieve retention window (archiveAfterDays setting, default 30 days)
            let retentionDays = 30;
            try {
                const rules = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'ai.rules' }).exec();
                if (rules && rules.value && rules.value.archiveAfterDays) {
                    retentionDays = rules.value.archiveAfterDays;
                }
            }
            catch (settingsErr) {
                // Fallback
            }
            const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
            console.log(`[MaintenanceScheduler] Purging raw telemetry logs older than cutoff: ${cutoffDate.toISOString()} (${retentionDays} days retention)`);
            // Bulk purge raw telemetry
            const infResult = await AiInferenceMetrics_1.AiInferenceMetricsModel.deleteMany({ timestamp: { $lt: cutoffDate } });
            const sysResult = await AiSystemMetrics_1.AiSystemMetricsModel.deleteMany({ timestamp: { $lt: cutoffDate } });
            console.log(`[MaintenanceScheduler] Purged ${infResult.deletedCount} old raw inference logs.`);
            console.log(`[MaintenanceScheduler] Purged ${sysResult.deletedCount} old raw system metrics.`);
        }
        catch (err) {
            console.error('[MaintenanceScheduler] Maintenance process failed:', err.message);
        }
        finally {
            // Release distributed lock
            try {
                await SystemSettings_1.SystemSettingsModel.updateOne({
                    key: 'scheduler.lock',
                    'value.lockedBy': this.instanceId
                }, {
                    $set: {
                        'value.locked': false,
                        'value.lockedBy': null,
                        'value.expiresAt': null
                    }
                }).exec();
                console.log('[MaintenanceScheduler] Distributed lock released successfully.');
            }
            catch (releaseErr) {
                console.error('[MaintenanceScheduler] Failed to release distributed lock:', releaseErr.message);
            }
            this.isRunning = false;
        }
    }
}
exports.MaintenanceScheduler = MaintenanceScheduler;
