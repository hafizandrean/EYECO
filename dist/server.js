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
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("./database/db");
const Report_1 = require("./database/models/Report");
const User_1 = require("./database/models/User");
const Cctv_1 = require("./database/models/Cctv");
const CctvHealthEngine_1 = require("./cctv/CctvHealthEngine");
const CctvScanner_1 = require("./cctv/CctvScanner");
const CctvAdapter_1 = require("./cctv/CctvAdapter");
const AiPipelineScheduler_1 = require("./cctv/services/AiPipelineScheduler");
const AiEngineHealthMonitor_1 = require("./cctv/services/AiEngineHealthMonitor");
const OutboxWorker_1 = require("./notifications/OutboxWorker");
const TelegramNotificationChannel_1 = require("./notifications/TelegramNotificationChannel");
const MaintenanceScheduler_1 = require("./cctv/services/MaintenanceScheduler");
const SessionService_1 = require("./services/SessionService");
const AuditLogService_1 = require("./services/AuditLogService");
const ApiResponse_1 = require("./services/ApiResponse");
dotenv_1.default.config();
// Tuya API integration for dynamic cloud camera streams (e.g. CCTV Krisbow Solar)
let tuyaTokenCache = {};
let tuyaStreamCache = {};
async function getTuyaToken(clientId = 'r5vap3snnr339dyeua5j', secret = '5a93707b474b41b9b888b1e2a12ed1c9') {
    const baseUrl = 'https://openapi-sg.iotbing.com';
    const cached = tuyaTokenCache[clientId];
    if (cached && cached.expiresAt > Date.now()) {
        return cached.token;
    }
    try {
        const t = Date.now().toString();
        const tokenUrl = '/v1.0/token?grant_type=1';
        const contentSha256 = crypto_1.default.createHash('sha256').update('').digest('hex');
        const tokenStringToSign = `GET\n${contentSha256}\n\n${tokenUrl}`;
        const tokenStr = `${clientId}${t}${tokenStringToSign}`;
        const tokenSign = crypto_1.default.createHmac('sha256', secret).update(tokenStr).digest('hex').toUpperCase();
        const tokenResponse = await fetch(`${baseUrl}${tokenUrl}`, {
            method: 'GET',
            headers: {
                'client_id': clientId,
                'sign': tokenSign,
                't': t,
                'sign_method': 'HMAC-SHA256'
            }
        });
        const tokenData = await tokenResponse.json();
        if (tokenData.success && tokenData.result) {
            tuyaTokenCache[clientId] = {
                token: tokenData.result.access_token,
                expiresAt: Date.now() + (tokenData.result.expire_time - 60) * 1000
            };
            return tokenData.result.access_token;
        }
    }
    catch (err) {
        console.error('[TUYA API] Token fetch failed:', err);
    }
    return null;
}
async function getTuyaStreamUrl(deviceId, definition = 'hd', clientId = 'r5vap3snnr339dyeua5j', secret = '5a93707b474b41b9b888b1e2a12ed1c9') {
    const baseUrl = 'https://openapi-sg.iotbing.com';
    const cacheKey = `${deviceId}_${definition}`;
    if (tuyaStreamCache[cacheKey] && tuyaStreamCache[cacheKey].expiresAt > Date.now()) {
        return tuyaStreamCache[cacheKey].url;
    }
    const token = await getTuyaToken(clientId, secret);
    if (!token)
        return null;
    try {
        const t2 = Date.now().toString();
        const httpMethod = 'POST';
        const bodyObj = { type: 'hls', definition: definition };
        const bodyStr = JSON.stringify(bodyObj);
        const contentSha256 = crypto_1.default.createHash('sha256').update(bodyStr).digest('hex');
        const allocateUrl = `/v1.0/devices/${deviceId}/stream/actions/allocate`;
        const stringToSign = `${httpMethod}\n${contentSha256}\n\n${allocateUrl}`;
        const str = `${clientId}${token}${t2}${stringToSign}`;
        const sign = crypto_1.default.createHmac('sha256', secret).update(str).digest('hex').toUpperCase();
        const response = await fetch(`${baseUrl}${allocateUrl}`, {
            method: 'POST',
            headers: {
                'client_id': clientId,
                'access_token': token,
                'sign': sign,
                't': t2,
                'sign_method': 'HMAC-SHA256',
                'Content-Type': 'application/json'
            },
            body: bodyStr
        });
        const data = await response.json();
        if (data.success && data.result && data.result.url) {
            tuyaStreamCache[cacheKey] = {
                url: data.result.url,
                expiresAt: Date.now() + 5400 * 1000 // Cache for 1.5 hours
            };
            return data.result.url;
        }
        else {
            console.warn('[TUYA API] HLS stream allocation failed or not subscribed:', data.msg || data.error);
        }
    }
    catch (err) {
        console.error('[TUYA API] HLS stream allocation error:', err);
    }
    return null;
}
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
// Request ID middleware and Disable Cache in Dev
app.use((req, res, next) => {
    const reqId = crypto_1.default.randomUUID();
    req.requestId = reqId;
    res.setHeader('X-Request-ID', reqId);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    next();
});
// Setup middleware
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
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
    const userId = await SessionService_1.SessionService.getUserId(token);
    if (userId === undefined)
        return null;
    try {
        const user = await db_1.DatabaseManager.getUserById(userId);
        if (!user || user.isDeleted || user.status === 'CLOSED') {
            return null;
        }
        return user;
    }
    catch (err) {
        console.error('[SERVER ERROR] Failed to fetch session user:', err);
        return null;
    }
}
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
        // Check CLOSED or isDeleted status
        if (user.isDeleted || user.status === 'CLOSED') {
            return res.status(403).json({ error: 'Akun Anda telah ditutup.' });
        }
        // Update lastLoginAt
        await User_1.UserModel.updateOne({ id: user.id }, { lastLoginAt: new Date() });
        // Create session (default 24h TTL)
        const token = 'sess_' + crypto_1.default.randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await SessionService_1.SessionService.createSession(token, user.id, expiresAt);
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
app.post('/api/auth/logout', async (req, res) => {
    const cookieHeader = req.headers.cookie || '';
    const cookies = cookieHeader.split(';').reduce((acc, c) => {
        const [key, val] = c.trim().split('=');
        if (key && val)
            acc[key] = val;
        return acc;
    }, {});
    const token = cookies['session_token'];
    if (token) {
        const userId = await SessionService_1.SessionService.getUserId(token);
        if (userId !== undefined) {
            const userObj = await db_1.DatabaseManager.getUserById(userId);
            if (userObj) {
                await AuditLogService_1.AuditLogService.log({
                    action: AuditLogService_1.AuditAction.LOGOUT,
                    actorId: userObj._id,
                    actorName: userObj.username,
                    status: 'SUCCESS',
                    requestId: req.requestId,
                    ipAddress: req.ip || '',
                    userAgent: req.headers['user-agent'] || ''
                });
            }
        }
        await SessionService_1.SessionService.deleteSession(token);
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
// POST /api/logout
app.post('/api/logout', async (req, res) => {
    try {
        const cookieHeader = req.headers.cookie || '';
        const cookies = cookieHeader.split(';').reduce((acc, c) => {
            const [key, val] = c.trim().split('=');
            if (key && val)
                acc[key] = val;
            return acc;
        }, {});
        const token = cookies['session_token'];
        if (token) {
            const userId = await SessionService_1.SessionService.getUserId(token);
            if (userId !== undefined) {
                const userObj = await db_1.DatabaseManager.getUserById(userId);
                if (userObj) {
                    await AuditLogService_1.AuditLogService.log({
                        action: AuditLogService_1.AuditAction.LOGOUT,
                        actorId: userObj._id,
                        actorName: userObj.username,
                        status: 'SUCCESS',
                        requestId: req.requestId,
                        ipAddress: req.ip || '',
                        userAgent: req.headers['user-agent'] || ''
                    });
                }
            }
            await SessionService_1.SessionService.deleteSession(token);
        }
        res.setHeader('Set-Cookie', 'session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly');
        return ApiResponse_1.ApiResponse.success(res, 'Berhasil keluar sesi.', null, req.requestId);
    }
    catch (err) {
        return ApiResponse_1.ApiResponse.error(res, 'Gagal keluar sesi.', 'LOGOUT_FAILED', req.requestId, 500);
    }
});
// GET /api/profile
app.get('/api/profile', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user) {
            return ApiResponse_1.ApiResponse.error(res, 'Belum masuk', 'UNAUTHORIZED', req.requestId, 401);
        }
        return ApiResponse_1.ApiResponse.success(res, 'Profil berhasil dimuat.', {
            id: String(user.id),
            username: user.username,
            email: user.email || null,
            role: user.role.toUpperCase(),
            accountStatus: user.status || 'APPROVED',
            createdAt: user.createdAt || null,
            avatar: null,
            security: {
                passwordChangedAt: user.passwordChangedAt || null,
                lastLoginAt: user.lastLoginAt || null
            },
            preferencesVersion: user.preferencesVersion || 1,
            preferences: user.preferences || {
                theme: 'dark',
                language: 'id',
                timezone: 'Asia/Jakarta'
            }
        }, req.requestId);
    }
    catch (err) {
        return ApiResponse_1.ApiResponse.error(res, err.message || 'Internal Server Error', 'INTERNAL_SERVER_ERROR', req.requestId, 500);
    }
});
// PATCH /api/profile/password
app.patch('/api/profile/password', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user) {
            return ApiResponse_1.ApiResponse.error(res, 'Belum masuk', 'UNAUTHORIZED', req.requestId, 401);
        }
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return ApiResponse_1.ApiResponse.error(res, 'Password lama dan baru wajib diisi', 'BAD_REQUEST', req.requestId, 400);
        }
        // Get minLength dynamic setting
        const minLengthSetting = await db_1.SystemSettingsModel.findOne({ key: 'security.password.minLength' }).exec();
        const minLength = minLengthSetting ? Number(minLengthSetting.value) : 6;
        if (newPassword.length < minLength) {
            await AuditLogService_1.AuditLogService.log({
                action: AuditLogService_1.AuditAction.PASSWORD_CHANGED,
                actorId: user._id,
                actorName: user.username,
                status: 'FAILED',
                requestId: req.requestId,
                ipAddress: req.ip || '',
                userAgent: req.headers['user-agent'] || '',
                details: { userId: user.id, error: 'Password too short' }
            });
            return ApiResponse_1.ApiResponse.error(res, `Password baru minimal ${minLength} karakter`, 'PASSWORD_TOO_SHORT', req.requestId, 400);
        }
        if (currentPassword === newPassword) {
            return ApiResponse_1.ApiResponse.error(res, 'Password baru tidak boleh sama dengan password lama', 'PASSWORD_SAME', req.requestId, 400);
        }
        // Find user document to verify current password
        const userDoc = await User_1.UserModel.findOne({ id: user.id }).select('+passwordHash').exec();
        if (!userDoc) {
            return ApiResponse_1.ApiResponse.error(res, 'User tidak ditemukan', 'USER_NOT_FOUND', req.requestId, 404);
        }
        const isBcrypt = userDoc.passwordHash.startsWith('$2');
        let match = false;
        if (isBcrypt) {
            match = await bcrypt_1.default.compare(currentPassword, userDoc.passwordHash);
        }
        else {
            const sha256Hash = crypto_1.default.createHash('sha256').update(currentPassword).digest('hex');
            match = (sha256Hash === userDoc.passwordHash);
        }
        if (!match) {
            await AuditLogService_1.AuditLogService.log({
                action: AuditLogService_1.AuditAction.PASSWORD_CHANGED,
                actorId: user._id,
                actorName: user.username,
                status: 'FAILED',
                requestId: req.requestId,
                ipAddress: req.ip || '',
                userAgent: req.headers['user-agent'] || '',
                details: { userId: user.id, error: 'Invalid current password' }
            });
            return ApiResponse_1.ApiResponse.error(res, 'Password lama salah', 'INVALID_CURRENT_PASSWORD', req.requestId, 400);
        }
        // Check Password History (compare with last 3 passwords)
        if (userDoc.passwordHistory && userDoc.passwordHistory.length > 0) {
            for (const historyItem of userDoc.passwordHistory) {
                let historyMatch = false;
                const histIsBcrypt = historyItem.hash.startsWith('$2');
                if (histIsBcrypt) {
                    historyMatch = await bcrypt_1.default.compare(newPassword, historyItem.hash);
                }
                else {
                    const sha256Hash = crypto_1.default.createHash('sha256').update(newPassword).digest('hex');
                    historyMatch = (sha256Hash === historyItem.hash);
                }
                if (historyMatch) {
                    await AuditLogService_1.AuditLogService.log({
                        action: AuditLogService_1.AuditAction.PASSWORD_CHANGED,
                        actorId: user._id,
                        actorName: user.username,
                        status: 'FAILED',
                        requestId: req.requestId,
                        ipAddress: req.ip || '',
                        userAgent: req.headers['user-agent'] || '',
                        details: { userId: user.id, error: 'Password reused' }
                    });
                    return ApiResponse_1.ApiResponse.error(res, 'Password baru tidak boleh sama dengan 3 password terakhir yang digunakan', 'PASSWORD_REUSED', req.requestId, 400);
                }
            }
        }
        // Update password
        const hashed = await bcrypt_1.default.hash(newPassword, 10);
        const oldHash = userDoc.passwordHash;
        // Add current password to history
        if (!userDoc.passwordHistory) {
            userDoc.passwordHistory = [];
        }
        userDoc.passwordHistory.unshift({ hash: oldHash, changedAt: new Date() });
        if (userDoc.passwordHistory.length > 3) {
            userDoc.passwordHistory = userDoc.passwordHistory.slice(0, 3);
        }
        userDoc.passwordHash = hashed;
        userDoc.passwordChangedAt = new Date();
        await userDoc.save();
        await AuditLogService_1.AuditLogService.log({
            action: AuditLogService_1.AuditAction.PASSWORD_CHANGED,
            actorId: user._id,
            actorName: user.username,
            status: 'SUCCESS',
            requestId: req.requestId,
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
            details: { userId: user.id }
        });
        return ApiResponse_1.ApiResponse.success(res, 'Password berhasil diperbarui.', null, req.requestId);
    }
    catch (err) {
        return ApiResponse_1.ApiResponse.error(res, err.message || 'Internal Server Error', 'INTERNAL_SERVER_ERROR', req.requestId, 500);
    }
});
// PATCH /api/profile/preferences
app.patch('/api/profile/preferences', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user) {
            return ApiResponse_1.ApiResponse.error(res, 'Belum masuk', 'UNAUTHORIZED', req.requestId, 401);
        }
        const { theme, language, timezone } = req.body;
        // Validation
        if (theme && !['dark', 'light', 'system'].includes(theme)) {
            return ApiResponse_1.ApiResponse.error(res, 'Tema tidak valid', 'INVALID_THEME', req.requestId, 400);
        }
        if (language && !['id', 'en'].includes(language)) {
            return ApiResponse_1.ApiResponse.error(res, 'Bahasa tidak valid', 'INVALID_LANGUAGE', req.requestId, 400);
        }
        if (timezone) {
            try {
                Intl.DateTimeFormat(undefined, { timeZone: timezone });
            }
            catch (e) {
                return ApiResponse_1.ApiResponse.error(res, 'Timezone tidak valid', 'INVALID_TIMEZONE', req.requestId, 400);
            }
        }
        // Merge preferences
        const userDoc = await User_1.UserModel.findOne({ id: user.id }).exec();
        if (!userDoc) {
            return ApiResponse_1.ApiResponse.error(res, 'User tidak ditemukan', 'USER_NOT_FOUND', req.requestId, 404);
        }
        userDoc.preferences = {
            theme: theme !== undefined ? theme : (userDoc.preferences?.theme || 'dark'),
            language: language !== undefined ? language : (userDoc.preferences?.language || 'id'),
            timezone: timezone !== undefined ? timezone : (userDoc.preferences?.timezone || 'Asia/Jakarta')
        };
        await userDoc.save();
        await AuditLogService_1.AuditLogService.log({
            action: AuditLogService_1.AuditAction.PREFERENCES_UPDATED,
            actorId: user._id,
            actorName: user.username,
            status: 'SUCCESS',
            requestId: req.requestId,
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
            details: { preferences: userDoc.preferences }
        });
        return ApiResponse_1.ApiResponse.success(res, 'Preferensi berhasil diperbarui.', userDoc.preferences, req.requestId);
    }
    catch (err) {
        return ApiResponse_1.ApiResponse.error(res, err.message || 'Internal Server Error', 'INTERNAL_SERVER_ERROR', req.requestId, 500);
    }
});
// DELETE /api/profile
app.delete('/api/profile', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user) {
            return ApiResponse_1.ApiResponse.error(res, 'Belum masuk', 'UNAUTHORIZED', req.requestId, 401);
        }
        if (user.role === 'admin' || user.role === 'superadmin') {
            await AuditLogService_1.AuditLogService.log({
                action: AuditLogService_1.AuditAction.ACCOUNT_CLOSED,
                actorId: user._id,
                actorName: user.username,
                status: 'FAILED',
                requestId: req.requestId,
                ipAddress: req.ip || '',
                userAgent: req.headers['user-agent'] || '',
                details: { error: 'Administrator self deletion forbidden' }
            });
            return ApiResponse_1.ApiResponse.error(res, 'Administrator tidak dapat menutup akunnya sendiri.', 'ADMIN_SELF_DELETE_FORBIDDEN', req.requestId, 403);
        }
        const { password, feedback } = req.body;
        if (!password) {
            return ApiResponse_1.ApiResponse.error(res, 'Password konfirmasi wajib diisi', 'PASSWORD_REQUIRED', req.requestId, 400);
        }
        // Verify password
        const userDoc = await User_1.UserModel.findOne({ id: user.id }).select('+passwordHash').exec();
        if (!userDoc) {
            return ApiResponse_1.ApiResponse.error(res, 'User tidak ditemukan', 'USER_NOT_FOUND', req.requestId, 404);
        }
        const isBcrypt = userDoc.passwordHash.startsWith('$2');
        let match = false;
        if (isBcrypt) {
            match = await bcrypt_1.default.compare(password, userDoc.passwordHash);
        }
        else {
            const sha256Hash = crypto_1.default.createHash('sha256').update(password).digest('hex');
            match = (sha256Hash === userDoc.passwordHash);
        }
        if (!match) {
            await AuditLogService_1.AuditLogService.log({
                action: AuditLogService_1.AuditAction.ACCOUNT_CLOSED,
                actorId: user._id,
                actorName: user.username,
                status: 'FAILED',
                requestId: req.requestId,
                ipAddress: req.ip || '',
                userAgent: req.headers['user-agent'] || '',
                details: { error: 'Invalid password confirm' }
            });
            return ApiResponse_1.ApiResponse.error(res, 'Password konfirmasi salah', 'INVALID_PASSWORD', req.requestId, 400);
        }
        // Limit feedback to 500 characters
        const closureFeedback = feedback ? String(feedback).substring(0, 500) : '';
        // Soft delete
        userDoc.isDeleted = true;
        userDoc.status = 'CLOSED';
        userDoc.closedReason = 'USER_REQUEST';
        userDoc.closureFeedback = closureFeedback;
        userDoc.closedBy = user.id;
        userDoc.closedAt = new Date();
        await userDoc.save();
        // Invalidate sessions mass-device
        await SessionService_1.SessionService.invalidateAllUserSessions(user.id);
        // Audit log
        await AuditLogService_1.AuditLogService.log({
            action: AuditLogService_1.AuditAction.ACCOUNT_CLOSED,
            actorId: user._id,
            actorName: user.username,
            status: 'SUCCESS',
            requestId: req.requestId,
            ipAddress: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
            details: { closedReason: 'USER_REQUEST', closureFeedback }
        });
        res.setHeader('Set-Cookie', 'session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly');
        return ApiResponse_1.ApiResponse.success(res, 'Akun berhasil ditutup.', null, req.requestId);
    }
    catch (err) {
        return ApiResponse_1.ApiResponse.error(res, err.message || 'Internal Server Error', 'INTERNAL_SERVER_ERROR', req.requestId, 500);
    }
});
// --- VIEW ROUTING & GUARDS ---
// Helper to get redirect path based on role
function getRedirectPath(role) {
    if (role === 'superadmin')
        return '/superadmin';
    if (role === 'admin')
        return '/dashboard';
    return '/dashboard-user';
}
app.get('/login', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (user) {
            return res.redirect(getRedirectPath(user.role));
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
            return res.redirect(getRedirectPath(user.role));
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
        res.redirect(getRedirectPath(user.role));
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
        if (user.role !== 'admin') {
            return res.redirect(getRedirectPath(user.role));
        }
        res.sendFile(path_1.default.join(__dirname, '../public/views/dashboard.html'));
    }
    catch (err) {
        console.error('[SERVER ERROR] Dashboard view routing failed:', err);
        res.redirect('/login');
    }
});
app.get('/dashboard-user', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user)
            return res.redirect('/login');
        if (user.role === 'admin' || user.role === 'superadmin') {
            return res.redirect(getRedirectPath(user.role));
        }
        res.sendFile(path_1.default.join(__dirname, '../public/views/dashboard-user.html'));
    }
    catch (err) {
        res.redirect('/login');
    }
});
app.get('/cloud-viewer', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user)
            return res.redirect('/login');
        res.sendFile(path_1.default.join(__dirname, '../public/views/cloud-viewer.html'));
    }
    catch (err) {
        res.redirect('/login');
    }
});
app.get(['/superadmin', '/superadmin/dashboard', '/superadmin/admins', '/superadmin/workspaces'], async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user)
            return res.redirect('/login');
        if (user.role !== 'superadmin') {
            return res.redirect(getRedirectPath(user.role));
        }
        res.sendFile(path_1.default.join(__dirname, '../public/views/superadmin.html'));
    }
    catch (err) {
        res.redirect('/login');
    }
});
// GET /profile page route
app.get('/profile', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user)
            return res.redirect('/login');
        res.sendFile(path_1.default.join(__dirname, '../public/views/profile.html'));
    }
    catch (err) {
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
        const { status, notes, assignedOfficer, progressStatus } = req.body;
        if (!status || !['VALID', 'DIABAIKAN', 'MENUNGGU'].includes(status)) {
            return res.status(400).json({ error: 'Status tidak valid' });
        }
        const updatedReport = await db_1.DatabaseManager.updateVerification(id, status, notes || '', assignedOfficer, progressStatus);
        if (!updatedReport) {
            return res.status(404).json({ error: 'Laporan tidak ditemukan' });
        }
        // MLOps Dataset Feedback Loop
        try {
            const { DatasetFeedbackModel } = require('./database/models/DatasetFeedback');
            const fs = require('fs');
            const path = require('path');
            const crypto = require('crypto');
            const sourcePath = path.join(process.cwd(), 'public', updatedReport.image);
            if (fs.existsSync(sourcePath)) {
                // Calculate SHA256 of image
                const fileBuffer = fs.readFileSync(sourcePath);
                const imageHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
                // Parse Image Dimensions
                let imageWidth = 1280;
                let imageHeight = 720;
                try {
                    if (fileBuffer[0] === 0xFF && fileBuffer[1] === 0xD8) {
                        let i = 2;
                        while (i < fileBuffer.length) {
                            const marker = fileBuffer.readUInt16BE(i);
                            i += 2;
                            if (marker === 0xFFC0 || marker === 0xFFC2) {
                                i += 3;
                                imageHeight = fileBuffer.readUInt16BE(i);
                                i += 2;
                                imageWidth = fileBuffer.readUInt16BE(i);
                                break;
                            }
                            else {
                                const length = fileBuffer.readUInt16BE(i);
                                i += length;
                            }
                        }
                    }
                }
                catch (dimErr) {
                    console.warn('[MLOps] Failed to parse image dimensions, using fallback:', dimErr);
                }
                // Ensure datasets directory exists
                const datasetsDir = path.join(process.cwd(), 'public', 'datasets');
                if (!fs.existsSync(datasetsDir)) {
                    fs.mkdirSync(datasetsDir, { recursive: true });
                }
                // Copy/Hardlink frame
                const imageExt = path.extname(sourcePath) || '.jpg';
                const targetFileName = `${updatedReport.id}_${imageHash.substring(0, 16)}${imageExt}`;
                const targetPath = path.join(datasetsDir, targetFileName);
                try {
                    fs.linkSync(sourcePath, targetPath);
                    console.log(`[MLOps] Hardlinked frame to ${targetPath}`);
                }
                catch (linkErr) {
                    try {
                        fs.copyFileSync(sourcePath, targetPath);
                        console.log(`[MLOps] Copied frame to ${targetPath} (fallback)`);
                    }
                    catch (copyErr) {
                        console.error('[MLOps] Failed to copy frame file:', copyErr.message);
                    }
                }
                // Map detections & ground truth
                const originalDetections = (updatedReport.boundingBoxes || []).map((b) => ({
                    class: b.label,
                    confidence: (b.confidence || 0) / 100,
                    bbox: [b.x, b.y, b.w, b.h]
                }));
                const operatorLabel = req.body.operatorLabel || (status === 'VALID' ? 'APPROVED' : 'REJECTED');
                const groundTruth = operatorLabel === 'APPROVED' ? originalDetections.map((d) => ({
                    class: d.class,
                    bbox: d.bbox
                })) : [];
                const cameraId = updatedReport.sourceMetadata?.cameraId || parseInt(updatedReport.identity?.replace(/\D/g, '')) || 1;
                const modelId = updatedReport.sourceMetadata?.modelId || 'yolov8-river-v1.0';
                const modelVersion = updatedReport.sourceMetadata?.modelVersion || '1.0';
                const rand = Math.random();
                const datasetPartition = rand < 0.8 ? 'TRAIN' : 'VALIDATION';
                await DatasetFeedbackModel.create({
                    reportId: updatedReport.id,
                    reportObjectId: updatedReport._id,
                    cameraId,
                    imageHash,
                    imageWidth,
                    imageHeight,
                    originalDetections,
                    groundTruth,
                    modelId,
                    modelVersion,
                    operatorLabel,
                    reviewStatus: status === 'VALID' ? 'APPROVED' : 'REJECTED',
                    datasetPartition,
                    feedbackSource: 'OPERATOR_REVIEW',
                    operatorId: user._id,
                    qualityScore: operatorLabel === 'APPROVED' ? 100 : 0,
                    reviewedAt: new Date(),
                    reviewedBy: user.username,
                    processedForRetraining: false
                });
                console.log(`[MLOps] Saved DatasetFeedback for Report #${updatedReport.id}`);
            }
        }
        catch (mopsErr) {
            console.error('[MLOps ERROR] Dataset feedback loop failed:', mopsErr.message);
        }
        // Rekam audit log aksi manual override verifikasi admin
        await SystemAuditLogModel.create({
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
        const user = await getLoggedInUser(req);
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
            await SystemAuditLogModel.create({
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
const commentLimiter = (0, express_rate_limit_1.default)({
    windowMs: 30 * 1000, // 30 seconds
    max: 5, // Limit each IP to 5 comments per windowMs
    message: { success: false, message: 'Terlalu banyak mengirim komentar, silakan tunggu 30 detik.' },
    standardHeaders: true,
    legacyHeaders: false,
});
const likeLimiter = (0, express_rate_limit_1.default)({
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
        const report = await Report_1.ReportModel.findOne({ id: reportId }).lean();
        if (!report) {
            return sendError(res, 'Laporan tidak ditemukan', 404);
        }
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const sortBy = req.query.sortBy || 'newest';
        // Filter out deleted comments
        let activeComments = (report.comments || []).filter(c => !c.isDeleted);
        // Sort comments
        if (sortBy === 'newest') {
            activeComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        }
        else if (sortBy === 'oldest') {
            activeComments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        }
        else if (sortBy === 'most_liked') {
            activeComments.sort((a, b) => (b.likedBy || []).length - (a.likedBy || []).length);
        }
        // Paginate in memory
        const total = activeComments.length;
        const totalPages = Math.ceil(total / limit) || 1;
        const skip = (page - 1) * limit;
        const paginatedComments = activeComments.slice(skip, skip + limit);
        // Resolve usernames in a single query (avoid N+1)
        const uniqueUserIds = Array.from(new Set(paginatedComments.map(c => c.userId)));
        const users = await User_1.UserModel.find({ id: { $in: uniqueUserIds } }).select('id username role').lean();
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
    }
    catch (err) {
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
        await db_1.DatabaseManager.deleteComment(reportId, commentId, user.id, isAdmin);
        return sendSuccess(res, { success: true });
    }
    catch (err) {
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
        const comment = await db_1.DatabaseManager.toggleLikeComment(reportId, commentId, user.id);
        const isLiked = comment.likedBy.includes(user.id);
        return sendSuccess(res, {
            commentId,
            likedBy: comment.likedBy,
            likeCount: comment.likedBy.length,
            isLiked
        });
    }
    catch (err) {
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
// --- CCTV API ENDPOINTS ---
// GET /api/cctv - List all CCTV channels
app.get('/api/cctv', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Belum masuk' });
        }
        const cctvs = await db_1.DatabaseManager.getAllCctv();
        // Decrypt / enrich each CCTV config with playUrl dynamically
        const processed = await Promise.all(cctvs.map(async (c) => {
            const playTarget = CctvAdapter_1.CctvAdapter.getPlayTarget(c);
            let playUrl = playTarget.playUrl;
            let mediaType = playTarget.playType;
            if (c.protocol === 'CLOUD_VIEWER') {
                const deviceId = c.playUrl || 'a368caa9d0ba8c2813gfir';
                const clientId = c.username || 'r5vap3snnr339dyeua5j';
                const secret = c.password ? db_1.DatabaseManager.decryptCctvPassword(c.password) : '5a93707b474b41b9b888b1e2a12ed1c9';
                const tuyaUrl = await getTuyaStreamUrl(deviceId, 'hd', clientId, secret);
                if (tuyaUrl) {
                    playUrl = `/api/cctv/${c.id}/stream.m3u8`;
                    mediaType = 'Video'; // Dynamic HLS stream plays as HTML5 Video
                }
            }
            return {
                ...c,
                playUrl,
                mediaType,
                // Hide password in listing
                password: c.password ? '••••••••' : ''
            };
        }));
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
        const user = await getLoggedInUser(req);
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
        let playUrl = playTarget.playUrl;
        let mediaType = playTarget.playType;
        if (c.protocol === 'CLOUD_VIEWER') {
            const deviceId = c.playUrl || 'a368caa9d0ba8c2813gfir';
            const clientId = c.username || 'r5vap3snnr339dyeua5j';
            const secret = c.password ? db_1.DatabaseManager.decryptCctvPassword(c.password) : '5a93707b474b41b9b888b1e2a12ed1c9';
            const tuyaUrl = await getTuyaStreamUrl(deviceId, 'hd', clientId, secret);
            if (tuyaUrl) {
                playUrl = `/api/cctv/${c.id}/stream.m3u8`;
                mediaType = 'Video';
            }
        }
        res.json({
            success: true,
            data: {
                ...c,
                playUrl: playUrl,
                mediaType: mediaType,
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
        const user = await getLoggedInUser(req);
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
        const camera = await db_1.DatabaseManager.getCctvById(id);
        if (camera && camera.protocol === 'CLOUD_VIEWER') {
            const deviceId = camera.playUrl || 'a368caa9d0ba8c2813gfir';
            delete tuyaStreamCache[`${deviceId}_hd`];
            delete tuyaStreamCache[`${deviceId}_sd`];
            delete tuyaBaseUrlCache[`${deviceId}_hd`];
            delete tuyaBaseUrlCache[`${deviceId}_sd`];
            console.log(`[TUYA API] Cleared stream cache for device ${deviceId} via manual reconnect.`);
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
// Store the last retrieved HLS base URL in memory for segment forwarding
let tuyaBaseUrlCache = {};
// GET /api/cctv/:id/stream.m3u8 - HLS Stream Proxy
app.get('/api/cctv/:id/stream.m3u8', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const camera = await db_1.DatabaseManager.getCctvById(id);
        if (!camera || camera.protocol !== 'CLOUD_VIEWER') {
            return res.status(404).send('Not a cloud camera');
        }
        const quality = req.query.quality === 'SD' ? 'sd' : 'hd';
        const deviceId = camera.playUrl || 'a368caa9d0ba8c2813gfir';
        const clientId = camera.username || 'r5vap3snnr339dyeua5j';
        const secret = camera.password ? db_1.DatabaseManager.decryptCctvPassword(camera.password) : '5a93707b474b41b9b888b1e2a12ed1c9';
        const tuyaUrl = await getTuyaStreamUrl(deviceId, quality, clientId, secret);
        if (!tuyaUrl) {
            console.warn(`[HLS PROXY] Tuya stream (${quality}) unavailable, redirecting to local fallback video`);
            return res.redirect('/uploads/orang buang sampah.mp4');
        }
        // Save the base URL of the HLS stream (up to the last slash)
        const lastSlashIdx = tuyaUrl.lastIndexOf('/');
        if (lastSlashIdx !== -1) {
            const cacheKey = `${deviceId}_${quality}`;
            tuyaBaseUrlCache[cacheKey] = tuyaUrl.substring(0, lastSlashIdx + 1);
        }
        // Fetch the .m3u8 file content
        const response = await fetch(tuyaUrl);
        if (!response.ok) {
            console.error(`[HLS PROXY] Failed to fetch .m3u8 (${quality}) from Tuya:`, response.statusText);
            const cacheKey = `${deviceId}_${quality}`;
            delete tuyaStreamCache[cacheKey];
            delete tuyaBaseUrlCache[cacheKey];
            return res.redirect('/uploads/orang buang sampah.mp4');
        }
        const m3u8Text = await response.text();
        // Set headers
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(m3u8Text);
    }
    catch (err) {
        console.error('[HLS PROXY] Error proxying .m3u8:', err.message);
        res.redirect('/uploads/orang buang sampah.mp4');
    }
});
// GET /api/cctv/:id/:filename.ts - HLS TS Segment Proxy
app.get('/api/cctv/:id/:filename.ts', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const filename = req.params.filename;
        const camera = await db_1.DatabaseManager.getCctvById(id);
        const deviceId = camera?.playUrl || 'a368caa9d0ba8c2813gfir';
        const quality = req.query.quality === 'SD' ? 'sd' : 'hd';
        const cacheKey = `${deviceId}_${quality}`;
        const baseUrl = tuyaBaseUrlCache[cacheKey] || tuyaBaseUrlCache[`${deviceId}_hd`] || tuyaBaseUrlCache[`${deviceId}_sd`];
        if (!baseUrl) {
            return res.status(404).send('Base URL not cached');
        }
        // Reconstruct the full query string
        const queryStr = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
        const targetUrl = `${baseUrl}${filename}.ts${queryStr}`;
        const response = await fetch(targetUrl);
        if (!response.ok) {
            return res.status(response.status).send(response.statusText);
        }
        // Forward the binary stream
        res.setHeader('Content-Type', 'video/mp2t');
        res.setHeader('Access-Control-Allow-Origin', '*');
        const arrayBuffer = await response.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
    }
    catch (err) {
        console.error('[HLS PROXY] Error proxying segment:', err.message);
        res.status(500).send('Internal Server Error');
    }
});
// POST /api/cctv/monitoring - Global toggle monitoring
app.post('/api/cctv/monitoring', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden: Hanya Admin yang dapat memodifikasi status pemantauan.' });
        }
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'Parameter "enabled" wajib boolean.' });
        }
        await Cctv_1.CctvModel.updateMany({}, { $set: { monitoringEnabled: enabled, status: enabled ? 'MONITORING' : 'PAUSED' } });
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
        const user = await getLoggedInUser(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden: Hanya Admin yang dapat memodifikasi status pemantauan.' });
        }
        const id = parseInt(req.params.id);
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'Parameter "enabled" wajib boolean.' });
        }
        const camera = await Cctv_1.CctvModel.findOne({ id });
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
// PATCH /api/cctv/:id/active - Per-camera toggle active/standby status
app.patch('/api/cctv/:id/active', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden: Hanya Admin yang dapat memodifikasi status aktif CCTV.' });
        }
        const id = parseInt(req.params.id);
        const { isActive } = req.body;
        if (typeof isActive !== 'boolean') {
            return res.status(400).json({ error: 'Parameter "isActive" wajib boolean.' });
        }
        const camera = await Cctv_1.CctvModel.findOne({ id });
        if (!camera) {
            return res.status(404).json({ error: 'Camera not found' });
        }
        camera.isActive = isActive;
        if (!isActive) {
            camera.monitoringEnabled = false;
            camera.status = 'PAUSED';
        }
        else {
            camera.status = 'ONLINE';
        }
        await camera.save();
        console.log(`[SERVER INFO] Camera ID ${id} active state set to ${isActive} by user ${user.username}`);
        res.json({ success: true, cameraId: id, data: camera });
    }
    catch (err) {
        console.error('[SERVER ERROR] PATCH /api/cctv/:id/active failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET /api/ai-detections - Retrieve raw AI detections log
app.get('/api/ai-detections', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const detections = await AiDetectionModel.find().sort({ createdAt: -1 }).limit(100).lean();
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
        const user = await getLoggedInUser(req);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const evidences = await AiEvidenceModel.find().sort({ createdAt: -1 }).limit(100).lean();
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
        const user = await getLoggedInUser(req);
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
        const user = await getLoggedInUser(req);
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
        // Hot-swap AI engine instantly if key is ai.engine
        if (key === 'ai.engine') {
            try {
                const { AiModelManager } = require('./cctv/services/AiModelManager');
                const { AiModelModel } = require('./database/models/AiModel');
                const activeModel = await AiModelModel.findOne({ isActive: true }).exec();
                const modelId = activeModel ? activeModel.id : 'yolov8-river-v1.0';
                await AiModelManager.swapActiveModel(modelId, value);
                console.log(`[SystemSettings] Hot-swapped active engine to: ${value} with model ${modelId}`);
            }
            catch (err) {
                console.error('[SystemSettings] Failed to trigger hot-swap on settings update:', err.message);
            }
        }
        // Rekam log audit perubahan konfigurasi sistem (Before, After, Reason, Approved By)
        await SystemAuditLogModel.create({
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
        // MLOps Configuration History Audit
        try {
            const { AiConfigurationHistoryModel } = require('./database/models/AiConfigurationHistory');
            await AiConfigurationHistoryModel.create({
                key,
                oldValue,
                newValue: value,
                changedBy: user._id,
                changedByName: user.username,
                reason: reason || 'Pembaruan parameter ambang batas deteksi AI.',
                timestamp: new Date()
            });
            console.log(`[MLOps Configuration Audit] Logged settings change for key: ${key}`);
        }
        catch (confHistoryErr) {
            console.error('[MLOps ERROR] Failed to record configuration history audit:', confHistoryErr.message);
        }
        console.log(`[SERVER INFO] Configuration setting "${key}" updated from "${JSON.stringify(oldValue)}" to "${JSON.stringify(value)}" by user ${user.username}`);
        res.json({ success: true, key, value });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/system-settings failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET /api/ai/models - Get list of models
app.get('/api/ai/models', async (req, res) => {
    try {
        const { AiModelModel } = require('./database/models/AiModel');
        const models = await AiModelModel.find().sort({ createdAt: -1 }).lean();
        res.json(models);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET /api/ai/feedback-count - Get total operator feedback samples count
app.get('/api/ai/feedback-count', async (req, res) => {
    try {
        const { DatasetFeedbackModel } = require('./database/models/DatasetFeedback');
        const count = await DatasetFeedbackModel.countDocuments();
        res.json({ count });
    }
    catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// GET /api/ai/training-runs - Get training runs history
app.get('/api/ai/training-runs', async (req, res) => {
    try {
        const { AiTrainingRunModel } = require('./database/models/AiTrainingRun');
        const runs = await AiTrainingRunModel.find().sort({ createdAt: -1 }).lean();
        res.json(runs);
    }
    catch (err) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// POST /api/ai/train - Start simulated AI model training
app.post('/api/ai/train', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden: Hanya Admin yang dapat memulai training model AI.' });
        }
        const { datasetSize, epochs, notes } = req.body;
        const numSize = parseInt(datasetSize) || 1000;
        const numEpochs = parseInt(epochs) || 50;
        const { AiTrainingRunModel } = require('./database/models/AiTrainingRun');
        const { AiModelModel } = require('./database/models/AiModel');
        // Create a new model ID based on dataset size and epochs
        const modelSuffix = numSize >= 10000 ? 'ultra' : (numSize >= 5000 ? 'high' : 'precision');
        const modelId = `yolov8-${modelSuffix}-v${(2 + Math.floor(Math.random() * 9))}.0`;
        // Calculate simulated metrics (larger datasets yield higher precision!)
        const baseMetric = numSize >= 10000 ? 0.96 : (numSize >= 5000 ? 0.93 : 0.90);
        const randomShift = Math.random() * 0.03;
        const precision = parseFloat((baseMetric + randomShift).toFixed(3));
        const recall = parseFloat((baseMetric - 0.02 + randomShift).toFixed(3));
        const mAP50 = parseFloat((baseMetric + 0.01 + randomShift).toFixed(3));
        const mAP50_95 = parseFloat((baseMetric - 0.15 + randomShift).toFixed(3));
        // Save training run record
        const trainingRun = await AiTrainingRunModel.create({
            datasetVersion: `ds-river-v${(1 + Math.floor(Math.random() * 5))}.0`,
            modelVersion: modelId,
            trainingStart: new Date(Date.now() - 1000 * 60 * 3), // simulated 3 mins ago
            trainingEnd: new Date(),
            epochs: numEpochs,
            precision,
            recall,
            mAP50,
            mAP50_95,
            bestWeightsPath: `/weights/${modelId}.pt`,
            artifactSize: 14200000 + Math.floor(Math.random() * 2000000), // ~14-16MB
            notes: notes || `Optimasi otomatis YOLOv8 pada ${numSize} sampel data sungai.`
        });
        // Save model to registry so it can be deployed!
        await AiModelModel.create({
            id: modelId,
            name: `YOLOv8 River ${modelSuffix.toUpperCase()} Model`,
            version: `${(2 + Math.floor(Math.random() * 9))}.0`,
            isActive: false,
            checksum: crypto_1.default.randomBytes(16).toString('hex'),
            artifactSize: trainingRun.artifactSize,
            framework: 'YOLOv8',
            supportedTasks: ['DETECTION']
        });
        res.json({ success: true, trainingRun });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/ai/train failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
// POST /api/ai/deploy - Deploy a trained model
app.post('/api/ai/deploy', async (req, res) => {
    try {
        const user = await getLoggedInUser(req);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden: Hanya Admin yang dapat men-deploy model AI.' });
        }
        const { modelId } = req.body;
        if (!modelId) {
            return res.status(400).json({ error: 'Parameter "modelId" wajib diisi.' });
        }
        const { AiModelModel } = require('./database/models/AiModel');
        const { ModelDeploymentLogModel } = require('./database/models/ModelDeploymentLog');
        // Find target model
        const targetModel = await AiModelModel.findOne({ id: modelId });
        if (!targetModel) {
            return res.status(404).json({ error: 'Model AI tidak ditemukan di registry.' });
        }
        // Set all other models to isActive: false, and target model to isActive: true
        await AiModelModel.updateMany({ id: { $ne: modelId } }, { isActive: false });
        targetModel.isActive = true;
        await targetModel.save();
        // Log deployment
        await ModelDeploymentLogModel.create({
            deploymentId: `deploy-manual-${Date.now()}`,
            modelId,
            status: 'SUCCESS',
            notes: `Deployment manual model ${modelId} melalui panel superadmin oleh ${user.username}`,
            deployedBy: user._id,
            timestamp: new Date()
        });
        // Hot-swap AI engine instantly!
        try {
            const { AiModelManager } = require('./cctv/services/AiModelManager');
            const engineSetting = await db_1.SystemSettingsModel.findOne({ key: 'ai.engine' }).exec();
            const engineType = engineSetting ? engineSetting.value : 'MOCK';
            await AiModelManager.swapActiveModel(modelId, engineType);
            console.log(`[MLOps Deployment] Hot-swapped active model to: ${modelId} via engine: ${engineType}`);
        }
        catch (swapErr) {
            console.error('[MLOps Deployment] Failed to swap model:', swapErr.message);
        }
        res.json({ success: true, modelId });
    }
    catch (err) {
        console.error('[SERVER ERROR] POST /api/ai/deploy failed:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
let serverInstance;
// Start Server after Database connection is established
(0, db_1.connectDB)().then(() => {
    CctvHealthEngine_1.CctvHealthEngine.start();
    AiPipelineScheduler_1.AiPipelineScheduler.start();
    MaintenanceScheduler_1.MaintenanceScheduler.start();
    OutboxWorker_1.OutboxWorker.start();
    serverInstance = app.listen(PORT, () => {
        console.log(`Server EYECO berjalan di http://localhost:${PORT}`);
    });
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
    // 1.5 Stop Maintenance Scheduler
    try {
        console.log('[SERVER] Stopping Maintenance Scheduler...');
        MaintenanceScheduler_1.MaintenanceScheduler.stop();
    }
    catch (err) {
        console.error('[SERVER ERROR] Failed to stop MaintenanceScheduler:', err.message);
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
        await disconnectDB();
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
