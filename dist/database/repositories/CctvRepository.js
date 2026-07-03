"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CctvRepository = void 0;
const Cctv_1 = require("../models/Cctv");
const crypto_1 = require("crypto");
class CctvRepository {
    // --- CCTV METHODS ---
    static async getAll() {
        try {
            let count = await Cctv_1.CctvModel.countDocuments();
            if (count === 0) {
                console.log('[DATABASE INFO] CCTV collection is empty. Seeding default 8 cameras...');
                const defaultCameras = [
                    {
                        id: 1,
                        name: 'Jembatan Merah',
                        location: 'Jembatan Merah',
                        description: 'Pemantauan hulu sungai Jembatan Merah',
                        vendor: 'GENERIC',
                        model: 'CCTV-G1',
                        protocol: 'HTTP Image',
                        mediaType: 'Image',
                        streamUrl: '/uploads/detection_1.jpg',
                        playUrl: '/uploads/detection_1.jpg',
                        capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
                        isDefault: true,
                        status: 'ONLINE',
                        health: { latency: 45, fps: 0, resolution: '1280x720' },
                        createdBy: 1
                    },
                    {
                        id: 2,
                        name: 'Sektor 7 Hulu',
                        location: 'Sektor 7 Hulu',
                        description: 'Pemantauan tanggul Sektor 7 Hulu',
                        vendor: 'GENERIC',
                        model: 'CCTV-G2',
                        protocol: 'HTTP Image',
                        mediaType: 'Image',
                        streamUrl: '/uploads/detection_2.jpg',
                        playUrl: '/uploads/detection_2.jpg',
                        capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
                        isDefault: true,
                        status: 'ONLINE',
                        health: { latency: 50, fps: 0, resolution: '1280x720' },
                        createdBy: 1
                    },
                    {
                        id: 3,
                        name: 'Pintu Air Manggarai',
                        location: 'Pintu Air Manggarai',
                        description: 'Pemantauan debit air Pintu Air Manggarai',
                        vendor: 'GENERIC',
                        model: 'CCTV-G3',
                        protocol: 'HTTP Image',
                        mediaType: 'Image',
                        streamUrl: '/uploads/detection_3.jpg',
                        playUrl: '/uploads/detection_3.jpg',
                        capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
                        isDefault: true,
                        status: 'ONLINE',
                        health: { latency: 60, fps: 0, resolution: '1280x720' },
                        createdBy: 1
                    },
                    {
                        id: 4,
                        name: 'Aliran Kampung Melayu',
                        location: 'Aliran Kampung Melayu',
                        description: 'Aliran padat penduduk Kampung Melayu',
                        vendor: 'GENERIC',
                        model: 'CCTV-G4',
                        protocol: 'HTTP Image',
                        mediaType: 'Image',
                        streamUrl: '/uploads/detection_4.jpg',
                        playUrl: '/uploads/detection_4.jpg',
                        capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
                        isDefault: true,
                        status: 'ONLINE',
                        health: { latency: 55, fps: 0, resolution: '1280x720' },
                        createdBy: 1
                    },
                    {
                        id: 5,
                        name: 'Bendungan Katulampa',
                        location: 'Bendungan Katulampa',
                        description: 'Pemantauan volume air Bendungan Katulampa',
                        vendor: 'GENERIC',
                        model: 'CCTV-G5',
                        protocol: 'HTTP Image',
                        mediaType: 'Image',
                        streamUrl: '/uploads/detection_5.jpg',
                        playUrl: '/uploads/detection_5.jpg',
                        capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
                        isDefault: true,
                        status: 'ONLINE',
                        health: { latency: 80, fps: 0, resolution: '1280x720' },
                        createdBy: 1
                    },
                    {
                        id: 6,
                        name: 'Kali Ciliwung Depok',
                        location: 'Kali Ciliwung Depok',
                        description: 'Aliran tengah Kali Ciliwung Depok',
                        vendor: 'GENERIC',
                        model: 'CCTV-G6',
                        protocol: 'HTTP Image',
                        mediaType: 'Image',
                        streamUrl: '/uploads/detection_6.jpg',
                        playUrl: '/uploads/detection_6.jpg',
                        capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
                        isDefault: true,
                        status: 'ONLINE',
                        health: { latency: 65, fps: 0, resolution: '1280x720' },
                        createdBy: 1
                    },
                    {
                        id: 7,
                        name: 'Pintu Air Karet',
                        location: 'Pintu Air Karet',
                        description: 'Pemantauan aliran Pintu Air Karet',
                        vendor: 'GENERIC',
                        model: 'CCTV-G7',
                        protocol: 'HTTP Image',
                        mediaType: 'Image',
                        streamUrl: '/uploads/detection_7.jpg',
                        playUrl: '/uploads/detection_7.jpg',
                        capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
                        isDefault: true,
                        status: 'ONLINE',
                        health: { latency: 70, fps: 0, resolution: '1280x720' },
                        createdBy: 1
                    },
                    {
                        id: 8,
                        name: 'Sektor 12 Hilir',
                        location: 'Sektor 12 Hilir',
                        description: 'Sektor 12 Hilir penyaringan sampah',
                        vendor: 'GENERIC',
                        model: 'CCTV-G8',
                        protocol: 'HTTP Image',
                        mediaType: 'Image',
                        streamUrl: '/uploads/detection_8.jpg',
                        playUrl: '/uploads/detection_8.jpg',
                        capabilities: { rtsp: false, hls: false, snapshot: true, mjpeg: false, onvif: false, cloud: false },
                        isDefault: true,
                        status: 'ONLINE',
                        health: { latency: 90, fps: 0, resolution: '1280x720' },
                        createdBy: 1
                    }
                ];
                await Cctv_1.CctvModel.insertMany(defaultCameras);
            }
            return await Cctv_1.CctvModel.find({}).sort({ id: 1 }).lean();
        }
        catch (err) {
            console.error('[DATABASE ERROR] getAllCctv failed:', err);
            throw err;
        }
    }
    static async getById(id) {
        try {
            return await Cctv_1.CctvModel.findOne({ id }).lean();
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
                createdBy: userId
            });
            await newCctv.save();
            return newCctv;
        }
        catch (err) {
            console.error('[DATABASE ERROR] addCctv failed:', err);
            throw err;
        }
    }
    static async update(id, payload) {
        try {
            const updatePayload = { ...payload };
            if (payload.password) {
                updatePayload.password = CctvRepository.encryptCctvPassword(payload.password);
            }
            if (payload.streamUrl) {
                updatePayload.playUrl = payload.playUrl || payload.streamUrl;
            }
            const updated = await Cctv_1.CctvModel.findOneAndUpdate({ id }, { $set: updatePayload }, { new: true }).lean().exec();
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
    static async delete(id) {
        try {
            const cctv = await Cctv_1.CctvModel.findOne({ id });
            if (!cctv) {
                throw new Error('CCTV tidak ditemukan.');
            }
            if (cctv.isDefault) {
                throw new Error('Kamera bawaan sistem tidak boleh dihapus.');
            }
            await Cctv_1.CctvModel.deleteOne({ id });
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
