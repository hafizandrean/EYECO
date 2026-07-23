"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationService = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const Notification_1 = require("../database/models/Notification");
const Report_1 = require("../database/models/Report");
const User_1 = require("../database/models/User");
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
class NotificationService {
    static EXPIRY_DAYS = 90;
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
    static async notifyComment(reportId, commenterName, reportOwnerId, workspaceId) {
        try {
            // Resolve report owner's ObjectId
            const owner = await User_1.UserModel.findOne({ id: reportOwnerId }).lean().exec();
            if (!owner) {
                return { success: false, count: 0, error: 'Report owner not found' };
            }
            // Fetch report to get its ObjectId (needed for reportId field)
            const report = await Report_1.ReportModel.findOne({ id: reportId, deletedAt: null })
                .select('_id workspaceId')
                .lean()
                .exec();
            if (!report) {
                return { success: false, count: 0, error: 'Report not found' };
            }
            const now = new Date();
            const expiresAt = new Date(now.getTime() + this.EXPIRY_DAYS * 24 * 60 * 60 * 1000);
            await Notification_1.NotificationModel.create({
                workspaceId: workspaceId ?? report.workspaceId,
                recipientId: owner._id,
                reportId: report._id,
                type: 'COMMENT',
                title: 'Komentar Baru pada Laporan Anda',
                message: `${commenterName} memberikan komentar pada laporan #${reportId}.`,
                actionUrl: `/dashboard/detections/${reportId}`,
                icon: 'message-square',
                priority: 'MEDIUM',
                read: false,
                readAt: null,
                expiresAt,
                deletedAt: null,
            });
            return { success: true, count: 1 };
        }
        catch (err) {
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
    static async notifyValidation(reportId, status, reportOwnerId, workspaceId) {
        try {
            const owner = await User_1.UserModel.findOne({ id: reportOwnerId }).lean().exec();
            if (!owner) {
                return { success: false, count: 0, error: 'Report owner not found' };
            }
            const report = await Report_1.ReportModel.findOne({ id: reportId, deletedAt: null })
                .select('_id workspaceId')
                .lean()
                .exec();
            if (!report) {
                return { success: false, count: 0, error: 'Report not found' };
            }
            const statusLabel = status === 'VALID' ? 'Valid' : status === 'DIABAIKAN' ? 'Diabaikan' : status;
            const now = new Date();
            const expiresAt = new Date(now.getTime() + this.EXPIRY_DAYS * 24 * 60 * 60 * 1000);
            await Notification_1.NotificationModel.create({
                workspaceId: workspaceId ?? report.workspaceId,
                recipientId: owner._id,
                reportId: report._id,
                type: 'VALIDATION',
                title: 'Laporan Telah Divalidasi',
                message: `Laporan #${reportId} telah divalidasi dengan status: ${statusLabel}.`,
                actionUrl: `/dashboard/detections/${reportId}`,
                icon: 'shield-check',
                priority: 'HIGH',
                read: false,
                readAt: null,
                expiresAt,
                deletedAt: null,
            });
            return { success: true, count: 1 };
        }
        catch (err) {
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
    static async notifyNewNews(newsTitle, workspaceId) {
        try {
            if (!workspaceId) {
                return { success: false, count: 0, error: 'workspaceId is required' };
            }
            // Find ALL users in the workspace (any role)
            const users = await User_1.UserModel.find({
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
            const placeholderObjectId = new mongoose_1.default.Types.ObjectId();
            const notifications = users.map((user) => ({
                workspaceId,
                recipientId: user._id,
                reportId: placeholderObjectId,
                type: 'NEWS',
                title: 'Berita Baru',
                message: `"${newsTitle}" — baca selengkapnya.`,
                actionUrl: '/dashboard/news',
                icon: 'newspaper',
                priority: 'LOW',
                read: false,
                readAt: null,
                expiresAt,
                deletedAt: null,
            }));
            await Notification_1.NotificationModel.insertMany(notifications);
            return { success: true, count: notifications.length };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'Unknown error';
            console.error('[NotificationService] notifyNewNews failed:', msg);
            return { success: false, count: 0, error: msg };
        }
    }
}
exports.NotificationService = NotificationService;
