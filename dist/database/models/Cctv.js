"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CctvModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const CctvCapabilitiesSchema = new mongoose_1.Schema({
    rtsp: { type: Boolean, default: false },
    hls: { type: Boolean, default: false },
    snapshot: { type: Boolean, default: false },
    mjpeg: { type: Boolean, default: false },
    onvif: { type: Boolean, default: false },
    cloud: { type: Boolean, default: false }
}, { _id: false });
const CctvHealthSchema = new mongoose_1.Schema({
    latency: { type: Number, default: 0 },
    fps: { type: Number, default: 0 },
    resolution: { type: String, default: '1280x720' }
}, { _id: false });
const CctvSchema = new mongoose_1.Schema({
    id: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true },
    location: { type: String, required: true },
    description: { type: String, default: '' },
    vendor: { type: String, default: 'GENERIC' },
    model: { type: String, default: '' },
    protocol: { type: String, required: true },
    mediaType: { type: String, required: true },
    streamUrl: { type: String, required: true },
    playUrl: { type: String },
    username: { type: String },
    password: { type: String }, // Stored encrypted
    capabilities: {
        rtsp: { type: Boolean, default: false },
        hls: { type: Boolean, default: false },
        snapshot: { type: Boolean, default: false },
        mjpeg: { type: Boolean, default: false },
        onvif: { type: Boolean, default: false },
        cloud: { type: Boolean, default: false }
    },
    status: {
        type: String,
        required: true,
        enum: ['NEW', 'CONNECTING', 'ONLINE', 'OFFLINE', 'BUFFERING', 'ERROR', 'DISCONNECTED', 'MONITORING', 'PAUSED', 'MAINTENANCE'],
        default: 'NEW'
    },
    health: {
        latency: { type: Number, default: 0 },
        fps: { type: Number, default: 0 },
        resolution: { type: String, default: '1280x720' }
    },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    monitoringEnabled: { type: Boolean, default: true },
    priority: { type: String, enum: ['CRITICAL', 'HIGH', 'NORMAL', 'LOW'], default: 'NORMAL' },
    priorityWeight: { type: Number, default: 50 },
    lastFrameAt: { type: Date },
    reconnectCount: { type: Number, default: 0 },
    packetLoss: { type: Number, default: 0 },
    lastHeartbeat: { type: Date },
    lastConnected: { type: Date },
    workspaceId: { type: Number, index: true }
}, { timestamps: true });
exports.CctvModel = mongoose_1.default.models.Cctv || mongoose_1.default.model('Cctv', CctvSchema);
