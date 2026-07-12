"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Workspace_1 = require("../database/models/Workspace");
const JoinRequest_1 = require("../database/models/JoinRequest");
const User_1 = require("../database/models/User");
const Cctv_1 = require("../database/models/Cctv");
const authMiddleware_1 = require("../auth/authMiddleware");
const RoleMiddleware_1 = require("../auth/RoleMiddleware");
const router = (0, express_1.Router)();
// ─── GET /api/workspaces/all ─────────────────────────────────────────────────
// Public: List all workspaces (for selection / join)
router.get('/all', async (req, res) => {
    try {
        const search = String(req.query.search || '').trim();
        const query = search
            ? { $or: [{ name: new RegExp(search, 'i') }, { company: new RegExp(search, 'i') }, { code: new RegExp(search, 'i') }] }
            : {};
        const workspaces = await Workspace_1.WorkspaceModel.find(query, 'id name company code description address').sort({ name: 1 }).lean().exec();
        res.json({ success: true, workspaces });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/workspaces/all failed:', err);
        res.status(500).json({ error: 'Gagal mengambil data workspace' });
    }
});
// ─── GET /api/workspaces/my-requests ─────────────────────────────────────────
// Auth (user): Get current user's join requests
router.get('/my-requests', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['user']), async (req, res) => {
    try {
        const userId = req.userContext?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const requests = await JoinRequest_1.JoinRequestModel.find({ userId }).lean().exec();
        res.json({ success: true, requests });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/workspaces/my-requests failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// ─── GET /api/workspaces/requests ────────────────────────────────────────────
// Auth (admin): Get pending join requests for the admin's workspace
router.get('/requests', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin']), async (req, res) => {
    try {
        const adminUser = await User_1.UserModel.findOne({ id: req.userContext?.id }).lean().exec();
        const adminWorkspaceId = adminUser?.workspaceId;
        if (!adminWorkspaceId)
            return res.status(403).json({ error: 'Admin tidak memiliki workspace' });
        const requests = await JoinRequest_1.JoinRequestModel.find({ workspaceId: adminWorkspaceId, status: 'PENDING' }).lean().exec();
        // Enrich with user data
        const enrichedRequests = await Promise.all(requests.map(async (reqItem) => {
            const user = await User_1.UserModel.findOne({ id: reqItem.userId }, 'name email phone').lean().exec();
            return {
                ...reqItem,
                userName: user?.name || 'Unknown',
                userEmail: user?.email || '-',
            };
        }));
        res.json({ success: true, requests: enrichedRequests });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/workspaces/requests failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// ─── POST /api/workspaces/requests/:id/approve ──────────────────────────────────
// Auth (admin): Approve a join request
router.post('/requests/:id/approve', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin']), async (req, res) => {
    try {
        const reqId = req.params.id;
        const adminUser = await User_1.UserModel.findOne({ id: req.userContext?.id }).lean().exec();
        const adminWorkspaceId = adminUser?.workspaceId;
        if (!adminWorkspaceId)
            return res.status(403).json({ error: 'Admin tidak memiliki workspace' });
        // Validate request ID format (either string for ObjectId or numeric for incrementing ID based on model)
        const joinReq = await JoinRequest_1.JoinRequestModel.findById(reqId);
        if (!joinReq) {
            // In case we used 'id' field instead of '_id'
            const reqByIntId = await JoinRequest_1.JoinRequestModel.findOne({ id: Number(reqId) });
            if (!reqByIntId)
                return res.status(404).json({ error: 'Request tidak ditemukan' });
            if (reqByIntId.workspaceId !== adminWorkspaceId)
                return res.status(403).json({ error: 'Forbidden' });
            reqByIntId.status = 'APPROVED';
            await reqByIntId.save();
            await User_1.UserModel.updateOne({ id: reqByIntId.userId }, { $addToSet: { workspaceIds: adminWorkspaceId } });
            return res.json({ success: true, message: 'Request disetujui' });
        }
        if (joinReq.workspaceId !== adminWorkspaceId)
            return res.status(403).json({ error: 'Forbidden' });
        joinReq.status = 'APPROVED';
        await joinReq.save();
        await User_1.UserModel.updateOne({ id: joinReq.userId }, { $addToSet: { workspaceIds: adminWorkspaceId } });
        res.json({ success: true, message: 'Request disetujui' });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/workspaces/requests/:id/approve failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// ─── POST /api/workspaces/requests/:id/reject ───────────────────────────────────
// Auth (admin): Reject a join request
router.post('/requests/:id/reject', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin']), async (req, res) => {
    try {
        const reqId = req.params.id;
        const adminUser = await User_1.UserModel.findOne({ id: req.userContext?.id }).lean().exec();
        const adminWorkspaceId = adminUser?.workspaceId;
        if (!adminWorkspaceId)
            return res.status(403).json({ error: 'Admin tidak memiliki workspace' });
        const joinReq = await JoinRequest_1.JoinRequestModel.findById(reqId);
        if (!joinReq) {
            const reqByIntId = await JoinRequest_1.JoinRequestModel.findOne({ id: Number(reqId) });
            if (!reqByIntId)
                return res.status(404).json({ error: 'Request tidak ditemukan' });
            if (reqByIntId.workspaceId !== adminWorkspaceId)
                return res.status(403).json({ error: 'Forbidden' });
            reqByIntId.status = 'REJECTED';
            await reqByIntId.save();
            return res.json({ success: true, message: 'Request ditolak' });
        }
        if (joinReq.workspaceId !== adminWorkspaceId)
            return res.status(403).json({ error: 'Forbidden' });
        joinReq.status = 'REJECTED';
        await joinReq.save();
        res.json({ success: true, message: 'Request ditolak' });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/workspaces/requests/:id/reject failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// ─── GET /api/workspaces/:id ──────────────────────────────────────────────────
// Auth: Get single workspace detail
router.get('/:id', authMiddleware_1.authMiddleware, async (req, res) => {
    try {
        const wsId = Number(req.params.id);
        if (isNaN(wsId))
            return res.status(400).json({ error: 'ID tidak valid' });
        const workspace = await Workspace_1.WorkspaceModel.findOne({ id: wsId }, 'id name company code description address').lean().exec();
        if (!workspace)
            return res.status(404).json({ error: 'Workspace tidak ditemukan' });
        res.json({ success: true, workspace });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/workspaces/:id failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// ─── POST /api/workspaces/select ─────────────────────────────────────────────
// Auth (user): Select active workspace (alias for /api/auth/select-workspace)
router.post('/select', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['user']), async (req, res) => {
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
        console.error('[SERVER ERROR] POST /api/workspaces/select failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// ─── POST /api/workspaces/join ────────────────────────────────────────────────
// Auth (user): Request to join a workspace
router.post('/join', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['user']), async (req, res) => {
    const { workspaceId } = req.body;
    if (!workspaceId)
        return res.status(400).json({ error: 'Workspace ID wajib diisi' });
    try {
        const userId = req.userContext?.id;
        if (!userId)
            return res.status(401).json({ error: 'Unauthorized' });
        const ws = await Workspace_1.WorkspaceModel.findOne({ id: Number(workspaceId) });
        if (!ws)
            return res.status(404).json({ error: 'Workspace tidak ditemukan' });
        const currentUser = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (currentUser?.workspaceIds?.includes(ws.id)) {
            return res.json({ success: true, status: 'APPROVED', message: 'Anda sudah memiliki akses ke workspace ini' });
        }
        const existingRequest = await JoinRequest_1.JoinRequestModel.findOne({ userId, workspaceId: ws.id, status: 'PENDING' });
        if (existingRequest) {
            return res.status(400).json({ error: 'Anda sudah mengajukan permintaan untuk workspace ini' });
        }
        const newRequest = await JoinRequest_1.JoinRequestModel.create({
            userId,
            workspaceId: ws.id,
            status: 'PENDING'
        });
        res.status(201).json({ success: true, message: 'Permintaan bergabung berhasil dikirim', request: newRequest });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/workspaces/join failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// ─── GET /api/workspaces/:id/statistics ──────────────────────────────────────
// Auth (admin/superadmin): Get workspace statistics
router.get('/:id/statistics', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'superadmin']), async (req, res) => {
    try {
        const wsId = Number(req.params.id);
        if (isNaN(wsId))
            return res.status(400).json({ error: 'ID tidak valid' });
        const requesterRole = req.userContext?.role;
        const requesterId = req.userContext?.id;
        // Authorisation: admins can only access their own workspace
        if (requesterRole === 'admin') {
            const admin = await User_1.UserModel.findOne({ id: requesterId }).lean().exec();
            if (!admin || admin.workspaceId !== wsId) {
                return res.status(403).json({ error: 'Akses ditolak' });
            }
        }
        const workspace = await Workspace_1.WorkspaceModel.findOne({ id: wsId }).lean().exec();
        if (!workspace)
            return res.status(404).json({ error: 'Workspace tidak ditemukan' });
        const [adminCount, userCount, cctvCount, pendingCount] = await Promise.all([
            User_1.UserModel.countDocuments({ role: 'admin', workspaceId: wsId }),
            User_1.UserModel.countDocuments({ role: 'user', workspaceIds: wsId }),
            Cctv_1.CctvModel.countDocuments({ workspaceId: wsId }),
            JoinRequest_1.JoinRequestModel.countDocuments({ workspaceId: wsId, status: 'PENDING' }),
        ]);
        // Reports stats (dynamic import to avoid hard dependency)
        let reportCount = 0;
        let approvedCount = 0;
        let rejectedCount = 0;
        try {
            const { ReportModel } = require('../database/models/Report');
            [reportCount, approvedCount, rejectedCount] = await Promise.all([
                ReportModel.countDocuments({ workspaceId: wsId }),
                ReportModel.countDocuments({ workspaceId: wsId, adminValidationStatus: 'approved' }),
                ReportModel.countDocuments({ workspaceId: wsId, adminValidationStatus: 'rejected' }),
            ]);
        }
        catch (_) {
            // Report model may not be available — skip silently
        }
        res.json({
            success: true,
            statistics: {
                admins: adminCount,
                users: userCount,
                reports: reportCount,
                cctv: cctvCount,
                pendingRequests: pendingCount,
                approvedReports: approvedCount,
                rejectedReports: rejectedCount,
            }
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/workspaces/:id/statistics failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
exports.default = router;
