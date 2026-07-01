import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { DatabaseManager, Report, BoundingBox, User } from './database/db';

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

<<<<<<< Updated upstream
// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI as string)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));
=======
// Rate limiting for Auth endpoints to mitigate brute force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per windowMs
  message: { error: 'Terlalu banyak percobaan masuk/daftar, silakan coba lagi nanti.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/verify-2fa', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/register-desa', authLimiter);
>>>>>>> Stashed changes

// In-memory Session Store (Session Token -> User ID)
const sessions = new Map<string, string>();

// Pending 2FA verification (Temp Token -> User ID)
const pending2faSessions = new Map<string, number>();

// Setup middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static CSS files directly
app.use('/css', express.static(path.join(__dirname, '../public/css')));
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
  const cookieHeader = req.headers.cookie || '';
  const cookies = cookieHeader.split(';').reduce((acc, c) => {
    const [key, val] = c.trim().split('=');
    if (key && val) acc[key] = val;
    return acc;
  }, {} as Record<string, string>);
  
  const token = cookies['session_token'];
  if (!token) return null;
  
  const userId = sessions.get(token);
  if (!userId) return null;
  
  return (await DatabaseManager.getUserById(userId)) || null;
}

<<<<<<< Updated upstream
// --- AUTH API ENDPOINTS ---

// 1. API BARU: Registrasi Desa / Workspace Baru (Otomatis Jadi Superadmin Desa Tersebut)
app.post('/api/auth/register-desa', async (req, res) => {
  try {
    const { namaDesa, kodeDesa, username, password } = req.body;

    if (!namaDesa || !kodeDesa || !username || !password) {
      return res.status(400).json({ error: 'Semua data desa dan akun wajib diisi' });
    }

    // Cek apakah kode desa sudah terdaftar
    const existingDesa = await DatabaseManager.findDesaByKode(kodeDesa.toLowerCase());
    if (existingDesa) {
      return res.status(400).json({ error: 'Kode desa/workspace sudah digunakan' });
    }

    // Buat Desanya terlebih dahulu
    const newDesa = await DatabaseManager.createDesa(namaDesa, kodeDesa.toLowerCase());

    // Buat user pertamanya langsung sebagai 'superadmin' di desa tersebut
    const newSuperAdmin = await DatabaseManager.createUser(username, password, 'superadmin', newDesa._id.toString());
    if (!newSuperAdmin) {
      return res.status(400).json({ error: 'Username sudah digunakan' });
    }

    res.status(201).json({ 
      message: 'Workspace desa dan akun superadmin berhasil dibuat',
      desa: { namaDesa: newDesa.namaDesa, kodeDesa: newDesa.kodeDesa },
      user: { username: newSuperAdmin.username, role: newSuperAdmin.role }
    });
  } catch (err) {
    console.error('Register Desa API Error:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server saat pendaftaran desa' });
  }
});

// 2. API Register Akun Anggota (Bisa Dipakai Publik dengan Mengirim desaId, atau oleh Superadmin untuk Tambah Admin)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, role, desaId } = req.body;
    const loggedInUser = await getLoggedInUser(req);

    if (!username || !password || !role) {
      return res.status(400).json({ error: 'Username, password, dan role harus diisi' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password minimal 6 karakter' });
    }

    if (!['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Role tidak valid' });
    }

    // Tentukan desaId: diambil dari request body, atau otomatis ikut desaId milik Superadmin yang sedang login
    let targetDesaId = desaId;
    if (loggedInUser && (loggedInUser.role === 'superadmin' || loggedInUser.role === 'admin')) {
      targetDesaId = loggedInUser.desaId;
    }

    if (!targetDesaId) {
      return res.status(400).json({ error: 'ID Desa / Workspace tidak ditemukan' });
    }

    const newUser = await DatabaseManager.createUser(username, password, role as 'admin' | 'user', targetDesaId);
=======
function createSessionToken(): string {
  return 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function createTemp2FAToken(): string {
  return '2fa_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function setSessionCookie(res: express.Response, token: string): void {
  res.setHeader('Set-Cookie', `session_token=${token}; Path=/; HttpOnly; SameSite=Lax`);
}

function requiresAdmin2FA(user: User): boolean {
  return (
    user.is2faEnabled === true &&
    (user.role === 'admin' || user.role === 'superadmin')
  );
}

const checkAuth: express.RequestHandler = async (req, res, next) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('[SERVER ERROR] Auth check failed:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};

// --- HEALTH CHECK ENDPOINT ---
app.get('/health', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  res.status(isConnected ? 200 : 503).json({
    status: isConnected ? 'UP' : 'DOWN',
    database: isConnected ? 'connected' : 'disconnected'
  });
});

// --- AUTH API ENDPOINTS ---

// Register Desa & Superadmin API
app.post('/api/auth/register-desa', async (req, res) => {
  const { namaDesa, username, password } = req.body;

  if (!namaDesa || !username || !password) {
    return res.status(400).json({ error: 'Nama desa, username, dan password harus diisi' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password minimal 6 karakter' });
  }

  try {
    // Check if Desa already exists
    const existingDesa = await DatabaseManager.findDesaByName(namaDesa);
    if (existingDesa) {
      return res.status(400).json({ error: 'Nama desa sudah terdaftar' });
    }

    // Check if Username already exists
    const existingUser = await DatabaseManager.findUserByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username sudah digunakan' });
    }

    // Create Desa
    const newDesa = await DatabaseManager.createDesa(namaDesa);

    // Create Superadmin User for the new Desa
    const newSuperadmin = await DatabaseManager.createUser(username, password, 'superadmin', newDesa._id.toString());
    if (!newSuperadmin) {
      return res.status(400).json({ error: 'Gagal mendaftarkan superadmin' });
    }

    res.status(201).json({
      success: true,
      desa: { id: newDesa._id, nama: newDesa.nama },
      user: { id: newSuperadmin.id, username: newSuperadmin.username, role: newSuperadmin.role }
    });
  } catch (err) {
    console.error('[SERVER ERROR] Register desa failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Register User API (public registration — defaults to role 'user' & default desa)
app.post('/api/auth/register', async (req, res) => {
  const { username, password, role, desaId } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password harus diisi' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password minimal 6 karakter' });
  }

  const resolvedRole = role || 'user';
  if (!['admin', 'user'].includes(resolvedRole)) {
    return res.status(400).json({ error: 'Role tidak valid. Harus admin atau user.' });
  }

  try {
    let resolvedDesaId = desaId;

    if (!resolvedDesaId) {
      const defaultDesa = await DatabaseManager.findDesaByName('Desa EYECO');
      if (!defaultDesa) {
        return res.status(500).json({ error: 'Desa default belum tersedia. Hubungi administrator.' });
      }
      resolvedDesaId = defaultDesa._id.toString();
    }

    const newUser = await DatabaseManager.createUser(
      username,
      password,
      resolvedRole as 'admin' | 'user',
      resolvedDesaId
    );

>>>>>>> Stashed changes
    if (!newUser) {
      return res.status(400).json({ error: 'Username sudah digunakan' });
    }

<<<<<<< Updated upstream
    res.status(201).json({ id: newUser.id, username: newUser.username, role: newUser.role, desaId: newUser.desaId });
=======
    res.status(201).json({
      id: newUser.id,
      username: newUser.username,
      role: newUser.role,
      desaId: newUser.desaId,
    });
>>>>>>> Stashed changes
  } catch (err) {
    console.error('Register API Error:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server saat pendaftaran' });
  }
});

// Login API
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password harus diisi' });
    }

    const user = await DatabaseManager.authenticateUser(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }

    // Verify user has a desaId
    if (!user.desaId) {
      return res.status(401).json({ error: 'Pengguna tidak terdaftar di desa manapun' });
    }

<<<<<<< Updated upstream
    // Set Cookie
    res.setHeader('Set-Cookie', `session_token=${token}; Path=/; HttpOnly; SameSite=Lax`);
    res.json({ id: user.id, username: user.username, role: user.role, desaId: user.desaId });
=======
    // Admin dengan 2FA aktif: kirim ke halaman verifikasi OTP
    if (requiresAdmin2FA(user)) {
      const tempToken = createTemp2FAToken();
      pending2faSessions.set(tempToken, user.id);

      return res.json({
        requires2FA: true,
        tempToken,
        username: user.username,
        role: user.role,
      });
    }

    // Create session (tanpa 2FA)
    const token = createSessionToken();
    sessions.set(token, user.id);
    setSessionCookie(res, token);

    res.json({ 
      id: user.id, 
      username: user.username, 
      role: user.role, 
      desaId: user.desaId 
    });
>>>>>>> Stashed changes
  } catch (err) {
    console.error('Login API Error:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server saat login' });
  }
});

// Verify 2FA API (TOTP token dari authenticator app)
app.post('/api/auth/verify-2fa', async (req, res) => {
  const { tempToken, code } = req.body;

  if (!tempToken || !code) {
    return res.status(400).json({ error: 'Token verifikasi dan kode OTP harus diisi' });
  }

  const normalizedCode = String(code).trim();
  if (!/^\d{6}$/.test(normalizedCode)) {
    return res.status(400).json({ error: 'Kode OTP harus berupa 6 digit angka' });
  }

  try {
    const userId = pending2faSessions.get(tempToken);
    if (userId === undefined) {
      return res.status(401).json({ error: 'Sesi verifikasi tidak valid atau sudah kedaluwarsa' });
    }

    const isValid = await DatabaseManager.verify2FAToken(userId, normalizedCode);
    if (!isValid) {
      return res.status(401).json({ error: 'Kode OTP tidak valid' });
    }

    pending2faSessions.delete(tempToken);

    const user = await DatabaseManager.getUserById(userId);
    if (!user || !user.desaId) {
      return res.status(401).json({ error: 'Pengguna tidak ditemukan' });
    }

    const token = createSessionToken();
    sessions.set(token, user.id);
    setSessionCookie(res, token);

    res.json({
      id: user.id,
      username: user.username,
      role: user.role,
      desaId: user.desaId,
    });
  } catch (err) {
    console.error('[SERVER ERROR] 2FA verification failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Logout API
app.post('/api/auth/logout', (req, res) => {
  const cookieHeader = req.headers.cookie || '';
  const cookies = cookieHeader.split(';').reduce((acc, c) => {
    const [key, val] = c.trim().split('=');
    if (key && val) acc[key] = val;
    return acc;
  }, {} as Record<string, string>);
  
  const token = cookies['session_token'];
  if (token) {
    sessions.delete(token);
  }

  res.setHeader('Set-Cookie', 'session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly');
  res.json({ success: true });
});

// Get Current User API
<<<<<<< Updated upstream
app.get('/api/auth/me', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Belum masuk' });
=======
app.get('/api/auth/me', checkAuth, async (req, res) => {
  try {
    const user = req.user!;
    res.json({ 
      id: user.id, 
      username: user.username, 
      role: user.role, 
      desaId: user.desaId 
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
>>>>>>> Stashed changes
  }
  res.json({ id: user.id, username: user.username, role: user.role, desaId: user.desaId });
});



// --- VIEW ROUTING & GUARDS ---

app.get('/login-2fa', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (user) {
      return res.redirect(user.role === 'admin' || user.role === 'superadmin' ? '/dashboard' : '/dashboard/upload');
    }
    res.sendFile(path.join(__dirname, '../public/views/login-2fa.html'));
  } catch (err) {
    res.redirect('/login');
  }
});

app.get('/login', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (user) {
    return res.redirect(['superadmin', 'admin'].includes(user.role) ? '/dashboard' : '/dashboard/upload');
  }
  res.sendFile(path.join(__dirname, '../public/views/login.html'));
});

app.get('/register', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (user) {
    return res.redirect(['superadmin', 'admin'].includes(user.role) ? '/dashboard' : '/dashboard/upload');
  }
  res.sendFile(path.join(__dirname, '../public/views/register.html'));
});

// Hanya Superadmin desa yang bisa mengakses halaman tambah admin/anggota baru
app.get('/admin-register', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user || user.role !== 'superadmin') {
    return res.redirect('/login');
  }
  res.sendFile(path.join(__dirname, '../public/views/admin-register.html'));
});

app.get('/', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) return res.redirect('/login');
  res.redirect(['superadmin', 'admin'].includes(user.role) ? '/dashboard' : '/dashboard/upload');
});

app.get('/dashboard', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) return res.redirect('/login');
  if (!['superadmin', 'admin'].includes(user.role)) return res.redirect('/dashboard/upload');
  
  res.sendFile(path.join(__dirname, '../public/views/dashboard.html'));
});

app.get('/dashboard/upload', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) return res.redirect('/login');
  
  res.sendFile(path.join(__dirname, '../public/views/upload.html'));
});

app.get('/dashboard/detections/:id', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) return res.redirect('/login');
  if (!['superadmin', 'admin'].includes(user.role)) return res.redirect('/dashboard/upload');
  
  res.sendFile(path.join(__dirname, '../public/views/detail.html'));
});


// --- SECURE DATA API ENDPOINTS ---

<<<<<<< Updated upstream
// API: Get Filtered & Paginated Reports (Terisolasi per Desa)
app.get('/api/detections', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
=======
// API: Get Filtered & Paginated Reports (Database-Level pagination optimized)
app.get('/api/detections', checkAuth, async (req, res) => {
  try {
    const user = req.user!;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 5;

    const filters = {
      timeRange: req.query.timeRange as string,
      date: req.query.date as string,
      aiStatus: req.query.aiStatus as string,
      adminStatus: req.query.adminStatus as string,
      location: req.query.location as string,
    };

    const userContext = { id: user.id, role: user.role, desaId: user.desaId };
    
    // Call database-level paginated query
    const result = await DatabaseManager.getFiltered(filters, userContext, page, limit);

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
>>>>>>> Stashed changes
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

  // Mengirim konteks user lengkap beserta desaId-nya
  const userContext = { id: user.id, role: user.role, desaId: user.desaId };
  const allFilteredReports = await DatabaseManager.getFiltered(filters, userContext);
  
  // Paginate
  const totalReports = allFilteredReports.length;
  const totalPages = Math.ceil(totalReports / limit) || 1;
  const offset = (page - 1) * limit;
  const paginatedReports = allFilteredReports.slice(offset, offset + limit);

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
});

<<<<<<< Updated upstream
// API: Get Single Report by ID (Proteksi Silang Antar Desa)
app.get('/api/detections/:id', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
=======
// API: Get Single Report by ID
app.get('/api/detections/:id', checkAuth, async (req, res) => {
  try {
    const user = req.user!;

    const id = parseInt(req.params.id);
    const report = await DatabaseManager.getById(id);

    if (!report) {
      return res.status(404).json({ error: 'Laporan tidak ditemukan' });
    }

    // Multi-tenancy check: User can only access report of their own village
    if (report.desaId.toString() !== user.desaId.toString()) {
      return res.status(403).json({ error: 'Forbidden: Anda tidak memiliki akses ke laporan ini' });
    }

    res.json(report);
  } catch (err) {
    console.error('[SERVER ERROR] Get single report failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
>>>>>>> Stashed changes
  }

  const id = req.params.id;
  const report = await DatabaseManager.getById(id);

  if (!report) {
    return res.status(404).json({ error: 'Laporan tidak ditemukan' });
  }

  // Cek Keamanan: Admin/User desa lain dilarang mengintip laporan desa ini
  if (report.desaId !== user.desaId) {
    return res.status(403).json({ error: 'Akses ditolak: Anda bukan bagian dari workspace desa ini' });
  }

  // Akses user biasa hanya boleh melihat buatannya sendiri
  if (user.role === 'user' && report.userId !== user.id) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  res.json(report);
});

// API: Update Admin Verification Status
<<<<<<< Updated upstream
app.post('/api/detections/:id/verify', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
=======
app.post('/api/detections/:id/verify', checkAuth, async (req, res) => {
  try {
    const user = req.user!;

    if (!['superadmin', 'admin'].includes(user.role)) {
      return res.status(403).json({ error: 'Hanya Admin yang dapat memvalidasi laporan' });
    }

    const id = parseInt(req.params.id);
    const report = await DatabaseManager.getById(id);
    if (!report) {
      return res.status(404).json({ error: 'Laporan tidak ditemukan' });
    }

    // Multi-tenancy check
    if (report.desaId.toString() !== user.desaId.toString()) {
      return res.status(403).json({ error: 'Forbidden: Anda tidak memiliki akses ke laporan ini' });
    }

    const { status, notes } = req.body;

    if (!status || !['VALID', 'DIABAIKAN', 'MENUNGGU'].includes(status)) {
      return res.status(400).json({ error: 'Status tidak valid' });
    }

    const updatedReport = await DatabaseManager.updateVerification(id, status, notes || '');
    if (!updatedReport) {
      return res.status(404).json({ error: 'Laporan tidak ditemukan' });
    }

    res.json(updatedReport);
  } catch (err) {
    console.error('[SERVER ERROR] Verify report failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
>>>>>>> Stashed changes
  }

<<<<<<< Updated upstream
  if (!['superadmin', 'admin'].includes(user.role)) {
    return res.status(403).json({ error: 'Hanya Admin/Superadmin yang dapat memvalidasi laporan' });
=======
// Helper functions for standard API responses
function sendSuccess(res: express.Response, data: any, status = 200) {
  return res.status(status).json({ success: true, data });
}

// Keep sendError as it is used by comment/like endpoints
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
app.get('/api/detections/:id/comments', checkAuth, async (req, res) => {
  try {
    const user = req.user!;

    const reportId = parseInt(req.params.id);
    const report = await ReportModel.findOne({ id: reportId }).lean();
    if (!report) {
      return sendError(res, 'Laporan tidak ditemukan', 404);
    }

    // Multi-tenancy check
    if (report.desaId.toString() !== user.desaId.toString()) {
      return sendError(res, 'Forbidden: Anda tidak memiliki akses ke laporan ini', 403);
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
>>>>>>> Stashed changes
  }

<<<<<<< Updated upstream
  const id = req.params.id;
  const report = await DatabaseManager.getById(id);

  if (!report) {
    return res.status(404).json({ error: 'Laporan tidak ditemukan' });
=======
// POST /api/detections/:id/comments - Add a comment (rate-limited)
app.post('/api/detections/:id/comments', commentLimiter, checkAuth, async (req, res) => {
  try {
    const user = req.user!;

    const reportId = parseInt(req.params.id);
    const report = await ReportModel.findOne({ id: reportId }).lean();
    if (!report) {
      return sendError(res, 'Laporan tidak ditemukan', 404);
    }

    // Multi-tenancy check
    if (report.desaId.toString() !== user.desaId.toString()) {
      return sendError(res, 'Forbidden: Anda tidak memiliki akses ke laporan ini', 403);
    }

    const { text } = req.body;

    if (!text || typeof text !== 'string') {
      return sendError(res, 'Konten komentar harus diisi.', 400);
    }

    const comment = await DatabaseManager.addComment(reportId, user.id, text);
    
    // Resolve comment author details for direct frontend integration
    return sendSuccess(res, {
      ...(comment as any).toJSON(),
      username: user.username,
      role: user.role
    }, 201);

  } catch (err: any) {
    console.error('[SERVER ERROR] Create comment failed:', err);
    return sendError(res, err.message || 'Internal Server Error', 500);
>>>>>>> Stashed changes
  }

<<<<<<< Updated upstream
  // Cek Keamanan: Admin dilarang memverifikasi laporan desa lain
  if (report.desaId !== user.desaId) {
    return res.status(403).json({ error: 'Akses ditolak' });
=======
// DELETE /api/detections/:id/comments/:commentId - Delete a comment (soft delete)
app.delete('/api/detections/:id/comments/:commentId', checkAuth, async (req, res) => {
  try {
    const user = req.user!;

    const reportId = parseInt(req.params.id);
    const report = await ReportModel.findOne({ id: reportId }).lean();
    if (!report) {
      return sendError(res, 'Laporan tidak ditemukan', 404);
    }

    // Multi-tenancy check
    if (report.desaId.toString() !== user.desaId.toString()) {
      return sendError(res, 'Forbidden: Anda tidak memiliki akses ke laporan ini', 403);
    }

    const commentId = req.params.commentId;
    const isAdmin = ['superadmin', 'admin'].includes(user.role);

    // soft delete comment
    await DatabaseManager.deleteComment(reportId, commentId, user.id, isAdmin);
    return sendSuccess(res, { success: true });
  } catch (err: any) {
    console.error('[SERVER ERROR] Delete comment failed:', err);
    return sendError(res, err.message || 'Internal Server Error', 500);
>>>>>>> Stashed changes
  }

<<<<<<< Updated upstream
  const { status, notes } = req.body;

  if (!status || !['VALID', 'DIABAIKAN', 'MENUNGGU'].includes(status)) {
    return res.status(400).json({ error: 'Status tidak valid' });
=======
// POST /api/detections/:id/comments/:commentId/like - Toggle like on a comment (rate-limited)
app.post('/api/detections/:id/comments/:commentId/like', likeLimiter, checkAuth, async (req, res) => {
  try {
    const user = req.user!;

    const reportId = parseInt(req.params.id);
    const report = await ReportModel.findOne({ id: reportId }).lean();
    if (!report) {
      return sendError(res, 'Laporan tidak ditemukan', 404);
    }

    // Multi-tenancy check
    if (report.desaId.toString() !== user.desaId.toString()) {
      return sendError(res, 'Forbidden: Anda tidak memiliki akses ke laporan ini', 403);
    }

    const commentId = req.params.commentId;

    const comment = await DatabaseManager.toggleLikeComment(reportId, commentId, user.id);
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
>>>>>>> Stashed changes
  }

  const updatedReport = await DatabaseManager.updateVerification(id, status, notes || '');
  res.json(updatedReport);
});

<<<<<<< Updated upstream
// API: Get Stats & Charts data (Ter-scope per desa)
app.get('/api/stats', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
=======
// API: Get Stats & Charts data (Aggregation Pipeline optimized)
app.get('/api/stats', checkAuth, async (req, res) => {
  try {
    const user = req.user!;

    const userContext = { id: user.id, role: user.role, desaId: user.desaId };
    const stats = await DatabaseManager.getStats(userContext);
    res.json(stats);
  } catch (err) {
    console.error('[SERVER ERROR] Get stats failed:', err);
    res.status(500).json({ error: 'Internal Server Error' });
>>>>>>> Stashed changes
  }

  const userContext = { id: user.id, role: user.role, desaId: user.desaId };
  const stats = await DatabaseManager.getStats(userContext);
  res.json(stats);
});

// Helper: Run simulated AI YOLO detector
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
  
  if (notesLower.includes('orang') || notesLower.includes('warga') || notesLower.includes('mancing')) hasPerson = true;
  if (notesLower.includes('sampah') || notesLower.includes('buang') || notesLower.includes('limbah')) hasTrash = true;
  if (notesLower.includes('perahu') || notesLower.includes('kapal') || notesLower.includes('boat')) hasBoat = true;

  if (hasPerson) {
    boxes.push({
      label: 'person',
      confidence: parseFloat((0.75 + Math.random() * 0.23).toFixed(2)),
      x: parseFloat((15 + Math.random() * 40).toFixed(1)), y: parseFloat((30 + Math.random() * 30).toFixed(1)),
      w: parseFloat((12 + Math.random() * 15).toFixed(1)), h: parseFloat((40 + Math.random() * 25).toFixed(1)),
    });
  }

  if (hasTrash) {
    boxes.push({
      label: 'trash',
      confidence: parseFloat((0.65 + Math.random() * 0.3).toFixed(2)),
      x: parseFloat((30 + Math.random() * 40).toFixed(1)), y: parseFloat((60 + Math.random() * 20).toFixed(1)),
      w: parseFloat((15 + Math.random() * 20).toFixed(1)), h: parseFloat((15 + Math.random() * 15).toFixed(1)),
    });
  }

  let status: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi' = 'Tidak Terindikasi';
  let confidence: number | null = null;

  if (hasTrash || (hasPerson && hasBoat) || notesLower.includes('mencurigakan')) {
    status = 'TINGGI';
    confidence = Math.round(75 + Math.random() * 23);
  } else if (hasPerson) {
    status = 'RENDAH';
    confidence = Math.round(40 + Math.random() * 30);
  } else if (boxes.length > 0) {
    status = 'SEDANG';
    confidence = Math.round(60 + Math.random() * 15);
  }

  return { status, confidence, boxes };
}

<<<<<<< Updated upstream
// API: Create new report (Mencatat desaId pelapor secara otomatis)
app.post('/api/detections', upload.single('file'), async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
=======
// API: Create new report (upload)
app.post('/api/detections', upload.single('file'), checkAuth, async (req, res) => {
  try {
    const user = req.user!;

    if (!req.file) {
      return res.status(400).json({ error: 'File media wajib diupload' });
    }

    const { location, identity, sourceType, additionalNotes } = req.body;

    // Run AI processing simulation
    const aiResults = runSimulatedAI(location || '', additionalNotes || '');

    // Create report entry linked to user.id and user.desaId
    const newReport = await DatabaseManager.create({
      location: location || 'Lokasi tidak diketahui',
      aiStatus: aiResults.status,
      aiConfidence: aiResults.confidence,
      image: `/uploads/${req.file.filename}`,
      identity: identity || 'Belum diketahui',
      sourceType: sourceType || 'Gambar',
      additionalNotes: additionalNotes || 'Tidak ada catatan tambahan.',
      boundingBoxes: aiResults.boxes,
    }, user.id, user.desaId.toString());

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
>>>>>>> Stashed changes
  }

  if (!req.file) {
    return res.status(400).json({ error: 'File media wajib diupload' });
  }

  const { location, identity, sourceType, additionalNotes } = req.body;
  const aiResults = runSimulatedAI(location || '', additionalNotes || '');

  // Kirim data laporan beserta user.id dan user.desaId pelapor!
  const newReport = await DatabaseManager.create({
    location: location || 'Lokasi tidak diketahui',
    aiStatus: aiResults.status,
    aiConfidence: aiResults.confidence,
    image: `/uploads/${req.file.filename}`,
    identity: identity || 'Belum diketahui',
    sourceType: sourceType || 'Gambar',
    additionalNotes: additionalNotes || 'Tidak ada catatan tambahan.',
    boundingBoxes: aiResults.boxes,
  }, user.id, user.desaId);

  try {
    const uploadDir = path.join(__dirname, '../public/uploads');
    const sourcePath = path.join(uploadDir, req.file.filename);
    const destPath = path.join(uploadDir, 'last_capture.jpg');
    fs.copyFileSync(sourcePath, destPath);
  } catch (err) {
    console.error('Error copying last capture image:', err);
  }

  res.status(201).json(newReport);
});

<<<<<<< Updated upstream
// API: Export Laporan Ke CSV (Ter-scope hanya mengekspor data milik desanya sendiri)
app.get('/api/export', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user || !['superadmin', 'admin'].includes(user.role)) {
    return res.status(403).send('Forbidden: Hanya Admin yang dapat mengekspor laporan');
=======
// API: Export all reports to CSV (Admins only) - Streaming optimized using MongoDB query cursor
app.get('/api/export', checkAuth, async (req, res) => {
  try {
    const user = req.user!;
    if (!['superadmin', 'admin'].includes(user.role)) {
      return res.status(403).send('Forbidden: Hanya Admin yang dapat mengekspor laporan');
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="eyeco_report_export.csv"');
    
    // Write Header
    res.write('ID,User ID,Lokasi,Waktu Kejadian,Status AI,Keyakinan AI (%),Status Admin,Sumber,Identitas/Kiri,Catatan Admin\n');

    // Only query reports belonging to user's desaId
    const cursor = ReportModel.find({ desaId: user.desaId }).sort({ id: 1 }).cursor();

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
>>>>>>> Stashed changes
  }

  // Mengambil laporan hanya untuk desanya sendiri
  const reports = await DatabaseManager.getAll(user.desaId);

  let csvContent = 'ID,User ID,Lokasi,Waktu Kejadian,Status AI,Keyakinan AI (%),Status Admin,Sumber,Identitas,Catatan Admin\n';

  reports.forEach((r) => {
    const row = [
      r.id,
      r.userId,
      `"${r.location.replace(/"/g, '""')}"`,
      r.timestamp,
      r.aiStatus,
      r.aiConfidence || 'N/A',
      r.adminStatus,
      r.sourceType,
      `"${(r.identity || '').replace(/"/g, '""')}"`,
      `"${(r.adminNotes || '').replace(/"/g, '""')}"`,
    ];
    csvContent += row.join(',') + '\n';
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="report_export_desa_${user.desaId}.csv"`);
  res.status(200).send(csvContent);
});

<<<<<<< Updated upstream
// Start Server
app.listen(PORT, () => {
  console.log(`Server Simbahrang berjalan di http://localhost:${PORT}`);
});
=======
// Start Server after Database connection is established
connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server EYECO berjalan di http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('[SERVER CRITICAL] Failed to connect to database. Server not started.', err);
  process.exit(1);
});

>>>>>>> Stashed changes
