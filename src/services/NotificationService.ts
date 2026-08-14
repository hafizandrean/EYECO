import mongoose from 'mongoose';
import { NotificationModel } from '../database/models/Notification';
import { ReportModel } from '../database/models/Report';
import { UserModel, IUser } from '../database/models/User';

type NotificationPriority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface NotifyResult {
  success: boolean;
  count: number;
  error?: string;
}

/**
 * NotificationService — creates in-app (Web) notifications for comments,
 * validations, and news. Uses NotificationModel.create() / insertMany()
 * directly, bypassing the outbox pattern (which is reserved for AI detection
 * notifications delivered via OutboxWorker + NotificationDispatcher).
 *
 * Notification types:  COMMENT, VALIDATION, NEWS
 * Priorities:          MEDIUM,   HIGH,        LOW
 * Icons:               message-square, shield-check, newspaper
 */
export class NotificationService {
  private static EXPIRY_DAYS = 90;

  // ──────────────────────────────────────────────
  //  COMMENT — when someone comments on a report
  // ──────────────────────────────────────────────

  /**
   * Notify the report owner that someone commented on their report.
   * Skips if the commenter is the report owner (self-comment).
   *
   * @param reportId      Numeric legacy report ID
   * @param commenterName Display name of the person who commented
   * @param reportOwnerId Numeric legacy user ID of the report owner
   * @param workspaceId   Optional workspace scope
   */
  public static async notifyComment(
    reportId: number,
    commenterName: string,
    reportOwnerId: number,
    workspaceId?: number,
  ): Promise<NotifyResult> {
    try {
      // Resolve report owner's ObjectId
      const owner = await UserModel.findOne({ id: reportOwnerId }).lean().exec();
      if (!owner) {
        return { success: false, count: 0, error: 'Report owner not found' };
      }

      // Fetch report to get its ObjectId (needed for reportId field)
      const report = await ReportModel.findOne({ id: reportId, deletedAt: null })
        .select('_id workspaceId')
        .lean()
        .exec();
      if (!report) {
        return { success: false, count: 0, error: 'Report not found' };
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      await NotificationModel.create({
        workspaceId: workspaceId ?? report.workspaceId,
        recipientId: owner._id,
        reportId: report._id,
        type: 'COMMENT',
        title: 'Komentar Baru pada Laporan Anda',
        message: `${commenterName} memberikan komentar pada laporan #${reportId}.`,
        actionUrl: `/dashboard/detections/${reportId}`,
        icon: 'message-square',
        priority: 'MEDIUM' as NotificationPriority,
        read: false,
        readAt: null,
        expiresAt,
        deletedAt: null,
      });

      return { success: true, count: 1 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[NotificationService] notifyComment failed:', msg);
      return { success: false, count: 0, error: msg };
    }
  }

  // ──────────────────────────────────────────────
  //  VALIDATION — when admin validates a report
  // ──────────────────────────────────────────────

  /**
   * Notify the report owner that an admin validated / dismissed their report.
   *
   * @param reportId      Numeric legacy report ID
   * @param status        Validation status: VALID | DIABAIKAN | MENUNGGU
   * @param reportOwnerId Numeric legacy user ID of the report owner
   * @param workspaceId   Optional workspace scope
   */
  public static async notifyValidation(
    reportId: number,
    status: string,
    reportOwnerId: number,
    workspaceId?: number,
    oldStatus?: string
  ): Promise<NotifyResult> {
    try {
      const cleanStatus = (status || '').toUpperCase().trim();
      // Guard: Validation notifications MUST only be created for actual transitions to VALID or DIABAIKAN
      if (cleanStatus === 'MENUNGGU' || cleanStatus === 'PENDING' || (oldStatus && oldStatus === cleanStatus)) {
        console.log(`[NotificationService] Suppressing validation notification for report #${reportId} (status: ${cleanStatus}, oldStatus: ${oldStatus})`);
        return { success: true, count: 0 };
      }

      const owner = await UserModel.findOne({ id: reportOwnerId }).lean().exec();
      if (!owner) {
        return { success: false, count: 0, error: 'Report owner not found' };
      }

      const report = await ReportModel.findOne({ id: reportId, deletedAt: null })
        .select('_id workspaceId analysisState activeSnapshotId')
        .lean()
        .exec() as any;
      if (!report) {
        return { success: false, count: 0, error: 'Report not found' };
      }

      if (report.analysisState && report.analysisState !== 'READY') {
        console.log(`[NotificationService] Suppressing validation notification for unready report #${reportId} (analysisState: ${report.analysisState})`);
        return { success: true, count: 0 };
      }

      const statusLabel =
        cleanStatus === 'VALID' ? 'Valid' : cleanStatus === 'TIDAK_VALID' ? 'Tidak Valid' : cleanStatus;

      const eventKey = `${reportId}:VALIDATION:${oldStatus || 'PENDING'}:${cleanStatus}`;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      try {
        await NotificationModel.create({
          eventKey,
          workspaceId: workspaceId ?? report.workspaceId,
          recipientId: owner._id,
          reportId: report._id,
          type: 'VALIDATION',
          title: 'Laporan Telah Divalidasi',
          message: `Laporan #${reportId} telah divalidasi dengan status: ${statusLabel}.`,
          actionUrl: `/dashboard/detections/${reportId}`,
          icon: 'shield-check',
          priority: 'HIGH' as NotificationPriority,
          read: false,
          readAt: null,
          expiresAt,
          deletedAt: null,
        });
      } catch (dbErr: any) {
        if (dbErr.code === 11000 || (dbErr.message && dbErr.message.includes('E11000'))) {
          console.log(`[NotificationService] Duplicate eventKey suppressed idempotently: ${eventKey}`);
          return { success: true, count: 0 };
        }
        throw dbErr;
      }

      return { success: true, count: 1 };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[NotificationService] notifyValidation failed:', msg);
      return { success: false, count: 0, error: msg };
    }
  }

  // ──────────────────────────────────────────────
  //  NEWS — when a news article is published
  // ──────────────────────────────────────────────

  /**
   * Notify ALL users in a workspace about a newly published news article.
   *
   * @param newsTitle   Title of the news article
   * @param workspaceId Workspace whose users should be notified
   */
  public static async notifyNewNews(
    newsTitle: string,
    workspaceId: number,
  ): Promise<NotifyResult> {
    try {
      if (!workspaceId) {
        return { success: false, count: 0, error: 'workspaceId is required' };
      }

      // Find ALL users in the workspace (any role)
      const users = await UserModel.find({
        $or: [{ workspaceId }, { workspaceIds: workspaceId }],
      })
        .select('_id')
        .lean()
        .exec();

      if (users.length === 0) {
        return { success: true, count: 0 };
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      // Notification model requires reportId (ObjectId). For NEWS notifications
      // we use a generated ObjectId since there is no associated report.
      const placeholderObjectId = new mongoose.Types.ObjectId();

      const notifications = users.map((user) => ({
        workspaceId,
        recipientId: user._id,
        reportId: placeholderObjectId,
        type: 'NEWS' as const,
        title: 'Berita Baru',
        message: `"${newsTitle}" — baca selengkapnya.`,
        actionUrl: '/dashboard/news',
        icon: 'newspaper',
        priority: 'LOW' as NotificationPriority,
        read: false,
        readAt: null,
        expiresAt,
        deletedAt: null,
      }));

      await NotificationModel.insertMany(notifications);

      return { success: true, count: notifications.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[NotificationService] notifyNewNews failed:', msg);
      return { success: false, count: 0, error: msg };
    }
  }
}
