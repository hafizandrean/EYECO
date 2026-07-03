"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportRepository = void 0;
const Report_1 = require("../models/Report");
const User_1 = require("../models/User");
const mongoose_1 = __importDefault(require("mongoose"));
class ReportRepository {
    static async findById(id) {
        const report = await Report_1.ReportModel.findOne({ _id: id, deletedAt: null }).exec();
        return report;
    }
    static async findByLegacyId(id) {
        const report = await Report_1.ReportModel.findOne({ id, deletedAt: null }).exec();
        return report;
    }
    static async update(id, updateData, session) {
        const options = { new: true, runValidators: true };
        if (session) {
            Object.assign(options, { session });
        }
        const report = await Report_1.ReportModel.findOneAndUpdate({ _id: id, deletedAt: null }, { $set: updateData }, options).exec();
        return report;
    }
    static async softDelete(id, actorId, actorName, reason, session) {
        const options = { new: true };
        if (session) {
            Object.assign(options, { session });
        }
        const report = await Report_1.ReportModel.findOneAndUpdate({ _id: id, deletedAt: null }, {
            $set: {
                deletedAt: new Date(),
                deletedById: actorId,
                deletedByName: actorName,
                deleteReason: reason
            }
        }, options).exec();
        return report;
    }
    static async restore(id, reason, session) {
        const options = { new: true };
        if (session) {
            Object.assign(options, { session });
        }
        const report = await Report_1.ReportModel.findOneAndUpdate({ _id: id, deletedAt: { $ne: null } }, {
            $set: {
                deletedAt: null,
                deletedById: null,
                deletedByName: null,
                restoreReason: reason
            }
        }, options).exec();
        return report;
    }
    // --- CRUD/CRUD-Like Methods originally in DatabaseManager ---
    static async create(report, creatorId) {
        try {
            const lastReport = await Report_1.ReportModel.findOne().sort({ id: -1 }).exec();
            const nextId = lastReport ? lastReport.id + 1 : 1;
            // Find user _id for the ref based on legacy creatorId
            const user = await User_1.UserModel.findOne({ id: creatorId }).lean().exec();
            const userObjectId = user ? user._id : new mongoose_1.default.Types.ObjectId();
            const newReport = await Report_1.ReportModel.create({
                ...report,
                id: nextId,
                userId: userObjectId,
                timestamp: new Date(),
                adminStatus: 'MENUNGGU',
                adminNotes: '',
                sla: {
                    detectedAt: new Date(),
                    validatedAt: null,
                    assignedAt: null,
                    arrivedAt: null,
                    resolvedAt: null,
                    closedAt: null,
                    validationDurationMs: null,
                    assignmentDurationMs: null,
                    cleanupDurationMs: null,
                    resolutionDurationMs: null,
                    totalDurationMs: null
                }
            });
            return newReport;
        }
        catch (err) {
            console.error('[DATABASE ERROR] create report failed:', err);
            throw err;
        }
    }
    static async updateVerification(id, status, notes, assignedOfficer, progressStatus) {
        try {
            const updateFields = { adminStatus: status, adminNotes: notes };
            if (assignedOfficer !== undefined) {
                updateFields.assignedOfficer = assignedOfficer;
            }
            if (progressStatus !== undefined) {
                updateFields.status = progressStatus;
            }
            else {
                if (status === 'VALID') {
                    updateFields.status = 'VALIDATED';
                }
                else if (status === 'DIABAIKAN') {
                    updateFields.status = 'REJECTED';
                }
            }
            const updated = await Report_1.ReportModel.findOneAndUpdate({ id }, updateFields, { new: true }).exec();
            return updated;
        }
        catch (err) {
            console.error('[DATABASE ERROR] updateVerification failed:', err);
            throw err;
        }
    }
    static async getFiltered(filters, userContext, page, limit) {
        try {
            const query = { deletedAt: null };
            if (filters.date) {
                const start = new Date(filters.date);
                start.setHours(0, 0, 0, 0);
                const end = new Date(filters.date);
                end.setHours(23, 59, 59, 999);
                query.timestamp = { $gte: start, $lte: end };
            }
            else if (filters.timeRange && filters.timeRange !== 'semua') {
                const now = new Date();
                if (filters.timeRange === 'hari_ini') {
                    const start = new Date(now);
                    start.setHours(0, 0, 0, 0);
                    query.timestamp = { $gte: start };
                }
                else if (filters.timeRange === 'minggu_ini') {
                    const oneWeekAgo = new Date();
                    oneWeekAgo.setDate(now.getDate() - 7);
                    query.timestamp = { $gte: oneWeekAgo };
                }
            }
            if (filters.aiStatus && filters.aiStatus !== 'semua') {
                query.aiStatus = filters.aiStatus;
            }
            if (filters.adminStatus && filters.adminStatus !== 'semua') {
                query.adminStatus = filters.adminStatus;
            }
            if (filters.location && filters.location.trim() !== '') {
                const regex = new RegExp(filters.location, 'i');
                query.$or = [
                    { location: regex },
                    { identity: regex }
                ];
            }
            const q = Report_1.ReportModel.find(query).sort({ timestamp: -1 });
            if (page !== undefined && limit !== undefined) {
                const skip = (page - 1) * limit;
                const [reports, total] = await Promise.all([
                    q.skip(skip).limit(limit).exec(),
                    Report_1.ReportModel.countDocuments(query).exec()
                ]);
                return { reports, total };
            }
            else {
                return await q.exec();
            }
        }
        catch (err) {
            console.error('[DATABASE ERROR] getFiltered failed:', err);
            throw err;
        }
    }
    static async getStats(userContext) {
        try {
            const matchQuery = { deletedAt: null };
            const [total, valid, cancelled, pending] = await Promise.all([
                Report_1.ReportModel.countDocuments(matchQuery),
                Report_1.ReportModel.countDocuments({ ...matchQuery, adminStatus: 'VALID' }),
                Report_1.ReportModel.countDocuments({ ...matchQuery, adminStatus: 'DIABAIKAN' }),
                Report_1.ReportModel.countDocuments({ ...matchQuery, adminStatus: 'MENUNGGU' })
            ]);
            const vulnGroup = await Report_1.ReportModel.aggregate([
                { $match: { ...matchQuery, aiStatus: { $in: ['TINGGI', 'SEDANG'] } } },
                { $group: { _id: '$location', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 1 }
            ]);
            let mostVulnerable = vulnGroup.length > 0 ? vulnGroup[0]._id : '-';
            if (total > 0 && mostVulnerable === '-') {
                const overallGroup = await Report_1.ReportModel.aggregate([
                    { $match: matchQuery },
                    { $group: { _id: '$location', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $limit: 1 }
                ]);
                if (overallGroup.length > 0) {
                    mostVulnerable = overallGroup[0]._id;
                }
            }
            return {
                total,
                mostVulnerable,
                valid,
                cancelled,
                pending
            };
        }
        catch (err) {
            console.error('[DATABASE ERROR] getStats failed:', err);
            throw err;
        }
    }
    // --- COMMENT METHODS ---
    static async addComment(reportId, userId, text) {
        try {
            const sanitized = text.replace(/<[^>]*>/g, '').trim();
            if (sanitized.length < 2 || sanitized.length > 500) {
                throw new Error('Komentar harus terdiri dari 2 hingga 500 karakter.');
            }
            const report = await Report_1.ReportModel.findOne({ id: reportId, deletedAt: null });
            if (!report) {
                throw new Error('Laporan tidak ditemukan.');
            }
            const commentData = {
                userId,
                text: sanitized,
                likedBy: [],
                isDeleted: false,
                parentCommentId: null
            };
            report.comments.push(commentData);
            await report.save();
            return report.comments[report.comments.length - 1];
        }
        catch (err) {
            console.error('[DATABASE ERROR] addComment failed:', err);
            throw err;
        }
    }
    static async deleteComment(reportId, commentId, userId, isAdmin) {
        try {
            const report = await Report_1.ReportModel.findOne({ id: reportId, deletedAt: null });
            if (!report) {
                throw new Error('Laporan tidak ditemukan.');
            }
            const comment = report.comments.id(commentId);
            if (!comment) {
                throw new Error('Komentar tidak ditemukan.');
            }
            if (comment.userId !== userId && !isAdmin) {
                throw new Error('Anda tidak memiliki akses untuk menghapus komentar ini.');
            }
            comment.isDeleted = true;
            await report.save();
            return comment;
        }
        catch (err) {
            console.error('[DATABASE ERROR] deleteComment failed:', err);
            throw err;
        }
    }
    static async toggleLikeComment(reportId, commentId, userId) {
        try {
            const report = await Report_1.ReportModel.findOne({ id: reportId, deletedAt: null });
            if (!report) {
                throw new Error('Laporan tidak ditemukan.');
            }
            const comment = report.comments.id(commentId);
            if (!comment) {
                throw new Error('Komentar tidak ditemukan.');
            }
            if (comment.isDeleted) {
                throw new Error('Komentar telah dihapus.');
            }
            const index = comment.likedBy.indexOf(userId);
            if (index > -1) {
                comment.likedBy.splice(index, 1);
            }
            else {
                comment.likedBy.push(userId);
            }
            await report.save();
            return comment;
        }
        catch (err) {
            console.error('[DATABASE ERROR] toggleLikeComment failed:', err);
            throw err;
        }
    }
}
exports.ReportRepository = ReportRepository;
