"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
exports.roleGuard = roleGuard;
const auth_service_1 = require("./auth.service");
function authMiddleware(req, res, next) {
    let token = '';
    // 1. Read from Authorization Header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    }
    // 2. Read from Cookie
    if (!token) {
        token = req.cookies?.session_token || '';
    }
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
            return res.status(401).json({ error: 'Unauthorized: Belum masuk' });
        }
        return res.redirect('/login');
    }
    const payload = (0, auth_service_1.verifyToken)(token);
    if (!payload) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Unauthorized: Sesi tidak valid' });
        }
        return res.redirect('/login');
    }
    req.userContext = payload;
    next();
}
function roleGuard(roles) {
    return (req, res, next) => {
        if (!req.userContext) {
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            return res.redirect('/login');
        }
        if (!roles.includes(req.userContext.role)) {
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({ error: 'Forbidden: Anda tidak memiliki akses' });
            }
            const role = req.userContext.role;
            if (role === 'superadmin') {
                return res.redirect('/superadmin/dashboard');
            }
            else if (role === 'admin') {
                return res.redirect('/dashboard');
            }
            else {
                return res.redirect('/dashboard/upload');
            }
        }
        next();
    };
}
