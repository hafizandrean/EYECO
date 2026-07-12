import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import cookieParser from 'cookie-parser';

import { connectDB, WorkspaceModel } from './database/db';
import { CctvHealthEngine } from './cctv/CctvHealthEngine';
import { authMiddleware, getLoggedInUser } from './auth/authMiddleware';
import { roleGuard } from './auth/RoleMiddleware';

// Import modular routers
import authRouter from './routes/authRoutes';
import superadminRouter from './routes/superadminRoutes';
import workspaceRouter from './routes/workspaceRoutes';
import adminRouter from './routes/adminRoutes';
import reportRouter from './routes/reportRoutes';
import cctvRouter from './routes/cctvRoutes';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 8000);
let lastDatabaseStateLogAt = 0;

function logDatabaseState(message: string): void {
  const now = Date.now();
  if (now - lastDatabaseStateLogAt < 10000) return;
  lastDatabaseStateLogAt = now;
  console.log(message);
}

mongoose.connection.on('disconnected', () => {
  logDatabaseState('[DATABASE WARNING] MongoDB disconnected. CCTV health engine paused.');
  CctvHealthEngine.stop();
});

mongoose.connection.on('reconnected', () => {
  logDatabaseState('[DATABASE SUCCESS] MongoDB reconnected. CCTV health engine resumed.');
  CctvHealthEngine.start();
});

mongoose.connection.on('error', (err) => {
  logDatabaseState(`[DATABASE ERROR] MongoDB connection error: ${err.message}`);
});

// --- MIDDLEWARE ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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
app.use('/css', express.static(path.join(__dirname, '../public/css')));
app.use('/js', express.static(path.join(__dirname, '../public/js')));
app.use('/uploads', express.static(path.join(__dirname, '../public/uploads')));

// --- MODULAR ROUTES ---
app.use('/api/auth', authRouter);
app.use('/api/superadmin', superadminRouter);
app.use('/api/workspaces', workspaceRouter);
app.use('/admin', adminRouter);

// --- HEALTH CHECK ---
app.get('/health', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  res.status(isConnected ? 200 : 503).json({
    status: isConnected ? 'UP' : 'DOWN',
    database: isConnected ? 'connected' : 'disconnected'
  });
});

// --- HELPER: Role-based redirect ---
function getRedirectPath(role: string): string {
  if (role === 'superadmin') return '/superadmin';
  if (role === 'admin') return '/dashboard';
  return '/select-workspace';
}

// --- VIEW ROUTES ---
app.get('/', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (!user) return res.redirect('/login');
    res.redirect(getRedirectPath(user.role));
  } catch (err) {
    res.redirect('/login');
  }
});

app.get('/login', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (user) return res.redirect(getRedirectPath(user.role));
    res.sendFile(path.join(__dirname, '../public/views/login.html'));
  } catch (err) {
    res.redirect('/login');
  }
});

app.get('/register', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (user) return res.redirect(getRedirectPath(user.role));
    res.sendFile(path.join(__dirname, '../public/views/register.html'));
  } catch (err) {
    res.redirect('/login');
  }
});

app.get('/register-superadmin', async (req, res) => {
  try {
    const user = await getLoggedInUser(req);
    if (user) return res.redirect(getRedirectPath(user.role));
    res.sendFile(path.join(__dirname, '../public/views/register-superadmin.html'));
  } catch (err) {
    res.redirect('/login');
  }
});

app.get('/logout', (req, res) => {
  res.clearCookie('session_token');
  res.redirect('/login');
});

// Superadmin pages
app.get(
  ['/superadmin', '/superadmin/dashboard', '/superadmin/admins', '/superadmin/workspaces'],
  authMiddleware,
  roleGuard(['superadmin']),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../public/views/superadmin.html'));
  }
);

// Superadmin Workspace Detail
app.get('/superadmin/workspaces/:id', authMiddleware, roleGuard(['superadmin']), (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/workspace-detail.html'));
});

// Dashboard — unified for admin AND user
app.get(
  ['/dashboard', '/dashboard/laporan', '/dashboard/upload', '/dashboard/users', '/dashboard/cctv', '/dashboard/join-requests'],
  authMiddleware,
  roleGuard(['admin', 'user']),
  (req, res) => {
    res.sendFile(path.join(__dirname, '../public/views/dashboard.html'));
  }
);

// Single report detail page
app.get('/dashboard/detections/:id', authMiddleware, roleGuard(['admin', 'user']), (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/dashboard.html'));
});

// Select Workspace — user only
app.get('/select-workspace', authMiddleware, roleGuard(['user']), (req, res) => {
  res.sendFile(path.join(__dirname, '../public/views/select-workspace.html'));
});

// Invite link for workspaces
app.get('/join/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const ws = await WorkspaceModel.findOne({ code: code.toUpperCase() }).lean().exec();
    if (!ws) {
      return res.redirect('/select-workspace?error=invalid_link');
    }
    if (!req.userContext) {
      return res.redirect(`/register?join=${ws.id}`);
    }
    res.redirect(`/select-workspace?join=${ws.id}`);
  } catch (err) {
    res.redirect('/select-workspace');
  }
});

// --- FEATURE ROUTES ---
app.use('/api', reportRouter);
app.use('/api/cctv', cctvRouter);

function listenWithFallback(port: number, attempts = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);

    server.once('listening', () => {
      CctvHealthEngine.start();
      resolve(port);
    });

    server.once('error', (err: NodeJS.ErrnoException) => {
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
connectDB().then(async () => {
  const activePort = await listenWithFallback(PORT);
  console.log(`[SERVER] EYECO berjalan di http://localhost:${activePort}`);
}).catch((err) => {
  console.error('[SERVER CRITICAL] Failed to connect to database. Server not started.', err);
  process.exit(1);
});
