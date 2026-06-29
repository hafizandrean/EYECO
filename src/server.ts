import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { DatabaseManager, Report, BoundingBox, User } from './database/db';

const app = express();
const PORT = process.env.PORT || 8000;

// In-memory Session Store (Session Token -> User ID)
const sessions = new Map<string, number>();

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
function getLoggedInUser(req: express.Request): User | null {
  const cookieHeader = req.headers.cookie || '';
  const cookies = cookieHeader.split(';').reduce((acc, c) => {
    const [key, val] = c.trim().split('=');
    if (key && val) acc[key] = val;
    return acc;
  }, {} as Record<string, string>);
  
  const token = cookies['session_token'];
  if (!token) return null;
  
  const userId = sessions.get(token);
  if (userId === undefined) return null;
  
  return DatabaseManager.getUserById(userId) || null;
}

// --- AUTH API ENDPOINTS ---

// Register API
app.post('/api/auth/register', (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password, dan role harus diisi' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password minimal 6 karakter' });
  }

  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'Role tidak valid' });
  }

  const newUser = DatabaseManager.createUser(username, password, role as 'admin' | 'user');
  if (!newUser) {
    return res.status(400).json({ error: 'Username sudah digunakan' });
  }

  res.status(201).json({ id: newUser.id, username: newUser.username, role: newUser.role });
});

// Login API
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password harus diisi' });
  }

  const user = DatabaseManager.authenticateUser(username, password);
  if (!user) {
    return res.status(401).json({ error: 'Username atau password salah' });
  }

  // Create session
  const token = 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  sessions.set(token, user.id);

  // Set Cookie
  res.setHeader('Set-Cookie', `session_token=${token}; Path=/; HttpOnly; SameSite=Lax`);
  res.json({ id: user.id, username: user.username, role: user.role });
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
app.get('/api/auth/me', (req, res) => {
  const user = getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Belum masuk' });
  }
  res.json({ id: user.id, username: user.username, role: user.role });
});


// --- VIEW ROUTING & GUARDS ---

app.get('/login', (req, res) => {
  const user = getLoggedInUser(req);
  if (user) {
    return res.redirect(user.role === 'admin' ? '/dashboard' : '/dashboard/upload');
  }
  res.sendFile(path.join(__dirname, '../public/views/login.html'));
});

app.get('/register', (req, res) => {
  const user = getLoggedInUser(req);
  if (user) {
    return res.redirect(user.role === 'admin' ? '/dashboard' : '/dashboard/upload');
  }
  res.sendFile(path.join(__dirname, '../public/views/register.html'));
});

app.get('/', (req, res) => {
  const user = getLoggedInUser(req);
  if (!user) return res.redirect('/login');
  res.redirect(user.role === 'admin' ? '/dashboard' : '/dashboard/upload');
});

app.get('/dashboard', (req, res) => {
  const user = getLoggedInUser(req);
  if (!user) return res.redirect('/login');
  if (user.role !== 'admin') return res.redirect('/dashboard/upload');
  
  res.sendFile(path.join(__dirname, '../public/views/dashboard.html'));
});

app.get('/dashboard/upload', (req, res) => {
  const user = getLoggedInUser(req);
  if (!user) return res.redirect('/login');
  
  res.sendFile(path.join(__dirname, '../public/views/upload.html'));
});

app.get('/dashboard/detections/:id', (req, res) => {
  const user = getLoggedInUser(req);
  if (!user) return res.redirect('/login');
  if (user.role !== 'admin') return res.redirect('/dashboard/upload');
  
  res.sendFile(path.join(__dirname, '../public/views/detail.html'));
});


// --- SECURE DATA API ENDPOINTS ---

// API: Get Filtered & Paginated Reports
app.get('/api/detections', (req, res) => {
  const user = getLoggedInUser(req);
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
  const allFilteredReports = DatabaseManager.getFiltered(filters, userContext);
  
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

// API: Get Single Report by ID
app.get('/api/detections/:id', (req, res) => {
  const user = getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const id = parseInt(req.params.id);
  const report = DatabaseManager.getById(id);

  if (!report) {
    return res.status(404).json({ error: 'Laporan tidak ditemukan' });
  }

  // Access check: normal user can only view their own report
  if (user.role === 'user' && report.userId !== user.id) {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  res.json(report);
});

// API: Update Admin Verification Status
app.post('/api/detections/:id/verify', (req, res) => {
  const user = getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'Hanya Admin yang dapat memvalidasi laporan' });
  }

  const id = parseInt(req.params.id);
  const { status, notes } = req.body;

  if (!status || !['VALID', 'DIABAIKAN', 'MENUNGGU'].includes(status)) {
    return res.status(400).json({ error: 'Status tidak valid' });
  }

  const updatedReport = DatabaseManager.updateVerification(id, status, notes || '');
  if (!updatedReport) {
    return res.status(404).json({ error: 'Laporan tidak ditemukan' });
  }

  res.json(updatedReport);
});

// API: Get Stats & Charts data
app.get('/api/stats', (req, res) => {
  const user = getLoggedInUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userContext = { id: user.id, role: user.role };
  const stats = DatabaseManager.getStats(userContext);
  res.json(stats);
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
app.post('/api/detections', upload.single('file'), (req, res) => {
  const user = getLoggedInUser(req);
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
  const newReport = DatabaseManager.create({
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
    console.error('Error copying last capture image:', err);
  }

  res.status(201).json(newReport);
});

// API: Export all reports to CSV (Admins only)
app.get('/api/export', (req, res) => {
  const user = getLoggedInUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).send('Forbidden: Hanya Admin yang dapat mengekspor laporan');
  }

  const reports = DatabaseManager.getAll();

  // CSV headers
  let csvContent = 'ID,User ID,Lokasi,Waktu Kejadian,Status AI,Keyakinan AI (%),Status Admin,Sumber,Identitas/Kiri,Catatan Admin\n';

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
  res.setHeader('Content-Disposition', 'attachment; filename="simbahrang_report_export.csv"');
  res.status(200).send(csvContent);
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server Simbahrang berjalan di http://localhost:${PORT}`);
});
