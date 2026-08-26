"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const Workspace_1 = require("../database/models/Workspace");
const WorkspaceRepository_1 = require("../database/repositories/WorkspaceRepository");
const User_1 = require("../database/models/User");
const Cctv_1 = require("../database/models/Cctv");
const UserRepository_1 = require("../database/repositories/UserRepository");
const authMiddleware_1 = require("../auth/authMiddleware");
const RoleMiddleware_1 = require("../auth/RoleMiddleware");
const SystemAuditLog_1 = require("../database/models/SystemAuditLog");
const Session_1 = require("../database/models/Session");
const password_1 = require("../utils/password");
const router = (0, express_1.Router)();
function adminIdentifierQuery(identifier) {
    const numericId = Number(identifier);
    if (Number.isInteger(numericId))
        return { id: numericId };
    return { _id: identifier };
}
router.post('/logout', (req, res) => {
    res.clearCookie('session_token');
    res.json({ success: true });
});
router.get('/stats', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    try {
        const superadminId = req.userContext?.id;
        if (!superadminId)
            return res.status(401).json({ error: 'Unauthorized' });
        const workspaces = await Workspace_1.WorkspaceModel.find({ superadminId }).lean().exec();
        const workspaceIds = workspaces.map(w => w.id);
        const totalAdmins = await User_1.UserModel.countDocuments({ role: 'admin', workspaceId: { $in: workspaceIds } });
        const totalWorkspaces = workspaces.length;
        const totalUsers = await User_1.UserModel.countDocuments({ role: 'user', workspaceIds: { $in: workspaceIds } });
        const totalCCTVs = await Cctv_1.CctvModel.countDocuments({ workspaceId: { $in: workspaceIds } });
        const ReportModel = (await Promise.resolve().then(() => __importStar(require('../database/models/Report')))).ReportModel;
        const totalReports = await ReportModel.countDocuments({ workspaceId: { $in: workspaceIds } }).exec();
        const pendingReports = await ReportModel.countDocuments({ workspaceId: { $in: workspaceIds }, adminStatus: 'MENUNGGU' }).exec();
        const validReports = await ReportModel.countDocuments({ workspaceId: { $in: workspaceIds }, adminStatus: 'VALID' }).exec();
        const NewsModel = (await Promise.resolve().then(() => __importStar(require('../database/models/News')))).NewsModel;
        const totalNews = await NewsModel.countDocuments({ workspaceId: { $in: workspaceIds } }).exec();
        const publishedNews = await NewsModel.countDocuments({ workspaceId: { $in: workspaceIds }, status: 'published' }).exec();
        // Recent global activity
        const recentReports = await ReportModel.find({ workspaceId: { $in: workspaceIds } })
            .sort({ timestamp: -1 }).limit(5).lean().exec();
        const recentNews = await NewsModel.find({ workspaceId: { $in: workspaceIds }, status: 'published' })
            .sort({ createdAt: -1 }).limit(3).lean().exec();
        const recentAuditLogs = await SystemAuditLog_1.SystemAuditLogModel.find({
            action: 'CLEAR_ALL_REPORTS',
            $or: workspaceIds.flatMap(id => [
                { 'details.workspaceId': id },
                { 'details.workspaceId': String(id) }
            ])
        })
            .sort({ createdAt: -1 }).limit(5).lean().exec();
        // Enrich with usernames
        const allUserIds = [];
        const reportObjectIds = [];
        recentReports.forEach(r => {
            if (r.userId) {
                const uid = r.userId.toString();
                if (uid.length === 24)
                    reportObjectIds.push(uid);
                else
                    allUserIds.push(uid);
            }
        });
        recentNews.forEach(n => {
            if (n.authorId)
                allUserIds.push(n.authorId.toString());
        });
        // Cari user by _id (ObjectId) untuk reporter laporan
        const userMapByObjectId = new Map();
        if (reportObjectIds.length > 0) {
            const users = await User_1.UserModel.find({ _id: { $in: reportObjectIds } }).select('name username').lean().exec();
            users.forEach((u) => userMapByObjectId.set(u._id.toString(), u));
        }
        // Cari user by integer id untuk author berita
        const intIds = [...new Set(allUserIds.map(Number).filter(n => !isNaN(n) && n > 0))];
        const userMapByIntId = new Map();
        if (intIds.length > 0) {
            const users = await User_1.UserModel.find({ id: { $in: intIds } }).select('name username id').lean().exec();
            users.forEach((u) => userMapByIntId.set(u.id.toString(), u));
        }
        const activity = [];
        recentReports.forEach(r => {
            const reporter = userMapByObjectId.get(r.userId?.toString());
            activity.push({
                type: 'report', text: `Laporan baru: ${r.location || '#' + r.id} oleh ${reporter?.name || reporter?.username || 'warga'}`,
                time: r.timestamp || r.createdAt, wsId: r.workspaceId, color: '#2563EB'
            });
        });
        recentNews.forEach(n => {
            const author = userMapByIntId.get(n.authorId?.toString());
            activity.push({
                type: 'news', text: `Berita baru: "${n.title}" oleh ${author?.name || author?.username || n.author}`,
                time: n.createdAt, wsId: n.workspaceId, color: '#8B5CF6'
            });
        });
        recentAuditLogs.forEach((a) => {
            const d = a.details || {};
            activity.push({
                type: 'clear_all', text: `Semua laporan dihapus oleh <strong>${a.actorName}</strong> dari ${d.workspaceName || 'Workspace #' + d.workspaceId} (${d.deletedCount} laporan)`,
                time: a.createdAt, wsId: d.workspaceId, color: '#EF4444'
            });
        });
        activity.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
        // Per-workspace activity summary
        const wsAdminCounts = await Promise.all(workspaceIds.map(async (id) => ({
            workspaceId: id,
            adminCount: await User_1.UserModel.countDocuments({ role: 'admin', workspaceId: id }).exec(),
            userCount: await User_1.UserModel.countDocuments({ role: 'user', workspaceIds: id }).exec(),
            cctvCount: await Cctv_1.CctvModel.countDocuments({ workspaceId: id }).exec(),
            reportCount: await ReportModel.countDocuments({ workspaceId: id }).exec(),
            pendingReportCount: await ReportModel.countDocuments({ workspaceId: id, adminStatus: 'MENUNGGU' }).exec(),
        })));
        res.json({
            success: true,
            stats: { totalAdmins, totalWorkspaces, totalUsers, totalCCTVs, totalReports, pendingReports, validReports, totalNews, publishedNews },
            data: { totalAdmins, totalWorkspaces, totalUsers, totalCCTVs },
            activity: activity.slice(0, 15),
            wsStats: wsAdminCounts
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/superadmin/stats failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.get('/admins', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    try {
        const superadminId = req.userContext?.id;
        if (!superadminId)
            return res.status(401).json({ error: 'Unauthorized' });
        const workspaces = await Workspace_1.WorkspaceModel.find({ superadminId }).lean().exec();
        const workspaceIds = workspaces.map(w => w.id);
        const search = req.query.search ? String(req.query.search).trim() : '';
        let query = { role: 'admin', workspaceId: { $in: workspaceIds } };
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { username: { $regex: search, $options: 'i' } }
            ];
        }
        const admins = await User_1.UserModel.find(query).sort({ createdAt: -1 }).lean().exec();
        const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
        const enrichedAdmins = admins.map((admin) => {
            const workspace = workspaceById.get(admin.workspaceId || 0);
            return { ...admin, workspaceCode: workspace?.code || '', workspaceName: workspace?.name || '' };
        });
        res.json({ success: true, admins: enrichedAdmins, data: enrichedAdmins });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/superadmin/admins failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
function generateRandomPassword(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    for (let i = 3; i < length; i++) {
        password += chars[Math.floor(Math.random() * chars.length)];
    }
    return password.split('').sort(() => 0.5 - Math.random()).join('');
}
async function generateAdminUsername(workspaceName) {
    const workspaceSlug = workspaceName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const prefix = `admin_${workspaceSlug}_`;
    const existingUsers = await User_1.UserModel.find({ username: { $regex: new RegExp('^' + prefix) } }).lean().exec();
    let maxSeq = 0;
    for (const user of existingUsers) {
        const parts = user.username.split('_');
        const seqStr = parts[parts.length - 1];
        const seq = parseInt(seqStr, 10);
        if (!isNaN(seq) && seq > maxSeq) {
            maxSeq = seq;
        }
    }
    const nextSeq = maxSeq + 1;
    const seqStr = String(nextSeq).padStart(3, '0');
    return `${prefix}${seqStr}`;
}
router.post('/admins', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    const { name, workspaceId, workspaceCode } = req.body;
    if (!name)
        return res.status(400).json({ error: 'Nama Admin wajib diisi' });
    if (!workspaceId && !workspaceCode)
        return res.status(400).json({ error: 'Workspace wajib dipilih' });
    try {
        let workspaceName = 'default';
        let wId;
        let resolvedWorkspaceCode = '';
        const workspaceQuery = workspaceCode
            ? { code: String(workspaceCode).trim().toUpperCase(), superadminId: req.userContext?.id }
            : { id: Number(workspaceId), superadminId: req.userContext?.id };
        const workspace = await Workspace_1.WorkspaceModel.findOne(workspaceQuery).lean().exec();
        if (workspace) {
            workspaceName = workspace.name;
            wId = workspace.id;
            resolvedWorkspaceCode = workspace.code;
            // Check 3 Admin Limit — count by ACTIVE admin users with this workspaceId
            const existingAdminCount = await User_1.UserModel.countDocuments({ role: 'admin', workspaceId: wId }).exec();
            if (existingAdminCount >= 3) {
                return res.status(400).json({ error: 'Batas maksimal 3 Admin per Workspace telah tercapai' });
            }
        }
        else {
            return res.status(403).json({ error: 'Workspace tidak valid atau tidak diizinkan' });
        }
        const username = await generateAdminUsername(workspaceName);
        const passwordPlain = generateRandomPassword(8);
        const newUser = await UserRepository_1.UserRepository.create(username, passwordPlain, 'admin', 'APPROVED');
        if (!newUser)
            return res.status(400).json({ error: 'Username admin sudah digunakan' });
        await User_1.UserModel.updateOne({ id: newUser.id }, { name: name.trim(), workspaceId: wId });
        await Workspace_1.WorkspaceModel.updateOne({ id: wId }, { $push: { adminIds: newUser.id } });
        await SystemAuditLog_1.SystemAuditLogModel.create({
            tenantId: String(wId),
            actorId: req.userContext?.id ? (await User_1.UserModel.findOne({ id: req.userContext.id }))?._id : null,
            actorName: req.userContext?.username || 'Unknown',
            action: 'Create Admin',
            ipAddress: req.ip || req.socket.remoteAddress || 'Unknown IP',
            userAgent: req.headers['user-agent'] || 'Unknown Device',
            details: { adminUsername: username, workspaceId: wId }
        });
        res.status(201).json({
            success: true,
            admin: {
                id: newUser.id,
                username,
                role: newUser.role,
                status: newUser.status,
                name: name.trim(),
                workspaceId: wId,
                workspaceCode: resolvedWorkspaceCode
            },
            passwordPlain,
            data: {
                id: newUser.id,
                username,
                name: name.trim(),
                workspaceId: wId,
                workspaceCode: resolvedWorkspaceCode,
                adminPasswordPlain: passwordPlain
            }
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/superadmin/admins failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.put('/admins/:id', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    const adminQuery = adminIdentifierQuery(req.params.id);
    const { name, workspaceId } = req.body;
    try {
        const admin = await User_1.UserModel.findOne({ ...adminQuery, role: 'admin' });
        if (!admin)
            return res.status(404).json({ error: 'Admin tidak ditemukan' });
        if (name)
            admin.name = name.trim();
        const oldWorkspaceId = admin.workspaceId;
        const superadminId = req.userContext?.id;
        if (workspaceId !== undefined) {
            const workspace = await Workspace_1.WorkspaceModel.findOne({ id: Number(workspaceId), superadminId }).lean().exec();
            if (!workspace)
                return res.status(403).json({ error: 'Workspace tidak valid atau tidak diizinkan' });
            if (oldWorkspaceId !== Number(workspaceId)) {
                if (workspace.adminIds && workspace.adminIds.length >= 3) {
                    return res.status(400).json({ error: 'Batas maksimal 3 Admin per Workspace telah tercapai' });
                }
            }
            admin.workspaceId = Number(workspaceId);
        }
        await admin.save();
        if (workspaceId !== undefined && oldWorkspaceId !== workspaceId) {
            if (oldWorkspaceId) {
                await Workspace_1.WorkspaceModel.updateOne({ id: oldWorkspaceId }, { $pull: { adminIds: admin.id } });
            }
            if (workspaceId) {
                await Workspace_1.WorkspaceModel.updateOne({ id: Number(workspaceId) }, { $push: { adminIds: admin.id } });
            }
        }
        res.json({ success: true, message: 'Admin berhasil diperbarui', admin });
    }
    catch (err) {
        console.error('[SERVER ERROR] PUT /api/superadmin/admins failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/admins/:id/reset-password', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    try {
        const adminQuery = adminIdentifierQuery(req.params.id);
        const superadminId = req.userContext?.id;
        const workspaces = await Workspace_1.WorkspaceModel.find({ superadminId }).lean().exec();
        const workspaceIds = workspaces.map(w => w.id);
        const admin = await User_1.UserModel.findOne({ ...adminQuery, role: 'admin', workspaceId: { $in: workspaceIds } });
        if (!admin)
            return res.status(404).json({ error: 'Admin tidak ditemukan atau tidak diizinkan' });
        const passwordPlain = generateRandomPassword(8);
        admin.passwordHash = await bcrypt_1.default.hash(passwordPlain, 10);
        await admin.save();
        await SystemAuditLog_1.SystemAuditLogModel.create({
            tenantId: admin.workspaceId ? String(admin.workspaceId) : 'system',
            actorId: req.userContext?.id ? (await User_1.UserModel.findOne({ id: req.userContext.id }))?._id : null,
            actorName: req.userContext?.username || 'Unknown',
            action: 'Reset Admin Password',
            ipAddress: req.ip || req.socket.remoteAddress || 'Unknown IP',
            userAgent: req.headers['user-agent'] || 'Unknown Device',
            details: { adminUsername: admin.username }
        });
        res.json({
            success: true,
            message: 'Password admin berhasil direset',
            passwordPlain,
            data: { username: admin.username, passwordPlain, newPasswordPlain: passwordPlain }
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] Reset admin password failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.delete('/admins/:id', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    try {
        const adminQuery = adminIdentifierQuery(req.params.id);
        const superadminId = req.userContext?.id;
        const workspaces = await Workspace_1.WorkspaceModel.find({ superadminId }).lean().exec();
        const workspaceIds = workspaces.map(w => w.id);
        const deleted = await User_1.UserModel.findOneAndDelete({ ...adminQuery, role: 'admin', workspaceId: { $in: workspaceIds } });
        if (!deleted)
            return res.status(404).json({ error: 'Admin tidak ditemukan atau tidak diizinkan' });
        await Workspace_1.WorkspaceModel.updateMany({ adminIds: deleted.id }, { $pull: { adminIds: deleted.id } });
        await SystemAuditLog_1.SystemAuditLogModel.create({
            tenantId: deleted.workspaceId ? String(deleted.workspaceId) : 'system',
            actorId: req.userContext?.id ? (await User_1.UserModel.findOne({ id: req.userContext.id }))?._id : null,
            actorName: req.userContext?.username || 'Unknown',
            action: 'Delete Admin',
            ipAddress: req.ip || req.socket.remoteAddress || 'Unknown IP',
            userAgent: req.headers['user-agent'] || 'Unknown Device',
            details: { adminUsername: deleted.username }
        });
        res.json({ success: true, message: 'Admin berhasil dihapus' });
    }
    catch (err) {
        console.error('[SERVER ERROR] DELETE /api/superadmin/admins failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// SESSIONS API
router.get('/sessions', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    try {
        const userId = req.userContext?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const user = await User_1.UserModel.findOne({ id: userId }).select('_id').lean().exec();
        if (!user)
            return res.status(401).json({ error: 'User not found' });
        const sessions = await Session_1.SessionModel.find({ userId })
            .sort({ lastActive: -1 })
            .limit(20)
            .lean()
            .exec();
        const enriched = sessions.map(s => ({
            id: s._id?.toString() || '',
            deviceInfo: s.deviceInfo || 'Unknown Device',
            ipAddress: s.ipAddress || 'Unknown IP',
            lastActive: s.lastActive || s.createdAt,
            createdAt: s.createdAt,
            isCurrent: false // client marks the current one
        }));
        res.json({ success: true, sessions: enriched });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/superadmin/sessions failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.delete('/sessions/:sessionId', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    try {
        const userId = req.userContext?.id;
        const sessionId = req.params.sessionId;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const deleted = await Session_1.SessionModel.findOneAndDelete({ _id: sessionId, userId }).exec();
        if (!deleted)
            return res.status(404).json({ error: 'Session tidak ditemukan atau tidak diizinkan' });
        res.json({ success: true, message: 'Session berhasil dihapus' });
    }
    catch (err) {
        console.error('[SERVER ERROR] DELETE /api/superadmin/sessions failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Change Password
router.post('/change-password', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    try {
        const userId = req.userContext?.id;
        const { currentPassword, newPassword } = req.body;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        if (!currentPassword || !newPassword)
            return res.status(400).json({ error: 'Password lama dan baru wajib diisi' });
        const strength = (0, password_1.checkPasswordStrength)(newPassword);
        if (strength.errors.length > 0) {
            return res.status(400).json({ error: 'Password lemah: ' + strength.errors.join(', ') });
        }
        const user = await User_1.UserModel.findOne({ id: userId }).select('+passwordHash').exec();
        if (!user)
            return res.status(401).json({ error: 'User tidak ditemukan' });
        const isMatch = await bcrypt_1.default.compare(currentPassword, user.passwordHash);
        if (!isMatch)
            return res.status(400).json({ error: 'Password lama tidak cocok' });
        user.passwordHash = await bcrypt_1.default.hash(newPassword, 10);
        await user.save();
        res.json({ success: true, message: 'Password berhasil diubah' });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/superadmin/change-password failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// WORKSPACES API
router.get('/workspaces', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    try {
        const superadminId = req.userContext?.id;
        if (!superadminId)
            return res.status(401).json({ error: 'Unauthorized' });
        const search = req.query.search ? String(req.query.search).trim() : '';
        let query = { superadminId };
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { code: { $regex: search, $options: 'i' } },
                { company: { $regex: search, $options: 'i' } }
            ];
        }
        const workspaces = await Workspace_1.WorkspaceModel.find(query).sort({ createdAt: -1 }).lean().exec();
        res.json({ success: true, workspaces, data: workspaces });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/superadmin/workspaces failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.post('/workspaces', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    const { name, company, address, description } = req.body;
    if (!name || !name.trim())
        return res.status(400).json({ error: 'Nama workspace wajib diisi' });
    try {
        const newWorkspace = await WorkspaceRepository_1.WorkspaceRepository.create({
            name: name.trim(),
            company: (company || '').trim(),
            address: (address || '').trim(),
            description: (description || '').trim(),
            superadminId: req.userContext?.id
        });
        const nextId = newWorkspace.id;
        const workspaceSlug = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
        let adminUsername = `admin_${workspaceSlug}`;
        const usernameExists = await UserRepository_1.UserRepository.findByUsername(adminUsername);
        if (usernameExists) {
            let seq = 2;
            while (await UserRepository_1.UserRepository.findByUsername(`admin_${workspaceSlug}_${String(seq).padStart(3, '0')}`)) {
                seq++;
            }
            adminUsername = `admin_${workspaceSlug}_${String(seq).padStart(3, '0')}`;
        }
        const adminPasswordPlain = generateRandomPassword(8);
        const newAdmin = await UserRepository_1.UserRepository.create(adminUsername, adminPasswordPlain, 'admin', 'APPROVED', {
            name: `Admin ${name.trim()}`,
            workspaceId: nextId
        });
        if (newAdmin) {
            await Workspace_1.WorkspaceModel.updateOne({ id: nextId }, { $push: { adminIds: newAdmin.id } });
        }
        await SystemAuditLog_1.SystemAuditLogModel.create({
            tenantId: String(newWorkspace.id),
            actorId: req.userContext?.id ? (await User_1.UserModel.findOne({ id: req.userContext.id }))?._id : null,
            actorName: req.userContext?.username || 'Unknown',
            action: 'Create Workspace',
            ipAddress: req.ip || req.socket.remoteAddress || 'Unknown IP',
            userAgent: req.headers['user-agent'] || 'Unknown Device',
            details: { workspaceName: newWorkspace.name, workspaceCode: newWorkspace.code }
        });
        res.status(201).json({
            success: true,
            workspace: newWorkspace,
            admin: newAdmin ? {
                id: newAdmin.id,
                username: newAdmin.username,
                role: newAdmin.role
            } : null,
            adminPasswordPlain,
            data: {
                code: newWorkspace.code,
                workspace: newWorkspace,
                adminUsername: newAdmin?.username,
                adminPasswordPlain
            }
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/superadmin/workspaces failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.put('/workspaces/:id', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    const workspaceId = parseInt(req.params.id);
    if (isNaN(workspaceId))
        return res.status(400).json({ error: 'ID tidak valid' });
    const { name, company, address, description } = req.body;
    try {
        const superadminId = req.userContext?.id;
        const workspace = await Workspace_1.WorkspaceModel.findOne({ id: workspaceId, superadminId });
        if (!workspace)
            return res.status(404).json({ error: 'Workspace tidak ditemukan atau tidak diizinkan' });
        if (name)
            workspace.name = name.trim();
        if (company !== undefined)
            workspace.company = (company || '').trim();
        if (address !== undefined)
            workspace.address = (address || '').trim();
        if (description !== undefined)
            workspace.description = (description || '').trim();
        await workspace.save();
        res.json({ success: true, message: 'Workspace berhasil diperbarui', workspace });
    }
    catch (err) {
        console.error('[SERVER ERROR] PUT /api/superadmin/workspaces failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
router.delete('/workspaces/:id', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    const workspaceId = parseInt(req.params.id);
    if (isNaN(workspaceId))
        return res.status(400).json({ error: 'ID tidak valid' });
    try {
        const superadminId = req.userContext?.id;
        const deleted = await Workspace_1.WorkspaceModel.findOneAndDelete({ id: workspaceId, superadminId });
        if (!deleted)
            return res.status(404).json({ error: 'Workspace tidak ditemukan atau tidak diizinkan' });
        await User_1.UserModel.updateMany({ workspaceId }, { $unset: { workspaceId: 1 }, $pull: { workspaceIds: workspaceId } });
        await SystemAuditLog_1.SystemAuditLogModel.create({
            tenantId: String(workspaceId),
            actorId: req.userContext?.id ? (await User_1.UserModel.findOne({ id: req.userContext.id }))?._id : null,
            actorName: req.userContext?.username || 'Unknown',
            action: 'Delete Workspace',
            ipAddress: req.ip || req.socket.remoteAddress || 'Unknown IP',
            userAgent: req.headers['user-agent'] || 'Unknown Device',
            details: { workspaceName: deleted.name, workspaceCode: deleted.code }
        });
        res.json({ success: true, message: 'Workspace berhasil dihapus' });
    }
    catch (err) {
        console.error('[SERVER ERROR] DELETE /api/superadmin/workspaces failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Get Workspace Full Details
router.get('/workspaces/:id/detail', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    try {
        const workspaceId = Number(req.params.id);
        const superadminId = req.userContext?.id;
        if (!superadminId)
            return res.status(401).json({ error: 'Unauthorized' });
        const workspace = await Workspace_1.WorkspaceModel.findOne({ id: workspaceId, superadminId }).lean().exec();
        if (!workspace)
            return res.status(404).json({ error: 'Workspace tidak ditemukan' });
        // Admins of this workspace
        const admins = await User_1.UserModel.find({
            $or: [
                { workspaceIds: workspaceId },
                { workspaceId: workspaceId }
            ],
            role: 'admin'
        })
            .select('id name username email role phone status createdAt updatedAt')
            .sort({ createdAt: -1 })
            .lean()
            .exec();
        // Regular users (citizens) — admins/superadmins excluded from "Data Warga"
        const members = await User_1.UserModel.find({
            $or: [
                { workspaceIds: workspaceId },
                { workspaceId: workspaceId }
            ],
            role: { $in: ['user'] }
        })
            .select('id name username email role phone status createdAt updatedAt')
            .sort({ createdAt: -1 })
            .lean()
            .exec();
        // Report stats
        const ReportModel = (await Promise.resolve().then(() => __importStar(require('../database/models/Report')))).ReportModel;
        const CctvModelLocal = (await Promise.resolve().then(() => __importStar(require('../database/models/Cctv')))).CctvModel;
        const NewsModelLocal = (await Promise.resolve().then(() => __importStar(require('../database/models/News')))).NewsModel;
        const reportCount = await ReportModel.countDocuments({ workspaceId }).exec();
        const pendingReports = await ReportModel.countDocuments({ workspaceId, adminStatus: 'MENUNGGU' }).exec();
        const validReports = await ReportModel.countDocuments({ workspaceId, adminStatus: 'VALID' }).exec();
        const cctvCount = await CctvModelLocal.countDocuments({ workspaceId }).exec();
        const offlineCameras = await CctvModelLocal.countDocuments({ workspaceId, status: { $ne: 'ONLINE' } }).exec();
        const newsCount = await NewsModelLocal.countDocuments({ workspaceId }).exec();
        const publishedNewsCount = await NewsModelLocal.countDocuments({ workspaceId, status: 'published' }).exec();
        // Recent news
        const recentNews = await NewsModelLocal.find({ workspaceId })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean()
            .exec();
        // Recent reports (last 10)
        const recentReports = await ReportModel.find({ workspaceId })
            .sort({ timestamp: -1 })
            .limit(10)
            .lean()
            .exec();
        // Enrich reports with reporter name and assigned admin name
        const userIds = [...new Set(recentReports.map(r => r.userId?.toString()).filter(Boolean))];
        const officers = [...new Set(recentReports.map(r => r.assignedOfficer).filter(Boolean))];
        const usersMap = new Map((await User_1.UserModel.find().where('_id').in([...userIds]).select('id name username').lean().exec())
            .map((u) => [u._id.toString(), u]));
        const officersMap = new Map((await User_1.UserModel.find({ username: { $in: officers } }).select('id name username').lean().exec())
            .map((u) => [u.username, u]));
        const enrichedReports = recentReports.map(r => {
            const reporter = usersMap.get(r.userId?.toString());
            const assignee = officersMap.get(r.assignedOfficer);
            return {
                ...r,
                reporterName: reporter?.name || reporter?.username || '',
                assignedToName: assignee?.name || assignee?.username || r.assignedOfficer || '',
            };
        });
        // Recent activity
        const activity = [];
        // Recent reports activity
        enrichedReports.slice(0, 5).forEach(r => {
            activity.push({
                text: `Laporan baru: <strong>${r.location || '#' + r.id}</strong> oleh ${r.reporterName || 'warga'}`,
                time: r.timestamp || r.createdAt,
                color: '#2563EB'
            });
        });
        // News activity
        recentNews.forEach(n => {
            activity.push({
                text: `Berita: <strong>${n.title}</strong> oleh ${n.author || (n.authorName || 'admin')}`,
                time: n.createdAt,
                color: '#8B5CF6'
            });
        });
        // New members activity
        const recentMembers = members.filter((m) => {
            const d = new Date(m.createdAt);
            return d > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        });
        recentMembers.forEach((m) => {
            activity.push({
                text: `Warga baru bergabung: <strong>${m.name || m.username}</strong>`,
                time: m.createdAt,
                color: '#10B981'
            });
        });
        // Audit logs for this workspace
        const wsAuditLogs = await SystemAuditLog_1.SystemAuditLogModel.find({
            action: 'CLEAR_ALL_REPORTS',
            $or: [
                { 'details.workspaceId': workspaceId },
                { 'details.workspaceId': String(workspaceId) }
            ]
        }).sort({ createdAt: -1 }).limit(5).lean().exec();
        wsAuditLogs.forEach((a) => {
            const d = a.details || {};
            activity.push({
                text: `Semua laporan dihapus oleh <strong>${a.actorName}</strong> (${d.deletedCount} laporan)`,
                time: a.createdAt,
                color: '#EF4444'
            });
        });
        // Sort activity by time desc
        activity.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
        const adminCount = admins.length;
        const userCount = members.length;
        // Enriched admins with validated report count + published news count
        const enrichedAdminData = await Promise.all(admins.map(async (admin) => {
            const adminValidatedReports = await ReportModel.countDocuments({ workspaceId, assignedOfficer: admin.username, adminStatus: 'VALID' }).exec();
            const adminPublishedNews = await NewsModelLocal.countDocuments({ workspaceId, author: admin.username, status: 'published' }).exec();
            return {
                id: admin.id, name: admin.name, username: admin.username, email: admin.email,
                phone: admin.phone, status: admin.status, role: admin.role,
                createdAt: admin.createdAt,
                validatedReports: adminValidatedReports,
                publishedNews: adminPublishedNews
            };
        }));
        // Enriched users with report count
        const enrichedUsers = await Promise.all(members.map(async (user) => {
            const userReportCount = await ReportModel.countDocuments({ workspaceId, userId: user._id }).exec();
            return {
                id: user.id, name: user.name, username: user.username, email: user.email,
                phone: user.phone, status: user.status, role: user.role,
                createdAt: user.createdAt,
                reportCount: userReportCount
            };
        }));
        const data = {
            stats: {
                adminCount,
                userCount,
                cctvCount,
                reportCount,
                pendingReports,
                validReports,
                offlineCameras,
                newsCount,
                publishedNewsCount,
                createdAt: workspace.createdAt,
            },
            admins: enrichedAdminData,
            users: enrichedUsers,
            reports: enrichedReports,
            news: recentNews,
            activity: activity.slice(0, 20),
        };
        res.json({ success: true, data });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/superadmin/workspaces/:id/detail failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
exports.default = router;
// GET /api/superadmin/audit-logs - Retrieve system audit logs (superadmin only)
router.get('/audit-logs', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), async (req, res) => {
    try {
        const { action, tenantId, actorName, fromDate, toDate, page = 1, limit = 50 } = req.query;
        const query = {};
        if (action)
            query.action = action;
        if (tenantId)
            query.tenantId = tenantId;
        if (actorName)
            query.actorName = { $regex: actorName, $options: 'i' };
        if (fromDate || toDate) {
            query.createdAt = {};
            if (fromDate)
                query.createdAt.$gte = new Date(fromDate);
            if (toDate)
                query.createdAt.$lte = new Date(toDate);
        }
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const skip = (pageNum - 1) * limitNum;
        const [logs, total] = await Promise.all([
            SystemAuditLog_1.SystemAuditLogModel.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean()
                .exec(),
            SystemAuditLog_1.SystemAuditLogModel.countDocuments(query).exec()
        ]);
        res.json({
            success: true,
            logs,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                pages: Math.ceil(total / limitNum)
            }
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/superadmin/audit-logs failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET /api/auth/audit-logs - User's own audit logs (authenticated users)
router.get('/auth/audit-logs', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const userId = req.userContext?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const user = await User_1.UserModel.findOne({ id: userId }).lean().exec();
        if (!user)
            return res.status(404).json({ error: 'User tidak ditemukan' });
        const { fromDate, toDate, page = 1, limit = 20 } = req.query;
        const query = { actorId: user._id };
        if (fromDate || toDate) {
            query.createdAt = {};
            if (fromDate)
                query.createdAt.$gte = new Date(fromDate);
            if (toDate)
                query.createdAt.$lte = new Date(toDate);
        }
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
        const skip = (pageNum - 1) * limitNum;
        const [logs, total] = await Promise.all([
            SystemAuditLog_1.SystemAuditLogModel.find(query)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .lean()
                .exec(),
            SystemAuditLog_1.SystemAuditLogModel.countDocuments(query).exec()
        ]);
        res.json({
            success: true,
            logs,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                pages: Math.ceil(total / limitNum)
            }
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/auth/audit-logs failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
