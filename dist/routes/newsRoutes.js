"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const News_1 = require("../database/models/News");
const User_1 = require("../database/models/User");
const authMiddleware_1 = require("../auth/authMiddleware");
const RoleMiddleware_1 = require("../auth/RoleMiddleware");
const router = (0, express_1.Router)();
function slugify(text) {
    return text.toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim()
        .substring(0, 80);
}
// ─── PUBLIC: Get published news ───
router.get('/public/:workspaceId', async (req, res) => {
    try {
        const workspaceId = parseInt(req.params.workspaceId);
        const news = await News_1.NewsModel.find({ workspaceId, status: 'published' })
            .sort({ publishedAt: -1 })
            .limit(10)
            .lean()
            .exec();
        res.json({ success: true, news });
    }
    catch (err) {
        console.error('[News] GET /public failed:', err);
        res.status(500).json({ success: false, error: 'Gagal memuat berita' });
    }
});
// ─── ADMIN: List news ───
router.get('/list', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'superadmin']), async (req, res) => {
    try {
        const userCtx = req.userContext;
        const user = await User_1.UserModel.findOne({ id: userCtx.id }).lean();
        if (!user || !user.workspaceId)
            return res.status(400).json({ error: 'No workspace context' });
        const news = await News_1.NewsModel.find({ workspaceId: user.workspaceId })
            .sort({ createdAt: -1 })
            .lean()
            .exec();
        res.json({ success: true, news });
    }
    catch (err) {
        console.error('[News] GET /list failed:', err);
        res.status(500).json({ error: 'Gagal memuat berita' });
    }
});
// ─── ADMIN: Get single news item ───
router.get('/:id', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'superadmin']), async (req, res) => {
    try {
        const item = await News_1.NewsModel.findById(req.params.id).lean().exec();
        if (!item)
            return res.status(404).json({ error: 'Berita tidak ditemukan' });
        res.json({ success: true, news: item });
    }
    catch (err) {
        res.status(500).json({ error: 'Gagal memuat berita' });
    }
});
// ─── ADMIN: Create news ───
router.post('/create', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'superadmin']), async (req, res) => {
    try {
        const userCtx = req.userContext;
        const user = await User_1.UserModel.findOne({ id: userCtx.id }).lean();
        if (!user || !user.workspaceId)
            return res.status(400).json({ error: 'No workspace context' });
        const { title, summary, content, category, thumbnail, status } = req.body;
        if (!title || !summary || !content) {
            return res.status(400).json({ error: 'Judul, ringkasan, dan konten wajib diisi' });
        }
        let slug = slugify(title);
        const existing = await News_1.NewsModel.findOne({ slug, workspaceId: user.workspaceId }).exec();
        if (existing)
            slug = slug + '-' + Date.now();
        const authorName = user.name || user.fullName || userCtx.username;
        const now = new Date();
        const news = await News_1.NewsModel.create({
            title,
            slug,
            summary,
            content,
            category: category || 'Informasi',
            thumbnail: thumbnail || '',
            author: authorName,
            authorId: userCtx.id,
            status: status || 'published',
            publishedAt: status !== 'draft' ? now : undefined,
            workspaceId: user.workspaceId,
        });
        res.status(201).json({ success: true, news });
    }
    catch (err) {
        console.error('[News] POST /create failed:', err);
        res.status(500).json({ error: 'Gagal membuat berita' });
    }
});
// ─── ADMIN: Update news ───
router.put('/:id', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'superadmin']), async (req, res) => {
    try {
        const { title, summary, content, category, thumbnail, status } = req.body;
        const updateData = {};
        if (title !== undefined)
            updateData.title = title;
        if (summary !== undefined)
            updateData.summary = summary;
        if (content !== undefined)
            updateData.content = content;
        if (category !== undefined)
            updateData.category = category;
        if (thumbnail !== undefined)
            updateData.thumbnail = thumbnail;
        if (status !== undefined) {
            updateData.status = status;
            updateData.publishedAt = status !== 'draft' ? new Date() : undefined;
        }
        const news = await News_1.NewsModel.findByIdAndUpdate(req.params.id, updateData, { new: true }).exec();
        if (!news)
            return res.status(404).json({ error: 'Berita tidak ditemukan' });
        res.json({ success: true, news });
    }
    catch (err) {
        console.error('[News] PUT failed:', err);
        res.status(500).json({ error: 'Gagal mengupdate berita' });
    }
});
// ─── ADMIN: Delete news ───
router.delete('/:id', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'superadmin']), async (req, res) => {
    try {
        const news = await News_1.NewsModel.findByIdAndDelete(req.params.id).exec();
        if (!news)
            return res.status(404).json({ error: 'Berita tidak ditemukan' });
        res.json({ success: true, message: 'Berita berhasil dihapus' });
    }
    catch (err) {
        console.error('[News] DELETE failed:', err);
        res.status(500).json({ error: 'Gagal menghapus berita' });
    }
});
exports.default = router;
