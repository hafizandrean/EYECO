import { Router, Request } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { NewsModel } from '../database/models/News';
import { UserModel } from '../database/models/User';
import { authMiddleware } from '../auth/authMiddleware';
import { roleGuard } from '../auth/RoleMiddleware';
import { NotificationService } from '../services/NotificationService';
import { R2StorageService } from '../services/R2StorageService';

const execFileAsync = promisify(execFile);

const router = Router();

// Multer config untuk upload gambar berita (max 3)
const newsStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../public/uploads/berita');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `news_${uniqueSuffix}${ext}`);
  },
});

const newsUpload = multer({
  storage: newsStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Hanya file gambar (JPEG, PNG, WebP, HEIC/HEIF) yang diizinkan.'));
    }
  },
});

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── PUBLIC: Get single published news by slug ───
router.get('/public/item/:slug', async (req, res) => {
  try {
    const item = await NewsModel.findOne({ slug: req.params.slug, status: 'published' }).lean().exec();
    if (!item) return res.status(404).json({ success: false, error: 'Berita tidak ditemukan' });
    res.json({ success: true, news: item });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Gagal memuat berita' });
  }
});

// ─── PUBLIC: Get published news ───
router.get('/public/:workspaceId', async (req, res) => {
  try {
    const workspaceId = parseInt(req.params.workspaceId);
    let news = await NewsModel.find({ workspaceId, status: 'published' })
      .sort({ publishedAt: -1, createdAt: -1 })
      .limit(12)
      .lean()
      .exec();

    // Fallback: If no or few news items for this workspace, fetch top published news overall
    if (news.length < 6) {
      const overallNews = await NewsModel.find({ status: 'published' })
        .sort({ publishedAt: -1, createdAt: -1 })
        .limit(12)
        .lean()
        .exec();
      news = overallNews;
    }
    res.json({ success: true, news });
  } catch (err) {
    console.error('[News] GET /public failed:', err);
    res.status(500).json({ success: false, error: 'Gagal memuat berita' });
  }
});

// ─── ADMIN: List news ───
router.get('/list', authMiddleware, roleGuard(['admin', 'superadmin']), async (req, res) => {
  try {
    const userCtx = req.userContext!;
    const user = await UserModel.findOne({ id: userCtx.id }).lean() as any;
    if (!user || !user.workspaceId) return res.status(400).json({ error: 'No workspace context' });

    const news = await NewsModel.find({ workspaceId: user.workspaceId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    res.json({ success: true, news });
  } catch (err) {
    console.error('[News] GET /list failed:', err);
    res.status(500).json({ error: 'Gagal memuat berita' });
  }
});

// ─── ADMIN: Get single news item ───
router.get('/:id', authMiddleware, roleGuard(['admin', 'superadmin']), async (req, res) => {
  try {
    const item = await NewsModel.findById(req.params.id).lean().exec();
    if (!item) return res.status(404).json({ error: 'Berita tidak ditemukan' });
    res.json({ success: true, news: item });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat berita' });
  }
});

// ─── ADMIN: Create news ───
router.post('/create', authMiddleware, roleGuard(['admin', 'superadmin']), async (req, res) => {
  try {
    const userCtx = req.userContext!;
    const user = await UserModel.findOne({ id: userCtx.id }).lean() as any;
    if (!user || !user.workspaceId) return res.status(400).json({ error: 'No workspace context' });

    const { title, summary, content, category, thumbnail, images, status } = req.body;
    if (!title || !summary || !content) {
      return res.status(400).json({ error: 'Judul, ringkasan, dan konten wajib diisi' });
    }

    let slug = slugify(title);
    const existing = await NewsModel.findOne({ slug, workspaceId: user.workspaceId }).exec();
    if (existing) slug = slug + '-' + Date.now();

    const authorName = user.name || user.fullName || userCtx.username;

    const now = new Date();
    const news = await NewsModel.create({
      title,
      slug,
      summary,
      content,
      category: category || 'Informasi',
      thumbnail: thumbnail || '',
      images: Array.isArray(images) ? images : [],
      author: authorName,
      authorId: userCtx.id,
      status: status || 'published',
      publishedAt: status !== 'draft' ? now : undefined,
      workspaceId: user.workspaceId,
    });

    // Notify all workspace users about new news (only for published articles)
    if (news.status === 'published') {
      NotificationService.notifyNewNews(news.title, news.workspaceId);
    }

    res.status(201).json({ success: true, news });
  } catch (err) {
    console.error('[News] POST /create failed:', err);
    res.status(500).json({ error: 'Gagal membuat berita' });
  }
});

// ─── ADMIN: Upload multiple images (max 3) ───
router.post('/upload-images', authMiddleware, roleGuard(['admin', 'superadmin']), async (req, res) => {
  // 1. Multer upload — wrapped in promise
  try {
    await new Promise<void>((resolve, reject) => {
      newsUpload.array('files', 3)(req as Request, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } catch (err: any) {
    return res.status(400).json({ success: false, error: err.message });
  }

  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    return res.status(400).json({ success: false, error: 'Tidak ada file yang diupload' });
  }

  const uploadBase = path.join(__dirname, '../../public/uploads/berita');
  const urls: string[] = [];

  for (const f of files) {
    const ext = path.extname(f.filename).toLowerCase();
    const sourcePath = f.path;

    if (ext === '.heic' || ext === '.heif') {
      const jpegName = f.filename.replace(/\.(heic|heif)$/i, '.jpg');
      const jpegPath = path.join(uploadBase, jpegName);

      try {
        // Convert HEIC → JPEG menggunakan heif-convert dari libheif
        // Output pake .jpg suffix biar heif-convert tau format output
        // Multi-page HEIC (Live Photos) → output -1.jpg, -2.jpg
        // Single-page HEIC → output langsung nama.jpg
        const jpegOutputPath = path.join(uploadBase, jpegName);
        const jpegBase = jpegOutputPath.replace(/\.jpg$/i, '');

        // execFile lebih aman dari exec (gak lewat shell)
        await execFileAsync('heif-convert', [sourcePath, jpegOutputPath]);

        // Cari hasil: bisa langsung jpegName atau jpegName-1.jpg (multi-page)
        let actualPath = jpegOutputPath;
        let stat: fs.Stats | null = null;
        try { stat = fs.statSync(actualPath); } catch { /* not found */ }

        if (!stat || stat.size < 100) {
          // Multi-page: coba -1.jpg
          actualPath = jpegBase + '-1.jpg';
          try { stat = fs.statSync(actualPath); } catch { /* not found */ }
        }
        if (!stat || stat.size < 100) throw new Error('Hasil konversi terlalu kecil');

        // Hapus page 2+ kalo ada (Live Photo)
        try { fs.unlinkSync(jpegBase + '-2.jpg'); } catch { /* skip */ }

        // Hapus HEIC asli
        try { fs.unlinkSync(sourcePath); } catch { /* skip */ }

        // Kalo actual beda dengan yg diinginkan, rename
        if (actualPath !== jpegOutputPath) {
          fs.renameSync(actualPath, jpegOutputPath);
        }

        urls.push('/uploads/berita/' + jpegName);
        console.log('[News] HEIC converted:', f.filename, '→', jpegName, (stat.size) + 'b');
      } catch (convertErr: any) {
        console.error('[News] HEIC convert error:', convertErr.message);

        // Hapus file .heic yg gagal
        try { fs.unlinkSync(sourcePath); } catch { /* skip */ }
        try { if (fs.existsSync(jpegPath)) fs.unlinkSync(jpegPath); } catch { /* skip */ }

        return res.status(400).json({
          success: false,
          error: 'Gagal memproses gambar HEIC. Pastikan file HEIC valid atau gunakan format JPG/PNG.',
        });
      }
    } else {
      urls.push('/uploads/berita/' + f.filename);
    }
  }

  // Upload semua gambar ke R2 di background (jangan blok response)
  for (const localUrl of urls) {
    const localPath = path.join(__dirname, '../../public', localUrl);
    const r2Key = `eyecofiles/berita/${path.basename(localUrl)}`;
    try {
      if (fs.existsSync(localPath)) {
        await R2StorageService.uploadFile(localPath, r2Key, 'image/jpeg', true);
        // Jangan hapus lokal — proxy fallback masih dipake
        console.log(`[R2] News image uploaded: ${r2Key}`);
      }
    } catch (r2Err) {
      console.warn('[R2] News image upload skipped:', (r2Err as Error).message);
    }
  }

  res.json({ success: true, urls, thumbnail: urls[0] });
});

// ─── ADMIN: Update news ───
router.put('/:id', authMiddleware, roleGuard(['admin', 'superadmin']), async (req, res) => {
  try {
    const { title, summary, content, category, thumbnail, images, status } = req.body;
    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (summary !== undefined) updateData.summary = summary;
    if (content !== undefined) updateData.content = content;
    if (category !== undefined) updateData.category = category;
    if (thumbnail !== undefined) updateData.thumbnail = thumbnail;
    if (images !== undefined) updateData.images = images;
    if (status !== undefined) {
      updateData.status = status;
      updateData.publishedAt = status !== 'draft' ? new Date() : undefined;
    }

    const news = await NewsModel.findByIdAndUpdate(req.params.id, updateData, { new: true }).exec();
    if (!news) return res.status(404).json({ error: 'Berita tidak ditemukan' });
    res.json({ success: true, news });
  } catch (err) {
    console.error('[News] PUT failed:', err);
    res.status(500).json({ error: 'Gagal mengupdate berita' });
  }
});

// ─── ADMIN: Delete news ───
router.delete('/:id', authMiddleware, roleGuard(['admin', 'superadmin']), async (req, res) => {
  try {
    const news = await NewsModel.findByIdAndDelete(req.params.id).exec();
    if (!news) return res.status(404).json({ error: 'Berita tidak ditemukan' });
    res.json({ success: true, message: 'Berita berhasil dihapus' });
  } catch (err) {
    console.error('[News] DELETE failed:', err);
    res.status(500).json({ error: 'Gagal menghapus berita' });
  }
});

export default router;
