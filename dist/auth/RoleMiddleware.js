"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roleGuard = roleGuard;
function roleGuard(roles) {
    return (req, res, next) => {
        if (!req.userContext) {
            if (req.path.startsWith('/api/')) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }
            res.redirect('/login');
            return;
        }
        if (!roles.includes(req.userContext.role)) {
            if (req.path.startsWith('/api/')) {
                res.status(403).json({ error: 'Forbidden: Anda tidak memiliki akses ke resource ini' });
                return;
            }
            // Redirect to correct dashboard instead of 403 page
            const role = req.userContext.role;
            if (role === 'superadmin') {
                res.redirect('/superadmin');
                return;
            }
            if (role === 'admin') {
                res.redirect('/dashboard');
                return;
            }
            if (role === 'user') {
                res.redirect('/select-workspace');
                return;
            }
            res.redirect('/login');
            return;
        }
        next();
    };
}
