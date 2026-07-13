import { SystemAuditLogModel } from '../database/db';
import mongoose from 'mongoose';

export enum AuditAction {
  PROFILE_UPDATED = 'PROFILE_UPDATED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  PREFERENCES_UPDATED = 'PREFERENCES_UPDATED',
  ACCOUNT_CLOSED = 'ACCOUNT_CLOSED',
  LOGOUT = 'LOGOUT'
}

export class AuditLogService {
  public static async log(data: {
    action: AuditAction;
    actorId: mongoose.Types.ObjectId | null;
    actorName: string;
    ipAddress?: string;
    userAgent?: string;
    status: 'SUCCESS' | 'FAILED';
    requestId?: string;
    details?: Record<string, any>;
    tenantId?: string;
  }): Promise<void> {
    try {
      await SystemAuditLogModel.create({
        tenantId: data.tenantId || 'BBWS',
        actorId: data.actorId,
        actorName: data.actorName,
        action: data.action,
        ipAddress: data.ipAddress || '',
        userAgent: data.userAgent || '',
        details: {
          ...data.details,
          status: data.status,
          requestId: data.requestId
        }
      });
    } catch (err) {
      console.error('[AUDIT LOG ERROR] Failed to write audit log:', err);
    }
  }
}
