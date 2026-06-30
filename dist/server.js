"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const mongoose_1 = __importDefault(require("mongoose"));
const db_1 = require("./database/db");
const Report_1 = require("./database/models/Report");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 8000;
// Rate limiting for Auth endpoints to mitigate brute force attacks
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit each IP to 20 requests per windowMs
    message: { error: 'Terlalu banyak percobaan masuk/daftar, silakan coba lagi nanti.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
// In-memory Session Store (Session Token -> User ID)
const sessions = new Map();
// Setup middleware
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Serve static CSS and JS files directly
app.use('/css', express_1.default.static(path_1.default.join(__dirname, '../public/css')));
app.use('/js', express_1.default.static(path_1.default.join(__dirname, '../public/js')));
app.use('/uploads', express_1.default.static(path_1.default.join(__dirname, '../public/uploads')));
// Configure Multer for file uploads
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path_1.default.join(__dirname, '../public/uploads');
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `upload_${uniqueSuffix}${ext}`);
    },
});
const upload = (0, multer_1.default)({ storage });
// --- SESSION HELPER ---
async function getLoggedInUser(req) {
    const cookieHeader = req.headers.cookie || '';
    const cookies = cookieHeader.split(';').reduce((acc, c) => {
        const [key, val] = c.trim().split('=');
        if (key && val)
            acc[key] = val;
        return acc;
    }, {});
    const token = cookies['session_token'];
    if (!token)
        return null;
    const userId = sessions.get(token);
    if (userId === undefined)
        return null;
    try {
        return (await db_1.DatabaseManager.getUserById(userId)) || null;
    }
    catch (err) {
        console.error('[SERVER ERROR] Failed to fetch session user:', err);
        return null;
    }
}
// --- HEALTH CHECK ENDPOINT ---
app.get('/health', (req, res) => {
    const isConnected = mongoose_1.default.connection.readyState === 1;
    res.status(isConnected ? 200 : 503).json({
        status: isConnected ? 'UP' : 'DOWN',
        database: isConnected ? 'connected' : 'disconnected'
    });
});
// --- AUTH API ENDPOINTS ---
// Register API
app.post('/api/auth/register', async (req, res) => {
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
    try {
        const newUser = await db_1.DatabaseManager.createUser(username, password, role);
        if (!newUser) {
            return res.status(400).json({ error: 'Username sudah digunakan' });
        }
        res.status(201).json({ id: newUser.id, username: newUser.username, role: newUser.role });
    }
    catch (err) {
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
        const user = await db_1.DatabaseManager.authenticateUser(username, password);
        if (!user) {
            return res.status(401).json({ error: 'Username atau password salah' });
        }
        // Create session
        const token = 'sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        sessions.set(token, user.id);
        // Set Cookie
        res.setHeader('Set-Cookie', `session_token=${token}; Path=/; HttpOnly; SameSite=Lax`);
        res.json({ id: user.id, username: user.username, role: user.role });
    }
    catch (err) {
        console.error('[SERVER ERROR] Login failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Logout API
app.post('/api/auth/logout', (req, res) => {
    const cookieHeader = req.headers.cookie || '';
    const cookies = cookieHeader.split(';').reduce((acc, c) => {
        const [key, val] = c.trim().split('=');
        if (key && val)
            acc[key] = val;
        return acc;
    }, {});
    const token = cookies['session_token'];
    if (token) {
        sessions.delete(token);
    }
    res.setHeader('Set-Cookie', 'session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly');
    res.json({ success: true });
});
// Get Current User API
app.get('/api/auth/me', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Belum masuk' });
        }
        res.json({ id: user.id, username: user.username, role: user.role });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// --- VIEW ROUTING & GUARDS ---
app.get('/login', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (user) {
            return res.redirect(user.role === 'admin' ? '/dashboard' : '/dashboard/upload');
        }
        res.sendFile(path_1.default.join(__dirname, '../public/views/login.html'));
    }
    catch (err) {
        res.redirect('/login');
    }
});
app.get('/register', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (user) {
            return res.redirect(user.role === 'admin' ? '/dashboard' : '/dashboard/upload');
        }
        res.sendFile(path_1.default.join(__dirname, '../public/views/register.html'));
    }
    catch (err) {
        res.redirect('/login');
    }
});
app.get('/', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user)
            return res.redirect('/login');
        res.redirect(user.role === 'admin' ? '/dashboard' : '/dashboard/upload');
    }
    catch (err) {
        res.redirect('/login');
    }
});
app.get(['/dashboard', '/dashboard/laporan', '/dashboard/upload', '/dashboard/detections/:id'], async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user)
            return res.redirect('/login');
        // Normal user can only access /dashboard/upload.
        // If they try to access other admin dashboard pages, redirect them to /dashboard/upload
        if (user.role !== 'admin' && req.path !== '/dashboard/upload') {
            return res.redirect('/dashboard/upload');
        }
        res.sendFile(path_1.default.join(__dirname, '../public/views/dashboard.html'));
    }
    catch (err) {
        console.error('[SERVER ERROR] Dashboard view routing failed:', err);
        res.redirect('/login');
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
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const filters = {
            timeRange: req.query.timeRange,
            date: req.query.date,
            aiStatus: req.query.aiStatus,
            adminStatus: req.query.adminStatus,
            location: req.query.location,
        };
        const userContext = { id: user.id, role: user.role };
        // Call database-level paginated query
        const result = await db_1.DatabaseManager.getFiltered(filters, userContext, page, limit);
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
        }
        else {
            res.status(500).json({ error: 'Gagal memproses data laporan' });
        }
    }
    catch (err) {
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
        const report = await db_1.DatabaseManager.getById(id);
        if (!report) {
            return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        }
        // Access check: normal user can only view their own report
        if (user.role === 'user' && report.userId !== user.id) {
            return res.status(403).json({ error: 'Akses ditolak' });
        }
        res.json(report);
    }
    catch (err) {
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
        const { status, notes } = req.body;
        if (!status || !['VALID', 'DIABAIKAN', 'MENUNGGU'].includes(status)) {
            return res.status(400).json({ error: 'Status tidak valid' });
        }
        const updatedReport = await db_1.DatabaseManager.updateVerification(id, status, notes || '');
        if (!updatedReport) {
            return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        }
        res.json(updatedReport);
    }
    catch (err) {
        console.error('[SERVER ERROR] Verify report failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
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
        const stats = await db_1.DatabaseManager.getStats(userContext);
        res.json(stats);
    }
    catch (err) {
        console.error('[SERVER ERROR] Get stats failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Helper: Run simulated AI YOLO detector on uploaded images
function runSimulatedAI(location, notes) {
    const boxes = [];
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
    let status = 'Tidak Terindikasi';
    let confidence = null;
    if (hasTrash || (hasPerson && hasBoat) || notesLower.includes('mencurigakan') || notesLower.includes('tebang')) {
        status = 'TINGGI';
        confidence = Math.round(75 + Math.random() * 23);
    }
    else if (hasPerson) {
        status = 'RENDAH';
        confidence = Math.round(40 + Math.random() * 30);
    }
    else if (hasBoat) {
        status = 'Tidak Terindikasi';
    }
    else if (boxes.length > 0) {
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
        const newReport = await db_1.DatabaseManager.create({
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
            const uploadDir = path_1.default.join(__dirname, '../public/uploads');
            const sourcePath = path_1.default.join(uploadDir, req.file.filename);
            const destPath = path_1.default.join(uploadDir, 'last_capture.jpg');
            fs_1.default.copyFileSync(sourcePath, destPath);
        }
        catch (err) {
            console.error('[SERVER ERROR] Error copying last capture image:', err);
        }
        res.status(201).json(newReport);
    }
    catch (err) {
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
        const cursor = Report_1.ReportModel.find().sort({ id: 1 }).cursor();
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
            }
            else {
                res.end();
            }
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] Export failed:', err);
        if (!res.headersSent) {
            res.status(500).send('Internal Server Error');
        }
    }
});
// Start Server after Database connection is established
(0, db_1.connectDB)().then(() => {
    app.listen(PORT, () => {
        console.log(`Server EYECO berjalan di http://localhost:${PORT}`);
    });
}).catch((err) => {
    console.error('[SERVER CRITICAL] Failed to connect to database. Server not started.', err);
    process.exit(1);
});
