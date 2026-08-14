import { Router } from 'express';
import { WorkspaceModel } from '../database/models/Workspace';
import { JoinRequestModel } from '../database/models/JoinRequest';
import { UserModel } from '../database/models/User';
import { CctvModel } from '../database/models/Cctv';
import { NotificationModel } from '../database/models/Notification';
import { authMiddleware, getLoggedInUser } from '../auth/authMiddleware';
import { roleGuard } from '../auth/RoleMiddleware';

const router = Router();

// ─── GET /api/workspaces/all ─────────────────────────────────────────────────
// Public: List all workspaces (for selection / join)
router.get('/all', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    const query = search
      ? { $or: [{ name: new RegExp(search, 'i') }, { company: new RegExp(search, 'i') }, { code: new RegExp(search, 'i') }] }
      : {};
    const workspaces = await WorkspaceModel.find(query, 'id name company code description address').sort({ name: 1 }).lean().exec();
    res.json({ success: true, workspaces });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/workspaces/all failed:', err);
    res.status(500).json({ error: 'Gagal mengambil data workspace' });
  }
});

// ─── GET /api/workspaces/my-requests ─────────────────────────────────────────
// Auth (user): Get current user's join requests
router.get('/my-requests', authMiddleware, roleGuard(['user', 'operator', 'admin']), async (req, res) => {
  try {
    const userId = req.userContext?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const requests = await JoinRequestModel.find({ userId }).sort({ createdAt: -1 }).lean().exec();
    
    // Enrich with workspace name
    const enriched = await Promise.all(requests.map(async (r) => {
      const ws = await WorkspaceModel.findOne({ id: r.workspaceId }, 'name company code').lean().exec();
      return {
        ...r,
        workspaceName: ws?.name || `Workspace #${r.workspaceId}`,
        workspaceCode: ws?.code || '',
      };
    }));

    res.json({ success: true, requests: enriched });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/workspaces/my-requests failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ─── GET /api/workspaces/requests/count ──────────────────────────────────────
// Auth (admin): Get PENDING requests count for navbar badge
router.get('/requests/count', authMiddleware, roleGuard(['admin', 'superadmin']), async (req, res) => {
  try {
    const adminUser = await UserModel.findOne({ id: req.userContext?.id }).lean().exec();
    const adminWorkspaceId = adminUser?.workspaceId;
    if (!adminWorkspaceId) return res.json({ success: true, count: 0 });

    const count = await JoinRequestModel.countDocuments({ workspaceId: adminWorkspaceId, status: 'PENDING' });
    res.json({ success: true, count });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/workspaces/requests/count failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ─── GET /api/workspaces/requests ────────────────────────────────────────────
// Auth (admin): Get join requests for the admin's workspace with filter support
router.get('/requests', authMiddleware, roleGuard(['admin', 'superadmin']), async (req, res) => {
  try {
    const adminUser = await UserModel.findOne({ id: req.userContext?.id }).lean().exec();
    const adminWorkspaceId = adminUser?.workspaceId;
    
    if (req.userContext?.role !== 'superadmin' && !adminWorkspaceId) {
      return res.status(403).json({ error: 'Admin belum terikat pada workspace manapun' });
    }

    const requestedWsId = req.query.workspaceId ? Number(req.query.workspaceId) : adminWorkspaceId;
    
    // Cross-workspace isolation guard: Admin A cannot view requests for Workspace B
    if (req.userContext?.role !== 'superadmin' && requestedWsId !== adminWorkspaceId) {
      return res.status(403).json({ error: 'Akses ditolak: Anda tidak berhak melihat permintaan workspace lain' });
    }

    const statusFilter = String(req.query.status || 'semua').toUpperCase();
    const filterQuery: Record<string, unknown> = { workspaceId: requestedWsId };
    if (statusFilter && statusFilter !== 'SEMUA') {
      filterQuery.status = statusFilter;
    }

    const requests = await JoinRequestModel.find(filterQuery).sort({ createdAt: -1 }).lean().exec();
    
    // Enrich with user and decision details
    const enrichedRequests = await Promise.all(requests.map(async (reqItem) => {
      const user = await UserModel.findOne({ id: reqItem.userId }, 'name username email phone role').lean().exec();
      let deciderName = '-';
      if (reqItem.decidedBy) {
        const decider = await UserModel.findOne({ id: reqItem.decidedBy }, 'name username').lean().exec();
        deciderName = decider?.name || decider?.username || `Admin #${reqItem.decidedBy}`;
      }

      return {
        ...reqItem,
        userName: user?.name || user?.username || 'Unknown',
        userEmail: user?.email || '-',
        userPhone: user?.phone || '-',
        userRole: user?.role || 'user',
        deciderName,
      };
    }));

    res.json({ success: true, requests: enrichedRequests });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/workspaces/requests failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ─── POST /api/workspaces/requests/:id/decide ─────────────────────────────────
// Auth (admin): Atomic decision (APPROVED or REJECTED) on a join request
router.post('/requests/:id/decide', authMiddleware, roleGuard(['admin', 'superadmin']), async (req, res) => {
  try {
    const reqId = req.params.id;
    const { action, rejectionReasonCode, rejectionNote } = req.body;

    if (!action || !['APPROVED', 'REJECTED'].includes(action)) {
      return res.status(400).json({ error: 'Aksi tidak valid (harus APPROVED atau REJECTED)' });
    }

    const adminUser = await UserModel.findOne({ id: req.userContext?.id }).lean().exec();
    const adminWorkspaceId = adminUser?.workspaceId;
    
    if (req.userContext?.role !== 'superadmin' && !adminWorkspaceId) {
      return res.status(403).json({ error: 'Admin tidak memiliki workspace' });
    }

    // Find request by ObjectId _id or numeric id
    let joinReq = await JoinRequestModel.findById(reqId);
    if (!joinReq) {
      joinReq = await JoinRequestModel.findOne({ id: Number(reqId) });
    }
    if (!joinReq) {
      return res.status(404).json({ error: 'Permintaan akses tidak ditemukan' });
    }

    // Cross-workspace isolation guard
    if (req.userContext?.role !== 'superadmin' && joinReq.workspaceId !== adminWorkspaceId) {
      return res.status(403).json({ error: 'Akses ditolak: Anda tidak berhak memproses permintaan di workspace lain' });
    }

    // ATOMIC STATE GUARD: Prevent re-decision on resolved requests
    if (joinReq.status !== 'PENDING') {
      return res.status(409).json({
        error: 'REQUEST_ALREADY_DECIDED',
        message: `Permintaan akses ini sudah diputuskan sebelumnya (${joinReq.status}).`
      });
    }

    joinReq.status = action as 'APPROVED' | 'REJECTED';
    joinReq.decidedBy = req.userContext?.id;
    joinReq.decidedAt = new Date();

    if (action === 'REJECTED') {
      joinReq.rejectionReasonCode = rejectionReasonCode || 'Lainnya';
      joinReq.rejectionNote = rejectionNote || '';
    }

    await joinReq.save();

    // If APPROVED, grant access to user
    if (action === 'APPROVED') {
      const targetUser = await UserModel.findOne({ id: joinReq.userId });
      if (targetUser) {
        const wsIds: number[] = targetUser.workspaceIds || [];
        if (!wsIds.includes(joinReq.workspaceId)) {
          wsIds.push(joinReq.workspaceId);
          targetUser.workspaceIds = wsIds;
        }
        if (!targetUser.workspaceId) {
          targetUser.workspaceId = joinReq.workspaceId;
        }
        await targetUser.save();
      }
    }

    // Create in-app notification for the user
    try {
      const targetUser = await UserModel.findOne({ id: joinReq.userId }).lean().exec();
      const ws = await WorkspaceModel.findOne({ id: joinReq.workspaceId }).lean().exec();
      if (targetUser && ws) {
        const title = action === 'APPROVED' ? 'Permintaan Akses Disetujui' : 'Permintaan Akses Ditolak';
        const reasonText = action === 'REJECTED' && rejectionReasonCode ? ` Alasan: ${rejectionReasonCode}${rejectionNote ? ` (${rejectionNote})` : ''}.` : '';
        const msg = action === 'APPROVED' 
          ? `Selamat! Permintaan bergabung ke workspace ${ws.name} telah disetujui.`
          : `Permintaan bergabung ke workspace ${ws.name} ditolak.${reasonText}`;
        
        await NotificationModel.create({
          workspaceId: joinReq.workspaceId,
          recipientId: targetUser._id,
          type: 'SYSTEM',
          title,
          message: msg,
          actionUrl: '/dashboard/profile',
          icon: action === 'APPROVED' ? 'check-circle' : 'x-circle',
          priority: 'HIGH',
          read: false,
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
        });
      }
    } catch (notifErr) {
      console.warn('[WORKSPACE_REQUEST] User notification failed:', notifErr);
    }

    res.json({
      success: true,
      message: action === 'APPROVED' ? 'Permintaan akses berhasil disetujui' : 'Permintaan akses berhasil ditolak',
      request: joinReq
    });
  } catch (err) {
    console.error('[SERVER ERROR] POST /api/workspaces/requests/:id/decide failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Backward compatibility legacy routes (/requests/:id/approve & /requests/:id/reject)
router.post('/requests/:id/approve', authMiddleware, roleGuard(['admin', 'superadmin']), (req, res, next) => {
  req.body.action = 'APPROVED';
  next();
}, router);

router.post('/requests/:id/reject', authMiddleware, roleGuard(['admin', 'superadmin']), (req, res, next) => {
  req.body.action = 'REJECTED';
  next();
}, router);

// ─── GET /api/workspaces/:id ──────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const wsId = Number(req.params.id);
    if (isNaN(wsId)) return res.status(400).json({ error: 'ID tidak valid' });

    const workspace = await WorkspaceModel.findOne({ id: wsId }, 'id name company code description address').lean().exec();
    if (!workspace) return res.status(404).json({ error: 'Workspace tidak ditemukan' });

    res.json({ success: true, workspace });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/workspaces/:id failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ─── POST /api/workspaces/select ─────────────────────────────────────────────
router.post('/select', authMiddleware, roleGuard(['user', 'operator', 'admin']), async (req, res) => {
  const { workspaceId } = req.body;
  if (!workspaceId) return res.status(400).json({ error: 'workspaceId wajib diisi' });

  try {
    const userId = req.userContext?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const user = await UserModel.findOne({ id: userId }).lean().exec();
    const wsIds: number[] = (user as any)?.workspaceIds || [];

    if (wsIds.length === 0 || !wsIds.includes(Number(workspaceId))) {
      return res.status(400).json({ error: 'Anda tidak memiliki akses ke workspace ini. Silakan ajukan permintaan bergabung.' });
    }

    await UserModel.updateOne({ id: userId }, { workspaceId: Number(workspaceId), status: 'APPROVED' });
    res.json({ success: true, workspaceId: Number(workspaceId) });
  } catch (err) {
    console.error('[SERVER ERROR] POST /api/workspaces/select failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ─── POST /api/workspaces/join ────────────────────────────────────────────────
router.post('/join', authMiddleware, roleGuard(['user', 'operator']), async (req, res) => {
  const { workspaceId } = req.body;
  if (!workspaceId) return res.status(400).json({ error: 'Workspace ID wajib diisi' });

  try {
    const userId = req.userContext?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const ws = await WorkspaceModel.findOne({ id: Number(workspaceId) });
    if (!ws) return res.status(404).json({ error: 'Workspace tidak ditemukan' });

    const currentUser = await getLoggedInUser(req);
    if ((currentUser as any)?.workspaceIds?.includes(ws.id)) {
      return res.json({ success: true, status: 'APPROVED', message: 'Anda sudah memiliki akses ke workspace ini' });
    }

    // Atomic Duplicate Check: Prevent duplicate PENDING request for same user + workspace
    const existingRequest = await JoinRequestModel.findOne({ userId, workspaceId: ws.id, status: 'PENDING' });
    if (existingRequest) {
      return res.status(400).json({ error: 'Anda sudah memiliki permintaan bergabung yang sedang menunggu keputusan.' });
    }

    const newRequest = await JoinRequestModel.create({
      userId,
      workspaceId: ws.id,
      status: 'PENDING'
    });

    res.status(201).json({ success: true, message: 'Permintaan bergabung berhasil dikirim', request: newRequest });
  } catch (err) {
    console.error('[SERVER ERROR] POST /api/workspaces/join failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ─── GET /api/workspaces/:id/statistics ──────────────────────────────────────
router.get('/:id/statistics', authMiddleware, roleGuard(['admin', 'superadmin']), async (req, res) => {
  try {
    const wsId = Number(req.params.id);
    if (isNaN(wsId)) return res.status(400).json({ error: 'ID tidak valid' });

    const requesterRole = req.userContext?.role;
    const requesterId = req.userContext?.id;

    if (requesterRole === 'admin') {
      const admin = await UserModel.findOne({ id: requesterId }).lean().exec();
      if (!admin || (admin as any).workspaceId !== wsId) {
        return res.status(403).json({ error: 'Akses ditolak' });
      }
    }

    const workspace = await WorkspaceModel.findOne({ id: wsId }).lean().exec();
    if (!workspace) return res.status(404).json({ error: 'Workspace tidak ditemukan' });

    const [adminCount, userCount, cctvCount, pendingCount] = await Promise.all([
      UserModel.countDocuments({ role: 'admin', workspaceId: wsId }),
      UserModel.countDocuments({ role: 'user', workspaceIds: wsId }),
      CctvModel.countDocuments({ workspaceId: wsId }),
      JoinRequestModel.countDocuments({ workspaceId: wsId, status: 'PENDING' }),
    ]);

    let reportCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    try {
      const { ReportModel } = require('../database/models/Report');
      [reportCount, approvedCount, rejectedCount] = await Promise.all([
        ReportModel.countDocuments({ workspaceId: wsId }),
        ReportModel.countDocuments({ workspaceId: wsId, adminStatus: 'VALID' }),
        ReportModel.countDocuments({ workspaceId: wsId, adminStatus: 'TIDAK_VALID' }),
      ]);
    } catch (_) {}

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
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/workspaces/:id/statistics failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
