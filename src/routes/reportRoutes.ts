import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { ReportModel } from '../database/models/Report';
import { UserModel } from '../database/models/User';
import { ReportRepository } from '../database/repositories/ReportRepository';
import { getLoggedInUser } from '../auth/authMiddleware';
import { detectFile, warmupAI, isAiReady, getWarmupError } from '../services/aiDetection.service';
import { NotificationService } from '../services/NotificationService';
import { NotificationModel } from '../database/models/Notification';

const router = Router();

// Allowed MIME types for upload
const ALLOWED_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'video/mp4'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `upload_${uniqueSuffix}${ext}`);
  },
});

const fileFilter: multer.Options['fileFilter'] = (req, file, cb) => {
  if (ALLOWED_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Format file tidak didukung. Hanya ${ALLOWED_MIMES.join(', ')} yang diizinkan.`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

const commentLimiter = rateLimit({
  windowMs: 30 * 1000,
  max: 5,
  message: { success: false, message: 'Terlalu banyak mengirim komentar, silakan tunggu 30 detik.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const likeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: 'Terlalu banyak menekan tombol suka, silakan tunggu 1 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function sendSuccess(res: import('express').Response, data: unknown, status = 200) {
  return res.status(status).json({ success: true, data });
}

function sendError(res: import('express').Response, message: string, status = 400) {
  return res.status(status).json({ success: false, message });
}

// ====== ROUTES ======
router.get('/detections', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    const userContext = user ? { id: user.id, role: user.role } : { id: 1, role: 'admin' };

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));

    const filters: any = {
      timeRange: req.query.timeRange as string,
      date: req.query.date as string,
      aiStatus: req.query.aiStatus as string,
      adminStatus: req.query.adminStatus as string,
      location: req.query.location as string,
    };

    const result = await ReportRepository.getFiltered(filters, userContext, page, limit);

    if (!result || !('reports' in result)) return res.status(500).json({ error: 'Gagal memproses data laporan' });

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
  } catch (err) {
    console.error('[SERVER ERROR] Get reports list failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/detections/:id', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID laporan tidak valid' });
    }

    const report = await ReportModel.findOne({ id, deletedAt: null }).lean().exec();
    if (!report) {
      return res.status(404).json({ error: 'Laporan tidak ditemukan' });
    }

    // Include info user yang upload laporan (jika admin/superadmin)
    const responseReport: Record<string, unknown> = { ...report };

    if (responseReport.image && typeof responseReport.image === 'string') {
      let img = responseReport.image as string;
      if (!img.startsWith('/') && !img.startsWith('http')) {
        img = '/' + img;
      }
      responseReport.image = img;
    }

    if (user && (user.role === 'admin' || user.role === 'superadmin')) {
      const uploader = await UserModel.findOne({ _id: report.userId as any }).select('username name avatar email phone').lean().exec();
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
  } catch (err) {
    console.error('[SERVER ERROR] Get single report failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/detections/:id/verify', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Hanya Admin yang dapat memvalidasi laporan' });
    if (!user.workspaceId) return res.status(403).json({ error: 'Admin belum memiliki workspace aktif' });

    const id = parseInt(req.params.id);
    const { status, notes, assignedOfficer, progressStatus } = req.body;

    if (!status || !['VALID', 'DIABAIKAN', 'MENUNGGU'].includes(status)) {
      return res.status(400).json({ error: 'Status tidak valid' });
    }

    const updatedReport = await ReportRepository.updateVerification(id, status, notes || '', assignedOfficer, progressStatus, user.workspaceId);
    if (!updatedReport) return res.status(404).json({ error: 'Laporan tidak ditemukan' });

    // Notify the report owner about validation
    if (updatedReport.userId) {
      const reportOwner = await UserModel.findById(updatedReport.userId).select('id').lean().exec();
      if (reportOwner) {
        NotificationService.notifyValidation(
          id,
          status,
          reportOwner.id,
          updatedReport.workspaceId,
        );
      }
    }

    res.json(updatedReport);
  } catch (err) {
    console.error('[SERVER ERROR] Verify report failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/detections/:id/comments', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return sendError(res, 'Unauthorized', 401);

    const reportId = parseInt(req.params.id);
    
    // Query tanpa workspaceId dulu (untuk report lama yang tidak punya field ini)
    let report = await ReportModel.findOne({ id: reportId, deletedAt: null }).lean();
    if (!report && user.workspaceId) {
      report = await ReportModel.findOne({ id: reportId, deletedAt: null, workspaceId: user.workspaceId }).lean();
    }
    if (!report) return sendError(res, 'Laporan tidak ditemukan', 404);

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const sortBy = (req.query.sortBy as string) || 'newest';

    let activeComments = (report.comments || []).filter((c) => !c.isDeleted);
    if (sortBy === 'newest') {
      activeComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sortBy === 'oldest') {
      activeComments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else if (sortBy === 'most_liked') {
      activeComments.sort((a, b) => (b.likedBy || []).length - (a.likedBy || []).length);
    }

    const total = activeComments.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;
    const paginatedComments = activeComments.slice(skip, skip + limit);

    const uniqueUserIds = Array.from(new Set(paginatedComments.map((c) => c.userId)));
    const users = await UserModel.find({ id: { $in: uniqueUserIds } }).select('id username role avatar').lean();
    const userMap = new Map(users.map((u) => [u.id, { username: u.username, role: u.role, avatar: u.avatar || '' }]));

    const commentsWithUser = paginatedComments.map((c) => {
      const uInfo = userMap.get(c.userId);
      return {
        ...c,
        parentCommentId: (c as any).parentCommentId || null,
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
  } catch (err) {
    console.error('[SERVER ERROR] Get comments failed:', err);
    return sendError(res, 'Internal Server Error', 500);
  }
});

router.post('/detections/:id/comments', commentLimiter, async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return sendError(res, 'Unauthorized', 401);

    const reportId = parseInt(req.params.id);
    const { text, parentCommentId } = req.body;
    if (!text || typeof text !== 'string') return sendError(res, 'Konten komentar harus diisi.', 400);

    // Find the report to determine who owns it
    const report = await ReportModel.findOne({ id: reportId, deletedAt: null })
      .select('userId workspaceId')
      .lean()
      .exec();
    if (!report) return sendError(res, 'Laporan tidak ditemukan', 404);

    const comment = await ReportRepository.addComment(reportId, user.id, text, user.workspaceId, parentCommentId || null);

    // Notify the report owner if someone else commented (don't notify on self-comment)
    if (report.userId && !report.userId.equals(user._id as mongoose.Types.ObjectId)) {
      // Resolve the report owner's numeric legacy ID for the notification service
      const reportOwner = await UserModel.findById(report.userId).select('id').lean().exec();
      if (reportOwner) {
        NotificationService.notifyComment(
          reportId,
          user.name || user.username,
          reportOwner.id,
          report.workspaceId,
        );
      }
    }

    return sendSuccess(res, { ...comment, username: user.username, role: user.role }, 201);
  } catch (err: unknown) {
    console.error('[SERVER ERROR] Create comment failed:', err);
    return sendError(res, err instanceof Error ? err.message : 'Internal Server Error', 500);
  }
});

router.delete('/detections/:id/comments/:commentId', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return sendError(res, 'Unauthorized', 401);

    const reportId = parseInt(req.params.id);
    const commentId = req.params.commentId;
    const isAdmin = user.role === 'admin';

    await ReportRepository.deleteComment(reportId, commentId, user.id, isAdmin, user.workspaceId);
    return sendSuccess(res, { success: true });
  } catch (err: unknown) {
    console.error('[SERVER ERROR] Delete comment failed:', err);
    return sendError(res, err instanceof Error ? err.message : 'Internal Server Error', 500);
  }
});

router.post('/detections/:id/comments/:commentId/like', likeLimiter, async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return sendError(res, 'Unauthorized', 401);

    const reportId = parseInt(req.params.id);
    const commentId = req.params.commentId;

    const comment = await ReportRepository.toggleLikeComment(reportId, commentId, user.id, user.workspaceId);
    const isLiked = comment.likedBy.includes(user.id);

    return sendSuccess(res, {
      commentId,
      likedBy: comment.likedBy,
      likeCount: comment.likedBy.length,
      isLiked
    });
  } catch (err: unknown) {
    console.error('[SERVER ERROR] Like comment failed:', err);
    return sendError(res, err instanceof Error ? err.message : 'Internal Server Error', 500);
  }
});

router.get('/stats', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    const userContext = user ? { id: user.id, role: user.role } : { id: 1, role: 'admin' };
    const stats = await ReportRepository.getStats(userContext);
    res.json(stats);
  } catch (err) {
    console.error('[SERVER ERROR] Get stats failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/detections', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      // Multer errors (file size, file type, etc.)
      if (err instanceof multer.MulterError) {
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
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role === 'superadmin') return res.status(403).json({ error: 'Superadmin tidak dapat upload laporan' });
    if (!req.file) return res.status(400).json({ error: 'File media wajib diupload' });

    const { location, identity, sourceType, additionalNotes } = req.body;
    const uploadDir = path.join(__dirname, '../../public/uploads');
    const uploadedFilePath = path.join(uploadDir, req.file.filename);

    console.log(`[UPLOAD] video diterima: ${req.file.filename} (${req.file.mimetype}, ${(req.file.size / 1024).toFixed(1)}KB)`);
    console.log(`[UPLOAD] oleh user: ${user.username} (role: ${user.role})`);

    // ==============================
    // STEP 1: Create report (tanpa AI detection dulu — biar cepat)
    // ==============================
    const newReport = await ReportRepository.create({
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

    const updateResult = await ReportModel.updateOne(
      { _id: newReport._id },
      {
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
          boundingBoxes: aiAnalysis.objects.map((o: any) => ({
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
      }
    ).exec();

    // ==============================
    // STEP 4: Ambil data terbaru dari DB untuk response
    // ==============================
    const updatedReport = await ReportModel.findById(newReport._id).lean().exec();
    if (!updatedReport) {
      console.error('[UPLOAD] ❌ KRITIKAL: Report hilang setelah update!');
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    console.log('[UPLOAD] Final report v3.0 — id=' + updatedReport.id + ', aiStatus=' + updatedReport.aiStatus + ', violationScore=' + updatedReport.violationScore + ', priority=' + updatedReport.priority);

    // Copy last_capture.jpg
    try {
      const sourcePath = path.join(uploadDir, req.file.filename);
      const destPath = path.join(uploadDir, 'last_capture.jpg');
      fs.copyFileSync(sourcePath, destPath);
    } catch (err) {
      console.error('[SERVER ERROR] Error copying last capture image:', err);
    }

    // ==============================
    // STEP 5: Notifikasi cross-user — kirim notifikasi NEW_REPORT ke semua user dalam workspace kecuali uploader
    // ==============================
    console.log(`[NOTIF] Membuat notifikasi NEW_REPORT untuk report #${newReport.id}...`);
    try {
      const workspaceId = newReport.workspaceId;
      if (workspaceId) {
        const workspaceUsers = await UserModel.find({
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
            priority: 'MEDIUM' as const,
            read: false,
            readAt: null,
            expiresAt,
            deletedAt: null,
          }));

          await NotificationModel.insertMany(notifs);
          console.log(`[NOTIF] ✅ ${notifs.length} notifikasi NEW_REPORT berhasil dibuat`);
        }
      } else {
        console.log('[NOTIF] Tidak ada workspaceId pada laporan, skip notifikasi');
      }
    } catch (notifErr) {
      console.error('[NOTIF] Gagal membuat notifikasi cross-user:', notifErr instanceof Error ? notifErr.message : notifErr);
      // Non-fatal: jangan sampai error notifikasi menggagalkan response
    }

    res.status(201).json(updatedReport);
  } catch (err) {
    console.error('[SERVER ERROR] Create report failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/export', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user || user.role !== 'admin') {
      return res.status(403).send('Forbidden: Hanya Admin yang dapat mengekspor laporan');
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="eyeco_report_export.csv"');
    res.write('ID,User ID,Lokasi,Waktu Kejadian,Status AI,Keyakinan AI (%),Status Admin,Sumber,Identitas,Catatan Admin\n');

    const query = user.workspaceId ? { workspaceId: user.workspaceId } : { workspaceId: -1 };
    const cursor = ReportModel.find(query).sort({ id: 1 }).cursor();

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
      if (!res.headersSent) res.status(500).send('Internal Server Error during export');
      else res.end();
    });
  } catch (err) {
    console.error('[SERVER ERROR] Export failed:', err);
    if (!res.headersSent) res.status(500).send('Internal Server Error');
  }
});

// DELETE /api/reports/clear-all — Admin only: clear all reports in workspace
router.delete('/clear-all', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Hanya admin yang dapat menghapus semua data' });
    }
    if (!user.workspaceId) {
      return res.status(400).json({ error: 'Tidak ada workspace aktif' });
    }

    const result = await ReportModel.deleteMany({ workspaceId: user.workspaceId });
    console.log(`[ADMIN] Cleared ${result.deletedCount} reports from workspace ${user.workspaceId}`);
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) {
    console.error('[SERVER ERROR] Clear all reports failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/detections/:id/signal — Community Signal (masih terjadi / sudah bersih)
router.post('/detections/:id/signal', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return sendError(res, 'Unauthorized', 401);

    const reportId = parseInt(req.params.id);
    const { type } = req.body; // 'active' | 'resolved'

    if (!type || !['active', 'resolved'].includes(type)) {
      return sendError(res, 'Tipe sinyal tidak valid.', 400);
    }

    // Cari report (tanpa workspaceId dulu untuk kompatibilitas)
    let report = await ReportModel.findOne({ id: reportId, deletedAt: null }).exec();
    if (!report && user.workspaceId) {
      report = await ReportModel.findOne({ id: reportId, deletedAt: null, workspaceId: user.workspaceId }).exec();
    }
    if (!report) return sendError(res, 'Laporan tidak ditemukan.', 404);

    // Initialize signals array if not exists
    if (!report.signals) {
      report.signals = { active: [], resolved: [] };
    }

    // Check if user already voted
    const alreadyActive = (report.signals.active || []).includes(user.id);
    const alreadyResolved = (report.signals.resolved || []).includes(user.id);

    // Remove previous vote if exists
    report.signals.active = (report.signals.active || []).filter((id: number) => id !== user.id);
    report.signals.resolved = (report.signals.resolved || []).filter((id: number) => id !== user.id);

    // Add new vote
    if (type === 'active') {
      report.signals.active.push(user.id);
    } else {
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
  } catch (err) {
    console.error('[SERVER ERROR] Community signal failed:', err);
    sendError(res, 'Internal Server Error', 500);
  }
});

// ── User Hapus Laporan Sendiri (dalam 10 menit) ──

router.delete('/detections/:id', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const reportId = parseInt(req.params.id);
    if (!reportId) return res.status(400).json({ error: 'ID laporan tidak valid' });

    const report = await ReportModel.findOne({ id: reportId, deletedAt: null }).lean().exec();
    if (!report) return res.status(404).json({ error: 'Laporan tidak ditemukan' });

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

    await ReportModel.updateOne(
      { _id: report._id },
      { $set: { deletedAt: new Date(), deletedById: user._id, deleteReason: 'Dihapus oleh user' } }
    ).exec();

    res.json({ success: true, message: 'Laporan berhasil dihapus' });
  } catch (err: unknown) {
    console.error('[SERVER ERROR] User delete report failed:', err);
    const msg = err instanceof Error ? err.message : 'Internal Server Error';
    res.status(500).json({ error: msg });
  }
});

// ── TEMP endpoints removed after AI_CCTV cleanup ──

export default router;
