import { AiInferenceMetricsModel } from '../../database/models/AiInferenceMetrics';
import { AiSystemMetricsModel } from '../../database/models/AiSystemMetrics';
import { SystemSettingsModel } from '../../database/models/SystemSettings';
import crypto from 'crypto';

export class MaintenanceScheduler {
  private static intervalId: NodeJS.Timeout | null = null;
  private static instanceId = crypto.randomUUID();
  private static isRunning = false;

  /**
   * Starts the background maintenance scheduler.
   */
  public static start(intervalMs: number = 3600000) { // Default every hour
    if (this.intervalId) return;
    
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
  public static stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[MaintenanceScheduler] Maintenance Scheduler stopped.');
    }
  }

  /**
   * Executes the database cleanup cycle under a distributed lock.
   */
  public static async runMaintenance() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Try to acquire distributed scheduler lock
    const now = new Date();
    let lockAcquired = null;

    try {
      lockAcquired = await SystemSettingsModel.findOneAndUpdate(
        {
          key: 'scheduler.lock',
          $or: [
            { 'value.locked': false },
            { 'value.expiresAt': { $lt: now } }
          ]
        },
        {
          $set: {
            value: {
              locked: true,
              lockedBy: this.instanceId,
              expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5-minute lease
            }
          }
        },
        { returnDocument: 'after' }
      ).exec();

      if (!lockAcquired) {
        console.log('[MaintenanceScheduler] Skip maintenance: Distributed lock held by another scheduler instance.');
        this.isRunning = false;
        return;
      }
    } catch (err: any) {
      console.warn('[MaintenanceScheduler] Failed to check distributed lock:', err.message);
      this.isRunning = false;
      return;
    }

    try {
      console.log('[MaintenanceScheduler] Executing daily database maintenance and metrics cleanup...');

      // Retrieve retention window (archiveAfterDays setting, default 30 days)
      let retentionDays = 30;
      try {
        const rules = await SystemSettingsModel.findOne({ key: 'ai.rules' }).exec();
        if (rules && rules.value && rules.value.archiveAfterDays) {
          retentionDays = rules.value.archiveAfterDays;
        }
      } catch (settingsErr) {
        // Fallback
      }

      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      console.log(`[MaintenanceScheduler] Purging raw telemetry logs older than cutoff: ${cutoffDate.toISOString()} (${retentionDays} days retention)`);

      // Bulk purge raw telemetry
      const infResult = await AiInferenceMetricsModel.deleteMany({ timestamp: { $lt: cutoffDate } });
      const sysResult = await AiSystemMetricsModel.deleteMany({ timestamp: { $lt: cutoffDate } });

      console.log(`[MaintenanceScheduler] Purged ${infResult.deletedCount} old raw inference logs.`);
      console.log(`[MaintenanceScheduler] Purged ${sysResult.deletedCount} old raw system metrics.`);
    } catch (err: any) {
      console.error('[MaintenanceScheduler] Maintenance process failed:', err.message);
    } finally {
      // Release distributed lock
      try {
        await SystemSettingsModel.updateOne(
          { 
            key: 'scheduler.lock', 
            'value.lockedBy': this.instanceId 
          },
          {
            $set: {
              'value.locked': false,
              'value.lockedBy': null,
              'value.expiresAt': null
            }
          }
        ).exec();
        console.log('[MaintenanceScheduler] Distributed lock released successfully.');
      } catch (releaseErr: any) {
        console.error('[MaintenanceScheduler] Failed to release distributed lock:', releaseErr.message);
      }
      this.isRunning = false;
    }
  }
}
