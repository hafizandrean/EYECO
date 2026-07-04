import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import { DatabaseManager, Report, BoundingBox, User, connectDB, WorkspaceModel } from './database/db';
import { ReportModel } from './database/models/Report';
import { UserModel } from './database/models/User';
import { CctvModel } from './database/models/Cctv';
import { CctvHealthEngine } from './cctv/CctvHealthEngine';
import { CctvScanner } from './cctv/CctvScanner';
import { CctvAdapter } from './cctv/CctvAdapter';
import { CctvRepository } from './database/repositories/CctvRepository';
import { UserRepository } from './database/repositories/UserRepository';
import { ReportRepository } from './database/repositories/ReportRepository';
import { generateToken, verifyToken } from './auth/auth.service';
import { authMiddleware, roleGuard } from './auth/authMiddleware';

declare global {
  namespace Express {
    interface Request {
      userContext?: {
        id: number;
        username: string;
        role: string;
      };
    }
  }
}

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Rate limiting for Auth endpoints to mitigate brute force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs
  message: { error: 'Terlalu banyak percobaan masuk/daftar, silakan coba lagi nanti.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Setup middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Global middleware to populate req.userContext
app.use((req, res, next) => {
  let token = '';

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    token = req.cookies?.session_token || '';
  }

  if (token) {
    const payload = verifyToken(token);
    if (payload) {
      req.userContext = payload;
    }
  }
  next();
});

// Serve static CSS and JS files directly
app.use('/css', express.static(path.join(__dirname, '../public/css')));
app.use('/js', express.static(path.join(__dirname, '../public/js')));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `upload_${uniqueSuffix}${ext}`);
  },
});

const upload = multer({ storage });

// --- SESSION HELPER ---
async function getLoggedInUser(req: express.Request): Promise<User | null> {
  if (req.userContext) {
    try {
      return (await UserRepository.findByLegacyId(req.userContext.id)) || null;
    } catch (err) {
      console.error('[SERVER ERROR] Failed to fetch session user:', err);
      return null;
    }
  }
  return null;
}

// --- HEALTH CHECK ENDPOINT ---
app.get('/health', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  res.status(isConnected ? 200 : 503).json({
    status: isConnected ? 'UP' : 'DOWN',
    database: isConnected ? 'connected' : 'disconnected'
  });
});

// Helper to get redirect path based on role
function getRedirectPath(role: string): string {
  if (role === 'superadmin') return '/superadmin';
  if (role === 'admin') return '/dashboard';
  return '/dashboard-user';
}

// --- AUTH API ENDPOINTS ---

// Register API
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, confirmPassword } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nama lengkap wajib diisi' });
  }

  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Email wajib diisi' });
  }

  // Basic email format check
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return res.status(400).json({ error: 'Format email tidak valid' });
  }

  if (!password) {
    return res.status(400).json({ error: 'Password wajib diisi' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password minimal 6 karakter' });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Konfirmasi password tidak cocok' });
  }

  try {
    // Generate username from email (ambil bagian sebelum @)
    const baseUsername = email.trim().split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
    let username = baseUsername;
    // Pastikan username unik
    let counter = 1;
    while (await UserRepository.findByUsername(username)) {
      username = `${baseUsername}${counter}`;
      counter++;
    }

    const newUser = await UserRepository.create(username, password, 'user', 'APPROVED', {
      name: name.trim(),
      email: email.trim().toLowerCase()
    });

    if (!newUser) {
      return res.status(400).json({ error: 'Gagal membuat akun, coba lagi' });
    }

    res.status(201).json({
      id: newUser.id,
      username: newUser.username,
      role: newUser.role,
      status: newUser.status,
      message: 'Akun berhasil dibuat.'
    });
  } catch (err) {
    console.error('[SERVER ERROR] Registration failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Login API
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password harus diisi' });
  }

  try {
    const user = await UserRepository.findByUsernameWithPassword(username);
    if (!user) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }

    const isBcrypt = user.passwordHash.startsWith('$2');
    let match = false;
    if (isBcrypt) {
      match = await bcrypt.compare(password, user.passwordHash);
    } else {
      // Legacy SHA-256 fallback for migrated passwords
      const sha256Hash = crypto.createHash('sha256').update(password).digest('hex');
      match = (sha256Hash === user.passwordHash);
    }

    if (!match) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }

    // --- Status-based access control ---
    if (user.status === 'PENDING') {
      return res.status(403).json({
        error: 'Akun Anda sedang menunggu persetujuan.',
        statusCode: 'PENDING'
      });
    }
    if (user.status === 'REJECTED') {
      return res.status(403).json({
        error: 'Akun Anda telah ditolak. Hubungi administrator.',
        statusCode: 'REJECTED'
      });
    }

    // Generate JWT stateless token
    const token = generateToken({ id: user.id, username: user.username, role: user.role });

    // Set HttpOnly Cookie
    res.cookie('session_token', token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    });
    res.json({ id: user.id, username: user.username, role: user.role, status: user.status });
  } catch (err) {
    console.error('[SERVER ERROR] Login failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Logout API
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('session_token');
  res.json({ success: true });
});

// GET Logout (Redirect to login)
app.get('/logout', (req, res) => {
  res.clearCookie('session_token');
  res.redirect('/login');
});

// Get Current User API
app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Belum masuk' });
    }
    res.json({ id: user.id, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// --- SUPER ADMIN MANAGEMENT API ---

// GET stats for ringkas dashboard
app.get('/api/superadmin/stats', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  try {
    const totalAdmins = await UserModel.countDocuments({ role: 'admin' });
    const totalWorkspaces = await WorkspaceModel.countDocuments({});
    const totalUsers = await UserModel.countDocuments({ role: 'user' });
    const totalCCTVs = await CctvModel.countDocuments({});
    res.json({
      success: true,
      stats: {
        totalAdmins,
        totalWorkspaces,
        totalUsers,
        totalCCTVs
      }
    });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/superadmin/stats failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET admins
app.get('/api/superadmin/admins', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  try {
    const admins = await UserModel.find({ role: 'admin' }).sort({ createdAt: -1 }).lean().exec();
    res.json({ success: true, admins });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/superadmin/admins failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Helper functions for admin credentials generation
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
  
  const existingUsers = await UserModel.find({
    username: { $regex: new RegExp('^' + prefix) }
  }).lean().exec();
  
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

// CREATE admin
app.post('/api/superadmin/admins', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  const { name, workspaceId } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Nama Admin wajib diisi' });
  }
  try {
    let workspaceName = 'default';
    let wId: number | undefined;

    if (workspaceId) {
      const workspace = await WorkspaceModel.findOne({ id: Number(workspaceId) }).lean().exec();
      if (workspace) {
        workspaceName = workspace.name;
        wId = workspace.id;
      }
    }

    const username = await generateAdminUsername(workspaceName);
    const passwordPlain = generateRandomPassword(8);

    const newUser = await UserRepository.create(username, passwordPlain, 'admin', 'APPROVED');
    if (!newUser) {
      return res.status(400).json({ error: 'Username admin sudah digunakan' });
    }

    await UserModel.updateOne({ id: newUser.id }, { name: name.trim(), workspaceId: wId });

    if (wId) {
      await WorkspaceModel.updateOne({ id: wId }, { adminId: newUser.id });
    }

    res.status(201).json({
      success: true,
      admin: {
        id: newUser.id,
        username,
        role: newUser.role,
        status: newUser.status,
        name: name.trim(),
        workspaceId: wId
      },
      passwordPlain
    });
  } catch (err) {
    console.error('[SERVER ERROR] POST /api/superadmin/admins failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// EDIT admin
app.put('/api/superadmin/admins/:id', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  const adminId = parseInt(req.params.id);
  if (isNaN(adminId)) return res.status(400).json({ error: 'ID tidak valid' });
  const { name, workspaceId } = req.body;
  try {
    const admin = await UserModel.findOne({ id: adminId, role: 'admin' });
    if (!admin) {
      return res.status(404).json({ error: 'Admin tidak ditemukan' });
    }
    if (name) {
      admin.name = name.trim();
    }
    
    const oldWorkspaceId = admin.workspaceId;
    if (workspaceId !== undefined) {
      admin.workspaceId = workspaceId ? Number(workspaceId) : undefined;
    }
    
    await admin.save();

    // Sync Workspace relations
    if (workspaceId !== undefined) {
      if (oldWorkspaceId && oldWorkspaceId !== workspaceId) {
        await WorkspaceModel.updateOne({ id: oldWorkspaceId }, { $unset: { adminId: 1 } });
      }
      if (workspaceId) {
        await WorkspaceModel.updateOne({ id: Number(workspaceId) }, { adminId: adminId });
      }
    }

    res.json({ success: true, message: 'Admin berhasil diperbarui', admin });
  } catch (err) {
    console.error('[SERVER ERROR] PUT /api/superadmin/admins failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// RESET admin password
app.post('/api/superadmin/admins/:id/reset-password', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  const adminId = parseInt(req.params.id);
  if (isNaN(adminId)) return res.status(400).json({ error: 'ID tidak valid' });
  try {
    const admin = await UserModel.findOne({ id: adminId, role: 'admin' });
    if (!admin) {
      return res.status(404).json({ error: 'Admin tidak ditemukan' });
    }
    const passwordPlain = generateRandomPassword(8);
    admin.passwordHash = await bcrypt.hash(passwordPlain, 10);
    await admin.save();

    res.json({
      success: true,
      message: 'Password admin berhasil direset',
      passwordPlain
    });
  } catch (err) {
    console.error('[SERVER ERROR] Reset admin password failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE admin
app.delete('/api/superadmin/admins/:id', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  const adminId = parseInt(req.params.id);
  if (isNaN(adminId)) return res.status(400).json({ error: 'ID tidak valid' });
  try {
    const deleted = await UserModel.findOneAndDelete({ id: adminId, role: 'admin' });
    if (!deleted) {
      return res.status(404).json({ error: 'Admin tidak ditemukan' });
    }
    // Clean up workspace association
    await WorkspaceModel.updateOne({ adminId }, { $unset: { adminId: 1 } });
    res.json({ success: true, message: 'Admin berhasil dihapus' });
  } catch (err) {
    console.error('[SERVER ERROR] DELETE /api/superadmin/admins failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- WORKSPACE MANAGEMENT API ---

// GET workspaces
app.get('/api/superadmin/workspaces', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  try {
    const workspaces = await WorkspaceModel.find({}).sort({ createdAt: -1 }).lean().exec();
    res.json({ success: true, workspaces });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/superadmin/workspaces failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// CREATE workspace + auto-generate admin
app.post('/api/superadmin/workspaces', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  const { name, company, address, description } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Nama workspace wajib diisi' });
  }
  try {
    const lastWorkspace = await WorkspaceModel.findOne().sort({ id: -1 }).exec();
    let nextId = 1;
    if (lastWorkspace && typeof lastWorkspace.id === 'number' && !isNaN(lastWorkspace.id)) {
      nextId = lastWorkspace.id + 1;
    } else if (lastWorkspace && lastWorkspace.id) {
      nextId = parseInt(lastWorkspace.id as any) + 1 || 1;
    }

    const newWorkspace = await WorkspaceModel.create({
      id: nextId,
      name: name.trim(),
      company: (company || '').trim(),
      address: (address || '').trim(),
      description: (description || '').trim()
    });

    // Auto-generate admin untuk workspace baru
    const workspaceSlug = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
    let adminUsername = `admin_${workspaceSlug}`;

    // Pastikan username unik
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
      await WorkspaceModel.updateOne({ id: nextId }, { adminId: newAdmin.id });
    }

    res.status(201).json({
      success: true,
      workspace: newWorkspace,
      admin: newAdmin ? {
        id: newAdmin.id,
        username: newAdmin.username,
        role: newAdmin.role
      } : null,
      adminPasswordPlain: adminPasswordPlain
    });
  } catch (err) {
    console.error('[SERVER ERROR] POST /api/superadmin/workspaces failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// EDIT workspace
app.put('/api/superadmin/workspaces/:id', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  const workspaceId = parseInt(req.params.id);
  if (isNaN(workspaceId)) return res.status(400).json({ error: 'ID tidak valid' });
  const { name, company, address, description, adminId } = req.body;
  try {
    const workspace = await WorkspaceModel.findOne({ id: workspaceId });
    if (!workspace) {
      return res.status(404).json({ error: 'Workspace tidak ditemukan' });
    }

    const oldAdminId = workspace.adminId;

    if (name) workspace.name = name.trim();
    if (company !== undefined) workspace.company = (company || '').trim();
    if (address !== undefined) workspace.address = (address || '').trim();
    if (description !== undefined) workspace.description = (description || '').trim();
    workspace.adminId = adminId ? Number(adminId) : undefined;

    await workspace.save();

    if (oldAdminId && oldAdminId !== adminId) {
      await UserModel.updateOne({ id: oldAdminId }, { $unset: { workspaceId: 1 } });
    }

    if (adminId) {
      await UserModel.updateOne({ id: Number(adminId) }, { workspaceId: workspaceId });
    }

    res.json({ success: true, message: 'Workspace berhasil diperbarui', workspace });
  } catch (err) {
    console.error('[SERVER ERROR] PUT /api/superadmin/workspaces failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// DELETE workspace
app.delete('/api/superadmin/workspaces/:id', authMiddleware, roleGuard(['superadmin']), async (req, res) => {
  const workspaceId = parseInt(req.params.id);
  if (isNaN(workspaceId)) return res.status(400).json({ error: 'ID tidak valid' });
  try {
    const deleted = await WorkspaceModel.findOneAndDelete({ id: workspaceId });
    if (!deleted) {
      return res.status(404).json({ error: 'Workspace tidak ditemukan' });
    }
    await UserModel.updateMany({ workspaceId }, { $unset: { workspaceId: 1 } });
    res.json({ success: true, message: 'Workspace berhasil dihapus' });
  } catch (err) {
    console.error('[SERVER ERROR] DELETE /api/superadmin/workspaces failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// --- VIEW ROUTING & GUARDS ---

app.get('/login', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (user) {
      return res.redirect(getRedirectPath(user.role));
    }
    res.sendFile(path.join(__dirname, '../public/views/login.html'));
  } catch (err) {
    res.redirect('/login');
  }
});

app.get('/register', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (user) {
      return res.redirect(getRedirectPath(user.role));
    }
    res.sendFile(path.join(__dirname, '../public/views/register.html'));
  } catch (err) {
    res.redirect('/login');
  }
});

app.get('/', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.redirect('/login');
    res.redirect(getRedirectPath(user.role));
  } catch (err) {
    res.redirect('/login');
  }
});

// Super Admin Pages
app.get(['/superadmin', '/superadmin/dashboard', '/superadmin/admins', '/superadmin/workspaces'], authMiddleware, roleGuard(['superadmin']), (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/superadmin.html'));
});

// Dashboard Pages — hanya untuk role 'admin'
app.get(['/dashboard', '/dashboard/laporan', '/dashboard/upload', '/dashboard/users', '/dashboard/detections/:id'], authMiddleware, roleGuard(['admin']), (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/dashboard.html'));
});

// Dashboard User Pages — hanya untuk role 'user'
app.get('/dashboard-user', authMiddleware, roleGuard(['user']), (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/dashboard-user.html'));
});


// --- ADMIN USER MANAGEMENT API ---

// GET /admin/users - List all users (admin only)
app.get('/admin/users', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });

    const users = await UserRepository.getAllUsers();
    const safeUsers = users.map(u => ({
      id: u.id,
      username: u.username,
      role: u.role,
      status: u.status,
      createdAt: (u as any).createdAt
    }));
    res.json({ users: safeUsers });
  } catch (err) {
    console.error('[SERVER ERROR] GET /admin/users failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PATCH /admin/users/:id/approve - Approve a user (admin only)
app.patch('/admin/users/:id/approve', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });

    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) return res.status(400).json({ error: 'ID tidak valid' });

    const updated = await UserRepository.updateStatus(targetId, 'APPROVED');
    if (!updated) return res.status(404).json({ error: 'User tidak ditemukan' });

    res.json({ success: true, message: `User ${updated.username} berhasil disetujui.`, user: { id: updated.id, username: updated.username, status: updated.status } });
  } catch (err) {
    console.error('[SERVER ERROR] PATCH /admin/users/:id/approve failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// PATCH /admin/users/:id/reject - Reject a user (admin only)
app.patch('/admin/users/:id/reject', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.status(401).json({ error: 'Belum masuk' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });

    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) return res.status(400).json({ error: 'ID tidak valid' });

    const updated = await UserRepository.updateStatus(targetId, 'REJECTED');
    if (!updated) return res.status(404).json({ error: 'User tidak ditemukan' });

    res.json({ success: true, message: `User ${updated.username} berhasil ditolak.`, user: { id: updated.id, username: updated.username, status: updated.status } });
  } catch (err) {
    console.error('[SERVER ERROR] PATCH /admin/users/:id/reject failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// --- SECURE DATA API ENDPOINTS ---

// API: Get Filtered & Paginated Reports (Database-Level pagination optimized)
app.get('/api/detections', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 5;

    const filters = {
      timeRange: req.query.timeRange as string,
      date: req.query.date as string,
      aiStatus: req.query.aiStatus as string,
      adminStatus: req.query.adminStatus as string,
      location: req.query.location as string,
    };

    const userContext = { id: user.id, role: user.role };
    
    // Call database-level paginated query
    const result = await ReportRepository.getFiltered(filters, userContext, page, limit);

    if (result && 'reports' in result) {
      const { reports: paginatedReports, total: totalReports } = result;
      const totalPages = Math.ceil(totalReports / limit) || 1;

      res.json({
        reports: paginatedReports,
        pagination: {
          page,
          limit,
          totalReports,
          totalPages,
          hasPrev: page > 1,
          hasNext: page < totalPages,
        },
      });
    } else {
      res.status(500).json({ error: 'Gagal memproses data laporan' });
    }
  } catch (err) {
    console.error('[SERVER ERROR] Get reports list failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API: Get Single Report by ID
app.get('/api/detections/:id', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const id = parseInt(req.params.id);
    const report = await ReportRepository.findByLegacyId(id);

    if (!report) {
      return res.status(404).json({ error: 'Laporan tidak ditemukan' });
    }

    res.json(report);
  } catch (err) {
    console.error('[SERVER ERROR] Get single report failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API: Update Admin Verification Status
app.post('/api/detections/:id/verify', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Hanya Admin yang dapat memvalidasi laporan' });
    }

    const id = parseInt(req.params.id);
    const { status, notes, assignedOfficer, progressStatus } = req.body;

    if (!status || !['VALID', 'DIABAIKAN', 'MENUNGGU'].includes(status)) {
      return res.status(400).json({ error: 'Status tidak valid' });
    }

    const updatedReport = await ReportRepository.updateVerification(
      id, 
      status, 
      notes || '', 
      assignedOfficer, 
      progressStatus
    );
    if (!updatedReport) {
      return res.status(404).json({ error: 'Laporan tidak ditemukan' });
    }

    res.json(updatedReport);
  } catch (err) {
    console.error('[SERVER ERROR] Verify report failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Helper functions for standard API responses
function sendSuccess(res: express.Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}

function sendError(res: express.Response, message: string, status = 400) {
  return res.status(status).json({ success: false, message });
}

// Rate limiters for commenting and liking
const commentLimiter = rateLimit({
  windowMs: 30 * 1000, // 30 seconds
  max: 5, // Limit each IP to 5 comments per windowMs
  message: { success: false, message: 'Terlalu banyak mengirim komentar, silakan tunggu 30 detik.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const likeLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // Limit each IP to 30 likes per windowMs
  message: { success: false, message: 'Terlalu banyak menekan tombol suka, silakan tunggu 1 menit.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/detections/:id/comments - Fetch paginated, sorted comments with resolved usernames
app.get('/api/detections/:id/comments', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return sendError(res, 'Unauthorized', 401);
    }

    const reportId = parseInt(req.params.id);
    const report = await ReportModel.findOne({ id: reportId }).lean();
    if (!report) {
      return sendError(res, 'Laporan tidak ditemukan', 404);
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const sortBy = (req.query.sortBy as string) || 'newest';

    // Filter out deleted comments
    let activeComments = (report.comments || []).filter(c => !c.isDeleted);

    // Sort comments
    if (sortBy === 'newest') {
      activeComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sortBy === 'oldest') {
      activeComments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else if (sortBy === 'most_liked') {
      activeComments.sort((a, b) => (b.likedBy || []).length - (a.likedBy || []).length);
    }

    // Paginate in memory
    const total = activeComments.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;
    const paginatedComments = activeComments.slice(skip, skip + limit);

    // Resolve usernames in a single query (avoid N+1)
    const uniqueUserIds = Array.from(new Set(paginatedComments.map(c => c.userId)));
    const users = await UserModel.find({ id: { $in: uniqueUserIds } }).select('id username role').lean();
    const userMap = new Map(users.map(u => [u.id, { username: u.username, role: u.role }]));

    const commentsWithUser = paginatedComments.map(c => {
      const uInfo = userMap.get(c.userId);
      return {
        ...c,
        username: uInfo ? uInfo.username : 'Pengguna tidak dikenal',
        role: uInfo ? uInfo.role : 'user'
      };
    });

    return sendSuccess(res, {
      comments: commentsWithUser,
      pagination: {
        page,
        limit,
        totalComments: total,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages
      }
    });
  } catch (err) {
    console.error('[SERVER ERROR] Get comments failed:', err);
    return sendError(res, 'Internal Server Error', 500);
  }
});

// POST /api/detections/:id/comments - Add a comment (rate-limited)
app.post('/api/detections/:id/comments', commentLimiter, async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return sendError(res, 'Unauthorized', 401);
    }

    const reportId = parseInt(req.params.id);
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return sendError(res, 'Konten komentar harus diisi.', 400);
    }

    const comment = await ReportRepository.addComment(reportId, user.id, text);
    
    // Resolve comment author details for direct frontend integration
    return sendSuccess(res, {
      ...comment,
      username: user.username,
      role: user.role
    }, 201);
  } catch (err: any) {
    console.error('[SERVER ERROR] Create comment failed:', err);
    return sendError(res, err.message || 'Internal Server Error', 500);
  }
});

// DELETE /api/detections/:id/comments/:commentId - Delete a comment (soft delete)
app.delete('/api/detections/:id/comments/:commentId', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return sendError(res, 'Unauthorized', 401);
    }

    const reportId = parseInt(req.params.id);
    const commentId = req.params.commentId;
    const isAdmin = user.role === 'admin';

    // soft delete comment
    await ReportRepository.deleteComment(reportId, commentId, user.id, isAdmin);
    return sendSuccess(res, { success: true });
  } catch (err: any) {
    console.error('[SERVER ERROR] Delete comment failed:', err);
    return sendError(res, err.message || 'Internal Server Error', 500);
  }
});

// POST /api/detections/:id/comments/:commentId/like - Toggle like on a comment (rate-limited)
app.post('/api/detections/:id/comments/:commentId/like', likeLimiter, async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return sendError(res, 'Unauthorized', 401);
    }

    const reportId = parseInt(req.params.id);
    const commentId = req.params.commentId;

    const comment = await ReportRepository.toggleLikeComment(reportId, commentId, user.id);
    const isLiked = comment.likedBy.includes(user.id);

    return sendSuccess(res, {
      commentId,
      likedBy: comment.likedBy,
      likeCount: comment.likedBy.length,
      isLiked
    });
  } catch (err: any) {
    console.error('[SERVER ERROR] Like comment failed:', err);
    return sendError(res, err.message || 'Internal Server Error', 500);
  }
});

// API: Get Stats & Charts data (Aggregation Pipeline optimized)
app.get('/api/stats', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userContext = { id: user.id, role: user.role };
    const stats = await ReportRepository.getStats(userContext);
    res.json(stats);
  } catch (err) {
    console.error('[SERVER ERROR] Get stats failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Helper: Run simulated AI YOLO detector on uploaded images
function runSimulatedAI(location: string, notes: string): {
  status: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi';
  confidence: number | null;
  boxes: BoundingBox[];
} {
  const boxes: BoundingBox[] = [];
  const notesLower = notes.toLowerCase();
  
  let hasPerson = Math.random() > 0.3;
  let hasTrash = Math.random() > 0.6;
  let hasBoat = Math.random() > 0.8;
  
  if (notesLower.includes('orang') || notesLower.includes('warga') || notesLower.includes('mancing')) {
    hasPerson = true;
  }
  if (notesLower.includes('sampah') || notesLower.includes('buang') || notesLower.includes('limbah')) {
    hasTrash = true;
  }
  if (notesLower.includes('perahu') || notesLower.includes('kapal') || notesLower.includes('boat')) {
    hasBoat = true;
  }

  if (hasPerson) {
    boxes.push({
      label: 'person',
      confidence: parseFloat((0.75 + Math.random() * 0.23).toFixed(2)),
      x: parseFloat((15 + Math.random() * 40).toFixed(1)),
      y: parseFloat((30 + Math.random() * 30).toFixed(1)),
      w: parseFloat((12 + Math.random() * 15).toFixed(1)),
      h: parseFloat((40 + Math.random() * 25).toFixed(1)),
    });
  }

  if (hasTrash) {
    boxes.push({
      label: 'trash',
      confidence: parseFloat((0.65 + Math.random() * 0.3).toFixed(2)),
      x: parseFloat((30 + Math.random() * 40).toFixed(1)),
      y: parseFloat((60 + Math.random() * 20).toFixed(1)),
      w: parseFloat((15 + Math.random() * 20).toFixed(1)),
      h: parseFloat((15 + Math.random() * 15).toFixed(1)),
    });
  }

  if (hasBoat) {
    boxes.push({
      label: 'boat',
      confidence: parseFloat((0.8 + Math.random() * 0.18).toFixed(2)),
      x: parseFloat((10 + Math.random() * 30).toFixed(1)),
      y: parseFloat((40 + Math.random() * 15).toFixed(1)),
      w: parseFloat((35 + Math.random() * 25).toFixed(1)),
      h: parseFloat((20 + Math.random() * 10).toFixed(1)),
    });
  }

  let status: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi' = 'Tidak Terindikasi';
  let confidence: number | null = null;

  if (hasTrash || (hasPerson && hasBoat) || notesLower.includes('mencurigakan') || notesLower.includes('tebang')) {
    status = 'TINGGI';
    confidence = Math.round(75 + Math.random() * 23);
  } else if (hasPerson) {
    status = 'RENDAH';
    confidence = Math.round(40 + Math.random() * 30);
  } else if (hasBoat) {
    status = 'Tidak Terindikasi';
  } else if (boxes.length > 0) {
    status = 'SEDANG';
    confidence = Math.round(60 + Math.random() * 15);
  }

  return { status, confidence, boxes };
}

// API: Create new report (upload)
app.post('/api/detections', upload.single('file'), async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'File media wajib diupload' });
    }

    const { location, identity, sourceType, additionalNotes } = req.body;

    // Run AI processing simulation
    const aiResults = runSimulatedAI(location || '', additionalNotes || '');

    // Create report entry linked to user.id
    const newReport = await ReportRepository.create({
      location: location || 'Lokasi tidak diketahui',
      aiStatus: aiResults.status,
      aiConfidence: aiResults.confidence,
      image: `/uploads/${req.file.filename}`,
      identity: identity || 'Belum diketahui',
      sourceType: sourceType || 'Gambar',
      additionalNotes: additionalNotes || 'Tidak ada catatan tambahan.',
      boundingBoxes: aiResults.boxes,
    }, user.id);

    // Also copy this uploaded file as the last capture image for the dashboard
    try {
      const uploadDir = path.join(__dirname, '../public/uploads');
      const sourcePath = path.join(uploadDir, req.file.filename);
      const destPath = path.join(uploadDir, 'last_capture.jpg');
      fs.copyFileSync(sourcePath, destPath);
    } catch (err) {
      console.error('[SERVER ERROR] Error copying last capture image:', err);
    }

    res.status(201).json(newReport);
  } catch (err) {
    console.error('[SERVER ERROR] Create report failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// API: Export all reports to CSV (Admins only) - Streaming optimized using MongoDB query cursor
app.get('/api/export', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user || user.role !== 'admin') {
      return res.status(403).send('Forbidden: Hanya Admin yang dapat mengekspor laporan');
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="eyeco_report_export.csv"');
    
    // Write Header
    res.write('ID,User ID,Lokasi,Waktu Kejadian,Status AI,Keyakinan AI (%),Status Admin,Sumber,Identitas/Kiri,Catatan Admin\n');

    const cursor = ReportModel.find().sort({ id: 1 }).cursor();

    cursor.on('data', (doc) => {
      const timestampStr = doc.timestamp instanceof Date ? doc.timestamp.toISOString() : doc.timestamp;
      const row = [
        doc.id,
        doc.userId,
        `"${doc.location.replace(/"/g, '""')}"`,
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

    cursor.on('end', () => {
      res.end();
    });

    cursor.on('error', (err) => {
      console.error('[SERVER ERROR] Export cursor error:', err);
      if (!res.headersSent) {
        res.status(500).send('Internal Server Error during export streaming');
      } else {
        res.end();
      }
    });

  } catch (err) {
    console.error('[SERVER ERROR] Export failed:', err);
    if (!res.headersSent) {
      res.status(500).send('Internal Server Error');
    }
  }
});

// --- CCTV API ENDPOINTS ---

// GET /api/cctv - List all CCTV channels
app.get('/api/cctv', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Belum masuk' });
    }

    let cctvs: Awaited<ReturnType<typeof CctvRepository.getAll>>;
    if (user.role === 'admin') {
      if (user.workspaceId !== undefined && user.workspaceId !== null) {
        cctvs = await CctvRepository.getAll(user.workspaceId);
      } else {
        cctvs = [];
      }
    } else {
      cctvs = await CctvRepository.getAll();
    }
    
    // Decrypt / enrich each CCTV config with playUrl dynamically
    const processed = cctvs.map(c => {
      const playTarget = CctvAdapter.getPlayTarget(c as any);
      return {
        ...c,
        playUrl: playTarget.playUrl,
        mediaType: playTarget.playType,
        // Hide password in listing
        password: c.password ? '••••••••' : ''
      };
    });

    res.json({ success: true, data: processed });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/cctv failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/cctv/:id - Fetch single CCTV detail
app.get('/api/cctv/:id', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Belum masuk' });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID tidak valid' });
    }

    const c = await CctvRepository.getById(id)
    if (!c) {
      return res.status(404).json({ error: 'CCTV tidak ditemukan' });
    }

    // Expose password decrypted to admin only for editing
    const decryptedPassword = user.role === 'admin' && c.password
      ? CctvRepository.decryptCctvPassword(c.password)
      : '';

    const playTarget = CctvAdapter.getPlayTarget(c as any);

    res.json({
      success: true,
      data: {
        ...c,
        playUrl: playTarget.playUrl,
        mediaType: playTarget.playType,
        password: decryptedPassword
      }
    });
  } catch (err) {
    console.error('[SERVER ERROR] GET /api/cctv/:id failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/cctv/scan - Capability Discovery Scan
app.post('/api/cctv/scan', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Belum masuk' });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
    }

    const { ipOrHost, username, password, vendorHint, port, connectionMode } = req.body;
    if (!ipOrHost) {
      return res.status(400).json({ error: 'IP Address / Host wajib diisi.' });
    }

    console.log(`[CctvScanner] Probing camera at: ${ipOrHost} (Vendor: ${vendorHint || 'GENERIC'}, Mode: ${connectionMode || 'AUTO'})...`);
    const scanResult = await CctvScanner.scan(
      ipOrHost,
      username,
      password,
      vendorHint,
      port ? parseInt(port) : undefined,
      connectionMode
    );
    
    res.json({ success: true, data: scanResult });
  } catch (err) {
    console.error('[SERVER ERROR] POST /api/cctv/scan failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/cctv - Connect CCTV (admin-only)
app.post('/api/cctv', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Belum masuk' });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
    }

    const newCctv = await CctvRepository.add({ ...req.body, workspaceId: user.workspaceId }, user.id);
    
    // Instantly check camera health upon connection
    CctvHealthEngine.checkCameraHealth(newCctv.id);

    res.json({ success: true, data: newCctv });
  } catch (err: any) {
    console.error('[SERVER ERROR] POST /api/cctv failed:', err);
    res.status(400).json({ error: err.message || 'Gagal menambahkan CCTV' });
  }
});

// PUT /api/cctv/:id - Update CCTV (admin-only)
app.put('/api/cctv/:id', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Belum masuk' });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID tidak valid' });
    }

    const updated = await CctvRepository.update(id, req.body);
    
    // Instantly trigger health check to update status
    CctvHealthEngine.checkCameraHealth(id);

    res.json({ success: true, data: updated });
  } catch (err: any) {
    console.error('[SERVER ERROR] PUT /api/cctv/:id failed:', err);
    res.status(400).json({ error: err.message || 'Gagal mengubah CCTV' });
  }
});

// DELETE /api/cctv/:id - Disconnect CCTV (admin-only)
app.delete('/api/cctv/:id', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Belum masuk' });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID tidak valid' });
    }

    await CctvRepository.delete(id);
    res.json({ success: true, message: 'CCTV berhasil diputuskan' });
  } catch (err: any) {
    console.error('[SERVER ERROR] DELETE /api/cctv/:id failed:', err);
    res.status(400).json({ error: err.message || 'Gagal menghapus CCTV' });
  }
});

// POST /api/cctv/:id/reconnect - Trigger manual reconnect
app.post('/api/cctv/:id/reconnect', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Belum masuk' });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'ID tidak valid' });
    }

    const success = await CctvHealthEngine.manualReconnect(id);
    if (success) {
      res.json({ success: true, message: 'Reconnection triggered' });
    } else {
      res.status(400).json({ error: 'Failed to trigger reconnect' });
    }
  } catch (err) {
    console.error('[SERVER ERROR] POST /api/cctv/:id/reconnect failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/cctv/:id/snapshot - Snapshot image proxy fallback
app.get('/api/cctv/:id/snapshot', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const camera = await CctvRepository.getById(id)
    if (!camera) {
      return res.status(404).send('Camera not found');
    }

    // Proxy the snapshot, or fallback to the static asset image
    if (camera.isDefault || camera.protocol === 'HTTP Image') {
      res.redirect(camera.streamUrl);
    } else {
      // Return default camera 1 image as fallback
      res.redirect('/uploads/detection_1.jpg');
    }
  } catch (err) {
    res.status(500).send('Internal Server Error');
  }
});

// Start Server after Database connection is established
connectDB().then(async () => {
  // Seed default admin account
  await UserRepository.seedDefaultAdmin();

  CctvHealthEngine.start();
  app.listen(PORT, () => {
    console.log(`Server EYECO berjalan di http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('[SERVER CRITICAL] Failed to connect to database. Server not started.', err);
  process.exit(1);
});
