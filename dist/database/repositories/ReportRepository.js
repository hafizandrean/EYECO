"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportRepository = void 0;
const Report_1 = require("../models/Report");
const User_1 = require("../models/User");
const mongoose_1 = __importDefault(require("mongoose"));
const Workspace_1 = require("../models/Workspace");
class ReportRepository {
    static async findById(id, workspaceId) {
        const query = { _id: id, deletedAt: null };
        if (workspaceId !== undefined)
            query.workspaceId = workspaceId;
        const report = await Report_1.ReportModel.findOne(query).exec();
        return report;
    }
    static async findByLegacyId(id, workspaceId) {
        const query = { id, deletedAt: null };
        if (workspaceId !== undefined)
            query.workspaceId = workspaceId;
        const report = await Report_1.ReportModel.findOne(query).exec();
        return report;
    }
    static async update(id, updateData, session) {
        const options = { new: true, returnDocument: 'after', runValidators: true };
        if (session) {
            Object.assign(options, { session });
        }
        const report = await Report_1.ReportModel.findOneAndUpdate({ _id: id, deletedAt: null }, { $set: updateData }, options).exec();
        return report;
    }
    static async softDelete(id, actorId, actorName, reason, session) {
        const options = { new: true, returnDocument: 'after' };
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
        const options = { new: true, returnDocument: 'after' };
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
            // Use the workspaceId from the user's active session
            const user = await User_1.UserModel.findOne({ id: creatorId }).lean().exec();
            const userObjectId = user ? user._id : new mongoose_1.default.Types.ObjectId();
            const workspaceId = user?.workspaceId;
            if (!workspaceId) {
                throw new Error('User has no active workspace selected');
            }
            const newReport = await Report_1.ReportModel.create({
                ...report,
                id: nextId,
                userId: userObjectId,
                timestamp: new Date(),
                adminStatus: 'MENUNGGU',
                adminNotes: '',
                workspaceId: workspaceId,
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
    static async updateVerification(id, status, notes, assignedOfficer, progressStatus, workspaceId) {
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
            // Auto-delete 40 days after validation: set scheduledDeletionAt when VALID or DIABAIKAN
            if (status === 'VALID' || status === 'DIABAIKAN') {
                updateFields.scheduledDeletionAt = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000);
                // Catat waktu verifikasi (untuk review duration)
                updateFields.verifiedAt = new Date();
            }
            else {
                updateFields.scheduledDeletionAt = null;
                updateFields.verifiedAt = null;
            }
            const query = { id };
            if (workspaceId !== undefined)
                query.workspaceId = workspaceId;
            const updated = await Report_1.ReportModel.findOneAndUpdate(query, updateFields, { new: true }).exec();
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
            if (userContext.role === 'admin') {
                const user = await User_1.UserModel.findOne({ id: userContext.id }).lean().exec();
                const wsId = user?.workspaceId;
                if (wsId) {
                    query.workspaceId = wsId;
                }
                else {
                    query.workspaceId = -1; // No workspace assigned = no results
                }
            }
            else if (userContext.role === 'user' || userContext.role === 'operator') {
                // User/Operator sees all non-deleted reports in their workspace
                const user = await User_1.UserModel.findOne({ id: userContext.id }).lean().exec();
                if (user && user.workspaceId) {
                    query.workspaceId = user.workspaceId;
                }
                else {
                    query.workspaceId = -1;
                }
                query.sourceType = { $ne: 'AI_CCTV' };
            }
            else if (userContext.role === 'superadmin') {
                const ownedWorkspaces = await Workspace_1.WorkspaceModel.find({ superadminId: userContext.id }).lean().exec();
                const wsIds = ownedWorkspaces.map(w => w.id);
                if (wsIds.length > 0) {
                    query.workspaceId = { $in: wsIds };
                }
                else {
                    query.workspaceId = -1; // No owned workspaces = no results
                }
            }
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
            // ── Filter: Laporan Saya ──
            if (filters.myReports) {
                const currentUser = await User_1.UserModel.findOne({ id: userContext.id }).lean().exec();
                if (currentUser) {
                    query.userId = currentUser._id;
                }
            }
            const q = Report_1.ReportModel.find(query).sort({ timestamp: -1 });
            if (page !== undefined && limit !== undefined) {
                const skip = (page - 1) * limit;
                let [reports, total] = await Promise.all([
                    q.skip(skip).limit(limit).exec(),
                    Report_1.ReportModel.countDocuments(query).exec()
                ]);
                // Fallback untuk superadmin: jika tidak ada hasil dari workspace sendiri,
                // cari semua report (tanpa filter workspaceId)
                if (reports.length === 0 && total === 0 && userContext.role === 'superadmin') {
                    const fallbackQuery = { ...query };
                    delete fallbackQuery.workspaceId;
                    [reports, total] = await Promise.all([
                        Report_1.ReportModel.find(fallbackQuery).sort({ timestamp: -1 }).skip(skip).limit(limit).exec(),
                        Report_1.ReportModel.countDocuments(fallbackQuery).exec()
                    ]);
                }
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
    static async buildWorkspaceScope(userContext) {
        if (!userContext)
            return { workspaceId: -1 };
        if (userContext.role === 'admin' || userContext.role === 'user') {
            const user = await User_1.UserModel.findOne({ id: userContext.id }).lean().exec();
            if (!user?.workspaceId)
                return { workspaceId: -1 };
            return { workspaceId: user.workspaceId };
        }
        if (userContext.role === 'superadmin') {
            const ownedWorkspaces = await Workspace_1.WorkspaceModel.find({ superadminId: userContext.id }).lean().exec();
            const wsIds = ownedWorkspaces.map(w => w.id);
            if (wsIds.length > 0) {
                return { workspaceId: { $in: wsIds } };
            }
            return { workspaceId: -1 };
        }
        return { workspaceId: -1 };
    }
    static async getGlobalStats() {
        const matchQuery = { deletedAt: null };
        const [total, valid, cancelled, pending, tinggi, sedang, rendah, tidakTerindikasi] = await Promise.all([
            Report_1.ReportModel.countDocuments(matchQuery),
            Report_1.ReportModel.countDocuments({ ...matchQuery, adminStatus: 'VALID' }),
            Report_1.ReportModel.countDocuments({ ...matchQuery, adminStatus: 'DIABAIKAN' }),
            Report_1.ReportModel.countDocuments({ ...matchQuery, adminStatus: 'MENUNGGU' }),
            Report_1.ReportModel.countDocuments({ ...matchQuery, aiStatus: 'TINGGI' }),
            Report_1.ReportModel.countDocuments({ ...matchQuery, aiStatus: 'SEDANG' }),
            Report_1.ReportModel.countDocuments({ ...matchQuery, aiStatus: 'RENDAH' }),
            Report_1.ReportModel.countDocuments({ ...matchQuery, aiStatus: 'Tidak Terindikasi' })
        ]);
        return { total, valid, cancelled, pending, tinggi, sedang, rendah, tidakTerindikasi };
    }
    static async getStats(userContext) {
        try {
            const matchQuery = { deletedAt: null, ...(await this.buildWorkspaceScope(userContext)) };
            const [total, valid, cancelled, pending] = await Promise.all([
                Report_1.ReportModel.countDocuments(matchQuery),
                Report_1.ReportModel.countDocuments({ ...matchQuery, adminStatus: 'VALID' }),
                Report_1.ReportModel.countDocuments({ ...matchQuery, adminStatus: 'DIABAIKAN' }),
                Report_1.ReportModel.countDocuments({ ...matchQuery, adminStatus: 'MENUNGGU' })
            ]);
            // Fallback: jika superadmin hasil 0, coba tanpa filter workspace
            if (total === 0 && userContext?.role === 'superadmin') {
                const fallbackQuery = { deletedAt: null };
                const [total2, valid2, cancelled2, pending2] = await Promise.all([
                    Report_1.ReportModel.countDocuments(fallbackQuery),
                    Report_1.ReportModel.countDocuments({ ...fallbackQuery, adminStatus: 'VALID' }),
                    Report_1.ReportModel.countDocuments({ ...fallbackQuery, adminStatus: 'DIABAIKAN' }),
                    Report_1.ReportModel.countDocuments({ ...fallbackQuery, adminStatus: 'MENUNGGU' })
                ]);
                if (total2 > 0) {
                    // Hitung distribusi AI untuk fallback
                    const [fbTinggi, fbSedang, fbRendah, fbTidak] = await Promise.all([
                        Report_1.ReportModel.countDocuments({ ...fallbackQuery, aiStatus: 'TINGGI' }),
                        Report_1.ReportModel.countDocuments({ ...fallbackQuery, aiStatus: 'SEDANG' }),
                        Report_1.ReportModel.countDocuments({ ...fallbackQuery, aiStatus: 'RENDAH' }),
                        Report_1.ReportModel.countDocuments({ ...fallbackQuery, aiStatus: 'Tidak Terindikasi' })
                    ]);
                    const fbSevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                    const fbRecent = await Report_1.ReportModel.countDocuments({
                        ...fallbackQuery,
                        $or: [
                            { adminStatus: 'MENUNGGU' },
                            { timestamp: { $gte: fbSevenDaysAgo } }
                        ]
                    });
                    return { total: total2, mostVulnerable: '-', valid: valid2, cancelled: cancelled2, pending: pending2, tinggi: fbTinggi, sedang: fbSedang, rendah: fbRendah, tidakTerindikasi: fbTidak, recent: fbRecent, myReports: 0 };
                }
            }
            // Hitung distribusi AI status
            const [tinggi, sedang, rendah, tidakTerindikasi] = await Promise.all([
                Report_1.ReportModel.countDocuments({ ...matchQuery, aiStatus: 'TINGGI' }),
                Report_1.ReportModel.countDocuments({ ...matchQuery, aiStatus: 'SEDANG' }),
                Report_1.ReportModel.countDocuments({ ...matchQuery, aiStatus: 'RENDAH' }),
                Report_1.ReportModel.countDocuments({ ...matchQuery, aiStatus: 'Tidak Terindikasi' })
            ]);
            // "Laporan Terkini" = laporan MENUNGGU (any age) ATAU laporan dalam 7 hari terakhir
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const recent = await Report_1.ReportModel.countDocuments({
                ...matchQuery,
                $or: [
                    { adminStatus: 'MENUNGGU' },
                    { timestamp: { $gte: sevenDaysAgo } }
                ]
            });
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
            // Hitung jumlah laporan milik user yang sedang login
            let myReportsCount = 0;
            if (userContext?.id) {
                const currentUser = await User_1.UserModel.findOne({ id: userContext.id }).select('_id').lean().exec();
                if (currentUser) {
                    myReportsCount = await Report_1.ReportModel.countDocuments({ ...matchQuery, userId: currentUser._id }).exec();
                }
            }
            return {
                total,
                mostVulnerable,
                valid,
                cancelled,
                pending,
                tinggi,
                sedang,
                rendah,
                tidakTerindikasi,
                recent,
                myReports: myReportsCount
            };
        }
        catch (err) {
            console.error('[DATABASE ERROR] getStats failed:', err);
            throw err;
        }
    }
    // --- COMMENT METHODS ---
    static async addComment(reportId, userId, text, workspaceId, parentCommentId) {
        try {
            const sanitized = text.replace(/<[^>]*>/g, '').trim();
            if (sanitized.length < 2 || sanitized.length > 500) {
                throw new Error('Komentar harus terdiri dari 2 hingga 500 karakter.');
            }
            // If replying, validate parent comment exists first
            if (parentCommentId) {
                const parentReport = await Report_1.ReportModel.findOne({ id: reportId, deletedAt: null, 'comments._id': parentCommentId }, { 'comments.$': 1 }).lean().exec();
                if (!parentReport || !parentReport.comments || parentReport.comments.length === 0) {
                    throw new Error('Komentar induk tidak ditemukan.');
                }
            }
            // Query WITHOUT workspaceId — karena report LAMA tidak punya field workspaceId
            const query = { id: reportId, deletedAt: null };
            let report = await Report_1.ReportModel.findOne(query).lean().exec();
            if (!report) {
                // Fallback: coba dengan workspaceId (untuk report BARU)
                if (workspaceId !== undefined) {
                    const query2 = { id: reportId, deletedAt: null, workspaceId };
                    report = await Report_1.ReportModel.findOne(query2).lean().exec();
                }
                if (!report) {
                    throw new Error('Laporan tidak ditemukan.');
                }
            }
            const commentData = {
                userId,
                text: sanitized,
                likedBy: [],
                isDeleted: false,
                parentCommentId: parentCommentId || null
            };
            // Gunakan findOneAndUpdate untuk atomic push (hindari masalah dengan timestamps)
            const updated = await Report_1.ReportModel.findOneAndUpdate({ _id: report._id }, { $push: { comments: commentData } }, { new: true }).exec();
            if (!updated) {
                throw new Error('Gagal menambahkan komentar.');
            }
            const newComment = updated.comments[updated.comments.length - 1];
            return newComment;
        }
        catch (err) {
            console.error('[DATABASE ERROR] addComment failed:', err);
            throw err;
        }
    }
    static async deleteComment(reportId, commentId, userId, isAdmin, workspaceId) {
        try {
            // Try without workspaceId first
            const query = { id: reportId, deletedAt: null };
            if (workspaceId !== undefined) {
                query.workspaceId = workspaceId;
            }
            const report = await Report_1.ReportModel.findOne(query).exec();
            if (!report) {
                throw new Error('Laporan tidak ditemukan.');
            }
            const comment = report.comments.id(commentId);
            if (!comment) {
                throw new Error('Komentar tidak ditemukan.');
            }
            // Only allow deletion if user owns comment or is admin
            if (!isAdmin && comment.userId !== userId) {
                throw new Error('Tidak diizinkan menghapus komentar orang lain.');
            }
            comment.isDeleted = true;
            await report.save();
        }
        catch (err) {
            console.error('[DATABASE ERROR] deleteComment failed:', err);
            throw err;
        }
    }
    static async toggleLikeComment(reportId, commentId, userId, workspaceId) {
        try {
            const query = { id: reportId, deletedAt: null };
            if (workspaceId !== undefined) {
                query.workspaceId = workspaceId;
            }
            const report = await Report_1.ReportModel.findOne(query).exec();
            if (!report) {
                throw new Error('Laporan tidak ditemukan.');
            }
            const comment = report.comments.id(commentId);
            if (!comment) {
                throw new Error('Komentar tidak ditemukan.');
            }
            const likedIndex = comment.likedBy.indexOf(userId);
            if (likedIndex === -1) {
                comment.likedBy.push(userId);
            }
            else {
                comment.likedBy.splice(likedIndex, 1);
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
