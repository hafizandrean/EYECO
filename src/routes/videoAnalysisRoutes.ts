import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { createHash, randomUUID } from 'crypto';
import { authMiddleware, getLoggedInUser } from '../auth/authMiddleware';
import { roleGuard } from '../auth/RoleMiddleware';
import { VideoAnalysisJobModel } from '../database/models/VideoAnalysisJob';
import { VideoAnalysisJobRepository } from '../database/repositories/VideoAnalysisJobRepository';
import { AiSnapshotModel } from '../database/models/AiSnapshot';
import { ReportModel } from '../database/models/Report';
import { R2StorageService } from '../services/R2StorageService';

const router = Router();

const ALLOWED_MIMES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const STORAGE_DIR = path.join(__dirname, '../../storage/video-analysis');

function sendSuccess(res: import('express').Response, data: unknown, status = 200) {
  return res.status(status).json({ success: true, data });
}

function sendError(res: import('express').Response, message: string, status = 400) {
  return res.status(status).json({ success: false, message });
}

// POST /api/video-analysis/upload — Upload video for AI analysis
router.post(
  '/upload',
  authMiddleware,
  roleGuard(['admin', 'superadmin']),
  (req, res, next) => {
    const uploadDir = STORAGE_DIR;
    fs.mkdirSync(uploadDir, { recursive: true });

    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueName = `video_${Date.now()}_${randomUUID().substring(0, 8)}${ext}`;
        cb(null, uniqueName);
      },
    });

    const upload = multer({
      storage,
      limits: { fileSize: MAX_FILE_SIZE },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIMES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error(`Format video tidak didukung. Hanya MP4, MOV, AVI, MKV yang diizinkan.`));
        }
      },
    }).single('video');

    upload(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return sendError(res, `Upload error: ${err.message}`, 400);
      }
      if (err) {
        return sendError(res, err.message, 400);
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return sendError(res, 'Tidak ada file video yang diupload.', 400);
      }

      const user = await getLoggedInUser(req);
      if (!user) {
        return sendError(res, 'Unauthorized', 401);
      }

      const sourceStorageKey = path.resolve(file.path);
      const fileBuffer = fs.readFileSync(sourceStorageKey);
      const sourceVideoHash = createHash('sha256').update(fileBuffer).digest('hex');

      const initialReport = await ReportModel.create({
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

      const job = await VideoAnalysisJobRepository.createFromUpload(
        initialReport._id as mongoose.Types.ObjectId,
        sourceVideoHash,
        sourceStorageKey
      );

      // Upload video ke R2 di background
      const r2Key = `eyecofiles/laporan_auto/${job._id}/${file.filename}`;
      try {
        if (fs.existsSync(sourceStorageKey)) {
          await R2StorageService.uploadFile(sourceStorageKey, r2Key, file.mimetype, true);
          console.log(`[R2] Video uploaded: ${r2Key}`);
          // Hapus lokal setelah upload sukses
          try { fs.unlinkSync(sourceStorageKey); } catch { /* ignore */ }
        }
      } catch (r2Err) {
        console.warn('[R2] Video upload skipped (local fallback):', (r2Err as Error).message);
      }

      sendSuccess(res, {
        jobId: job._id,
        analysisRunId: job.analysisRunId,
        status: job.status,
        fileName: file.originalname,
        fileSize: file.size,
        createdAt: job.createdAt,
      }, 201);
    } catch (err: any) {
      console.error('[VIDEO ANALYSIS] Upload failed:', err);
      sendError(res, err.message || 'Internal Server Error', 500);
    }
  }
);

// GET /api/video-analysis/:jobId/progress — Check analysis progress
router.get('/:jobId/progress', authMiddleware, async (req, res) => {
  try {
    const { jobId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      return sendError(res, 'ID pekerjaan tidak valid.', 400);
    }

    const { job, incidents } = await VideoAnalysisJobRepository.getProgress(jobId);
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
  } catch (err: any) {
    console.error('[VIDEO ANALYSIS] Progress check failed:', err);
    sendError(res, err.message || 'Internal Server Error', 500);
  }
});

// GET /api/video-analysis/:jobId/incidents/:incidentKey/evidence — RBAC file access
router.get(
  '/:jobId/incidents/:incidentKey/evidence',
  authMiddleware,
  roleGuard(['admin', 'superadmin', 'operator', 'supervisor', 'officer']),
  async (req, res) => {
    try {
      const { jobId, incidentKey } = req.params;
      let fileType = (req.query.type as string) || 'raw';
      if (fileType === 'video') fileType = 'clip';
      if (fileType === 'frame') fileType = 'raw';

      if (!mongoose.Types.ObjectId.isValid(jobId)) {
        return sendError(res, 'ID pekerjaan tidak valid.', 400);
      }

      // Sanitize incidentKey — prevent path traversal
      const sanitizedKey = path.basename(path.normalize(incidentKey));
      if (sanitizedKey !== incidentKey || sanitizedKey.includes('..')) {
        return sendError(res, 'Incident key tidak valid.', 400);
      }

      const { filePath, mimeType } = await VideoAnalysisJobRepository.getEvidenceFile(
        jobId, sanitizedKey, fileType as any
      );

      if (!filePath || !fs.existsSync(filePath)) {
        return sendError(res, 'Berkas bukti tidak ditemukan.', 404);
      }

      // Verify file is within storage boundary
      const resolvedPath = path.resolve(filePath);
      const storageRoot = path.resolve(STORAGE_DIR);
      if (!resolvedPath.startsWith(storageRoot)) {
        return sendError(res, 'Akses ditolak.', 403);
      }

      // Verify the link against MongoDB
      const job = await VideoAnalysisJobModel.findById(jobId).exec();
      if (!job) {
        return sendError(res, 'Pekerjaan tidak ditemukan.', 404);
      }

      const stat = fs.statSync(resolvedPath);
      res.set({
        'Content-Type': mimeType,
        'Content-Length': stat.size.toString(),
        'Cache-Control': 'private, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });
      res.sendFile(resolvedPath);
    } catch (err: any) {
      console.error('[VIDEO ANALYSIS] Evidence access failed:', err);
      sendError(res, err.message || 'Internal Server Error', 500);
    }
  }
);

export default router;
