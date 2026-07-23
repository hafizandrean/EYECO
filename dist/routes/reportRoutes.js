"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const Report_1 = require("../database/models/Report");
const User_1 = require("../database/models/User");
const ReportRepository_1 = require("../database/repositories/ReportRepository");
const authMiddleware_1 = require("../auth/authMiddleware");
const router = (0, express_1.Router)();
// Allowed MIME types for upload
const ALLOWED_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'video/mp4'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path_1.default.join(__dirname, '../../public/uploads');
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `upload_${uniqueSuffix}${ext}`);
    },
});
const fileFilter = (req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) {
        cb(null, true);
    }
    else {
        cb(new Error(`Format file tidak didukung. Hanya ${ALLOWED_MIMES.join(', ')} yang diizinkan.`));
    }
};
const upload = (0, multer_1.default)({
    storage,
    fileFilter,
    limits: { fileSize: MAX_FILE_SIZE },
});
const commentLimiter = (0, express_rate_limit_1.default)({
    windowMs: 30 * 1000,
    max: 5,
    message: { success: false, message: 'Terlalu banyak mengirim komentar, silakan tunggu 30 detik.' },
    standardHeaders: true,
    legacyHeaders: false,
});
const likeLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 30,
    message: { success: false, message: 'Terlalu banyak menekan tombol suka, silakan tunggu 1 menit.' },
    standardHeaders: true,
    legacyHeaders: false,
});
function sendSuccess(res, data, status = 200) {
    return res.status(status).json({ success: true, data });
}
function sendError(res, message, status = 400) {
    return res.status(status).json({ success: false, message });
}
// ====== ROUTES ======
router.get('/detections', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        const userContext = user ? { id: user.id, role: user.role } : { id: 1, role: 'admin' };
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const filters = {
            timeRange: req.query.timeRange,
            date: req.query.date,
            aiStatus: req.query.aiStatus,
            adminStatus: req.query.adminStatus,
            location: req.query.location,
        };
        const result = await ReportRepository_1.ReportRepository.getFiltered(filters, userContext, page, limit);
        if (!result || !('reports' in result))
            return res.status(500).json({ error: 'Gagal memproses data laporan' });
        const totalPages = Math.ceil(result.total / limit) || 1;
        res.json({
            reports: result.reports,
            pagination: {
                page,
                limit,
                totalReports: result.total,
                totalPages,
                hasPrev: page > 1,
                hasNext: page < totalPages,
            },
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] Get reports list failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.get('/detections/:id', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID laporan tidak valid' });
        }
        const report = await Report_1.ReportModel.findOne({ id, deletedAt: null }).lean().exec();
        if (!report) {
            return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        }
        // Include info user yang upload laporan (jika admin/superadmin)
        const responseReport = { ...report };
        if (responseReport.image && typeof responseReport.image === 'string') {
            let img = responseReport.image;
            if (!img.startsWith('/') && !img.startsWith('http')) {
                img = '/' + img;
            }
            responseReport.image = img;
        }
        if (user && (user.role === 'admin' || user.role === 'superadmin')) {
            const uploader = await User_1.UserModel.findOne({ _id: report.userId }).select('username name avatar email phone').lean().exec();
            if (uploader) {
                responseReport.uploaderInfo = {
                    username: uploader.username,
                    name: uploader.name || '',
                    avatar: uploader.avatar || '',
                    email: uploader.email || '',
                    phone: uploader.phone || ''
                };
            }
        }
        console.log(`[API_DETECTIONS] GET /detections/${id} -> returning report id=${report.id}, image=${responseReport.image}, location=${responseReport.location}, boxes=${Array.isArray(responseReport.boundingBoxes) ? responseReport.boundingBoxes.length : 0}`);
        res.json(responseReport);
    }
    catch (err) {
        console.error('[SERVER ERROR] Get single report failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/detections/:id/verify', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        if (user.role !== 'admin')
            return res.status(403).json({ error: 'Hanya Admin yang dapat memvalidasi laporan' });
        if (!user.workspaceId)
            return res.status(403).json({ error: 'Admin belum memiliki workspace aktif' });
        const id = parseInt(req.params.id);
        const { status, notes, assignedOfficer, progressStatus } = req.body;
        if (!status || !['VALID', 'DIABAIKAN', 'MENUNGGU'].includes(status)) {
            return res.status(400).json({ error: 'Status tidak valid' });
        }
        const updatedReport = await ReportRepository_1.ReportRepository.updateVerification(id, status, notes || '', assignedOfficer, progressStatus, user.workspaceId);
        if (!updatedReport)
            return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        res.json(updatedReport);
    }
    catch (err) {
        console.error('[SERVER ERROR] Verify report failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.get('/detections/:id/comments', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return sendError(res, 'Unauthorized', 401);
        const reportId = parseInt(req.params.id);
        // Query tanpa workspaceId dulu (untuk report lama yang tidak punya field ini)
        let report = await Report_1.ReportModel.findOne({ id: reportId, deletedAt: null }).lean();
        if (!report && user.workspaceId) {
            report = await Report_1.ReportModel.findOne({ id: reportId, deletedAt: null, workspaceId: user.workspaceId }).lean();
        }
        if (!report)
            return sendError(res, 'Laporan tidak ditemukan', 404);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const sortBy = req.query.sortBy || 'newest';
        let activeComments = (report.comments || []).filter((c) => !c.isDeleted);
        if (sortBy === 'newest') {
            activeComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        }
        else if (sortBy === 'oldest') {
            activeComments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        }
        else if (sortBy === 'most_liked') {
            activeComments.sort((a, b) => (b.likedBy || []).length - (a.likedBy || []).length);
        }
        const total = activeComments.length;
        const totalPages = Math.ceil(total / limit) || 1;
        const skip = (page - 1) * limit;
        const paginatedComments = activeComments.slice(skip, skip + limit);
        const uniqueUserIds = Array.from(new Set(paginatedComments.map((c) => c.userId)));
        const users = await User_1.UserModel.find({ id: { $in: uniqueUserIds } }).select('id username role avatar').lean();
        const userMap = new Map(users.map((u) => [u.id, { username: u.username, role: u.role, avatar: u.avatar || '' }]));
        const commentsWithUser = paginatedComments.map((c) => {
            const uInfo = userMap.get(c.userId);
            return {
                ...c,
                parentCommentId: c.parentCommentId || null,
                username: uInfo ? uInfo.username : 'Pengguna tidak dikenal',
                role: uInfo ? uInfo.role : 'user',
                avatar: uInfo ? uInfo.avatar : ''
            };
        });
        return sendSuccess(res, {
            comments: commentsWithUser,
            pagination: {
                page, limit,
                totalComments: total, totalPages,
                hasPrev: page > 1, hasNext: page < totalPages
            }
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] Get comments failed:', err);
        return sendError(res, 'Internal Server Error', 500);
    }
});
router.post('/detections/:id/comments', commentLimiter, async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return sendError(res, 'Unauthorized', 401);
        const reportId = parseInt(req.params.id);
        const { text, parentCommentId } = req.body;
        if (!text || typeof text !== 'string')
            return sendError(res, 'Konten komentar harus diisi.', 400);
        const comment = await ReportRepository_1.ReportRepository.addComment(reportId, user.id, text, user.workspaceId, parentCommentId || null);
        return sendSuccess(res, { ...comment, username: user.username, role: user.role }, 201);
    }
    catch (err) {
        console.error('[SERVER ERROR] Create comment failed:', err);
        return sendError(res, err instanceof Error ? err.message : 'Internal Server Error', 500);
    }
});
router.delete('/detections/:id/comments/:commentId', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return sendError(res, 'Unauthorized', 401);
        const reportId = parseInt(req.params.id);
        const commentId = req.params.commentId;
        const isAdmin = user.role === 'admin';
        await ReportRepository_1.ReportRepository.deleteComment(reportId, commentId, user.id, isAdmin, user.workspaceId);
        return sendSuccess(res, { success: true });
    }
    catch (err) {
        console.error('[SERVER ERROR] Delete comment failed:', err);
        return sendError(res, err instanceof Error ? err.message : 'Internal Server Error', 500);
    }
});
router.post('/detections/:id/comments/:commentId/like', likeLimiter, async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return sendError(res, 'Unauthorized', 401);
        const reportId = parseInt(req.params.id);
        const commentId = req.params.commentId;
        const comment = await ReportRepository_1.ReportRepository.toggleLikeComment(reportId, commentId, user.id, user.workspaceId);
        const isLiked = comment.likedBy.includes(user.id);
        return sendSuccess(res, {
            commentId,
            likedBy: comment.likedBy,
            likeCount: comment.likedBy.length,
            isLiked
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] Like comment failed:', err);
        return sendError(res, err instanceof Error ? err.message : 'Internal Server Error', 500);
    }
});
router.get('/stats', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        const userContext = user ? { id: user.id, role: user.role } : { id: 1, role: 'admin' };
        const stats = await ReportRepository_1.ReportRepository.getStats(userContext);
        res.json(stats);
    }
    catch (err) {
        console.error('[SERVER ERROR] Get stats failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/detections', (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            // Multer errors (file size, file type, etc.)
            if (err instanceof multer_1.default.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    console.log(`[UPLOAD] File rejected: too large (>10MB)`);
                    return res.status(400).json({ error: 'Ukuran file maksimal 10MB.' });
                }
                console.log(`[UPLOAD] Multer error: ${err.message}`);
                return res.status(400).json({ error: `Upload error: ${err.message}` });
            }
            // Custom file filter error
            console.log(`[UPLOAD] File rejected: ${err.message}`);
            return res.status(400).json({ error: err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        if (user.role === 'superadmin')
            return res.status(403).json({ error: 'Superadmin tidak dapat upload laporan' });
        if (!req.file)
            return res.status(400).json({ error: 'File media wajib diupload' });
        const { location, identity, sourceType, additionalNotes } = req.body;
        const uploadDir = path_1.default.join(__dirname, '../../public/uploads');
        const uploadedFilePath = path_1.default.join(uploadDir, req.file.filename);
        console.log(`[UPLOAD] video diterima: ${req.file.filename} (${req.file.mimetype}, ${(req.file.size / 1024).toFixed(1)}KB)`);
        console.log(`[UPLOAD] oleh user: ${user.username} (role: ${user.role})`);
        // ==============================
        // STEP 1: Create report (tanpa AI detection dulu — biar cepat)
        // ==============================
        const newReport = await ReportRepository_1.ReportRepository.create({
            location: location || 'Lokasi tidak diketahui',
            aiStatus: 'Tidak Terindikasi',
            aiConfidence: null,
            image: `/uploads/${req.file.filename}`,
            identity: identity || 'Belum diketahui',
            sourceType: sourceType || 'Gambar',
            additionalNotes: additionalNotes || 'Tidak ada catatan tambahan.',
            boundingBoxes: [],
        }, user.id);
        console.log(`[UPLOAD] Report #${newReport.id} (_id: ${newReport._id}) berhasil dibuat`);
        // ==============================
        // STEP 2: Jalankan AI Pipeline Orchestrator v3.0 (aiEngine)
        // ==============================
        console.log('[AI_ENGINE] Running AI Pipeline Orchestrator for report #' + newReport.id);
        const { aiEngine } = require('../services/ai/aiEngine');
        const aiAnalysis = await aiEngine.analyze(uploadedFilePath, { reportId: newReport.id });
        // ==============================
        // STEP 3: Update MongoDB dengan hasil AI v3.0 & snapshot
        // ==============================
        console.log('[AI] Mengupdate report #' + newReport.id + ' dengan hasil AI Engine v3.0...');
        const updateResult = await Report_1.ReportModel.updateOne({ _id: newReport._id }, {
            $set: {
                aiStatus: aiAnalysis.decision.status,
                aiConfidence: aiAnalysis.decision.objectConfidence,
                violationScore: aiAnalysis.decision.violationScore,
                objectConfidence: aiAnalysis.decision.objectConfidence,
                sceneConfidence: aiAnalysis.decision.sceneConfidence,
                decisionConfidence: aiAnalysis.decision.decisionConfidence,
                uncertaintyScore: aiAnalysis.decision.uncertaintyScore,
                priority: aiAnalysis.decision.priority,
                recommendedAction: aiAnalysis.decision.recommendedAction,
                activeSnapshotId: aiAnalysis.snapshot._id,
                boundingBoxes: aiAnalysis.objects.map((o) => ({
                    label: o.class,
                    confidence: o.confidence,
                    x: o.x,
                    y: o.y,
                    w: o.w,
                    h: o.h
                })),
            },
            $push: {
                snapshotHistory: aiAnalysis.snapshot._id
            }
        }).exec();
        // ==============================
        // STEP 4: Ambil data terbaru dari DB untuk response
        // ==============================
        const updatedReport = await Report_1.ReportModel.findById(newReport._id).lean().exec();
        if (!updatedReport) {
            console.error('[UPLOAD] ❌ KRITIKAL: Report hilang setelah update!');
            return res.status(500).json({ error: 'Internal Server Error' });
        }
        console.log('[UPLOAD] Final report v3.0 — id=' + updatedReport.id + ', aiStatus=' + updatedReport.aiStatus + ', violationScore=' + updatedReport.violationScore + ', priority=' + updatedReport.priority);
        // Copy last_capture.jpg
        try {
            const sourcePath = path_1.default.join(uploadDir, req.file.filename);
            const destPath = path_1.default.join(uploadDir, 'last_capture.jpg');
            fs_1.default.copyFileSync(sourcePath, destPath);
        }
        catch (err) {
            console.error('[SERVER ERROR] Error copying last capture image:', err);
        }
        res.status(201).json(updatedReport);
    }
    catch (err) {
        console.error('[SERVER ERROR] Create report failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.get('/export', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).send('Forbidden: Hanya Admin yang dapat mengekspor laporan');
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="eyeco_report_export.csv"');
        res.write('ID,User ID,Lokasi,Waktu Kejadian,Status AI,Keyakinan AI (%),Status Admin,Sumber,Identitas,Catatan Admin\n');
        const query = user.workspaceId ? { workspaceId: user.workspaceId } : { workspaceId: -1 };
        const cursor = Report_1.ReportModel.find(query).sort({ id: 1 }).cursor();
        cursor.on('data', (doc) => {
            const timestampStr = doc.timestamp instanceof Date ? doc.timestamp.toISOString() : doc.timestamp;
            const row = [
                doc.id,
                doc.userId,
                `"${(doc.location || '').replace(/"/g, '""')}"`,
                timestampStr,
                doc.aiStatus,
                doc.aiConfidence !== null ? doc.aiConfidence : 'N/A',
                doc.adminStatus,
                doc.sourceType,
                `"${(doc.identity || '').replace(/"/g, '""')}"`,
                `"${(doc.adminNotes || '').replace(/"/g, '""')}"`,
            ];
            res.write(row.join(',') + '\n');
        });
        cursor.on('end', () => res.end());
        cursor.on('error', (err) => {
            console.error('[SERVER ERROR] Export cursor error:', err);
            if (!res.headersSent)
                res.status(500).send('Internal Server Error during export');
            else
                res.end();
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] Export failed:', err);
        if (!res.headersSent)
            res.status(500).send('Internal Server Error');
    }
});
// DELETE /api/reports/clear-all — Admin only: clear all reports in workspace
router.delete('/clear-all', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        if (user.role !== 'admin' && user.role !== 'superadmin') {
            return res.status(403).json({ error: 'Hanya admin yang dapat menghapus semua data' });
        }
        if (!user.workspaceId) {
            return res.status(400).json({ error: 'Tidak ada workspace aktif' });
        }
        const result = await Report_1.ReportModel.deleteMany({ workspaceId: user.workspaceId });
        console.log(`[ADMIN] Cleared ${result.deletedCount} reports from workspace ${user.workspaceId}`);
        res.json({ success: true, deleted: result.deletedCount });
    }
    catch (err) {
        console.error('[SERVER ERROR] Clear all reports failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// POST /api/detections/:id/signal — Community Signal (masih terjadi / sudah bersih)
router.post('/detections/:id/signal', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return sendError(res, 'Unauthorized', 401);
        const reportId = parseInt(req.params.id);
        const { type } = req.body; // 'active' | 'resolved'
        if (!type || !['active', 'resolved'].includes(type)) {
            return sendError(res, 'Tipe sinyal tidak valid.', 400);
        }
        // Cari report (tanpa workspaceId dulu untuk kompatibilitas)
        let report = await Report_1.ReportModel.findOne({ id: reportId, deletedAt: null }).exec();
        if (!report && user.workspaceId) {
            report = await Report_1.ReportModel.findOne({ id: reportId, deletedAt: null, workspaceId: user.workspaceId }).exec();
        }
        if (!report)
            return sendError(res, 'Laporan tidak ditemukan.', 404);
        // Initialize signals array if not exists
        if (!report.signals) {
            report.signals = { active: [], resolved: [] };
        }
        // Check if user already voted
        const alreadyActive = (report.signals.active || []).includes(user.id);
        const alreadyResolved = (report.signals.resolved || []).includes(user.id);
        // Remove previous vote if exists
        report.signals.active = (report.signals.active || []).filter((id) => id !== user.id);
        report.signals.resolved = (report.signals.resolved || []).filter((id) => id !== user.id);
        // Add new vote
        if (type === 'active') {
            report.signals.active.push(user.id);
        }
        else {
            report.signals.resolved.push(user.id);
        }
        await report.save();
        res.json({
            success: true,
            data: {
                active: report.signals.active.length,
                resolved: report.signals.resolved.length,
                voted: true
            }
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] Community signal failed:', err);
        sendError(res, 'Internal Server Error', 500);
    }
});
exports.default = router;
