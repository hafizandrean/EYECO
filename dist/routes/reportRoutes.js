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
const AiSnapshot_1 = require("../database/models/AiSnapshot");
const User_1 = require("../database/models/User");
const ReportRepository_1 = require("../database/repositories/ReportRepository");
const ReportAiProjectionService_1 = require("../services/ai/ReportAiProjectionService");
const authMiddleware_1 = require("../auth/authMiddleware");
const NotificationService_1 = require("../services/NotificationService");
const Notification_1 = require("../database/models/Notification");
const SystemAuditLog_1 = require("../database/models/SystemAuditLog");
const Workspace_1 = require("../database/models/Workspace");
const R2StorageService_1 = require("../services/R2StorageService");
const feedbackCollector_1 = require("../services/ai/validation/feedbackCollector");
const AiValidationLog_1 = require("../database/models/AiValidationLog");
const TimelineEvent_1 = require("../database/models/TimelineEvent");
const AiDatasetCandidate_1 = require("../database/models/AiDatasetCandidate");
const AiDatasetVersion_1 = require("../database/models/AiDatasetVersion");
const datasetBuilder_1 = require("../services/ai/continualLearning/datasetBuilder");
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
        const userContext = user ? { id: user.id, role: user.role } : { id: 0, role: 'public', workspaceId: 9 };
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const filters = {
            timeRange: req.query.timeRange,
            date: req.query.date,
            aiStatus: req.query.aiStatus,
            adminStatus: req.query.adminStatus,
            location: req.query.location,
            myReports: req.query.myReports === 'true' ? true : false,
        };
        const result = await ReportRepository_1.ReportRepository.getFiltered(filters, userContext, page, limit);
        if (!result || !('reports' in result))
            return res.status(500).json({ error: 'Gagal memproses data laporan' });
        // Inject canDelete flag per report + uploader info (admin/superadmin)
        const TEN_MINUTES = 10 * 60 * 1000;
        const userObjectId = user ? (user._id?.toString() || '') : '';
        const reportsWithFlags = result.reports.map(r => {
            const plain = typeof r.toObject === 'function' ? r.toObject() : r;
            const repCreatedAt = plain.createdAt || plain.timestamp;
            const canDelete = !!userObjectId && plain.userId
                && plain.userId.toString() === userObjectId
                && repCreatedAt && (Date.now() - new Date(repCreatedAt).getTime()) < TEN_MINUTES;
            return { ...plain, canDelete };
        });
        // Batch fetch active snapshots for all reports in 1 single MongoDB query (0 N+1 overhead)
        const activeSnapIds = [...new Set(reportsWithFlags.map((r) => r.activeSnapshotId?.toString()).filter(Boolean))];
        const snapMap = new Map();
        if (activeSnapIds.length > 0) {
            const snapshots = await AiSnapshot_1.AiSnapshotModel.find({ _id: { $in: activeSnapIds } }).lean().exec();
            snapshots.forEach((s) => snapMap.set(s._id.toString(), s));
        }
        // Attach ReportAiProjectionService projection for each report
        reportsWithFlags.forEach((r) => {
            const snap = r.activeSnapshotId ? snapMap.get(r.activeSnapshotId.toString()) : null;
            const projection = ReportAiProjectionService_1.ReportAiProjectionService.buildReportAiProjection(r, snap);
            Object.assign(r, projection);
        });
        // Batch fetch uploader info for admin/superadmin
        if (user && (user.role === 'admin' || user.role === 'superadmin')) {
            const userIds = [...new Set(reportsWithFlags.map((r) => r.userId?.toString()).filter(Boolean))];
            if (userIds.length > 0) {
                const uploaders = await User_1.UserModel.find({ _id: { $in: userIds } }).select('username name').lean().exec();
                const uploaderMap = new Map();
                uploaders.forEach((u) => uploaderMap.set(u._id.toString(), { username: u.username, name: u.name || '' }));
                reportsWithFlags.forEach((r) => {
                    const uid = r.userId?.toString();
                    if (uid && uploaderMap.has(uid)) {
                        r.uploaderInfo = uploaderMap.get(uid);
                    }
                });
            }
        }
        const totalPages = Math.ceil(result.total / limit) || 1;
        res.json({
            reports: reportsWithFlags,
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
        // Resolve active snapshot & build single-source-of-truth AI projection
        let snapshot = null;
        if (report.activeSnapshotId) {
            snapshot = await AiSnapshot_1.AiSnapshotModel.findById(report.activeSnapshotId).lean().exec();
        }
        const aiProjection = ReportAiProjectionService_1.ReportAiProjectionService.buildReportAiProjection(report, snapshot);
        Object.assign(responseReport, aiProjection);
        // Reporter privacy projection (Backend-enforced, NO raw email/phone sent to unauthorized users)
        const uploaderDoc = report.userId ? await User_1.UserModel.findById(report.userId).select('username name avatar email phone id').lean().exec() : null;
        const reporterProj = ReportAiProjectionService_1.ReportAiProjectionService.projectReporterForViewer(uploaderDoc, uploaderDoc?.id || 0, user?.id || 0, user?.role || 'user');
        responseReport.reporterInfo = reporterProj;
        if (responseReport.image && typeof responseReport.image === 'string') {
            let img = responseReport.image;
            if (!img.startsWith('/') && !img.startsWith('http')) {
                img = '/' + img;
            }
            responseReport.image = img;
        }
        // Add canDelete flag: owner within 10 min
        const TEN_MINUTES = 10 * 60 * 1000;
        const repCreatedAt = report.createdAt || report.timestamp;
        const canDelete = user && report.userId
            && report.userId.toString() === user._id?.toString()
            && repCreatedAt && (Date.now() - new Date(repCreatedAt).getTime()) < TEN_MINUTES;
        responseReport.canDelete = !!canDelete;
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
        if (!status || !['VALID', 'TIDAK_VALID', 'MENUNGGU'].includes(status)) {
            return res.status(400).json({ error: 'Status tidak valid' });
        }
        const updatedReport = await ReportRepository_1.ReportRepository.updateVerification(id, status, notes || '', assignedOfficer, progressStatus, user.workspaceId);
        if (!updatedReport)
            return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        // Notify the report owner about validation
        if (updatedReport.userId) {
            const reportOwner = await User_1.UserModel.findById(updatedReport.userId).select('id').lean().exec();
            if (reportOwner) {
                NotificationService_1.NotificationService.notifyValidation(id, status, reportOwner.id, updatedReport.workspaceId);
            }
        }
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
        // Find the report to determine who owns it
        const report = await Report_1.ReportModel.findOne({ id: reportId, deletedAt: null })
            .select('userId workspaceId')
            .lean()
            .exec();
        if (!report)
            return sendError(res, 'Laporan tidak ditemukan', 404);
        const comment = await ReportRepository_1.ReportRepository.addComment(reportId, user.id, text, user.workspaceId, parentCommentId || null);
        // Notify the report owner if someone else commented (don't notify on self-comment)
        if (report.userId && !report.userId.equals(user._id)) {
            // Resolve the report owner's numeric legacy ID for the notification service
            const reportOwner = await User_1.UserModel.findById(report.userId).select('id').lean().exec();
            if (reportOwner) {
                NotificationService_1.NotificationService.notifyComment(reportId, user.name || user.username, reportOwner.id, report.workspaceId);
            }
        }
        return sendSuccess(res, { ...comment, username: user.username, role: user.role }, 201);
    }
    catch (err) {
        console.error('[SERVER ERROR] Create comment failed:', err);
        return sendError(res, err instanceof Error ? err.message : 'Internal Server Error', 500);
    }
});
router.post('/detections/:id/upload-update', upload.single('file'), async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return sendError(res, 'Unauthorized', 401);
        const reportId = parseInt(req.params.id);
        if (!req.file)
            return sendError(res, 'File gambar harus diunggah.', 400);
        const report = await Report_1.ReportModel.findOne({ id: reportId, deletedAt: null })
            .select('userId workspaceId')
            .lean()
            .exec();
        if (!report)
            return sendError(res, 'Laporan tidak ditemukan', 404);
        const text = `[Kondisi Terbaru] Warga mengunggah foto kondisi terkini lokasi: /uploads/${req.file.filename}`;
        const comment = await ReportRepository_1.ReportRepository.addComment(reportId, user.id, text, user.workspaceId, null);
        return sendSuccess(res, { ...comment, username: user.username, role: user.role }, 201);
    }
    catch (err) {
        console.error('[SERVER ERROR] Upload update comment failed:', err);
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
router.get('/stats/global', async (_req, res) => {
    try {
        const stats = await ReportRepository_1.ReportRepository.getGlobalStats();
        res.json(stats);
    }
    catch (err) {
        console.error('[SERVER ERROR] Get global stats failed:', err);
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
            image: `/uploads/laporan_manual/${req.file.filename}`,
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
        const aiAnalysis = await aiEngine.analyze(uploadedFilePath, { reportId: newReport.id, forceReanalysis: true });
        // ==============================
        // STEP 3: Update MongoDB dengan hasil AI v3.0 & snapshot
        // ==============================
        console.log('[AI] Mengupdate report #' + newReport.id + ' dengan hasil AI Engine v3.0...');
        const isVideo = req.file.mimetype.startsWith('video/') || sourceType === 'Video';
        // Normalize status for consistency
        const rawStatus = aiAnalysis.decision.status;
        let normalizedStatus = 'Tidak Terindikasi';
        if (rawStatus === 'Indikasi Tinggi' || rawStatus === 'TINGGI') {
            normalizedStatus = 'TINGGI';
        }
        else if (rawStatus === 'Indikasi Sedang' || rawStatus === 'SEDANG') {
            normalizedStatus = 'SEDANG';
        }
        else if (rawStatus === 'Indikasi Rendah' || rawStatus === 'RENDAH') {
            normalizedStatus = 'RENDAH';
        }
        const updateFields = {
            aiStatus: normalizedStatus,
            aiConfidence: aiAnalysis.decision.decisionConfidence,
            violationScore: aiAnalysis.decision.violationScore,
            objectConfidence: aiAnalysis.decision.objectConfidence,
            sceneConfidence: aiAnalysis.decision.sceneConfidence,
            decisionConfidence: aiAnalysis.decision.decisionConfidence,
            uncertaintyScore: aiAnalysis.decision.uncertaintyScore,
            priority: aiAnalysis.decision.priority,
            recommendedAction: aiAnalysis.decision.recommendedAction,
            activeSnapshotId: aiAnalysis.snapshot._id,
            boundingBoxes: (aiAnalysis.objects || []).map((o) => {
                const labelMap = {
                    'person': 'Orang', 'people': 'Orang', 'sitting': 'Orang', 'standing': 'Orang', 'orang': 'Orang', 'cctv persons': 'Orang',
                    'bicycle': 'Sepeda', 'car': 'Mobil', 'motorcycle': 'Sepeda Motor', 'airplane': 'Pesawat', 'bus': 'Bus', 'train': 'Kereta',
                    'truck': 'Truk', 'boat': 'Perahu', 'perahu': 'Perahu', 'traffic light': 'Lampu Lalu Lintas', 'fire hydrant': 'Hidran Pemadam',
                    'stop sign': 'Rambu Stop', 'parking meter': 'Meteran Parkir', 'bench': 'Bangku', 'bird': 'Burung', 'cat': 'Kucing',
                    'dog': 'Anjing', 'horse': 'Kuda', 'sheep': 'Domba', 'cow': 'Sapi', 'elephant': 'Gajah', 'bear': 'Beruang',
                    'zebra': 'Zebra', 'giraffe': 'Jerapah', 'backpack': 'Ransel', 'umbrella': 'Payung', 'handbag': 'Tas Tangan',
                    'tie': 'Dasi', 'suitcase': 'Koper', 'frisbee': 'Frisbee', 'skis': 'Ski', 'snowboard': 'Papan Seluncur Salju',
                    'sports ball': 'Bola Olahraga', 'kite': 'Layang-layang', 'baseball bat': 'Pemukul Bisbol', 'baseball glove': 'Sarung Tangan Bisbol',
                    'skateboard': 'Papan Seluncur', 'surfboard': 'Papan Selancar', 'tennis racket': 'Raket Tenis', 'bottle': 'Botol',
                    'plastic': 'Plastik', 'wine glass': 'Gelas Anggur', 'cup': 'Cangkir', 'fork': 'Garpu', 'knife': 'Pisau',
                    'spoon': 'Sendok', 'bowl': 'Mangkuk', 'banana': 'Pisang', 'apple': 'Apel', 'sandwich': 'Roti Lapis',
                    'orange': 'Jeruk', 'broccoli': 'Brokoli', 'carrot': 'Wortel', 'hot dog': 'Hot Dog', 'pizza': 'Pizza',
                    'donut': 'Donat', 'cake': 'Kue', 'chair': 'Kursi', 'couch': 'Sofa', 'potted plant': 'Tanaman Pot',
                    'bed': 'Tempat Tidur', 'dining table': 'Meja Makan', 'toilet': 'Toilet', 'tv': 'TV', 'laptop': 'Laptop',
                    'mouse': 'Mouse', 'remote': 'Remote', 'keyboard': 'Keyboard', 'cell phone': 'Ponsel', 'microwave': 'Microwave',
                    'oven': 'Oven', 'toaster': 'Pemanggang Roti', 'sink': 'Wastafel', 'refrigerator': 'Kulkas', 'book': 'Buku',
                    'clock': 'Jam', 'jam': 'Jam', 'vase': 'Vas', 'scissors': 'Gunting', 'teddy bear': 'Boneka Beruang',
                    'hair drier': 'Pengering Rambut', 'toothbrush': 'Sikat Gigi', 'trash': 'Sampah', 'sampah': 'Sampah',
                    'waste': 'Sampah', 'bag': 'Kantong', 'cardboard': 'Kardus', 'object': 'Objek'
                };
                const cleanLabel = labelMap[(o.class || '').toLowerCase()] || o.class || 'Objek';
                let bx = typeof o.x === 'number' ? o.x : 0;
                let by = typeof o.y === 'number' ? o.y : 0;
                let bw = typeof o.w === 'number' ? o.w : 0;
                let bh = typeof o.h === 'number' ? o.h : 0;
                if (Array.isArray(o.bbox) && o.bbox.length === 4 && (!bw || !bh)) {
                    const [x1, y1, x2, y2] = o.bbox;
                    bx = x1;
                    by = y1;
                    bw = Math.max(0, x2 - x1);
                    bh = Math.max(0, y2 - y1);
                }
                return {
                    label: cleanLabel,
                    confidence: typeof o.confidence === 'number' ? Math.round(o.confidence * 100) / 100 : 0.5,
                    x: Math.min(Math.max(0, Math.round(bx * 10) / 10), 100),
                    y: Math.min(Math.max(0, Math.round(by * 10) / 10), 100),
                    w: Math.min(Math.max(0, Math.round(bw * 10) / 10), 100),
                    h: Math.min(Math.max(0, Math.round(bh * 10) / 10), 100)
                };
            }),
        };
        if (isVideo) {
            updateFields.videoPath = `/uploads/${req.file.filename}`;
            if (aiAnalysis.extractedFramePath) {
                updateFields.image = aiAnalysis.extractedFramePath;
            }
        }
        const updateResult = await Report_1.ReportModel.updateOne({ _id: newReport._id }, {
            $set: updateFields,
            $push: {
                snapshotHistory: aiAnalysis.snapshot._id
            }
        }).exec();
        // ==============================
        // STEP 3.5: Move file to report-specific subdir, then upload to R2 + update MongoDB
        // ==============================
        const reportUploadDir = path_1.default.join(uploadDir, 'reports', String(newReport.id));
        if (!fs_1.default.existsSync(reportUploadDir)) {
            fs_1.default.mkdirSync(reportUploadDir, { recursive: true });
        }
        const finalFilePath = path_1.default.join(reportUploadDir, req.file.filename);
        // Move file from temp location to report-specific subdir
        fs_1.default.renameSync(uploadedFilePath, finalFilePath);
        const r2Key = `eyecofiles/laporan_manual/${newReport.id}/${req.file.filename}`;
        const contentType = req.file.mimetype || 'application/octet-stream';
        try {
            await R2StorageService_1.R2StorageService.uploadFile(finalFilePath, r2Key, contentType, true);
            const r2Url = await R2StorageService_1.R2StorageService.getPublicUrl(r2Key);
            // Update image & videoPath di MongoDB — pake path yg match R2 key (proxy /uploads map ke eyecofiles/)
            const imagePath = `/uploads/laporan_manual/${newReport.id}/${req.file.filename}`;
            const r2Updates = { r2Key };
            if (!isVideo) {
                r2Updates.image = imagePath;
            }
            if (isVideo) {
                r2Updates.videoPath = imagePath;
                if (aiAnalysis.extractedFramePath) {
                    // Upload extracted frame juga
                    const frameKey = `eyecofiles/laporan_manual/${newReport.id}/frame.jpg`;
                    try {
                        const absFramePath = path_1.default.isAbsolute(aiAnalysis.extractedFramePath)
                            ? aiAnalysis.extractedFramePath
                            : path_1.default.join(__dirname, '../../', aiAnalysis.extractedFramePath);
                        if (fs_1.default.existsSync(absFramePath)) {
                            await R2StorageService_1.R2StorageService.uploadFile(absFramePath, frameKey, 'image/jpeg', true);
                            // extracted frame path sementara sama aja
                            try {
                                fs_1.default.unlinkSync(absFramePath);
                            }
                            catch { /* ignore */ }
                        }
                    }
                    catch (frameErr) {
                        console.warn('[R2] Frame upload skipped:', frameErr.message);
                    }
                }
            }
            // Update MongoDB dengan R2 URL
            await Report_1.ReportModel.updateOne({ _id: newReport._id }, { $set: r2Updates }).exec();
            // Copy last_capture.jpg SEBELUM hapus file lokal
            try {
                const destPath = path_1.default.join(uploadDir, 'last_capture.jpg');
                fs_1.default.copyFileSync(finalFilePath, destPath);
            }
            catch (lastErr) {
                console.warn('[UPLOAD] last_capture copy skipped:', lastErr.message);
            }
            // Hapus file lokal setelah berhasil upload ke R2 (optional — keep for local fallback)
            // try { fs.unlinkSync(finalFilePath); } catch { /* ignore */ }
            console.log(`[R2] File uploaded: ${r2Key} → ${r2Url}`);
        }
        catch (r2Err) {
            // Non-fatal: kalo R2 gagal, file tetap di lokal di path yang benar
            console.warn('[R2] Upload skipped (local fallback):', r2Err.message);
        }
        // ==============================
        // STEP 4: Ambil data terbaru dari DB untuk response
        // ==============================
        const updatedReport = await Report_1.ReportModel.findById(newReport._id).lean().exec();
        if (!updatedReport) {
            console.error('[UPLOAD] ❌ KRITIKAL: Report hilang setelah update!');
            return res.status(500).json({ error: 'Internal Server Error' });
        }
        console.log('[UPLOAD] Final report v3.0 — id=' + updatedReport.id + ', aiStatus=' + updatedReport.aiStatus + ', violationScore=' + updatedReport.violationScore + ', priority=' + updatedReport.priority);
        // ==============================
        // STEP 5: Notifikasi cross-user — kirim notifikasi NEW_REPORT ke semua user dalam workspace kecuali uploader
        // ==============================
        console.log(`[NOTIF] Membuat notifikasi NEW_REPORT untuk report #${newReport.id}...`);
        try {
            const workspaceId = newReport.workspaceId;
            if (workspaceId) {
                const workspaceUsers = await User_1.UserModel.find({
                    $or: [{ workspaceId }, { workspaceIds: workspaceId }],
                    _id: { $ne: user._id }
                })
                    .select('_id')
                    .lean()
                    .exec();
                console.log(`[NOTIF] Ditemukan ${workspaceUsers.length} user lain dalam workspace #${workspaceId}`);
                if (workspaceUsers.length > 0) {
                    const now = new Date();
                    const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
                    const notifs = workspaceUsers.map((u) => ({
                        workspaceId,
                        recipientId: u._id,
                        reportId: newReport._id,
                        type: 'NEW_REPORT',
                        title: 'Laporan Baru',
                        message: `${user.name || user.username} melaporkan: ${newReport.location}`,
                        actionUrl: `/dashboard/detections/${newReport.id}`,
                        icon: 'upload-cloud',
                        priority: 'MEDIUM',
                        read: false,
                        readAt: null,
                        expiresAt,
                        deletedAt: null,
                    }));
                    await Notification_1.NotificationModel.insertMany(notifs);
                    console.log(`[NOTIF] ✅ ${notifs.length} notifikasi NEW_REPORT berhasil dibuat`);
                }
            }
            else {
                console.log('[NOTIF] Tidak ada workspaceId pada laporan, skip notifikasi');
            }
        }
        catch (notifErr) {
            console.error('[NOTIF] Gagal membuat notifikasi cross-user:', notifErr instanceof Error ? notifErr.message : notifErr);
            // Non-fatal: jangan sampai error notifikasi menggagalkan response
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
        // 1. Dapatkan info workspace
        const workspace = await Workspace_1.WorkspaceModel.findOne({ id: user.workspaceId }).select('name').lean().exec();
        // 2. Ambil semua laporan yang akan dihapus (dapatkan path gambar)
        const reports = await Report_1.ReportModel.find({ workspaceId: user.workspaceId })
            .select('image')
            .lean()
            .exec();
        const imagePaths = reports
            .map(r => r.image)
            .filter(img => img && img.startsWith('/uploads/'));
        // 3. Hapus file gambar dari disk
        const uploadDir = path_1.default.join(__dirname, '../../public');
        let deletedFiles = 0;
        let failedFiles = 0;
        for (const imgPath of imagePaths) {
            const fullPath = path_1.default.join(uploadDir, imgPath);
            try {
                if (fs_1.default.existsSync(fullPath)) {
                    fs_1.default.unlinkSync(fullPath);
                    deletedFiles++;
                }
            }
            catch (fileErr) {
                failedFiles++;
                console.error(`[ADMIN] Gagal hapus file: ${imgPath}`, fileErr);
            }
        }
        // 4. Hapus semua record dari database (hard delete permanent)
        const result = await Report_1.ReportModel.deleteMany({ workspaceId: user.workspaceId });
        // 5. Catat audit log untuk superadmin
        const adminName = user.name || user.username || 'Admin';
        const workspaceName = workspace?.name || `Workspace #${user.workspaceId}`;
        try {
            await SystemAuditLog_1.SystemAuditLogModel.create({
                tenantId: 'system',
                actorId: user._id || null,
                actorName: adminName,
                action: 'CLEAR_ALL_REPORTS',
                ipAddress: req.ip || req.socket.remoteAddress || '',
                userAgent: req.headers['user-agent'] || '',
                details: {
                    workspaceId: user.workspaceId,
                    workspaceName: workspaceName,
                    deletedCount: result.deletedCount,
                    filesDeleted: deletedFiles,
                    filesFailed: failedFiles,
                    performedBy: adminName,
                    timestamp: new Date().toISOString()
                }
            });
        }
        catch (auditErr) {
            console.error('[ADMIN] Gagal mencatat audit log:', auditErr);
        }
        console.log(`[ADMIN] ${adminName} cleared ${result.deletedCount} reports + ${deletedFiles} files from workspace ${user.workspaceId} (${workspaceName})${failedFiles > 0 ? ` (${failedFiles} file gagal dihapus)` : ''}`);
        res.json({
            success: true,
            deleted: result.deletedCount,
            filesDeleted: deletedFiles,
            filesFailed: failedFiles
        });
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
// ── User Hapus Laporan Sendiri (dalam 10 menit) ──
router.delete('/detections/:id', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        const reportId = parseInt(req.params.id);
        if (!reportId)
            return res.status(400).json({ error: 'ID laporan tidak valid' });
        const report = await Report_1.ReportModel.findOne({ id: reportId, deletedAt: null }).lean().exec();
        if (!report)
            return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        // Pastikan user pemilik laporan
        if (!report.userId || report.userId.toString() !== user._id.toString()) {
            return res.status(403).json({ error: 'Anda hanya bisa menghapus laporan Anda sendiri' });
        }
        // Cek batas waktu 10 menit
        const createdAt = report.createdAt || report.timestamp;
        const elapsed = Date.now() - new Date(createdAt).getTime();
        const TEN_MINUTES = 10 * 60 * 1000;
        if (elapsed > TEN_MINUTES) {
            return res.status(403).json({ error: 'Batas waktu 10 menit untuk menghapus laporan telah lewat' });
        }
        await Report_1.ReportModel.updateOne({ _id: report._id }, { $set: { deletedAt: new Date(), deletedById: user._id, deleteReason: 'Dihapus oleh user' } }).exec();
        res.json({ success: true, message: 'Laporan berhasil dihapus' });
    }
    catch (err) {
        console.error('[SERVER ERROR] User delete report failed:', err);
        const msg = err instanceof Error ? err.message : 'Internal Server Error';
        res.status(500).json({ error: msg });
    }
});
// ── TEMP endpoints removed after AI_CCTV cleanup ──
// POST /api/detect-preview — Preview AI detection on an image without saving to DB
router.post('/detect-preview', upload.single('file'), async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        if (!req.file)
            return res.status(400).json({ error: 'File gambar wajib diupload' });
        const uploadedFilePath = path_1.default.join(__dirname, '../../public/uploads', req.file.filename);
        // Gunakan YOLOv8n (COCO) untuk preview — mendeteksi 80 class termasuk bottle, cup, phone
        const { detectFile } = require('../services/aiDetection.service');
        const result = await detectFile(uploadedFilePath, { model: 'yolov8n.pt', conf: 0.05 });
        // Hapus file temp
        try {
            fs_1.default.unlinkSync(uploadedFilePath);
        }
        catch (_) { }
        const boxes = (result.boxes || []).map((b) => ({
            label: b.label,
            confidence: b.confidence,
            x: b.x, y: b.y, w: b.w, h: b.h,
        }));
        // Person detection for auto-upload trigger & status
        const personBoxes = boxes.filter((b) => ['person', 'cctv persons', 'people'].includes(b.label.toLowerCase()));
        let aiStatus = 'Tidak Terindikasi';
        if (boxes.length > 0 && personBoxes.length === 0)
            aiStatus = 'Indikasi Rendah';
        else if (personBoxes.length > 0 && boxes.length > personBoxes.length)
            aiStatus = 'Indikasi Sedang';
        else if (personBoxes.length > 0)
            aiStatus = 'Tidak Terindikasi';
        res.json({
            success: true,
            boxes,
            aiStatus,
            totalDetections: boxes.length,
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] Detect preview failed:', err);
        res.status(500).json({ error: 'Gagal memproses deteksi AI' });
    }
});
// GET /api/detections/:id/pdf — Export laporan sebagai PDF
router.get('/detections/:id/pdf', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        const id = parseInt(req.params.id);
        if (isNaN(id))
            return res.status(400).json({ error: 'ID laporan tidak valid' });
        const report = await Report_1.ReportModel.findOne({ id, deletedAt: null }).lean().exec();
        if (!report)
            return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        // Pastikan user punya akses ke workspace ini
        if (user.role === 'admin' && user.workspaceId && report.workspaceId !== user.workspaceId) {
            return res.status(403).json({ error: 'Akses ditolak' });
        }
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument({
            size: 'A4',
            margins: { top: 50, bottom: 50, left: 50, right: 50 },
            info: {
                Title: `EYECO - Laporan #${report.id}`,
                Author: 'EYECO Incident Command Center',
                Subject: `Laporan Lingkungan #${report.id}`
            }
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="EYECO_Laporan_${report.id}.pdf"`);
        doc.pipe(res);
        // ── Header Brand ──
        doc.font('Helvetica-Bold').fontSize(20).fillColor('#1E3A8A')
            .text('EYECO', 50, 50, { continued: true })
            .font('Helvetica').fontSize(12).fillColor('#64748B')
            .text('  Incident Command Center', { align: 'left' });
        // Garis pemisah
        doc.moveTo(50, 75).lineTo(545, 75).strokeColor('#E2E8F0').lineWidth(1).stroke();
        // ── Title ──
        doc.font('Helvetica-Bold').fontSize(16).fillColor('#1E293B')
            .text(`LAPORAN LINGKUNGAN #${report.id}`, 50, 90);
        const statusColor = report.aiStatus === 'Indikasi Tinggi' || report.aiStatus === 'TINGGI' ? '#EF4444'
            : report.aiStatus === 'Indikasi Sedang' || report.aiStatus === 'SEDANG' ? '#F59E0B'
                : report.aiStatus === 'Indikasi Rendah' || report.aiStatus === 'RENDAH' ? '#06B6D4'
                    : '#94A3B8';
        doc.font('Helvetica-Bold').fontSize(14).fillColor(statusColor)
            .text(`Status: ${report.aiStatus || 'Tidak Terindikasi'}`, 50, 115);
        // Tanggal
        const ts = report.timestamp || report.createdAt;
        const dateStr = ts ? new Date(ts).toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
        doc.font('Helvetica').fontSize(10).fillColor('#64748B').text(`Tanggal: ${dateStr}`, 50, 140);
        // ── Informasi Laporan ──
        let y = 175;
        const section = (title) => {
            doc.font('Helvetica-Bold').fontSize(11).fillColor('#1E293B').text(title, 50, y);
            y += 20;
        };
        const field = (label, value) => {
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748B').text(label, 55, y);
            doc.font('Helvetica').fontSize(10).fillColor('#1E293B').text(String(value || '-'), 155, y);
            y += 18;
        };
        section('INFORMASI LAPORAN');
        field('Lokasi', report.location);
        field('Sumber', report.sourceType || '-');
        field('Identitas', report.identity || '-');
        field('Admin Status', report.adminStatus || 'MENUNGGU');
        if (report.assignedOfficer)
            field('Petugas', report.assignedOfficer);
        y += 10;
        section('METRIK AI');
        field('Object Confidence', `${report.objectConfidence ?? report.aiConfidence ?? '-'}%`);
        field('Scene Confidence', `${report.sceneConfidence ?? '-'}%`);
        field('Decision Confidence', `${report.decisionConfidence ?? '-'}%`);
        field('Violation Score', `${report.violationScore ?? '-'}/100`);
        field('Uncertainty Score', `${report.uncertaintyScore ?? '-'}%`);
        if (report.priority)
            field('Prioritas', report.priority);
        if (report.recommendedAction)
            field('Rekomendasi', report.recommendedAction);
        y += 10;
        section('CATATAN');
        if (report.additionalNotes) {
            doc.font('Helvetica').fontSize(9).fillColor('#1E293B').text(report.additionalNotes, 55, y, { width: 490 });
            y += Math.ceil(report.additionalNotes.length / 80) * 14 + 5;
        }
        if (report.adminNotes) {
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748B').text('Catatan Admin:', 55, y);
            doc.font('Helvetica').fontSize(9).fillColor('#1E293B').text(report.adminNotes, 55, y + 14, { width: 490 });
        }
        // ── Footer ──
        y = Math.max(y + 50, 700);
        doc.moveTo(50, y).lineTo(545, y).strokeColor('#E2E8F0').lineWidth(1).stroke();
        doc.font('Helvetica').fontSize(8).fillColor('#94A3B8')
            .text(`Dokumen ini diekspor dari EYECO Incident Command Center pada ${new Date().toLocaleString('id-ID')} oleh ${user.name || user.username}`, 50, y + 10, { align: 'center' });
        doc.text(`Laporan #${report.id} · Workspace #${report.workspaceId}`, 50, y + 24, { align: 'center' });
        doc.end();
    }
    catch (err) {
        console.error('[SERVER ERROR] PDF export failed:', err);
        res.status(500).json({ error: 'Gagal mengekspor PDF' });
    }
});
// POST /api/reports/:reportId/ai-feedback — Record/update operator AI feedback
router.post('/:reportId/ai-feedback', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized: Harap login terlebih dahulu' });
        const reportIdNum = parseInt(req.params.reportId, 10);
        if (isNaN(reportIdNum))
            return res.status(400).json({ error: 'ID Laporan tidak valid' });
        const report = await Report_1.ReportModel.findOne({ id: reportIdNum, deletedAt: null }).exec();
        if (!report)
            return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        const { snapshotId, groundTruthLabel, isLitteringConfirmed, correctedPriority, correctedObjects, notes, idempotencyKey } = req.body;
        if (!snapshotId)
            return res.status(400).json({ error: 'snapshotId wajib diisi' });
        if (!groundTruthLabel)
            return res.status(400).json({ error: 'groundTruthLabel wajib diisi' });
        const snapshot = await AiSnapshot_1.AiSnapshotModel.findById(snapshotId).exec();
        if (!snapshot)
            return res.status(404).json({ error: 'AiSnapshot tidak ditemukan' });
        if (snapshot.reportId !== reportIdNum && String(report._id) !== String(snapshot.reportId)) {
            return res.status(400).json({ error: 'snapshotId tidak terhubung ke Laporan ini' });
        }
        // Validate correctedObjects payload if present
        if (Array.isArray(correctedObjects)) {
            for (const item of correctedObjects) {
                if (!['CONFIRM', 'REMOVE', 'RELABEL', 'ADD'].includes(item.action)) {
                    return res.status(400).json({ error: `Aksi correctedObjects '${item.action}' tidak valid` });
                }
                if (['CONFIRM', 'REMOVE', 'RELABEL'].includes(item.action) && !item.detectionId) {
                    return res.status(400).json({ error: `Aksi ${item.action} membutuhkan detectionId` });
                }
                if (item.action === 'RELABEL' && !item.correctedClass) {
                    return res.status(400).json({ error: 'Aksi RELABEL membutuhkan correctedClass' });
                }
                if (item.action === 'ADD') {
                    if (!item.correctedClass)
                        return res.status(400).json({ error: 'Aksi ADD membutuhkan correctedClass' });
                    if (!Array.isArray(item.correctedBbox) || item.correctedBbox.length !== 4) {
                        return res.status(400).json({ error: 'Aksi ADD membutuhkan correctedBbox [x1, y1, x2, y2]' });
                    }
                    const [x1, y1, x2, y2] = item.correctedBbox;
                    if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2) || x2 <= x1 || y2 <= y1) {
                        return res.status(400).json({ error: 'Aksi ADD membutuhkan koordinat bounding box valid (x2 > x1 dan y2 > y1)' });
                    }
                }
            }
        }
        const key = idempotencyKey || `feedback-${snapshotId}-${user._id}-${Date.now()}`;
        const feedbackLog = await feedbackCollector_1.feedbackCollector.logOperatorFeedback({
            idempotencyKey: key,
            reportId: reportIdNum,
            reportObjectId: String(report._id),
            snapshotId: String(snapshot._id),
            userId: String(user._id),
            operatorUsername: user.username || user.name || 'Operator',
            operatorDecision: groundTruthLabel,
            isLitteringConfirmed,
            correctedPriority,
            correctedObjects,
            notes,
            predictedStatus: snapshot.decision ? (snapshot.decision.status || '') : '',
            predictedScore: snapshot.decision ? snapshot.decision.violationScore : null,
            inputImageHash: snapshot.inputImageHash || ''
        });
        // Record Timeline Event
        await TimelineEvent_1.TimelineEventModel.create({
            workspaceId: report.workspaceId || user.workspaceId || 1,
            reportId: report._id,
            eventVersion: 1,
            type: 'REVIEW',
            actorId: user._id,
            actorName: user.name || user.username || 'Operator',
            actorRole: user.role || 'operator',
            title: 'Validasi AI Operator Catat Ground Truth',
            description: `Operator mencatat umpan balik AI: ${groundTruthLabel} (Versi Log v${feedbackLog.validationVersion}).`,
            metadata: { validationLogId: feedbackLog._id, idempotencyKey: key },
            ipAddress: req.ip || '127.0.0.1',
            userAgent: req.get('user-agent') || 'EYECO Command Center',
            createdAt: new Date()
        });
        res.status(200).json({
            message: 'Umpan balik operator berhasil dicatat secara idempotent',
            feedbackLog
        });
    }
    catch (err) {
        if (err.code === 'IDEMPOTENCY_KEY_CONFLICT' || err.status === 409) {
            return res.status(409).json({ error: err.message, errorCode: 'IDEMPOTENCY_KEY_CONFLICT' });
        }
        console.error('[SERVER ERROR] AI feedback recording failed:', err);
        res.status(500).json({ error: 'Gagal mencatat umpan balik AI: ' + err.message });
    }
});
// GET /api/reports/:reportId/ai-feedback — Get feedback history for a report
router.get('/:reportId/ai-feedback', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        const reportIdNum = parseInt(req.params.reportId, 10);
        if (isNaN(reportIdNum))
            return res.status(400).json({ error: 'ID Laporan tidak valid' });
        const logs = await AiValidationLog_1.AiValidationLogModel.find({ reportId: reportIdNum }).sort({ validationVersion: -1 }).exec();
        res.status(200).json({ logs });
    }
    catch (err) {
        console.error('[SERVER ERROR] Get AI feedback history failed:', err);
        res.status(500).json({ error: 'Gagal mengambil riwayat umpan balik' });
    }
});
// GET /api/admin/continual-learning/candidates — Get active learning candidates
router.get('/admin/continual-learning/candidates', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized: Harap login terlebih dahulu' });
        if (!['admin'].includes(user.role)) {
            return res.status(403).json({ error: 'Forbidden: Membutuhkan hak akses admin' });
        }
        const { status = 'PENDING_APPROVAL', targetModel } = req.query;
        const query = {};
        if (status)
            query.approvalStatus = status;
        if (targetModel)
            query.targetModel = targetModel;
        const candidates = await AiDatasetCandidate_1.AiDatasetCandidateModel.find(query).sort({ candidateScore: -1, createdAt: -1 }).limit(100).exec();
        res.status(200).json({ candidates, count: candidates.length });
    }
    catch (err) {
        console.error('[SERVER ERROR] Failed to fetch candidates:', err);
        res.status(500).json({ error: 'Gagal mengambil daftar kandidat pembelajaran' });
    }
});
// POST /api/admin/continual-learning/candidates/:candidateId/review — Review candidate with atomic state transition
router.post('/admin/continual-learning/candidates/:candidateId/review', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized: Harap login terlebih dahulu' });
        if (!['admin'].includes(user.role)) {
            return res.status(403).json({ error: 'Forbidden: Hanya Admin yang dapat menyetujui kandidat dataset' });
        }
        const { approvalStatus, approvalNotes } = req.body;
        if (!['APPROVED', 'REJECTED'].includes(approvalStatus)) {
            return res.status(400).json({ error: 'approvalStatus harus APPROVED atau REJECTED' });
        }
        // Atomic State Transition Guard: Only transition if current status is PENDING_APPROVAL
        const updatedCandidate = await AiDatasetCandidate_1.AiDatasetCandidateModel.findOneAndUpdate({ _id: req.params.candidateId, approvalStatus: 'PENDING_APPROVAL' }, {
            $set: {
                approvalStatus,
                approvedByUserId: user._id,
                approvalNotes: approvalNotes || '',
                reviewedAt: new Date()
            }
        }, { new: true }).exec();
        if (!updatedCandidate) {
            const existing = await AiDatasetCandidate_1.AiDatasetCandidateModel.findById(req.params.candidateId).exec();
            if (!existing)
                return res.status(404).json({ error: 'Kandidat dataset tidak ditemukan' });
            return res.status(409).json({
                error: `Kandidat sudah ditinjau sebelumnya (Status: ${existing.approvalStatus})`,
                errorCode: 'CANDIDATE_ALREADY_REVIEWED'
            });
        }
        // Audit Event
        await SystemAuditLog_1.SystemAuditLogModel.create({
            tenantId: user.tenantId || 'tenant-default',
            actorId: user._id,
            actorName: user.name || user.username || 'Admin',
            action: 'REVIEW_AI_CANDIDATE',
            details: {
                candidateId: req.params.candidateId,
                approvalStatus,
                approvalNotes
            },
            ipAddress: req.ip || '127.0.0.1',
            userAgent: req.get('user-agent') || 'EYECO Admin Center',
            createdAt: new Date()
        });
        res.status(200).json({ message: `Kandidat berhasil diubah menjadi ${approvalStatus}`, candidate: updatedCandidate });
    }
    catch (err) {
        console.error('[SERVER ERROR] Candidate review failed:', err);
        res.status(500).json({ error: 'Gagal memproses persetujuan kandidat' });
    }
});
// POST /api/admin/continual-learning/datasets/build — Build anti-leakage dataset version manifest
router.post('/admin/continual-learning/datasets/build', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized: Harap login terlebih dahulu' });
        if (!['admin'].includes(user.role)) {
            return res.status(403).json({ error: 'Forbidden: Hanya Admin yang dapat membangun versi dataset' });
        }
        const { targetModel = 'OBJECT_DETECTOR' } = req.body;
        const datasetVersion = await datasetBuilder_1.datasetBuilder.buildDatasetVersion({
            targetModel,
            createdByUserId: String(user._id)
        });
        res.status(201).json({
            message: `Versi dataset ${datasetVersion.datasetVersion} berhasil dibuat (Status: ${datasetVersion.status})`,
            datasetVersion
        });
    }
    catch (err) {
        if (err.code === 'NO_APPROVED_CANDIDATES' || err.status === 400) {
            return res.status(400).json({ error: err.message, errorCode: 'NO_APPROVED_CANDIDATES' });
        }
        console.error('[SERVER ERROR] Dataset build failed:', err);
        res.status(500).json({ error: 'Gagal membangun versi dataset: ' + err.message });
    }
});
// GET /api/admin/continual-learning/datasets — Get list of dataset version manifests
router.get('/admin/continual-learning/datasets', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized: Harap login terlebih dahulu' });
        if (!['admin'].includes(user.role)) {
            return res.status(403).json({ error: 'Forbidden: Membutuhkan hak akses admin' });
        }
        const datasets = await AiDatasetVersion_1.AiDatasetVersionModel.find().sort({ createdAt: -1 }).limit(50).exec();
        res.status(200).json({ datasets, count: datasets.length });
    }
    catch (err) {
        console.error('[SERVER ERROR] Failed to fetch dataset versions:', err);
        res.status(500).json({ error: 'Gagal mengambil riwayat versi dataset' });
    }
});
exports.default = router;
