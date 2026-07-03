"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DuplicateRule = void 0;
const Report_1 = require("../../database/models/Report");
const TimelineEvent_1 = require("../../database/models/TimelineEvent");
const User_1 = require("../../database/models/User");
const mongoose_1 = __importDefault(require("mongoose"));
class DuplicateRule {
    name = 'Duplicate Check';
    async evaluate(detection, context) {
        try {
            const duplicateLimit = new Date(Date.now() - context.settings.duplicateTimeWindowSeconds * 1000);
            // Cari laporan aktif pada kamera yang sama, dengan kelas deteksi yang sama, dalam jendela waktu duplikasi
            const openReport = await Report_1.ReportModel.findOne({
                status: { $nin: ['CLOSED', 'REJECTED'] },
                timestamp: { $gte: duplicateLimit },
                'sourceMetadata.cameraId': detection.cameraId,
                'boundingBoxes.label': context.mainClass
            });
            if (openReport) {
                // Cari admin utama untuk relasi aktor default
                const adminUser = await User_1.UserModel.findOne({ id: 1 });
                const adminObjectId = adminUser ? adminUser._id : new mongoose_1.default.Types.ObjectId('000000000000000000000001');
                // Tandai deteksi sebagai DUPLICATE
                detection.status = 'DUPLICATE';
                detection.promotedReportId = openReport.id;
                detection.rejectedReason = 'DUPLICATE';
                await detection.save();
                // Tambahkan log di timeline laporan yang sudah ada
                await TimelineEvent_1.TimelineEventModel.create({
                    reportId: openReport._id,
                    eventVersion: 1,
                    type: 'DETECTION',
                    actorId: adminObjectId,
                    actorName: 'YOLOv8',
                    actorRole: 'AI',
                    title: 'Deteksi AI Berlanjut',
                    description: `Sistem AI mendeteksi keberadaan objek '${context.mainClass}' kembali di kamera ini. (Confidence: ${Math.round(detection.confidence * 100)}%, Severity: ${detection.severity}).`,
                    metadata: { confidence: detection.confidence, severity: detection.severity, trackingId: detection.trackingId },
                    ipAddress: '127.0.0.1',
                    userAgent: 'EYECO AI Engine',
                    createdAt: new Date()
                });
                return {
                    success: false,
                    reason: `DUPLICATE: Active incident exists for this camera and class (Report #${openReport.id}).`
                };
            }
            return { success: true };
        }
        catch (err) {
            console.error('[DuplicateRule] Error evaluating duplicates:', err.message);
            return { success: false, reason: `DUPLICATE_ERROR: ${err.message}` };
        }
    }
}
exports.DuplicateRule = DuplicateRule;
