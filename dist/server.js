"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const db_1 = require("./database/db");
const CctvHealthEngine_1 = require("./cctv/CctvHealthEngine");
const authMiddleware_1 = require("./auth/authMiddleware");
const RoleMiddleware_1 = require("./auth/RoleMiddleware");
// Import modular routers
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const superadminRoutes_1 = __importDefault(require("./routes/superadminRoutes"));
const workspaceRoutes_1 = __importDefault(require("./routes/workspaceRoutes"));
const adminRoutes_1 = __importDefault(require("./routes/adminRoutes"));
const reportRoutes_1 = __importDefault(require("./routes/reportRoutes"));
const cctvRoutes_1 = __importDefault(require("./routes/cctvRoutes"));
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
// --- MIDDLEWARE ---
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.use((0, cookie_parser_1.default)());
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
app.get('/logout', (req, res) => {
    res.clearCookie('session_token');
    res.redirect('/login');
});
// Superadmin pages
app.get(['/superadmin', '/superadmin/dashboard', '/superadmin/admins', '/superadmin/workspaces'], authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/superadmin.html'));
});
// Superadmin Workspace Detail
app.get('/superadmin/workspaces/:id', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['superadmin']), (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/workspace-detail.html'));
});
// Dashboard — unified for admin AND user
app.get(['/dashboard', '/dashboard/laporan', '/dashboard/upload', '/dashboard/users', '/dashboard/cctv', '/dashboard/join-requests'], authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'user']), (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/dashboard.html'));
});
// Single report detail page
app.get('/dashboard/detections/:id', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'user']), (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/views/dashboard.html'));
});
// Select Workspace — user only
app.get('/select-workspace', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['user']), (req, res) => {
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
app.use('/api', reportRoutes_1.default);
app.use('/api/cctv', cctvRoutes_1.default);
function listenWithFallback(port, attempts = 10) {
    return new Promise((resolve, reject) => {
        const server = app.listen(port);
        server.once('listening', () => {
            CctvHealthEngine_1.CctvHealthEngine.start();
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
// --- START SERVER ---
(0, db_1.connectDB)().then(async () => {
    const activePort = await listenWithFallback(PORT);
    console.log(`[SERVER] EYECO berjalan di http://localhost:${activePort}`);
}).catch((err) => {
    console.error('[SERVER CRITICAL] Failed to connect to database. Server not started.', err);
    process.exit(1);
});
