import { Router } from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { WorkspaceModel } from '../database/models/Workspace';
import { WorkspaceRepository } from '../database/repositories/WorkspaceRepository';
import { UserModel } from '../database/models/User';
import { CctvModel } from '../database/models/Cctv';
import { UserRepository } from '../database/repositories/UserRepository';
import { authMiddleware } from '../auth/authMiddleware';
import { roleGuard } from '../auth/RoleMiddleware';
import { SystemAuditLogModel } from '../database/models/SystemAuditLog';

const router = Router();

function adminIdentifierQuery(identifier: string): Record<string, unknown> {
  const numericId = Number(identifier);
  if (Number.isInteger(numericId)) return { id: numericId };
  return { _id: identifier };
}

router.post('/logout', (req, res) => {
  res.clearCookie('session_token');
  res.json({ success: true });
});

router.get('/stats', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  try {
    const superadminId = req.userContext?.id;
    if (!superadminId) return res.status(401).json({ error: 'Unauthorized' });

    const workspaces = await WorkspaceModel.find({ superadminId }).lean().exec();
    const workspaceIds = workspaces.map(w => w.id);

    const totalAdmins = await UserModel.countDocuments({ role: 'admin', workspaceId: { $in: workspaceIds } });
    const totalWorkspaces = workspaces.length;
    const totalUsers = await UserModel.countDocuments({ role: 'user', workspaceIds: { $in: workspaceIds } });
    const totalCCTVs = await CctvModel.countDocuments({ workspaceId: { $in: workspaceIds } });

    res.json({
      success: true,
      stats: { totalAdmins, totalWorkspaces, totalUsers, totalCCTVs },
      data: { totalAdmins, totalWorkspaces, totalUsers, totalCCTVs }
    });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/superadmin/stats failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/admins', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  try {
    const superadminId = req.userContext?.id;
    if (!superadminId) return res.status(401).json({ error: 'Unauthorized' });

    const workspaces = await WorkspaceModel.find({ superadminId }).lean().exec();
    const workspaceIds = workspaces.map(w => w.id);

    const search = req.query.search ? String(req.query.search).trim() : '';
    let query: any = { role: 'admin', workspaceId: { $in: workspaceIds } };
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } }
      ];
    }

    const admins = await UserModel.find(query).sort({ createdAt: -1 }).lean().exec();
    const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    const enrichedAdmins = admins.map((admin) => {
      const workspace = workspaceById.get(admin.workspaceId || 0);
      return { ...admin, workspaceCode: workspace?.code || '', workspaceName: workspace?.name || '' };
    });
    res.json({ success: true, admins: enrichedAdmins, data: enrichedAdmins });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/superadmin/admins failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

function generateRandomPassword(length = 8): string {
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

async function generateAdminUsername(workspaceName: string): Promise<string> {
  const workspaceSlug = workspaceName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const prefix = `admin_${workspaceSlug}_`;
  
  const existingUsers = await UserModel.find({ username: { $regex: new RegExp('^' + prefix) } }).lean().exec();
  
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

router.post('/admins', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  const { name, workspaceId, workspaceCode } = req.body;
  if (!name) return res.status(400).json({ error: 'Nama Admin wajib diisi' });
  
  try {
    let workspaceName = 'default';
    let wId: number | undefined;
    let resolvedWorkspaceCode = '';

    if (workspaceId || workspaceCode) {
      const workspaceQuery = workspaceCode
        ? { code: String(workspaceCode).trim().toUpperCase(), superadminId: req.userContext?.id }
        : { id: Number(workspaceId), superadminId: req.userContext?.id };
      const workspace = await WorkspaceModel.findOne(workspaceQuery).lean().exec();
      if (workspace) {
        workspaceName = workspace.name;
        wId = workspace.id;
        resolvedWorkspaceCode = workspace.code;
        
        // Check 3 Admin Limit
        if (workspace.adminIds && workspace.adminIds.length >= 3) {
          return res.status(400).json({ error: 'Batas maksimal 3 Admin per Workspace telah tercapai' });
        }
      } else {
        return res.status(403).json({ error: 'Workspace tidak valid atau tidak diizinkan' });
      }
    }

    const username = await generateAdminUsername(workspaceName);
    const passwordPlain = generateRandomPassword(8);

    const newUser = await UserRepository.create(username, passwordPlain, 'admin', 'APPROVED');
    if (!newUser) return res.status(400).json({ error: 'Username admin sudah digunakan' });

    await UserModel.updateOne({ id: newUser.id }, { name: name.trim(), workspaceId: wId });

    if (wId) {
      await WorkspaceModel.updateOne({ id: wId }, { $push: { adminIds: newUser.id } });
    }

    await SystemAuditLogModel.create({
      tenantId: wId ? String(wId) : 'system',
      actorId: req.userContext?.id ? (await UserModel.findOne({ id: req.userContext.id }))?._id : null,
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
  } catch (err) {
    console.error('[SERVER ERROR] POST /api/superadmin/admins failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.put('/admins/:id', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  const adminQuery = adminIdentifierQuery(req.params.id);
  const { name, workspaceId } = req.body;
  
  try {
    const admin = await UserModel.findOne({ ...adminQuery, role: 'admin' });
    if (!admin) return res.status(404).json({ error: 'Admin tidak ditemukan' });
    
    if (name) admin.name = name.trim();
    
    const oldWorkspaceId = admin.workspaceId;
    const superadminId = req.userContext?.id;
    
    if (workspaceId !== undefined) {
      const workspace = await WorkspaceModel.findOne({ id: Number(workspaceId), superadminId }).lean().exec();
      if (!workspace) return res.status(403).json({ error: 'Workspace tidak valid atau tidak diizinkan' });
      
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
        await WorkspaceModel.updateOne({ id: oldWorkspaceId }, { $pull: { adminIds: admin.id } });
      }
      if (workspaceId) {
        await WorkspaceModel.updateOne({ id: Number(workspaceId) }, { $push: { adminIds: admin.id } });
      }
    }

    res.json({ success: true, message: 'Admin berhasil diperbarui', admin });
  } catch (err) {
    console.error('[SERVER ERROR] PUT /api/superadmin/admins failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/admins/:id/reset-password', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  try {
    const adminQuery = adminIdentifierQuery(req.params.id);
    const superadminId = req.userContext?.id;
    const workspaces = await WorkspaceModel.find({ superadminId }).lean().exec();
    const workspaceIds = workspaces.map(w => w.id);
    
    const admin = await UserModel.findOne({ ...adminQuery, role: 'admin', workspaceId: { $in: workspaceIds } });
    if (!admin) return res.status(404).json({ error: 'Admin tidak ditemukan atau tidak diizinkan' });
    
    const passwordPlain = generateRandomPassword(8);
    admin.passwordHash = await bcrypt.hash(passwordPlain, 10);
    await admin.save();

    await SystemAuditLogModel.create({
      tenantId: admin.workspaceId ? String(admin.workspaceId) : 'system',
      actorId: req.userContext?.id ? (await UserModel.findOne({ id: req.userContext.id }))?._id : null,
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
  } catch (err) {
    console.error('[SERVER ERROR] Reset admin password failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.delete('/admins/:id', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  try {
    const adminQuery = adminIdentifierQuery(req.params.id);
    const superadminId = req.userContext?.id;
    const workspaces = await WorkspaceModel.find({ superadminId }).lean().exec();
    const workspaceIds = workspaces.map(w => w.id);

    const deleted = await UserModel.findOneAndDelete({ ...adminQuery, role: 'admin', workspaceId: { $in: workspaceIds } });
    if (!deleted) return res.status(404).json({ error: 'Admin tidak ditemukan atau tidak diizinkan' });
    
    await WorkspaceModel.updateMany({ adminIds: deleted.id }, { $pull: { adminIds: deleted.id } });

    await SystemAuditLogModel.create({
      tenantId: deleted.workspaceId ? String(deleted.workspaceId) : 'system',
      actorId: req.userContext?.id ? (await UserModel.findOne({ id: req.userContext.id }))?._id : null,
      actorName: req.userContext?.username || 'Unknown',
      action: 'Delete Admin',
      ipAddress: req.ip || req.socket.remoteAddress || 'Unknown IP',
      userAgent: req.headers['user-agent'] || 'Unknown Device',
      details: { adminUsername: deleted.username }
    });

    res.json({ success: true, message: 'Admin berhasil dihapus' });
  } catch (err) {
    console.error('[SERVER ERROR] DELETE /api/superadmin/admins failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// WORKSPACES API

router.get('/workspaces', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  try {
    const superadminId = req.userContext?.id;
    if (!superadminId) return res.status(401).json({ error: 'Unauthorized' });
    
    const search = req.query.search ? String(req.query.search).trim() : '';
    let query: any = { superadminId };
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } }
      ];
    }

    const workspaces = await WorkspaceModel.find(query).sort({ createdAt: -1 }).lean().exec();
    res.json({ success: true, workspaces, data: workspaces });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/superadmin/workspaces failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/workspaces', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  const { name, company, address, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Nama workspace wajib diisi' });
  
  try {
    const newWorkspace = await WorkspaceRepository.create({
      name: name.trim(),
      company: (company || '').trim(),
      address: (address || '').trim(),
      description: (description || '').trim(),
      superadminId: req.userContext?.id
    });
    
    const nextId = newWorkspace.id;

    const workspaceSlug = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
    let adminUsername = `admin_${workspaceSlug}`;

    const usernameExists = await UserRepository.findByUsername(adminUsername);
    if (usernameExists) {
      let seq = 2;
      while (await UserRepository.findByUsername(`admin_${workspaceSlug}_${String(seq).padStart(3, '0')}`)) {
        seq++;
      }
      adminUsername = `admin_${workspaceSlug}_${String(seq).padStart(3, '0')}`;
    }

    const adminPasswordPlain = generateRandomPassword(8);

    const newAdmin = await UserRepository.create(adminUsername, adminPasswordPlain, 'admin', 'APPROVED', {
      name: `Admin ${name.trim()}`,
      workspaceId: nextId
    });

    if (newAdmin) {
      await WorkspaceModel.updateOne({ id: nextId }, { $push: { adminIds: newAdmin.id } });
    }

    await SystemAuditLogModel.create({
      tenantId: String(newWorkspace.id),
      actorId: req.userContext?.id ? (await UserModel.findOne({ id: req.userContext.id }))?._id : null,
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
      adminPasswordPlain
      ,
      data: {
        code: newWorkspace.code,
        workspace: newWorkspace,
        adminUsername: newAdmin?.username,
        adminPasswordPlain
      }
    });
  } catch (err) {
    console.error('[SERVER ERROR] POST /api/superadmin/workspaces failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.put('/workspaces/:id', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  const workspaceId = parseInt(req.params.id);
  if (isNaN(workspaceId)) return res.status(400).json({ error: 'ID tidak valid' });
  const { name, company, address, description } = req.body;
  
  try {
    const superadminId = req.userContext?.id;
    const workspace = await WorkspaceModel.findOne({ id: workspaceId, superadminId });
    if (!workspace) return res.status(404).json({ error: 'Workspace tidak ditemukan atau tidak diizinkan' });

    if (name) workspace.name = name.trim();
    if (company !== undefined) workspace.company = (company || '').trim();
    if (address !== undefined) workspace.address = (address || '').trim();
    if (description !== undefined) workspace.description = (description || '').trim();

    await workspace.save();

    res.json({ success: true, message: 'Workspace berhasil diperbarui', workspace });
  } catch (err) {
    console.error('[SERVER ERROR] PUT /api/superadmin/workspaces failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.delete('/workspaces/:id', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  const workspaceId = parseInt(req.params.id);
  if (isNaN(workspaceId)) return res.status(400).json({ error: 'ID tidak valid' });
  
  try {
    const superadminId = req.userContext?.id;
    const deleted = await WorkspaceModel.findOneAndDelete({ id: workspaceId, superadminId });
    if (!deleted) return res.status(404).json({ error: 'Workspace tidak ditemukan atau tidak diizinkan' });
    
    await UserModel.updateMany({ workspaceId }, { $unset: { workspaceId: 1 }, $pull: { workspaceIds: workspaceId } });

    await SystemAuditLogModel.create({
      tenantId: String(workspaceId),
      actorId: req.userContext?.id ? (await UserModel.findOne({ id: req.userContext.id }))?._id : null,
      actorName: req.userContext?.username || 'Unknown',
      action: 'Delete Workspace',
      ipAddress: req.ip || req.socket.remoteAddress || 'Unknown IP',
      userAgent: req.headers['user-agent'] || 'Unknown Device',
      details: { workspaceName: deleted.name, workspaceCode: deleted.code }
    });

    res.json({ success: true, message: 'Workspace berhasil dihapus' });
  } catch (err) {
    console.error('[SERVER ERROR] DELETE /api/superadmin/workspaces failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Get Workspace Details
router.get('/workspaces/:id/detail', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  try {
    const workspaceId = Number(req.params.id);
    const superadminId = req.userContext?.id;
    if (!superadminId) return res.status(401).json({ error: 'Unauthorized' });

    const workspace = await WorkspaceModel.findOne({ id: workspaceId, superadminId }).lean().exec();
    if (!workspace) return res.status(404).json({ error: 'Workspace tidak ditemukan' });

    const admins = await UserModel.find({ workspaceId, role: 'admin' })
      .select('id name username email phone status createdAt')
      .lean()
      .exec();

    // Get Cctv count (optional, if Cctv model is present. Assuming it might be added later, skip for now or stub it)
    // For now we'll just return admins
    res.json({
      success: true,
      workspace,
      admins,
      stats: {
        totalAdmins: admins.length
      }
    });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/superadmin/workspaces/:id/detail failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
