"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
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
    if (password.length < 6)
        return res.status(400).json({ error: 'Password minimal 6 karakter' });
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
    if (password.length < 6)
        return res.status(400).json({ error: 'Password minimal 6 karakter' });
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
        await Session_1.SessionModel.create({
            userId: superadmin.id,
            tokenHash,
            deviceInfo: req.headers['user-agent'] || 'Unknown Device',
            ipAddress: req.ip || req.socket.remoteAddress || 'Unknown IP'
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
        }
        if (!match)
            return res.status(401).json({ error: 'Username atau password salah' });
        // Removed status check, all users can login to be directed to select workspace.
        const token = (0, auth_service_1.generateToken)({ id: user.id, username: user.username, role: user.role });
        const tokenHash = crypto_1.default.createHash('sha256').update(token).digest('hex');
        await Session_1.SessionModel.create({
            userId: user.id,
            tokenHash,
            deviceInfo: req.headers['user-agent'] || 'Unknown Device',
            ipAddress: req.ip || req.socket.remoteAddress || 'Unknown IP'
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
        res.json({ id: user.id, username: user.username, role: user.role, status: user.status, redirect });
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
            id: user.id,
            username: user.username,
            role: user.role,
            name: user.name,
            email: user.email,
            workspaceId: user.workspaceId,
            workspaceIds: user.workspaceIds || []
        });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Change Password Endpoint
router.post('/change-password', authMiddleware_1.authMiddleware, async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    if (!currentPassword || !newPassword || !confirmPassword)
        return res.status(400).json({ error: 'Semua field wajib diisi' });
    if (newPassword.length < 6)
        return res.status(400).json({ error: 'Password minimal 6 karakter' });
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
exports.default = router;
