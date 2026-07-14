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
function runSimulatedAI(location, notes) {
    const boxes = [];
    const notesLower = notes.toLowerCase();
    let hasPerson = Math.random() > 0.3;
    let hasTrash = Math.random() > 0.6;
    let hasBoat = Math.random() > 0.8;
    if (notesLower.includes('orang') || notesLower.includes('warga') || notesLower.includes('mancing'))
        hasPerson = true;
    if (notesLower.includes('sampah') || notesLower.includes('buang') || notesLower.includes('limbah'))
        hasTrash = true;
    if (notesLower.includes('perahu') || notesLower.includes('kapal') || notesLower.includes('boat'))
        hasBoat = true;
    if (hasPerson) {
        boxes.push({
            label: 'person',
            confidence: parseFloat((0.75 + Math.random() * 0.23).toFixed(2)),
            x: parseFloat((15 + Math.random() * 40).toFixed(1)),
            y: parseFloat((30 + Math.random() * 30).toFixed(1)),
            w: parseFloat((12 + Math.random() * 15).toFixed(1)),
            h: parseFloat((40 + Math.random() * 25).toFixed(1)),
        });
    }
    if (hasTrash) {
        boxes.push({
            label: 'trash',
            confidence: parseFloat((0.65 + Math.random() * 0.3).toFixed(2)),
            x: parseFloat((30 + Math.random() * 40).toFixed(1)),
            y: parseFloat((60 + Math.random() * 20).toFixed(1)),
            w: parseFloat((15 + Math.random() * 20).toFixed(1)),
            h: parseFloat((15 + Math.random() * 15).toFixed(1)),
        });
    }
    if (hasBoat) {
        boxes.push({
            label: 'boat',
            confidence: parseFloat((0.8 + Math.random() * 0.18).toFixed(2)),
            x: parseFloat((10 + Math.random() * 30).toFixed(1)),
            y: parseFloat((40 + Math.random() * 15).toFixed(1)),
            w: parseFloat((35 + Math.random() * 25).toFixed(1)),
            h: parseFloat((20 + Math.random() * 10).toFixed(1)),
        });
    }
    let status = 'Tidak Terindikasi';
    let confidence = null;
    if (hasTrash || (hasPerson && hasBoat) || notesLower.includes('mencurigakan')) {
        status = 'TINGGI';
        confidence = Math.round(75 + Math.random() * 23);
    }
    else if (hasPerson) {
        status = 'RENDAH';
        confidence = Math.round(40 + Math.random() * 30);
    }
    else if (boxes.length > 0) {
        status = 'SEDANG';
        confidence = Math.round(60 + Math.random() * 15);
    }
    return { status, confidence, boxes };
}
router.get('/detections', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const filters = {
            timeRange: req.query.timeRange,
            date: req.query.date,
            aiStatus: req.query.aiStatus,
            adminStatus: req.query.adminStatus,
            location: req.query.location,
        };
        const result = await ReportRepository_1.ReportRepository.getFiltered(filters, { id: user.id, role: user.role }, page, limit);
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
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        const id = parseInt(req.params.id);
        const report = await ReportRepository_1.ReportRepository.findByLegacyId(id, user.workspaceId);
        if (!report)
            return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        res.json(report);
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
        const report = await Report_1.ReportModel.findOne({ id: reportId, workspaceId: user.workspaceId }).lean();
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
        const users = await User_1.UserModel.find({ id: { $in: uniqueUserIds } }).select('id username role').lean();
        const userMap = new Map(users.map((u) => [u.id, { username: u.username, role: u.role }]));
        const commentsWithUser = paginatedComments.map((c) => {
            const uInfo = userMap.get(c.userId);
            return {
                ...c,
                username: uInfo ? uInfo.username : 'Pengguna tidak dikenal',
                role: uInfo ? uInfo.role : 'user'
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
        const { text } = req.body;
        if (!text || typeof text !== 'string')
            return sendError(res, 'Konten komentar harus diisi.', 400);
        const comment = await ReportRepository_1.ReportRepository.addComment(reportId, user.id, text, user.workspaceId);
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
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        const stats = await ReportRepository_1.ReportRepository.getStats({ id: user.id, role: user.role });
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
                    return res.status(400).json({ error: 'Ukuran file maksimal 10MB.' });
                }
                return res.status(400).json({ error: `Upload error: ${err.message}` });
            }
            // Custom file filter error
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
        const aiResults = runSimulatedAI(location || '', additionalNotes || '');
        const newReport = await ReportRepository_1.ReportRepository.create({
            location: location || 'Lokasi tidak diketahui',
            aiStatus: aiResults.status,
            aiConfidence: aiResults.confidence,
            image: `/uploads/${req.file.filename}`,
            identity: identity || 'Belum diketahui',
            sourceType: sourceType || 'Gambar',
            additionalNotes: additionalNotes || 'Tidak ada catatan tambahan.',
            boundingBoxes: aiResults.boxes,
        }, user.id);
        try {
            const uploadDir = path_1.default.join(__dirname, '../../public/uploads');
            const sourcePath = path_1.default.join(uploadDir, req.file.filename);
            const destPath = path_1.default.join(uploadDir, 'last_capture.jpg');
            fs_1.default.copyFileSync(sourcePath, destPath);
        }
        catch (err) {
            console.error('[SERVER ERROR] Error copying last capture image:', err);
        }
        res.status(201).json(newReport);
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
exports.default = router;
