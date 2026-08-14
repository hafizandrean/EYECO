import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { verifyToken } from './auth.service';
import { UserRepository } from '../database/repositories/UserRepository';
import { IUser } from '../database/models/User';
import { SessionModel } from '../database/models/Session';

// Extend Express Request to include userContext
declare global {
  namespace Express {
    interface Request {
      userContext?: {
        id: number;
        username: string;
        role: string;
      };
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
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
        if (key && val) acc[key] = val;
        return acc;
      }, {} as Record<string, string>);
      token = cookiesObj['session_token'] || '';
    }

    if (!token) {
      if (req.originalUrl.startsWith('/api/')) {
        res.status(401).json({ error: 'Unauthorized: Belum masuk' });
        return;
      }
      res.redirect('/login');
      return;
    }

    const payload = verifyToken(token);
    if (!payload) {
      if (req.originalUrl.startsWith('/api/')) {
        res.status(401).json({ error: 'Unauthorized: Sesi tidak valid' });
        return;
      }
      res.redirect('/login');
      return;
    }

    // Check DB session
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    let session = await SessionModel.findOne({ tokenHash });
    // IMPORTANT: Do NOT auto-restore deleted sessions.
    // SessionModel.deleteMany on login enforces 1-session-per-user.
    // Auto-restore would recreate a new record, defeating the purpose.
    if (!session) {
      res.clearCookie('session_token');
      if (req.originalUrl.startsWith('/api/')) {
        res.status(401).json({ error: 'Unauthorized: Sesi telah kedaluwarsa atau dicabut' });
        return;
      }
      res.redirect('/login');
      return;
    }

    // Optionally update lastActive if it's been a while (e.g. 5 mins) to avoid too many writes
    if (session && Date.now() - session.lastActive.getTime() > 5 * 60 * 1000) {
      await SessionModel.updateOne({ _id: session._id }, { lastActive: new Date() });
    }

    req.userContext = payload as { id: number; username: string; role: string };
    next();
  } catch (err) {
    console.error('[AUTH ERROR] Middleware failed:', err);
    if (req.originalUrl.startsWith('/api/')) {
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }
    res.redirect('/login');
  }
}

// Helper to get full user object from session
export async function getLoggedInUser(req: Request): Promise<IUser | null> {
  // 1. Try from already populated userContext
  if (req.userContext) {
    try {
      return await UserRepository.findByLegacyId(req.userContext.id);
    } catch (err) {
      console.error('[AUTH] Failed to fetch session user:', err);
      return null;
    }
  }

  // 2. Standalone parsing for routes without authMiddleware (like / and /login)
  try {
    let token = '';
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }
    if (!token) {
      token = req.cookies?.session_token || '';
    }
    if (!token && req.headers.cookie) {
      const cookiesObj = req.headers.cookie.split(';').reduce((acc, c) => {
        const parts = c.trim().split('=');
        if (parts[0] && parts[1]) acc[parts[0]] = parts.slice(1).join('=');
        return acc;
      }, {} as Record<string, string>);
      token = cookiesObj['session_token'] || '';
    }

    if (!token) return null;

    const payload = verifyToken(token);
    if (!payload) return null;

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    let session = await SessionModel.findOne({ tokenHash });
    // No auto-restore — login's deleteMany enforces 1-session-per-user.
    if (!session) return null;

    return await UserRepository.findByLegacyId(payload.id as number);
  } catch (err) {
    console.error('[AUTH] getLoggedInUser standalone parsing failed:', err);
    return null;
  }
}
