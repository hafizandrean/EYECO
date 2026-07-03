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
exports.CameraEventModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const CameraEventSchema = new mongoose_1.Schema({
    id: { type: Number, required: true, unique: true },
    cameraId: { type: Number, required: true, index: true },
    eventType: {
        type: String,
        required: true,
        enum: ['OFFLINE', 'ONLINE', 'RECONNECT', 'PACKET_LOSS', 'RTSP_TIMEOUT', 'AUTH_FAILED', 'RESOLUTION_CHANGED', 'FPS_DROP']
    },
    severity: {
        type: String,
        required: true,
        enum: ['INFO', 'WARNING', 'CRITICAL']
    },
    details: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: { expires: 180 * 24 * 60 * 60 } } // Auto-delete after 180 days (TTL)
}, {
    timestamps: { createdAt: true, updatedAt: false }
});
exports.CameraEventModel = mongoose_1.default.model('CameraEvent', CameraEventSchema);
