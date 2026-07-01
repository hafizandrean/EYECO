import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { DatabaseManager, Report, BoundingBox, User } from './database/db';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI as string)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// In-memory Session Store (Session Token -> User ID)
const sessions = new Map<string, string>();

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
    if (!newUser) {
      return res.status(400).json({ error: 'Username sudah digunakan' });
    }

    res.status(201).json({ id: newUser.id, username: newUser.username, role: newUser.role, desaId: newUser.desaId });
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

    // Create session
    const token = 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    sessions.set(token, user.id);

    // Set Cookie
    res.setHeader('Set-Cookie', `session_token=${token}; Path=/; HttpOnly; SameSite=Lax`);
    res.json({ id: user.id, username: user.username, role: user.role, desaId: user.desaId });
  } catch (err) {
    console.error('Login API Error:', err);
    res.status(500).json({ error: 'Terjadi kesalahan pada server saat login' });
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
app.get('/api/auth/me', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Belum masuk' });
  }
  res.json({ id: user.id, username: user.username, role: user.role, desaId: user.desaId });
});


// --- VIEW ROUTING & GUARDS ---

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

// API: Get Filtered & Paginated Reports (Terisolasi per Desa)
app.get('/api/detections', async (req, res) => {
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

// API: Get Single Report by ID (Proteksi Silang Antar Desa)
app.get('/api/detections/:id', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
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
app.post('/api/detections/:id/verify', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!['superadmin', 'admin'].includes(user.role)) {
    return res.status(403).json({ error: 'Hanya Admin/Superadmin yang dapat memvalidasi laporan' });
  }

  const id = req.params.id;
  const report = await DatabaseManager.getById(id);

  if (!report) {
    return res.status(404).json({ error: 'Laporan tidak ditemukan' });
  }

  // Cek Keamanan: Admin dilarang memverifikasi laporan desa lain
  if (report.desaId !== user.desaId) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  const { status, notes } = req.body;

  if (!status || !['VALID', 'DIABAIKAN', 'MENUNGGU'].includes(status)) {
    return res.status(400).json({ error: 'Status tidak valid' });
  }

  const updatedReport = await DatabaseManager.updateVerification(id, status, notes || '');
  res.json(updatedReport);
});

// API: Get Stats & Charts data (Ter-scope per desa)
app.get('/api/stats', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
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

// API: Create new report (Mencatat desaId pelapor secara otomatis)
app.post('/api/detections', upload.single('file'), async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
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

// API: Export Laporan Ke CSV (Ter-scope hanya mengekspor data milik desanya sendiri)
app.get('/api/export', async (req, res) => {
  const user = await getLoggedInUser(req);
  if (!user || !['superadmin', 'admin'].includes(user.role)) {
    return res.status(403).send('Forbidden: Hanya Admin yang dapat mengekspor laporan');
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

// Start Server
app.listen(PORT, () => {
  console.log(`Server Simbahrang berjalan di http://localhost:${PORT}`);
});