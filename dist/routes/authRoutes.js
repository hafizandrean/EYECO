"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const Workspace_1 = require("../database/models/Workspace");
const User_1 = require("../database/models/User");
const UserRepository_1 = require("../database/repositories/UserRepository");
const WorkspaceRepository_1 = require("../database/repositories/WorkspaceRepository");
const auth_service_1 = require("../auth/auth.service");
const authMiddleware_1 = require("../auth/authMiddleware");
const RoleMiddleware_1 = require("../auth/RoleMiddleware");
const Session_1 = require("../database/models/Session");
const SystemAuditLog_1 = require("../database/models/SystemAuditLog");
const password_1 = require("../utils/password");
const R2StorageService_1 = require("../services/R2StorageService");
const router = (0, express_1.Router)();
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Terlalu banyak percobaan masuk/daftar, silakan coba lagi nanti.' },
    standardHeaders: true,
    legacyHeaders: false,
});
router.use('/login', authLimiter);
router.use('/register', authLimiter);
// Avatar upload config
const avatarDir = path_1.default.join(__dirname, '../../public/uploads/avatars');
if (!fs_1.default.existsSync(avatarDir)) {
    fs_1.default.mkdirSync(avatarDir, { recursive: true });
}
const avatarStorage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, avatarDir),
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname) || '.jpg';
        cb(null, `avatar_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`);
    }
});
const avatarUpload = (0, multer_1.default)({
    storage: avatarStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (allowed.includes(file.mimetype))
            return cb(null, true);
        cb(new Error('Hanya file gambar (JPG, PNG, WebP, GIF) yang diizinkan'));
    }
});
router.post('/register', async (req, res) => {
    const { name, username, email, phone, password, confirmPassword } = req.body;
    if (!name || !name.trim())
        return res.status(400).json({ error: 'Nama lengkap wajib diisi' });
    if (!username || !username.trim())
        return res.status(400).json({ error: 'Username wajib diisi' });
    if (!email || !email.trim())
        return res.status(400).json({ error: 'Email wajib diisi' });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim()))
        return res.status(400).json({ error: 'Format email tidak valid' });
    if (!password)
        return res.status(400).json({ error: 'Password wajib diisi' });
    const strength = (0, password_1.checkPasswordStrength)(password);
    if (strength.errors.length > 0) {
        return res.status(400).json({ error: 'Password lemah: ' + strength.errors.join(', ') });
    }
    if (password !== confirmPassword)
        return res.status(400).json({ error: 'Konfirmasi password tidak cocok' });
    try {
        const finalUsername = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
        // Check duplicate username
        const existingUsername = await UserRepository_1.UserRepository.findByUsername(finalUsername);
        if (existingUsername)
            return res.status(400).json({ error: 'Username sudah digunakan' });
        // Check duplicate email
        const existingEmail = await User_1.UserModel.findOne({ email: email.trim().toLowerCase() }).lean().exec();
        if (existingEmail)
            return res.status(400).json({ error: 'Email sudah terdaftar' });
        const newUser = await UserRepository_1.UserRepository.create(finalUsername, password, 'user', 'APPROVED', {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            phone: (phone || '').trim(),
            workspaceIds: []
        });
        if (!newUser)
            return res.status(400).json({ error: 'Gagal membuat akun, coba lagi' });
        res.status(201).json({
            id: newUser.id,
            username: newUser.username,
            role: newUser.role,
            status: newUser.status,
            message: 'Akun berhasil dibuat.'
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] Registration failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/register-superadmin', async (req, res) => {
    const { orgName, workspaceName, picName, email, username, password, confirmPassword, address, description } = req.body;
    if (!orgName || !workspaceName || !picName || !email || !username || !password) {
        return res.status(400).json({ error: 'Semua field wajib diisi' });
    }
    const strength = (0, password_1.checkPasswordStrength)(password);
    if (strength.errors.length > 0) {
        return res.status(400).json({ error: 'Password lemah: ' + strength.errors.join(', ') });
    }
    if (password !== confirmPassword)
        return res.status(400).json({ error: 'Konfirmasi password tidak cocok' });
    try {
        const existingUser = await UserRepository_1.UserRepository.findByUsername(username);
        if (existingUser)
            return res.status(400).json({ error: 'Username sudah digunakan' });
        const existingWorkspace = await Workspace_1.WorkspaceModel.findOne({ name: workspaceName.trim() }).lean().exec();
        if (existingWorkspace)
            return res.status(400).json({ error: 'Nama workspace sudah digunakan' });
        const superadmin = await UserRepository_1.UserRepository.create(username, password, 'superadmin', 'APPROVED', {
            name: picName.trim(),
            email: email.trim().toLowerCase()
        });
        if (!superadmin)
            return res.status(400).json({ error: 'Gagal membuat superadmin' });
        const newWorkspace = await WorkspaceRepository_1.WorkspaceRepository.create({
            name: workspaceName.trim(),
            company: orgName.trim(),
            address: (address || '').trim(),
            description: (description || '').trim(),
            superadminId: superadmin.id
        });
        await User_1.UserModel.updateOne({ id: superadmin.id }, { workspaceId: newWorkspace.id, workspaceIds: [newWorkspace.id] });
        const token = (0, auth_service_1.generateToken)({ id: superadmin.id, username: superadmin.username, role: superadmin.role });
        const tokenHash = crypto_1.default.createHash('sha256').update(token).digest('hex');
        const deviceInfo = req.headers['user-agent'] || 'Unknown Device';
        const ipAddress = req.ip || req.socket.remoteAddress || 'Unknown IP';
        // Hapus semua session lama user ini
        await Session_1.SessionModel.deleteMany({ userId: superadmin.id });
        await Session_1.SessionModel.create({
            userId: superadmin.id,
            tokenHash,
            deviceInfo,
            ipAddress
        });
        await SystemAuditLog_1.SystemAuditLogModel.create({
            tenantId: String(newWorkspace.id),
            actorId: superadmin._id,
            actorName: superadmin.name,
            action: 'Register Superadmin',
            ipAddress: req.ip || req.socket.remoteAddress || 'Unknown IP',
            userAgent: req.headers['user-agent'] || 'Unknown Device',
            details: { username: superadmin.username, workspaceName: newWorkspace.name }
        });
        res.cookie('session_token', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000
        });
        res.status(201).json({
            success: true,
            id: superadmin.id,
            username: superadmin.username,
            role: superadmin.role,
            workspaceId: newWorkspace.id,
            workspaceCode: newWorkspace.code,
            redirect: '/superadmin',
            message: 'Registrasi organisasi berhasil'
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] Register Superadmin failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password)
        return res.status(400).json({ error: 'Username dan password harus diisi' });
    try {
        const user = await UserRepository_1.UserRepository.findByUsernameWithPassword(username);
        if (!user)
            return res.status(401).json({ error: 'Username atau password salah' });
        const isBcrypt = user.passwordHash.startsWith('$2');
        let match = false;
        if (isBcrypt) {
            match = await bcrypt_1.default.compare(password, user.passwordHash);
        }
        else {
            const sha256Hash = crypto_1.default.createHash('sha256').update(password).digest('hex');
            match = (sha256Hash === user.passwordHash);
            // If SHA-256 match, upgrade to bcrypt
            if (match) {
                user.passwordHash = await bcrypt_1.default.hash(password, 10);
                await User_1.UserModel.updateOne({ id: user.id }, { $set: { passwordHash: user.passwordHash } }).exec();
            }
        }
        if (!match)
            return res.status(401).json({ error: 'Username atau password salah' });
        // Removed status check, all users can login to be directed to select workspace.
        const token = (0, auth_service_1.generateToken)({ id: user.id, username: user.username, role: user.role });
        const tokenHash = crypto_1.default.createHash('sha256').update(token).digest('hex');
        const deviceInfo = req.headers['user-agent'] || 'Unknown Device';
        const ipAddress = req.ip || req.socket.remoteAddress || 'Unknown IP';
        const deviceId = typeof req.body.deviceId === 'string' && req.body.deviceId ? req.body.deviceId : '';
        // 1 perangkat = 1 data sesi. Hapus hanya sesi untuk perangkat yang SAMA
        // agar sesi perangkat lain (mis. perangkat teman) tetap aktif & terdaftar.
        if (deviceId) {
            await Session_1.SessionModel.deleteMany({ userId: user.id, deviceId });
        }
        else {
            await Session_1.SessionModel.deleteMany({ userId: user.id, deviceInfo });
        }
        await Session_1.SessionModel.create({
            userId: user.id,
            tokenHash,
            deviceInfo,
            deviceId,
            ipAddress
        });
        await SystemAuditLog_1.SystemAuditLogModel.create({
            tenantId: 'system',
            actorId: user._id,
            actorName: user.name || user.username,
            action: 'User Login',
            ipAddress: req.ip || req.socket.remoteAddress || 'Unknown IP',
            userAgent: req.headers['user-agent'] || 'Unknown Device',
            details: { username: user.username, role: user.role }
        });
        res.cookie('session_token', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000
        });
        const redirect = user.role === 'superadmin' ? '/superadmin' : user.role === 'admin' ? '/dashboard' : '/select-workspace';
        res.json({ _id: user._id, id: user.id, username: user.username, role: user.role, status: user.status, redirect });
    }
    catch (err) {
        console.error('[SERVER ERROR] Login failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/logout', async (req, res) => {
    const token = req.cookies?.session_token || '';
    if (token) {
        const tokenHash = crypto_1.default.createHash('sha256').update(token).digest('hex');
        await Session_1.SessionModel.deleteOne({ tokenHash });
    }
    res.clearCookie('session_token');
    res.json({ success: true });
});
router.post('/select-workspace', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['user']), async (req, res) => {
    const { workspaceId } = req.body;
    if (!workspaceId)
        return res.status(400).json({ error: 'workspaceId wajib diisi' });
    try {
        const userId = req.userContext?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const user = await User_1.UserModel.findOne({ id: userId }).lean().exec();
        const wsIds = user?.workspaceIds || [];
        if (wsIds.length === 0 || !wsIds.includes(Number(workspaceId))) {
            return res.status(400).json({ error: 'Anda tidak memiliki akses ke workspace ini. Silakan ajukan permintaan bergabung.' });
        }
        await User_1.UserModel.updateOne({ id: userId }, { workspaceId: Number(workspaceId), status: 'APPROVED' });
        res.json({ success: true, workspaceId: Number(workspaceId) });
    }
    catch (err) {
        console.error('[SERVER ERROR] select-workspace failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.get('/me', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userContext?.id;
        if (!userId)
            return res.status(401).json({ error: 'Belum masuk' });
        const user = await UserRepository_1.UserRepository.findByLegacyId(userId);
        if (!user)
            return res.status(401).json({ error: 'User tidak ditemukan' });
        res.json({
            _id: user._id,
            id: user.id,
            username: user.username,
            role: user.role,
            name: user.name,
            email: user.email,
            phone: user.phone || '',
            avatar: user.avatar || '',
            status: user.status,
            workspaceId: user.workspaceId,
            workspaceIds: user.workspaceIds || [],
        });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Update Profile Endpoint
router.patch('/me', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userContext?.id;
        if (!userId)
            return res.status(401).json({ error: 'Belum masuk' });
        const { name, email, phone } = req.body;
        const updateData = {};
        if (name !== undefined)
            updateData.name = name.trim();
        if (email !== undefined)
            updateData.email = email.trim().toLowerCase();
        if (phone !== undefined)
            updateData.phone = phone.trim();
        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'Tidak ada data yang diubah' });
        }
        const user = await User_1.UserModel.findOneAndUpdate({ id: userId }, { $set: updateData }, { new: true }).lean().exec();
        if (!user)
            return res.status(404).json({ error: 'User tidak ditemukan' });
        res.json({ success: true, data: { id: user.id, username: user.username, name: user.name, email: user.email, phone: user.phone || '' } });
    }
    catch (err) {
        console.error('[SERVER ERROR] Update profile failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Avatar Upload Endpoint
router.post('/avatar', authMiddleware_1.authMiddleware, (req, res, next) => {
    avatarUpload.single('avatar')(req, res, (err) => {
        if (err) {
            if (err instanceof multer_1.default.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ error: 'Ukuran foto maksimal 10MB' });
                }
                return res.status(400).json({ error: `Upload gagal: ${err.message}` });
            }
            return res.status(400).json({ error: err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        const userId = req.userContext?.id;
        if (!userId)
            return res.status(401).json({ error: 'Belum masuk' });
        if (!req.file)
            return res.status(400).json({ error: 'Tidak ada file yang diupload' });
        // Hapus file avatar lama jika ada (lokal & R2)
        const existingUser = await User_1.UserModel.findOne({ id: userId }).lean().exec();
        if (existingUser && existingUser.avatar) {
            const oldAvatarStr = existingUser.avatar;
            const oldPath = path_1.default.join(__dirname, '../../public', oldAvatarStr);
            try {
                if (fs_1.default.existsSync(oldPath))
                    fs_1.default.unlinkSync(oldPath);
            }
            catch (_) { }
            const oldR2Key = `eyecofiles/avatars/${path_1.default.basename(oldAvatarStr)}`;
            R2StorageService_1.R2StorageService.delete(oldR2Key).catch(() => { });
        }
        const avatarPath = `/uploads/avatars/${req.file.filename}`;
        // Upload avatar ke Cloudflare R2 di background
        const r2Key = `eyecofiles/avatars/${req.file.filename}`;
        R2StorageService_1.R2StorageService.uploadFile(req.file.path, r2Key, req.file.mimetype || 'image/jpeg', true)
            .then(() => console.log(`[R2] Avatar uploaded to R2: ${r2Key}`))
            .catch((r2Err) => console.warn('[R2] Avatar upload skipped:', r2Err.message));
        await User_1.UserModel.findOneAndUpdate({ id: userId }, { $set: { avatar: avatarPath } }).exec();
        res.json({ success: true, data: { avatar: avatarPath } });
    }
    catch (err) {
        console.error('[SERVER ERROR] Avatar upload failed:', err);
        res.status(500).json({ error: 'Gagal mengupload foto profil' });
    }
});
// Remove Avatar Endpoint
router.delete('/avatar', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userContext?.id;
        if (!userId)
            return res.status(401).json({ error: 'Belum masuk' });
        const user = await User_1.UserModel.findOne({ id: userId }).lean().exec();
        if (!user)
            return res.status(404).json({ error: 'User tidak ditemukan' });
        const oldAvatar = user.avatar;
        if (oldAvatar) {
            const oldPath = path_1.default.join(__dirname, '../../public', oldAvatar);
            try {
                if (fs_1.default.existsSync(oldPath))
                    fs_1.default.unlinkSync(oldPath);
            }
            catch (_) { }
            const oldR2Key = `eyecofiles/avatars/${path_1.default.basename(oldAvatar)}`;
            R2StorageService_1.R2StorageService.delete(oldR2Key).catch(() => { });
        }
        await User_1.UserModel.findOneAndUpdate({ id: userId }, { $set: { avatar: '' } }).exec();
        res.json({ success: true, data: { avatar: '' } });
    }
    catch (err) {
        console.error('[SERVER ERROR] Avatar remove failed:', err);
        res.status(500).json({ error: 'Gagal menghapus foto profil' });
    }
});
// Change Password Endpoint
router.post('/change-password', authMiddleware_1.authMiddleware, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmPassword)
        return res.status(400).json({ error: 'Semua field wajib diisi' });
    const strength = (0, password_1.checkPasswordStrength)(newPassword);
    if (strength.errors.length > 0) {
        return res.status(400).json({ error: 'Password lemah: ' + strength.errors.join(', ') });
    }
    if (newPassword !== confirmPassword)
        return res.status(400).json({ error: 'Konfirmasi password tidak cocok' });
    try {
        const userId = req.userContext?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const user = await User_1.UserModel.findOne({ id: userId }).select('+passwordHash');
        if (!user)
            return res.status(404).json({ error: 'User tidak ditemukan' });
        const isBcrypt = user.passwordHash.startsWith('$2');
        let match = false;
        if (isBcrypt) {
            match = await bcrypt_1.default.compare(currentPassword, user.passwordHash);
        }
        else {
            const sha256Hash = crypto_1.default.createHash('sha256').update(currentPassword).digest('hex');
            match = (sha256Hash === user.passwordHash);
        }
        if (!match)
            return res.status(401).json({ error: 'Password lama tidak sesuai' });
        user.passwordHash = await bcrypt_1.default.hash(newPassword, 10);
        await user.save();
        await SystemAuditLog_1.SystemAuditLogModel.create({
            tenantId: 'system',
            actorId: user._id,
            actorName: user.name || user.username,
            action: 'Change Password',
            ipAddress: req.ip || req.socket.remoteAddress || 'Unknown IP',
            userAgent: req.headers['user-agent'] || 'Unknown Device',
            details: { username: user.username }
        });
        res.json({ success: true, message: 'Password berhasil diubah' });
    }
    catch (err) {
        console.error('[SERVER ERROR] Change password failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Session Management Endpoints
router.get('/sessions', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userContext?.id;
        const token = req.cookies?.session_token || '';
        const currentTokenHash = token ? crypto_1.default.createHash('sha256').update(token).digest('hex') : '';
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const sessions = await Session_1.SessionModel.find({ userId }).sort({ lastActive: -1 }).lean().exec();
        const safeSessions = sessions.map(s => ({
            id: s._id,
            deviceInfo: s.deviceInfo,
            deviceId: s.deviceId,
            ipAddress: s.ipAddress,
            lastActive: s.lastActive,
            isCurrent: s.tokenHash === currentTokenHash
        }));
        res.json({ success: true, sessions: safeSessions });
    }
    catch (err) {
        console.error('[SERVER ERROR] Get sessions failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.delete('/sessions/:id', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userContext?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const result = await Session_1.SessionModel.deleteOne({ _id: req.params.id, userId });
        if (result.deletedCount === 0)
            return res.status(404).json({ error: 'Sesi tidak ditemukan atau tidak diizinkan' });
        res.json({ success: true, message: 'Sesi berhasil dihapus (Logout Device)' });
    }
    catch (err) {
        console.error('[SERVER ERROR] Delete session failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.delete('/sessions', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userContext?.id;
        const token = req.cookies?.session_token || '';
        const currentTokenHash = token ? crypto_1.default.createHash('sha256').update(token).digest('hex') : '';
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        await Session_1.SessionModel.deleteMany({ userId, tokenHash: { $ne: currentTokenHash } });
        res.json({ success: true, message: 'Semua sesi lain berhasil dihapus' });
    }
    catch (err) {
        console.error('[SERVER ERROR] Delete all sessions failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// ──────────────────────────────────────────────
//  Forgot / Reset Password (no auth required)
// ──────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
    try {
        const { identifier } = req.body;
        if (!identifier)
            return res.status(400).json({ error: 'Masukkan username atau email' });
        const user = await User_1.UserModel.findOne({
            $or: [
                { username: identifier.toLowerCase().trim() },
                { email: identifier.toLowerCase().trim() }
            ]
        }).exec();
        if (!user) {
            return res.status(404).json({ error: 'Akun tidak ditemukan' });
        }
        // Mask phone for display
        const phone = user.phone || '';
        const maskedPhone = phone.length >= 4
            ? phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4)
            : '***';
        res.json({
            success: true,
            name: user.name || user.username,
            maskedPhone,
            hasPhone: !!user.phone,
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] Forgot password failed:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/verify-phone', async (req, res) => {
    try {
        const { identifier, phone } = req.body;
        if (!identifier)
            return res.status(400).json({ error: 'Masukkan username atau email' });
        if (!phone)
            return res.status(400).json({ error: 'Masukkan nomor telepon' });
        const user = await User_1.UserModel.findOne({
            $or: [
                { username: identifier.toLowerCase().trim() },
                { email: identifier.toLowerCase().trim() }
            ]
        }).exec();
        if (!user) {
            return res.status(404).json({ error: 'Akun tidak ditemukan' });
        }
        // Normalize phone comparison
        const cleanInput = phone.replace(/[^0-9]/g, '');
        const cleanStored = (user.phone || '').replace(/[^0-9]/g, '');
        if (cleanInput !== cleanStored) {
            return res.status(400).json({ error: 'Nomor telepon tidak cocok' });
        }
        const token = crypto_1.default.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 jam
        user.resetToken = token;
        user.resetTokenExpires = expires;
        await user.save();
        console.log(`[FORGOT PASSWORD] Reset token for ${user.username}: ${token}`);
        res.json({
            success: true,
            token,
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] Verify phone failed:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token)
            return res.status(400).json({ error: 'Token reset diperlukan' });
        const strength = (0, password_1.checkPasswordStrength)(newPassword);
        if (strength.errors.length > 0) {
            return res.status(400).json({ error: 'Password lemah: ' + strength.errors.join(', ') });
        }
        const user = await User_1.UserModel.findOne({
            resetToken: token,
            resetTokenExpires: { $gt: new Date() },
        }).exec();
        if (!user) {
            return res.status(400).json({ error: 'Token tidak valid atau sudah kedaluwarsa. Minta reset ulang.' });
        }
        const passwordHash = await bcrypt_1.default.hash(newPassword, 10);
        user.passwordHash = passwordHash;
        user.resetToken = undefined;
        user.resetTokenExpires = undefined;
        await user.save();
        // Hapus semua sesi user ini
        await Session_1.SessionModel.deleteMany({ userId: user.id });
        res.json({ success: true, message: 'Password berhasil direset. Silakan login.' });
    }
    catch (err) {
        console.error('[SERVER ERROR] Reset password failed:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET /api/auth/audit-logs - Get user's own audit logs
router.get('/audit-logs', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const skip = (page - 1) * limit;
        // Find audit logs for the current user
        const userId = req.userContext?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const filter = { actorId: userId };
        const [logs, total] = await Promise.all([
            SystemAuditLog_1.SystemAuditLogModel.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean()
                .exec(),
            SystemAuditLog_1.SystemAuditLogModel.countDocuments(filter).exec(),
        ]);
        res.json({
            success: true,
            logs,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] Get audit logs failed:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
exports.default = router;
