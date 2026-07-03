import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './auth.service';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  let token = '';

  // 1. Read from Authorization Header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // 2. Read from Cookie
  if (!token && req.headers.cookie) {
    const cookies = req.headers.cookie.split(';').reduce((acc, c) => {
      const [key, val] = c.trim().split('=');
      if (key && val) acc[key] = val;
      return acc;
    }, {} as Record<string, string>);
    token = cookies['session_token'];
  }

  if (!token) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized: Belum masuk' });
    }
    return res.redirect('/login');
  }

  const payload = verifyToken(token);
  if (!payload) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized: Sesi tidak valid' });
    }
    return res.redirect('/login');
  }

  req.userContext = payload;
  next();
}

export function roleGuard(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.userContext) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!roles.includes(req.userContext.role)) {
      return res.status(403).json({ error: 'Forbidden: Anda tidak memiliki akses' });
    }
    next();
  };
}
