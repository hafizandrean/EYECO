import mongoose from 'mongoose';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { runMigration } from './migration';
import { UserModel, IUser } from './models/User';
import { ReportModel, IReport, IBoundingBox, IComment } from './models/Report';
import { CctvModel, ICctv } from './models/Cctv';
import { TimelineEventModel, ITimelineEvent } from './models/TimelineEvent';
import { AssignmentModel, IAssignment } from './models/Assignment';
import { ResolutionModel, IResolution } from './models/Resolution';
import { NotificationModel, INotification } from './models/Notification';
import { OutboxEventModel, IOutboxEvent } from './models/OutboxEvent';
import { SystemAuditLogModel, ISystemAuditLog } from './models/SystemAuditLog';
import { WorkspaceModel, IWorkspace } from './models/Workspace';

// Re-export types for legacy compatibility in server.ts
export { 
  IUser as User, 
  IReport as Report, 
  IBoundingBox as BoundingBox, 
  IComment as Comment, 
  ICctv as Cctv,
  TimelineEventModel, ITimelineEvent as TimelineEvent,
  AssignmentModel, IAssignment as Assignment,
  ResolutionModel, IResolution as Resolution,
  NotificationModel, INotification as Notification,
  OutboxEventModel, IOutboxEvent as OutboxEvent,
  SystemAuditLogModel, ISystemAuditLog as SystemAuditLog,
  WorkspaceModel, IWorkspace as Workspace
};

dotenv.config();

// Validate Environment Variables
if (!process.env.MONGODB_URI) {
  console.error('CRITICAL ERROR: MONGODB_URI is not defined in environment variables.');
  process.exit(1);
}
if (!process.env.PORT) {
  console.warn('[WARNING] PORT is not defined in environment variables. Defaulting to 8000.');
}

export async function connectDB() {
  const uri = process.env.MONGODB_URI!;
  const maxRetries = 3;
  let attempt = 1;

  while (attempt <= maxRetries) {
    try {
      console.log(`[DATABASE INFO] Connecting to MongoDB (Attempt ${attempt}/${maxRetries})...`);
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
      });
      console.log('[DATABASE SUCCESS] MongoDB connected successfully.');
      
      // Run automatic migration from db.json
      await runMigration();
      return;
    } catch (err) {
      console.error(`[DATABASE ERROR] MongoDB connection attempt ${attempt} failed:`, err);
      if (attempt === maxRetries) {
        console.error('[DATABASE CRITICAL] Could not connect to MongoDB after maximum retries. Exiting.');
        process.exit(1);
      }
      attempt++;
      // Wait 2 seconds before retrying
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
}

// Graceful Shutdown Handler
const gracefulExit = async (signal: string) => {
  try {
    console.log(`[DATABASE INFO] Closing database connection due to ${signal}...`);
    await mongoose.connection.close();
    console.log('[DATABASE SUCCESS] Mongoose connection closed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('[DATABASE ERROR] Error during database disconnect:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulExit('SIGINT'));
process.on('SIGTERM', () => gracefulExit('SIGTERM'));

export class DatabaseManager {
  // Hashing utility remains SHA-256 for backward compatibility with existing hashed passwords
  public static hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  // --- ENCRYPTION HELPERS ---

  public static encryptCctvPassword(text: string): string {
    try {
      const encryptionKey = crypto.scryptSync(process.env.JWT_SECRET || 'eyeco-secret-key', 'salt', 32);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', encryptionKey, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return iv.toString('hex') + ':' + encrypted;
    } catch (err) {
      console.error('[DATABASE ERROR] Encryption failed:', err);
      return '';
    }
  }

  public static decryptCctvPassword(text: string): string {
    try {
      if (!text) return '';
      const encryptionKey = crypto.scryptSync(process.env.JWT_SECRET || 'eyeco-secret-key', 'salt', 32);
      const parts = text.split(':');
      const iv = Buffer.from(parts.shift()!, 'hex');
      const encryptedText = Buffer.from(parts.join(':'), 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKey, iv);
      let decrypted = decipher.update(encryptedText).toString('utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      console.error('[DATABASE ERROR] Decryption failed:', err);
      return '';
    }
  }
}
