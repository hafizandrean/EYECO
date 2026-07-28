"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dns_1 = __importDefault(require("dns"));
dns_1.default.setDefaultResultOrder('ipv4first');
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const fs_1 = __importDefault(require("fs"));
const express_rate_limit_1 = require("express-rate-limit");
const authMiddleware_1 = require("./auth/authMiddleware");
const db_1 = require("./database/db");
const Report_1 = require("./database/models/Report");
const User_1 = require("./database/models/User");
const authMiddleware_2 = require("./auth/authMiddleware");
const RoleMiddleware_1 = require("./auth/RoleMiddleware");
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const superadminRoutes_1 = __importDefault(require("./routes/superadminRoutes"));
const workspaceRoutes_1 = __importDefault(require("./routes/workspaceRoutes"));
const adminRoutes_1 = __importDefault(require("./routes/adminRoutes"));
const reportRoutes_1 = __importDefault(require("./routes/reportRoutes"));
const cctvRoutes_1 = __importDefault(require("./routes/cctvRoutes"));
const newsRoutes_1 = __importDefault(require("./routes/newsRoutes"));
const videoAnalysisRoutes_1 = __importDefault(require("./routes/videoAnalysisRoutes"));
const CctvHealthEngine_1 = require("./cctv/CctvHealthEngine");
const CctvScanner_1 = require("./cctv/CctvScanner");
const CctvAdapter_1 = require("./cctv/CctvAdapter");
const AiPipelineScheduler_1 = require("./cctv/services/AiPipelineScheduler");
const AiEngineHealthMonitor_1 = require("./cctv/services/AiEngineHealthMonitor");
const OutboxWorker_1 = require("./notifications/OutboxWorker");
const Notification_1 = require("./database/models/Notification");
const TelegramNotificationChannel_1 = require("./notifications/TelegramNotificationChannel");
const aiDetection_service_1 = require("./services/aiDetection.service");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = Number(process.env.PORT || 8000);
let lastDatabaseStateLogAt = 0;
function logDatabaseState(message) {
    const now = Date.now();
    if (now - lastDatabaseStateLogAt < 10000)
        return;
    lastDatabaseStateLogAt = now;
    console.log(message);
}
mongoose_1.default.connection.on('disconnected', () => {
    logDatabaseState('[DATABASE WARNING] MongoDB disconnected. CCTV health engine paused.');
    CctvHealthEngine_1.CctvHealthEngine.stop();
});
mongoose_1.default.connection.on('reconnected', () => {
    logDatabaseState('[DATABASE SUCCESS] MongoDB reconnected. CCTV health engine resumed.');
    CctvHealthEngine_1.CctvHealthEngine.start();
});
mongoose_1.default.connection.on('error', (err) => {
    logDatabaseState(`[DATABASE ERROR] MongoDB connection error: ${err.message}`);
});
// Setup middleware
app.use((0, cookie_parser_1.default)());
// --- MIDDLEWARE ---
app.use(express_1.default.json());
app.use((req, res, next) => {
    console.log(`[HTTP REQ] ${req.method} ${req.url}`);
    next();
});
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, cookie_parser_1.default)());
// API Versioning Rewriter (Translates /api/v1/* to /api/* internally for seamless backward compatibility)
app.use((req, res, next) => {
    if (req.url.startsWith('/api/v1/')) {
        req.url = req.url.replace('/api/v1/', '/api/');
    }
    next();
});
// Serve static CSS and JS files directly
app.use('/css', express_1.default.static(path_1.default.join(__dirname, '../public/css')));
app.use('/js', express_1.default.static(path_1.default.join(__dirname, '../public/js')));
app.use('/uploads', express_1.default.static(path_1.default.join(__dirname, '../public/uploads')));
app.use('/hls', express_1.default.static(path_1.default.join(__dirname, '../public/hls')));
// Global middleware to populate req.userContext from cookie/header
app.use((req, res, next) => {
    const { verifyToken } = require('./auth/auth.service');
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
// --- STATIC FILES ---
app.use('/css', express_1.default.static(path_1.default.join(__dirname, '../public/css')));
app.use('/js', express_1.default.static(path_1.default.join(__dirname, '../public/js')));
app.use('/uploads', express_1.default.static(path_1.default.join(__dirname, '../public/uploads')));
// --- MODULAR ROUTES ---
app.use('/api/auth', authRoutes_1.default);
app.use('/api/superadmin', superadminRoutes_1.default);
app.use('/api/workspaces', workspaceRoutes_1.default);
app.use('/admin', adminRoutes_1.default);
app.use('/api/cctv', cctvRoutes_1.default);
app.use('/api/news', newsRoutes_1.default);
app.use('/api', reportRoutes_1.default);
app.use('/api/video-analysis', videoAnalysisRoutes_1.default);
// --- HEALTH CHECK ENDPOINTS ---
app.get('/health/live', (req, res) => {
    res.json({ status: 'UP' });
});
app.get('/health/ready', async (req, res) => {
    try {
        const mongoStatus = mongoose_1.default.connection.readyState === 1 ? 'UP' : 'DOWN';
        // Check if Telegram notifications are enabled in settings
        const telegramEnabledSetting = await db_1.SystemSettingsModel.findOne({ key: 'telegram.enabled' }).exec();
        const telegramStatus = telegramEnabledSetting && telegramEnabledSetting.value === true ? 'UP' : 'DOWN';
        // Verify storage write accessibility
        const uploadDir = path_1.default.join(__dirname, '../public/uploads');
        let storageStatus = 'DOWN';
        try {
            fs_1.default.accessSync(uploadDir, fs_1.default.constants.W_OK);
            storageStatus = 'UP';
        }
        catch {
            storageStatus = 'DOWN';
        }
        const aiMetrics = await AiEngineHealthMonitor_1.AiEngineHealthMonitor.getMetrics();
        const ready = mongoStatus === 'UP' && storageStatus === 'UP' && aiMetrics.status !== 'OFFLINE';
        res.status(ready ? 200 : 503).json({
            mongodb: mongoStatus,
            telegram: telegramStatus,
            scheduler: 'UP',
            storage: storageStatus,
            aiEngine: aiMetrics,
            ready
        });
    }
    catch (err) {
        res.status(503).json({
            mongodb: 'DOWN',
            telegram: 'DOWN',
            scheduler: 'DOWN',
            storage: 'DOWN',
            ready: false,
            error: err.message
        });
    }
});
// --- HEALTH CHECK ---
app.get('/health', (req, res) => {
    const isConnected = mongoose_1.default.connection.readyState === 1;
    res.status(isConnected ? 200 : 503).json({
        status: isConnected ? 'UP' : 'DOWN',
        database: isConnected ? 'connected' : 'disconnected'
    });
});
// --- HELPER: Role-based redirect ---
function getRedirectPath(role) {
    if (role === 'superadmin')
        return '/superadmin';
    if (role === 'admin')
        return '/dashboard';
    return '/select-workspace';
}
// --- VIEW ROUTES ---
app.get('/', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.redirect('/login');
        res.redirect(getRedirectPath(user.role));
    }
    catch (err) {
        res.redirect('/login');
    }
});
app.get('/login', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (user)
            return res.redirect(getRedirectPath(user.role));
        res.sendFile(path_1.default.join(__dirname, '../public/views/login.html'));
    }
    catch (err) {
        res.redirect('/login');
    }
});
app.get('/register', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (user)
            return res.redirect(getRedirectPath(user.role));
        res.sendFile(path_1.default.join(__dirname, '../public/views/register.html'));
    }
    catch (err) {
        res.redirect('/login');
    }
});
app.get('/register-superadmin', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (user)
            return res.redirect(getRedirectPath(user.role));
        res.sendFile(path_1.default.join(__dirname, '../public/views/register-superadmin.html'));
    }
    catch (err) {
        res.redirect('/login');
    }
});
// API: Get single report detail by ID (Public read access)
app.get('/api/detections/:id', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID laporan tidak valid' });
        }
        const report = await Report_1.ReportModel.findOne({ id, deletedAt: null }).lean().exec();
        if (!report) {
            return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        }
        const responseReport = { ...report };
        if (responseReport.image && typeof responseReport.image === 'string') {
            let img = responseReport.image;
            if (!img.startsWith('/') && !img.startsWith('http')) {
                img = '/' + img;
            }
            responseReport.image = img;
        }
        if (responseReport.videoPath && typeof responseReport.videoPath === 'string') {
            let vPath = responseReport.videoPath;
            if (!vPath.startsWith('/') && !vPath.startsWith('http')) {
                vPath = '/' + vPath;
            }
            responseReport.videoPath = vPath;
        }
        if (user && (user.role === 'admin' || user.role === 'superadmin')) {
            const uploader = await User_1.UserModel.findOne({ _id: report.userId }).select('username name avatar email phone').lean().exec();
            if (uploader) {
                responseReport.uploaderInfo = {
                    username: uploader.username,
                    name: uploader.name || '',
                    avatar: uploader.avatar || '',
                    email: uploader.email || '',
                };
            }
        }
        // Attach active AiSnapshot metadata if available
        try {
            const { AiSnapshotModel } = require('./database/models/AiSnapshot');
            let snapshot = null;
            if (report.activeSnapshotId) {
                snapshot = await AiSnapshotModel.findById(report.activeSnapshotId).lean().exec();
            }
            if (!snapshot) {
                snapshot = await AiSnapshotModel.findOne({ reportId: id, isActive: true }).sort({ createdAt: -1 }).lean().exec();
            }
            if (snapshot) {
                responseReport.snapshot = snapshot;
                responseReport.evidenceItems = snapshot.evidenceItems || [];
                responseReport.limitations = snapshot.limitations || [];
                responseReport.featureVector = snapshot.featureVector || null;
            }
        }
        catch (sErr) {
            console.warn('[SERVER] Could not load AiSnapshot for report #' + id + ':', sErr.message);
        }
        // Attach video analysis job info if available
        try {
            if (report.sourceVideoId && report.incidentKey) {
                const { VideoAnalysisJobModel } = require('./database/models/VideoAnalysisJob');
                const job = await VideoAnalysisJobModel.findOne({ sourceVideoId: report.sourceVideoId }).lean().exec();
                if (job) {
                    responseReport.videoAnalysisJobId = job._id.toString();
                    const parts = report.incidentKey.split(':');
                    responseReport.shortIncidentKey = parts[parts.length - 1];
                }
            }
        }
        catch (vErr) {
            console.warn('[SERVER] Could not load VideoAnalysisJob for report #' + id + ':', vErr.message);
        }
        res.json(responseReport);
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/detections/:id failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// API: Update Admin Verification Status
app.post('/api/detections/:id/verify', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
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
        const updatedReport = await db_1.DatabaseManager.updateVerification(id, status, notes || '', assignedOfficer, progressStatus);
        if (!updatedReport) {
            return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        }
        // Rekam audit log aksi manual override verifikasi admin
        await db_1.SystemAuditLogModel.create({
            tenantId: 'BBWS',
            actorId: user._id,
            actorName: user.username,
            action: 'VERIFY_REPORT',
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
            details: {
                reportId: id,
                adminStatus: status,
                notes: notes || '',
                assignedOfficer,
                progressStatus
            }
        });
        res.json(updatedReport);
    }
    catch (err) {
        console.error('[SERVER ERROR] Verify report failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// API: Manual Broadcast to Telegram Channel
app.post('/api/detections/:id/telegram', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized: Harap masuk terlebih dahulu.' });
        }
        const id = parseInt(req.params.id);
        const report = await Report_1.ReportModel.findOne({ id }).exec();
        if (!report) {
            return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        }
        const channel = new TelegramNotificationChannel_1.TelegramNotificationChannel();
        const success = await channel.send(report);
        if (success) {
            // Rekam audit log aksi penyiaran manual
            await db_1.SystemAuditLogModel.create({
                tenantId: 'BBWS',
                actorId: user._id,
                actorName: user.username,
                action: 'MANUAL_TELEGRAM_BROADCAST',
                ipAddress: req.ip || '',
                userAgent: req.headers['user-agent'] || '',
                details: { reportId: id }
            });
            return res.json({ success: true, message: 'Notifikasi berhasil dikirim ke Telegram.' });
        }
        else {
            return res.status(500).json({ error: 'Gagal mengirim notifikasi Telegram. Periksa status keaktifan Telegram dan ID chat di konfigurasi.' });
        }
    }
    catch (err) {
        console.error('[SERVER ERROR] Telegram manual broadcast failed:', err);
        res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
});
// Helper functions for standard API responses
function sendSuccess(res, data, status = 200) {
    return res.status(status).json({ success: true, data });
}
function sendError(res, message, status = 400) {
    return res.status(status).json({ success: false, message });
}
// Rate limiters for commenting and liking
const commentLimiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: 30 * 1000, // 30 seconds
    max: 5, // Limit each IP to 5 comments per windowMs
    message: { success: false, message: 'Terlalu banyak mengirim komentar, silakan tunggu 30 detik.' },
    standardHeaders: true,
    legacyHeaders: false,
});
const likeLimiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // Limit each IP to 30 likes per windowMs
    message: { success: false, message: 'Terlalu banyak menekan tombol suka, silakan tunggu 1 menit.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.get('/logout', (req, res) => {
    res.clearCookie('session_token');
    res.redirect('/login');
});
// Superadmin pages
app.get(['/superadmin', '/superadmin/dashboard', '/superadmin/admins', '/superadmin/workspaces'], authMiddleware_2.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/superadmin.html'));
});
// POST /api/detections/:id/comments - Add a comment (rate-limited)
app.post('/api/detections/:id/comments', commentLimiter, async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user) {
            return sendError(res, 'Unauthorized', 401);
        }
        const reportId = parseInt(req.params.id);
        const { text } = req.body;
        if (!text || typeof text !== 'string') {
            return sendError(res, 'Konten komentar harus diisi.', 400);
        }
        const comment = await db_1.DatabaseManager.addComment(reportId, user.id, text);
        // Resolve comment author details for direct frontend integration
        return sendSuccess(res, {
            ...comment.toJSON(),
            username: user.username,
            role: user.role
        }, 201);
    }
    catch (err) {
        console.error('[SERVER ERROR] Create comment failed:', err);
        return sendError(res, err.message || 'Internal Server Error', 500);
    }
});
// Superadmin Workspace Detail
app.get('/superadmin/workspaces/:id', authMiddleware_2.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/workspace-detail.html'));
});
// Dashboard — unified for admin AND user
app.get(['/dashboard', '/dashboard/laporan', '/dashboard/upload', '/dashboard/profile', '/dashboard/berita', '/dashboard/users', '/dashboard/cctv', '/dashboard/join-requests', '/dashboard/cctv-monitoring'], authMiddleware_2.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'user', 'operator', 'supervisor', 'officer']), (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/dashboard.html'));
});
// Single report detail page
app.get('/dashboard/detections/:id', authMiddleware_2.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'user', 'operator', 'supervisor', 'officer']), (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/dashboard.html'));
});
// News public detail page
app.get('/berita/:slug', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/news-detail.html'));
});
// --- PUBLIC INFO PAGES (no auth required) ---
app.get('/tentang', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/tentang.html'));
});
app.get('/kebijakan', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/kebijakan.html'));
});
app.get('/kontak', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/kontak.html'));
});
// Forgot & Reset Password pages (no auth)
app.get('/lupa-password', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/forgot-password.html'));
});
app.get('/reset-password', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/reset-password.html'));
});
// Select Workspace — user only
app.get('/select-workspace', authMiddleware_2.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['user', 'operator', 'supervisor', 'officer']), (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/select-workspace.html'));
});
// Invite link for workspaces
app.get('/join/:code', async (req, res) => {
    try {
        const code = req.params.code;
        const ws = await db_1.WorkspaceModel.findOne({ code: code.toUpperCase() }).lean().exec();
        if (!ws) {
            return res.redirect('/select-workspace?error=invalid_link');
        }
        if (!req.userContext) {
            return res.redirect(`/register?join=${ws.id}`);
        }
        res.redirect(`/select-workspace?join=${ws.id}`);
    }
    catch (err) {
        res.redirect('/select-workspace');
    }
});
// --- FEATURE ROUTES ---
app.use('/api/cctv', cctvRoutes_1.default);
app.use('/api/news', newsRoutes_1.default);
function listenWithFallback(port, attempts = 10) {
    return new Promise((resolve, reject) => {
        const server = app.listen(port);
        server.once('listening', () => {
            CctvHealthEngine_1.CctvHealthEngine.start();
            // Warmup AI model di background — jangan block startup
            (0, aiDetection_service_1.warmupAI)().then((res) => {
                if (!res.success) {
                    console.warn('[AI] Model tidak tersedia. Deteksi AI dinonaktifkan. Upload laporan tetap berfungsi.');
                }
            });
            serverInstance = server;
            resolve(port);
        });
        server.once('error', (err) => {
            server.close();
            if (err.code === 'EADDRINUSE' && attempts > 0) {
                console.warn(`[SERVER WARNING] Port ${port} sedang digunakan. Mencoba port ${port + 1}...`);
                listenWithFallback(port + 1, attempts - 1).then(resolve).catch(reject);
                return;
            }
            reject(err);
        });
    });
}
// --- NOTIFICATIONS API ---
// GET /api/notifications — Fetch in-app notifications for current user
app.get('/api/notifications', authMiddleware_2.authMiddleware, async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        const notifications = await Notification_1.NotificationModel.find({
            recipientId: user._id,
            deletedAt: null,
        })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean()
            .exec();
        res.json({ success: true, notifications });
    }
    catch (err) {
        console.error('[SERVER ERROR] Fetch notifications failed:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// PATCH /api/notifications/:id/read — Mark single notification as read
app.patch('/api/notifications/:id/read', authMiddleware_2.authMiddleware, async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        const notif = await Notification_1.NotificationModel.findOneAndUpdate({ _id: req.params.id, recipientId: user._id, deletedAt: null }, { read: true, readAt: new Date() }, { new: true });
        if (!notif)
            return res.status(404).json({ error: 'Notifikasi tidak ditemukan' });
        res.json({ success: true, notification: notif });
    }
    catch (err) {
        console.error('[SERVER ERROR] Mark notification read failed:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// PATCH /api/notifications/read-all — Mark all notifications as read
app.patch('/api/notifications/read-all', authMiddleware_2.authMiddleware, async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user)
            return res.status(401).json({ error: 'Unauthorized' });
        await Notification_1.NotificationModel.updateMany({ recipientId: user._id, read: false, deletedAt: null }, { read: true, readAt: new Date() });
        res.json({ success: true });
    }
    catch (err) {
        console.error('[SERVER ERROR] Mark all notifications read failed:', err.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// --- CCTV API ENDPOINTS ---
// GET /api/cctv - List all CCTV channels
app.get('/api/cctv', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user) {
            return res.status(401).json({ error: 'Belum masuk' });
        }
        const cctvs = await db_1.DatabaseManager.getAllCctv();
        // Decrypt / enrich each CCTV config with playUrl dynamically
        const processed = cctvs.map(c => {
            const playTarget = CctvAdapter_1.CctvAdapter.getPlayTarget(c);
            return {
                ...c,
                playUrl: playTarget.playUrl,
                mediaType: playTarget.playType,
                // Hide password in listing
                password: c.password ? '••••••••' : ''
            };
        });
        res.json({ success: true, data: processed });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/cctv failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET /api/cctv/:id - Fetch single CCTV detail
app.get('/api/cctv/:id', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user) {
            return res.status(401).json({ error: 'Belum masuk' });
        }
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'ID tidak valid' });
        }
        const c = await db_1.DatabaseManager.getCctvById(id);
        if (!c) {
            return res.status(404).json({ error: 'CCTV tidak ditemukan' });
        }
        // Expose password decrypted to admin only for editing
        const decryptedPassword = user.role === 'admin' && c.password
            ? db_1.DatabaseManager.decryptCctvPassword(c.password)
            : '';
        const playTarget = CctvAdapter_1.CctvAdapter.getPlayTarget(c);
        res.json({
            success: true,
            data: {
                ...c,
                playUrl: playTarget.playUrl,
                mediaType: playTarget.playType,
                password: decryptedPassword
            }
        });
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/cctv/:id failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// POST /api/cctv/scan - Capability Discovery Scan
app.post('/api/cctv/scan', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
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
        const scanResult = await CctvScanner_1.CctvScanner.scan(ipOrHost, username, password, vendorHint, port ? parseInt(port) : undefined, connectionMode);
        res.json({ success: true, data: scanResult });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/cctv/scan failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// POST /api/cctv - Connect CCTV (admin-only)
app.post('/api/cctv', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user) {
            return res.status(401).json({ error: 'Belum masuk' });
        }
        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Akses ditolak: Khusus Admin' });
        }
        const newCctv = await db_1.DatabaseManager.addCctv(req.body, user.id);
        // Instantly check camera health upon connection
        CctvHealthEngine_1.CctvHealthEngine.checkCameraHealth(newCctv.id);
        res.json({ success: true, data: newCctv });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/cctv failed:', err);
        res.status(400).json({ error: err.message || 'Gagal menambahkan CCTV' });
    }
});
// PUT /api/cctv/:id - Update CCTV (admin-only)
app.put('/api/cctv/:id', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
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
        const updated = await db_1.DatabaseManager.updateCctv(id, req.body);
        // Instantly trigger health check to update status
        CctvHealthEngine_1.CctvHealthEngine.checkCameraHealth(id);
        res.json({ success: true, data: updated });
    }
    catch (err) {
        console.error('[SERVER ERROR] PUT /api/cctv/:id failed:', err);
        res.status(400).json({ error: err.message || 'Gagal mengubah CCTV' });
    }
});
// DELETE /api/cctv/:id - Disconnect CCTV (admin-only)
app.delete('/api/cctv/:id', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
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
        await db_1.DatabaseManager.deleteCctv(id);
        res.json({ success: true, message: 'CCTV berhasil diputuskan' });
    }
    catch (err) {
        console.error('[SERVER ERROR] DELETE /api/cctv/:id failed:', err);
        res.status(400).json({ error: err.message || 'Gagal menghapus CCTV' });
    }
});
// POST /api/cctv/:id/reconnect - Trigger manual reconnect
app.post('/api/cctv/:id/reconnect', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
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
        const success = await CctvHealthEngine_1.CctvHealthEngine.manualReconnect(id);
        if (success) {
            res.json({ success: true, message: 'Reconnection triggered' });
        }
        else {
            res.status(400).json({ error: 'Failed to trigger reconnect' });
        }
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/cctv/:id/reconnect failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET /api/cctv/:id/snapshot - Snapshot image proxy fallback
app.get('/api/cctv/:id/snapshot', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const camera = await db_1.DatabaseManager.getCctvById(id);
        if (!camera) {
            return res.status(404).send('Camera not found');
        }
        // Proxy the snapshot, or fallback to the static asset image
        if (camera.isDefault || camera.protocol === 'HTTP Image') {
            res.redirect(camera.streamUrl);
        }
        else {
            // Return default camera 1 image as fallback
            res.redirect('/uploads/detection_1.jpg');
        }
    }
    catch (err) {
        res.status(500).send('Internal Server Error');
    }
});
// POST /api/cctv/monitoring - Global toggle monitoring
app.post('/api/cctv/monitoring', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden: Hanya Admin yang dapat memodifikasi status pemantauan.' });
        }
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'Parameter "enabled" wajib boolean.' });
        }
        await db_1.CctvModel.updateMany({}, { $set: { monitoringEnabled: enabled, status: enabled ? 'MONITORING' : 'PAUSED' } });
        console.log(`[SERVER INFO] Global monitoring toggle set to ${enabled} by user ${user.username}`);
        res.json({ success: true, monitoringEnabled: enabled });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/cctv/monitoring failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// PATCH /api/cctv/:id/monitoring - Per-camera toggle monitoring
app.patch('/api/cctv/:id/monitoring', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden: Hanya Admin yang dapat memodifikasi status pemantauan.' });
        }
        const id = parseInt(req.params.id);
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'Parameter "enabled" wajib boolean.' });
        }
        const camera = await db_1.CctvModel.findOne({ id });
        if (!camera) {
            return res.status(404).json({ error: 'Camera not found' });
        }
        camera.monitoringEnabled = enabled;
        camera.status = enabled ? 'MONITORING' : 'PAUSED';
        await camera.save();
        console.log(`[SERVER INFO] Camera ID ${id} monitoring set to ${enabled} by user ${user.username}`);
        res.json({ success: true, cameraId: id, monitoringEnabled: enabled });
    }
    catch (err) {
        console.error('[SERVER ERROR] PATCH /api/cctv/:id/monitoring failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET /api/ai-detections - Retrieve raw AI detections log
app.get('/api/ai-detections', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const detections = await db_1.AiDetectionModel.find().sort({ createdAt: -1 }).limit(100).lean();
        res.json(detections);
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/ai-detections failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET /api/ai-evidences - Retrieve raw AI evidences log
app.get('/api/ai-evidences', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const evidences = await db_1.AiEvidenceModel.find().sort({ createdAt: -1 }).limit(100).lean();
        res.json(evidences);
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/ai-evidences failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET /api/system-settings - Retrieve configuration settings
app.get('/api/system-settings', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const settings = await db_1.SystemSettingsModel.find().lean();
        res.json(settings);
    }
    catch (err) {
        console.error('[SERVER ERROR] GET /api/system-settings failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// POST /api/system-settings - Update configuration settings
app.post('/api/system-settings', async (req, res) => {
    try {
        const user = await (0, authMiddleware_1.getLoggedInUser)(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden: Hanya Admin yang dapat memodifikasi konfigurasi.' });
        }
        const { key, value, reason, approvedBy } = req.body;
        if (!key || value === undefined) {
            return res.status(400).json({ error: 'Parameter "key" dan "value" wajib diisi.' });
        }
        const setting = await db_1.SystemSettingsModel.findOne({ key });
        if (!setting) {
            return res.status(404).json({ error: 'Konfigurasi tidak ditemukan.' });
        }
        const oldValue = setting.value;
        setting.value = value;
        setting.updatedBy = user.id;
        await setting.save();
        // Rekam log audit perubahan konfigurasi sistem (Before, After, Reason, Approved By)
        await db_1.SystemAuditLogModel.create({
            tenantId: 'BBWS',
            actorId: user._id,
            actorName: user.username,
            action: 'UPDATE_SYSTEM_SETTINGS',
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
            details: {
                key,
                oldValue,
                newValue: value,
                reason: reason || 'Optimasi berkala performa modul deteksi.',
                approvedBy: approvedBy || 'Supervisor'
            }
        });
        console.log(`[SERVER INFO] Configuration setting "${key}" updated from "${JSON.stringify(oldValue)}" to "${JSON.stringify(value)}" by user ${user.username}`);
        res.json({ success: true, key, value });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/system-settings failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
let serverInstance;
// --- START SERVER ---
(0, db_1.connectDB)().then(async () => {
    // Ensure all user passwords use bcrypt (migrate SHA-256 -> bcrypt)
    try {
        const bcrypt = require('bcrypt');
        const userWithSha = await User_1.UserModel.find({
            passwordHash: { $not: /^\$2/ }
        }).select('+passwordHash').exec();
        for (const u of userWithSha) {
            if (u.passwordHash && !u.passwordHash.startsWith('$2')) {
                u.passwordHash = await bcrypt.hash(u.passwordHash, 10);
                await u.save();
            }
        }
        if (userWithSha.length > 0) {
            console.log(`[PASSWORD MIGRATION] Converted ${userWithSha.length} user password(s) from SHA-256 to bcrypt.`);
        }
    }
    catch (_) { }
    // CCTV Health Engine is started inside listenWithFallback
    // AiPipelineScheduler.start(); — disabled, no more CCTV reports
    OutboxWorker_1.OutboxWorker.start();
    // Start background video analysis worker as a separate process
    try {
        const { spawn } = require('child_process');
        const workerScript = path_1.default.resolve(__dirname, './services/ai/videoWorker.js');
        console.log(`[SERVER INFO] Spawning background video worker process: ${process.execPath} ${workerScript}...`);
        const worker = spawn(process.execPath, [workerScript], {
            detached: true,
            stdio: 'ignore',
            cwd: path_1.default.resolve(__dirname, '../')
        });
        worker.unref();
    }
    catch (wErr) {
        console.error('[SERVER ERROR] Failed to spawn video worker:', wErr.message);
    }
    const activePort = await listenWithFallback(PORT);
    console.log(`[SERVER] EYECO berjalan di http://localhost:${activePort}`);
}).catch((err) => {
    console.error('[SERVER CRITICAL] Failed to connect to database. Server not started.', err);
    process.exit(1);
});
// Coordinated Graceful Shutdown Handler
const gracefulShutdown = async (signal) => {
    console.log(`\n[SERVER] Received ${signal}. Starting coordinated graceful shutdown...`);
    // 1. Stop AI Pipeline Scheduler (which halts capture and triggers InferenceQueue shutdown)
    try {
        console.log('[SERVER] Stopping AI Pipeline Scheduler...');
        await AiPipelineScheduler_1.AiPipelineScheduler.stop();
    }
    catch (err) {
        console.error('[SERVER ERROR] Failed to stop AiPipelineScheduler:', err.message);
    }
    // 2. Stop CCTV Health Engine
    try {
        console.log('[SERVER] Stopping CCTV Health Engine...');
        CctvHealthEngine_1.CctvHealthEngine.stop();
    }
    catch (err) {
        console.error('[SERVER ERROR] Failed to stop CctvHealthEngine:', err.message);
    }
    // 3. Stop Outbox Worker
    try {
        console.log('[SERVER] Stopping Outbox Worker...');
        OutboxWorker_1.OutboxWorker.stop();
    }
    catch (err) {
        console.error('[SERVER ERROR] Failed to stop OutboxWorker:', err.message);
    }
    // 4. Close database connection
    try {
        console.log('[SERVER] Closing database connection...');
        await (0, db_1.disconnectDB)();
    }
    catch (err) {
        console.error('[SERVER ERROR] Failed to disconnect database:', err.message);
    }
    // 5. Close HTTP server listener
    if (serverInstance) {
        console.log('[SERVER] Closing HTTP server listener...');
        serverInstance.close(() => {
            console.log('[SERVER] HTTP server closed.');
            console.log('[SERVER] Graceful shutdown completed. Exiting process.');
            process.exit(0);
        });
        // Force exit after 10 seconds if HTTP server hangs
        setTimeout(() => {
            console.warn('[SERVER WARNING] Coordinated shutdown timed out. Forcing exit.');
            process.exit(1);
        }, 10000);
    }
    else {
        console.log('[SERVER] Coordinated shutdown completed. Exiting process.');
        process.exit(0);
    }
};
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
