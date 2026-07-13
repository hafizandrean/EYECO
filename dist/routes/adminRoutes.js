"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const User_1 = require("../database/models/User");
const JoinRequest_1 = require("../database/models/JoinRequest");
const UserRepository_1 = require("../database/repositories/UserRepository");
const authMiddleware_1 = require("../auth/authMiddleware");
const RoleMiddleware_1 = require("../auth/RoleMiddleware");
const router = (0, express_1.Router)();
// GET /admin/users - List all users for Admin's workspace
router.get('/users', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin']), async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        const workspaceId = user.workspaceId || -1;
        const users = await User_1.UserModel.find({ role: 'user', workspaceIds: workspaceId }).select('-passwordHash').lean().exec();
        res.json({ users });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /admin/users failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET /admin/join-requests - List pending join requests for Admin's workspace
router.get('/join-requests', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin']), async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Belum masuk' });
        const workspaceId = user.workspaceId || -1;
        const requests = await JoinRequest_1.JoinRequestModel.find({ workspaceId, status: 'PENDING' }).sort({ createdAt: -1 }).lean().exec();
        // Enrich with user data
        const userIds = requests.map(r => r.userId);
        const users = await User_1.UserModel.find({ id: { $in: userIds } }).select('id username name email').lean().exec();
        const enriched = requests.map(r => {
            const u = users.find(user => user.id === r.userId);
            return {
                ...r,
                user: u ? { username: u.username, name: u.name, email: u.email } : null
            };
        });
        res.json({ requests: enriched });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /admin/join-requests failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// POST /admin/join-requests/:id/approve
router.post('/join-requests/:id/approve', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin']), async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user || !user.workspaceId)
            return res.status(403).json({ error: 'Akses ditolak' });
        const reqId = req.params.id;
        const joinReq = await JoinRequest_1.JoinRequestModel.findOne({ _id: reqId, workspaceId: user.workspaceId, status: 'PENDING' });
        if (!joinReq)
            return res.status(404).json({ error: 'Permintaan tidak ditemukan' });
        joinReq.status = 'APPROVED';
        await joinReq.save();
        await User_1.UserModel.updateOne({ id: joinReq.userId }, { $addToSet: { workspaceIds: user.workspaceId } });
        res.json({ success: true, message: 'Permintaan disetujui' });
    }
    catch (err) {
        console.error('[SERVER ERROR] Approve join request failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// POST /admin/join-requests/:id/reject
router.post('/join-requests/:id/reject', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin']), async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user || !user.workspaceId)
            return res.status(403).json({ error: 'Akses ditolak' });
        const reqId = req.params.id;
        const joinReq = await JoinRequest_1.JoinRequestModel.findOne({ _id: reqId, workspaceId: user.workspaceId, status: 'PENDING' });
        if (!joinReq)
            return res.status(404).json({ error: 'Permintaan tidak ditemukan' });
        joinReq.status = 'REJECTED';
        await joinReq.save();
        res.json({ success: true, message: 'Permintaan ditolak' });
    }
    catch (err) {
        console.error('[SERVER ERROR] Reject join request failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// PATCH /admin/users/:id/approve - Approve user globally (Legacy)
router.patch('/users/:id/approve', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin']), async (req, res) => {
    try {
        const admin = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!admin?.workspaceId)
            return res.status(403).json({ error: 'Admin belum diassign ke workspace' });
        const targetId = parseInt(req.params.id);
        if (isNaN(targetId))
            return res.status(400).json({ error: 'ID tidak valid' });
        const target = await User_1.UserModel.findOne({ id: targetId, role: 'user', workspaceIds: admin.workspaceId }).lean().exec();
        if (!target)
            return res.status(404).json({ error: 'User tidak ditemukan di workspace ini' });
        const updated = await UserRepository_1.UserRepository.updateStatus(targetId, 'APPROVED', admin.workspaceId);
        if (!updated)
            return res.status(404).json({ error: 'User tidak ditemukan' });
        res.json({ success: true, message: `User ${updated.username} berhasil disetujui.`, user: { id: updated.id, username: updated.username, status: updated.status } });
    }
    catch (err) {
        console.error('[SERVER ERROR] PATCH /admin/users/:id/approve failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// PATCH /admin/users/:id/reject - Reject user globally (Legacy)
router.patch('/users/:id/reject', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin']), async (req, res) => {
    try {
        const admin = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!admin?.workspaceId)
            return res.status(403).json({ error: 'Admin belum diassign ke workspace' });
        const targetId = parseInt(req.params.id);
        if (isNaN(targetId))
            return res.status(400).json({ error: 'ID tidak valid' });
        const target = await User_1.UserModel.findOne({ id: targetId, role: 'user', workspaceIds: admin.workspaceId }).lean().exec();
        if (!target)
            return res.status(404).json({ error: 'User tidak ditemukan di workspace ini' });
        const updated = await UserRepository_1.UserRepository.updateStatus(targetId, 'REJECTED', admin.workspaceId);
        if (!updated)
            return res.status(404).json({ error: 'User tidak ditemukan' });
        res.json({ success: true, message: `User ${updated.username} berhasil ditolak.`, user: { id: updated.id, username: updated.username, status: updated.status } });
    }
    catch (err) {
        console.error('[SERVER ERROR] PATCH /admin/users/:id/reject failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
exports.default = router;
