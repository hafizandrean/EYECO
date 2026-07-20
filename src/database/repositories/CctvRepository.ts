import { CctvModel, ICctv } from "../models/Cctv";
import {
    scryptSync,
    randomBytes,
    createCipheriv,
    createDecipheriv
} from "crypto";


export class CctvRepository {

    // --- CCTV METHODS ---
    
      static async getAll(workspaceId?: number): Promise<ICctv[]> {
        try {
          const filter: any = {};
          if (workspaceId !== undefined) {
            filter.workspaceId = workspaceId;
          }
          return await CctvModel.find(filter).sort({ id: 1 }).lean();
        } catch (err) {
          console.error('[DATABASE ERROR] getAllCctv failed:', err);
          throw err;
        }
      }
    
      static async getById(id: number, workspaceId?: number): Promise<ICctv | null> {
        try {
          const query: Record<string, unknown> = { id };
          if (workspaceId !== undefined) query.workspaceId = workspaceId;
          return await CctvModel.findOne(query).lean();
        } catch (err) {
          console.error('[DATABASE ERROR] getCctvById failed:', err);
          throw err;
        }
      }
    
      static async add(payload: Partial<ICctv>, userId: number): Promise<ICctv> {
        try {
          if (!payload.name || !payload.location || !payload.protocol || !payload.streamUrl) {
            throw new Error('Semua field wajib diisi.');
          }
    
          // Generate Auto-increment ID
          const maxCctv = await CctvModel.findOne({}).sort({ id: -1 });
          const nextId = maxCctv ? maxCctv.id + 1 : 1;
    
          // Encrypt password if provided
          let encryptedPassword = '';
          if (payload.password) {
            encryptedPassword = CctvRepository.encryptCctvPassword(payload.password);
          }
    
          const newCctv = new CctvModel({
            id: nextId,
            name: payload.name,
            location: payload.location,
            description: payload.description || '',
            vendor: payload.vendor || 'GENERIC',
            model: payload.model || '',
            protocol: payload.protocol,
            mediaType: payload.mediaType || 'Video',
            streamUrl: payload.streamUrl,
            playUrl: payload.playUrl || payload.streamUrl,
            username: payload.username || '',
            password: encryptedPassword,
            capabilities: payload.capabilities || {
              rtsp: payload.protocol === 'RTSP',
              hls: payload.protocol === 'HLS',
              snapshot: payload.protocol === 'HTTP Image',
              mjpeg: payload.protocol === 'MJPEG',
              onvif: false,
              cloud: payload.protocol === 'CLOUD_VIEWER'
            },
            status: 'CONNECTING',
            health: {
              latency: 0,
              fps: 0,
              resolution: '1280x720'
            },
            isDefault: false,
            isActive: true,
            createdBy: userId,
            workspaceId: payload.workspaceId
          });
    
          await newCctv.save();
          return newCctv;
        } catch (err) {
          console.error('[DATABASE ERROR] addCctv failed:', err);
          throw err;
        }
      }
    
      static async update(id: number, payload: Partial<ICctv>, workspaceId?: number): Promise<ICctv> {
        try {
          const updatePayload: any = { ...payload };
          
          if (payload.password) {
            updatePayload.password = CctvRepository.encryptCctvPassword(payload.password);
          }

          if (payload.streamUrl) {
            updatePayload.playUrl = payload.playUrl || payload.streamUrl;
          }

          const updated = await CctvModel.findOneAndUpdate(
            workspaceId !== undefined ? { id, workspaceId } : { id },
            { $set: updatePayload },
            { new: true }
          ).lean().exec();

          if (!updated) {
            throw new Error('CCTV tidak ditemukan.');
          }

          return updated as unknown as ICctv;
        } catch (err) {
          console.error('[DATABASE ERROR] updateCctv failed:', err);
          throw err;
        }
      }
    
      static async delete(id: number, workspaceId?: number): Promise<boolean> {
        try {
          const cctv = await CctvModel.findOne(workspaceId !== undefined ? { id, workspaceId } : { id });
          if (!cctv) {
            throw new Error('CCTV tidak ditemukan.');
          }
    
          await CctvModel.deleteOne(workspaceId !== undefined ? { id, workspaceId } : { id });
          return true;
        } catch (err) {
          console.error('[DATABASE ERROR] deleteCctv failed:', err);
          throw err;
        }
      }
    
      static async updateStatus(
        id: number,
        status: 'NEW' | 'CONNECTING' | 'ONLINE' | 'OFFLINE' | 'BUFFERING' | 'ERROR' | 'DISCONNECTED',
        health?: { latency: number; fps: number; resolution: string }
      ): Promise<void> {
        try {
          const updatePayload: any = {
            status,
            lastHeartbeat: new Date()
          };
          if (status === 'ONLINE') {
            updatePayload.lastConnected = new Date();
          }
          if (health) {
            updatePayload.health = health;
          }
          await CctvModel.updateOne({ id }, { $set: updatePayload });
        } catch (err) {
          console.error('[DATABASE ERROR] updateCctvStatus failed:', err);
        }
      }
    
    // --- ENCRYPTION HELPERS ---
    
      public static encryptCctvPassword(text: string): string {
        try {
          const encryptionKey = scryptSync(process.env.JWT_SECRET || 'eyeco-secret-key', 'salt', 32);
          const iv = randomBytes(16);
          const cipher = createCipheriv('aes-256-cbc', encryptionKey, iv);
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
          const encryptionKey = scryptSync(process.env.JWT_SECRET || 'eyeco-secret-key', 'salt', 32);
          const parts = text.split(':');
          const iv = Buffer.from(parts.shift()!, 'hex');
          const encryptedText = Buffer.from(parts.join(':'), 'hex');
          const decipher = createDecipheriv('aes-256-cbc', encryptionKey, iv);
          let decrypted = decipher.update(encryptedText).toString('utf8');
          decrypted += decipher.final('utf8');
          return decrypted;
        } catch (err) {
          console.error('[DATABASE ERROR] Decryption failed:', err);
          return '';
        }
      }

}
