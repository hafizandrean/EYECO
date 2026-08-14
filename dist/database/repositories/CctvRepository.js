"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CctvRepository = void 0;
const Cctv_1 = require("../models/Cctv");
const crypto_1 = require("crypto");
class CctvRepository {
    // --- CCTV METHODS ---
    static async getAll(workspaceId) {
        try {
            const filter = {};
            if (workspaceId !== undefined) {
                filter.workspaceId = workspaceId;
            }
            return await Cctv_1.CctvModel.find(filter).sort({ id: 1 }).lean();
        }
        catch (err) {
            console.error('[DATABASE ERROR] getAllCctv failed:', err);
            throw err;
        }
    }
    static async getById(id, workspaceId) {
        try {
            const query = { id };
            if (workspaceId !== undefined)
                query.workspaceId = workspaceId;
            return await Cctv_1.CctvModel.findOne(query).lean();
        }
        catch (err) {
            console.error('[DATABASE ERROR] getCctvById failed:', err);
            throw err;
        }
    }
    static async add(payload, userId) {
        try {
            if (!payload.name || !payload.location || !payload.protocol || !payload.streamUrl) {
                throw new Error('Semua field wajib diisi.');
            }
            // Generate Auto-increment ID
            const maxCctv = await Cctv_1.CctvModel.findOne({}).sort({ id: -1 });
            const nextId = maxCctv ? maxCctv.id + 1 : 1;
            // Encrypt password if provided
            let encryptedPassword = '';
            if (payload.password) {
                encryptedPassword = CctvRepository.encryptCctvPassword(payload.password);
            }
            const newCctv = new Cctv_1.CctvModel({
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
        }
        catch (err) {
            console.error('[DATABASE ERROR] addCctv failed:', err);
            throw err;
        }
    }
    static async update(id, payload, workspaceId) {
        try {
            const updatePayload = { ...payload };
            if (payload.password) {
                updatePayload.password = CctvRepository.encryptCctvPassword(payload.password);
            }
            if (payload.streamUrl) {
                updatePayload.playUrl = payload.playUrl || payload.streamUrl;
            }
            if (payload.protocol) {
                updatePayload.protocol = payload.protocol;
                if (payload.protocol === 'HLS' || payload.protocol === 'RTSP_TUYA') {
                    updatePayload.mediaType = 'HLS';
                }
                else if (payload.protocol === 'HTTP Image' || payload.protocol === 'Snapshot') {
                    updatePayload.mediaType = 'Image';
                }
                else if (payload.protocol === 'CLOUD_VIEWER' || payload.protocol === 'Cloud') {
                    updatePayload.mediaType = 'Cloud';
                }
                else {
                    updatePayload.mediaType = 'Video';
                }
            }
            if (payload.health) {
                delete updatePayload.health;
                if (payload.health.resolution) {
                    updatePayload['health.resolution'] = payload.health.resolution;
                }
                if (payload.health.latency !== undefined) {
                    updatePayload['health.latency'] = payload.health.latency;
                }
                if (payload.health.fps !== undefined) {
                    updatePayload['health.fps'] = payload.health.fps;
                }
            }
            const updated = await Cctv_1.CctvModel.findOneAndUpdate(workspaceId !== undefined ? { id, workspaceId } : { id }, { $set: updatePayload }, { new: true }).lean().exec();
            if (!updated) {
                throw new Error('CCTV tidak ditemukan.');
            }
            return updated;
        }
        catch (err) {
            console.error('[DATABASE ERROR] updateCctv failed:', err);
            throw err;
        }
    }
    static async delete(id, workspaceId) {
        try {
            const cctv = await Cctv_1.CctvModel.findOne(workspaceId !== undefined ? { id, workspaceId } : { id });
            if (!cctv) {
                throw new Error('CCTV tidak ditemukan.');
            }
            await Cctv_1.CctvModel.deleteOne(workspaceId !== undefined ? { id, workspaceId } : { id });
            return true;
        }
        catch (err) {
            console.error('[DATABASE ERROR] deleteCctv failed:', err);
            throw err;
        }
    }
    static async updateStatus(id, status, health) {
        try {
            const updatePayload = {
                status,
                lastHeartbeat: new Date()
            };
            if (status === 'ONLINE') {
                updatePayload.lastConnected = new Date();
            }
            if (health) {
                updatePayload.health = health;
            }
            await Cctv_1.CctvModel.updateOne({ id }, { $set: updatePayload });
        }
        catch (err) {
            console.error('[DATABASE ERROR] updateCctvStatus failed:', err);
        }
    }
    // --- ENCRYPTION HELPERS ---
    static encryptCctvPassword(text) {
        try {
            const encryptionKey = (0, crypto_1.scryptSync)(process.env.JWT_SECRET || 'eyeco-secret-key', 'salt', 32);
            const iv = (0, crypto_1.randomBytes)(16);
            const cipher = (0, crypto_1.createCipheriv)('aes-256-cbc', encryptionKey, iv);
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            return iv.toString('hex') + ':' + encrypted;
        }
        catch (err) {
            console.error('[DATABASE ERROR] Encryption failed:', err);
            return '';
        }
    }
    static decryptCctvPassword(text) {
        try {
            if (!text)
                return '';
            const encryptionKey = (0, crypto_1.scryptSync)(process.env.JWT_SECRET || 'eyeco-secret-key', 'salt', 32);
            const parts = text.split(':');
            const iv = Buffer.from(parts.shift(), 'hex');
            const encryptedText = Buffer.from(parts.join(':'), 'hex');
            const decipher = (0, crypto_1.createDecipheriv)('aes-256-cbc', encryptionKey, iv);
            let decrypted = decipher.update(encryptedText).toString('utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        }
        catch (err) {
            console.error('[DATABASE ERROR] Decryption failed:', err);
            return '';
        }
    }
}
exports.CctvRepository = CctvRepository;
