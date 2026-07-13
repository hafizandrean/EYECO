"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
exports.getLoggedInUser = getLoggedInUser;
const crypto_1 = __importDefault(require("crypto"));
const auth_service_1 = require("./auth.service");
const UserRepository_1 = require("../database/repositories/UserRepository");
const Session_1 = require("../database/models/Session");
async function authMiddleware(req, res, next) {
    try {
        let token = '';
        // 1. Read from Authorization Header
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
        // 2. Read from Cookie (express cookieParser)
        if (!token) {
            token = req.cookies?.session_token || '';
        }
        // 3. Fallback: parse raw cookie header manually
        if (!token && req.headers.cookie) {
            const cookiesObj = req.headers.cookie.split(';').reduce((acc, c) => {
                const parts = c.trim().split('=');
                const key = parts[0];
                const val = parts.slice(1).join('=');
                if (key && val)
                    acc[key] = val;
                return acc;
            }, {});
            token = cookiesObj['session_token'] || '';
        }
        if (!token) {
            if (req.path.startsWith('/api/')) {
                res.status(401).json({ error: 'Unauthorized: Belum masuk' });
                return;
            }
            res.redirect('/login');
            return;
        }
        const payload = (0, auth_service_1.verifyToken)(token);
        if (!payload) {
            if (req.path.startsWith('/api/')) {
                res.status(401).json({ error: 'Unauthorized: Sesi tidak valid' });
                return;
            }
            res.redirect('/login');
            return;
        }
        // Check DB session
        const tokenHash = crypto_1.default.createHash('sha256').update(token).digest('hex');
        const session = await Session_1.SessionModel.findOne({ tokenHash });
        if (!session) {
            res.clearCookie('session_token');
            if (req.path.startsWith('/api/')) {
                res.status(401).json({ error: 'Unauthorized: Sesi telah kedaluwarsa atau dicabut' });
                return;
            }
            res.redirect('/login');
            return;
        }
        // Optionally update lastActive if it's been a while (e.g. 5 mins) to avoid too many writes
        if (Date.now() - session.lastActive.getTime() > 5 * 60 * 1000) {
            await Session_1.SessionModel.updateOne({ _id: session._id }, { lastActive: new Date() });
        }
        req.userContext = payload;
        next();
    }
    catch (err) {
        console.error('[AUTH ERROR] Middleware failed:', err);
        if (req.path.startsWith('/api/')) {
            res.status(500).json({ error: 'Internal Server Error' });
            return;
        }
        res.redirect('/login');
    }
}
// roleGuard moved to RoleMiddleware.ts
// Helper to get full user object from session
async function getLoggedInUser(req) {
    if (req.userContext) {
        try {
            return await UserRepository_1.UserRepository.findByLegacyId(req.userContext.id);
        }
        catch (err) {
            console.error('[AUTH] Failed to fetch session user:', err);
            return null;
        }
    }
    return null;
}
