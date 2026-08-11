"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const mongoose_1 = __importDefault(require("mongoose"));
const crypto_1 = require("crypto");
const authMiddleware_1 = require("../auth/authMiddleware");
const RoleMiddleware_1 = require("../auth/RoleMiddleware");
const VideoAnalysisJob_1 = require("../database/models/VideoAnalysisJob");
const VideoAnalysisJobRepository_1 = require("../database/repositories/VideoAnalysisJobRepository");
const Report_1 = require("../database/models/Report");
const R2StorageService_1 = require("../services/R2StorageService");
const router = (0, express_1.Router)();
const ALLOWED_MIMES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const STORAGE_DIR = path_1.default.join(__dirname, '../../storage/video-analysis');
function sendSuccess(res, data, status = 200) {
    return res.status(status).json({ success: true, data });
}
function sendError(res, message, status = 400) {
    return res.status(status).json({ success: false, message });
}
// POST /api/video-analysis/upload — Upload video for AI analysis
router.post('/upload', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'superadmin']), (req, res, next) => {
    const uploadDir = STORAGE_DIR;
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
    const storage = multer_1.default.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadDir),
        filename: (_req, file, cb) => {
            const ext = path_1.default.extname(file.originalname).toLowerCase();
            const uniqueName = `video_${Date.now()}_${(0, crypto_1.randomUUID)().substring(0, 8)}${ext}`;
            cb(null, uniqueName);
        },
    });
    const upload = (0, multer_1.default)({
        storage,
        limits: { fileSize: MAX_FILE_SIZE },
        fileFilter: (_req, file, cb) => {
            if (ALLOWED_MIMES.includes(file.mimetype)) {
                cb(null, true);
            }
            else {
                cb(new Error(`Format video tidak didukung. Hanya MP4, MOV, AVI, MKV yang diizinkan.`));
            }
        },
    }).single('video');
    upload(req, res, (err) => {
        if (err instanceof multer_1.default.MulterError) {
            return sendError(res, `Upload error: ${err.message}`, 400);
        }
        if (err) {
            return sendError(res, err.message, 400);
        }
        next();
    });
}, async (req, res) => {
    try {
        const file = req.file;
        if (!file) {
            return sendError(res, 'Tidak ada file video yang diupload.', 400);
        }
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user) {
            return sendError(res, 'Unauthorized', 401);
        }
        const sourceStorageKey = path_1.default.resolve(file.path);
        const fileBuffer = fs_1.default.readFileSync(sourceStorageKey);
        const sourceVideoHash = (0, crypto_1.createHash)('sha256').update(fileBuffer).digest('hex');
        const initialReport = await Report_1.ReportModel.create({
            id: Date.now(),
            userId: user._id,
            tenantId: 'BBWS',
            location: 'Video Analysis Upload',
            timestamp: new Date(),
            image: '',
            identity: 'Belum diketahui',
            sourceType: 'Video',
            additionalNotes: `Video upload: ${file.originalname}`,
            comments: [],
            assignedOfficer: '',
            validationStatus: 'PENDING',
            needsHumanValidation: false,
            createdFrom: 'VIDEO_AI',
            adminStatus: 'MENUNGGU',
            status: 'UNDER_REVIEW',
        });
        const job = await VideoAnalysisJobRepository_1.VideoAnalysisJobRepository.createFromUpload(initialReport._id, sourceVideoHash, sourceStorageKey);
        // Upload video ke R2 di background
        const r2Key = `eyecofiles/laporan_auto/${job._id}/${file.filename}`;
        try {
            if (fs_1.default.existsSync(sourceStorageKey)) {
                await R2StorageService_1.R2StorageService.uploadFile(sourceStorageKey, r2Key, file.mimetype, true);
                console.log(`[R2] Video uploaded: ${r2Key}`);
                // Hapus lokal setelah upload sukses
                try {
                    fs_1.default.unlinkSync(sourceStorageKey);
                }
                catch { /* ignore */ }
            }
        }
        catch (r2Err) {
            console.warn('[R2] Video upload skipped (local fallback):', r2Err.message);
        }
        sendSuccess(res, {
            jobId: job._id,
            analysisRunId: job.analysisRunId,
            status: job.status,
            fileName: file.originalname,
            fileSize: file.size,
            createdAt: job.createdAt,
        }, 201);
    }
    catch (err) {
        console.error('[VIDEO ANALYSIS] Upload failed:', err);
        sendError(res, err.message || 'Internal Server Error', 500);
    }
});
// GET /api/video-analysis/:jobId/progress — Check analysis progress
router.get('/:jobId/progress', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const { jobId } = req.params;
        if (!mongoose_1.default.Types.ObjectId.isValid(jobId)) {
            return sendError(res, 'ID pekerjaan tidak valid.', 400);
        }
        const { job, incidents } = await VideoAnalysisJobRepository_1.VideoAnalysisJobRepository.getProgress(jobId);
        if (!job) {
            return sendError(res, 'Pekerjaan tidak ditemukan.', 404);
        }
        sendSuccess(res, {
            status: job.status,
            progressStage: job.progressStage,
            progressPercent: job.progressPercent,
            totalFrames: job.totalFrames,
            decodedFrames: job.decodedFrames,
            analyzedFrames: job.analyzedFrames,
            processedIncidents: job.processedIncidents,
            incidentCount: job.incidentCount,
            errorCode: job.errorCode,
            errorDetails: job.errorDetails,
            completedAt: job.completedAt,
            incidents,
        });
    }
    catch (err) {
        console.error('[VIDEO ANALYSIS] Progress check failed:', err);
        sendError(res, err.message || 'Internal Server Error', 500);
    }
});
// GET /api/video-analysis/:jobId/incidents/:incidentKey/evidence — RBAC file access
router.get('/:jobId/incidents/:incidentKey/evidence', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'superadmin', 'operator', 'supervisor', 'officer']), async (req, res) => {
    try {
        const { jobId, incidentKey } = req.params;
        let fileType = req.query.type || 'raw';
        if (fileType === 'video')
            fileType = 'clip';
        if (fileType === 'frame')
            fileType = 'raw';
        if (!mongoose_1.default.Types.ObjectId.isValid(jobId)) {
            return sendError(res, 'ID pekerjaan tidak valid.', 400);
        }
        // Sanitize incidentKey — prevent path traversal
        const sanitizedKey = path_1.default.basename(path_1.default.normalize(incidentKey));
        if (sanitizedKey !== incidentKey || sanitizedKey.includes('..')) {
            return sendError(res, 'Incident key tidak valid.', 400);
        }
        const { filePath, mimeType } = await VideoAnalysisJobRepository_1.VideoAnalysisJobRepository.getEvidenceFile(jobId, sanitizedKey, fileType);
        if (!filePath || !fs_1.default.existsSync(filePath)) {
            return sendError(res, 'Berkas bukti tidak ditemukan.', 404);
        }
        // Verify file is within storage boundary
        const resolvedPath = path_1.default.resolve(filePath);
        const storageRoot = path_1.default.resolve(STORAGE_DIR);
        if (!resolvedPath.startsWith(storageRoot)) {
            return sendError(res, 'Akses ditolak.', 403);
        }
        // Verify the link against MongoDB
        const job = await VideoAnalysisJob_1.VideoAnalysisJobModel.findById(jobId).exec();
        if (!job) {
            return sendError(res, 'Pekerjaan tidak ditemukan.', 404);
        }
        const stat = fs_1.default.statSync(resolvedPath);
        res.set({
            'Content-Type': mimeType,
            'Content-Length': stat.size.toString(),
            'Cache-Control': 'private, max-age=3600',
            'X-Content-Type-Options': 'nosniff',
        });
        res.sendFile(resolvedPath);
    }
    catch (err) {
        console.error('[VIDEO ANALYSIS] Evidence access failed:', err);
        sendError(res, err.message || 'Internal Server Error', 500);
    }
});
exports.default = router;
