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
  if (!token) {
    token = req.cookies?.session_token || '';
  }

  if (!token && req.headers.cookie) {
    const cookiesObj = req.headers.cookie.split(';').reduce((acc, c) => {
      const parts = c.trim().split('=');
      const key = parts[0];
      const val = parts.slice(1).join('=');
      if (key && val) acc[key] = val;
      return acc;
    }, {} as Record<string, string>);
    token = cookiesObj['session_token'] || '';
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

  req.userContext = payload as any;
  next();
}

export function roleGuard(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.userContext) {
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      return res.redirect('/login');
    }

    if (!roles.includes(req.userContext.role)) {
      if (req.path.startsWith('/api/')) {
        return res.status(403).json({ error: 'Forbidden: Anda tidak memiliki akses ke resource ini' });
      }

      // Untuk page routes: tampilkan 403
      const role = req.userContext.role;
      res.status(403).send(`
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>403 - Akses Ditolak | EYECO</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: #090d16;
      color: #f3f4f6;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      text-align: center;
      padding: 40px 20px;
      max-width: 480px;
    }
    .error-code {
      font-size: 5rem;
      font-weight: 900;
      background: linear-gradient(135deg, #ef4444, #dc2626);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      line-height: 1;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      margin-bottom: 12px;
    }
    p {
      color: #9ca3af;
      font-size: 0.95rem;
      line-height: 1.6;
      margin-bottom: 28px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 24px;
      background: rgba(47, 107, 255, 0.15);
      border: 1px solid rgba(47, 107, 255, 0.3);
      border-radius: 10px;
      color: #2f6bff;
      text-decoration: none;
      font-weight: 600;
      font-size: 0.9rem;
      transition: all 0.2s;
    }
    .btn:hover { background: rgba(47, 107, 255, 0.25); }
    .role-badge {
      display: inline-block;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.2);
      color: #ef4444;
      padding: 4px 12px;
      border-radius: 100px;
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-code">403</div>
    <div class="role-badge">Role: ${role.toUpperCase()}</div>
    <h1>Akses Ditolak</h1>
    <p>Anda tidak memiliki izin untuk mengakses halaman ini.<br>
    Halaman ini hanya dapat diakses oleh: <strong style="color: #f3f4f6;">${roles.map(r => r.toUpperCase()).join(', ')}</strong></p>
    <a href="${role === 'superadmin' ? '/superadmin' : role === 'admin' ? '/dashboard' : '/dashboard-user'}" class="btn">
      ← Kembali ke Dashboard
    </a>
  </div>
</body>
</html>
      `);
      return;
    }

    next();
  };
}
