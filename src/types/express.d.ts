import { Express } from 'express';

export interface UserContext {
  id: number;
  username: string;
  role: 'superadmin' | 'admin' | 'user';
  desaId?: string; // Menampung context multi-tenant Workspace Desa dari Hafiz
}

declare global {
  namespace Express {
    interface Request {
      userContext?: UserContext;
    }
  }
}