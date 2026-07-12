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
exports.WorkspaceModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const WorkspaceSchema = new mongoose_1.Schema({
    id: { type: Number, required: true, unique: true, index: true },
    code: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        uppercase: true,
        match: [/^[A-Z0-9-]+$/, 'Kode workspace hanya boleh berisi huruf, angka, dan tanda hubung']
    },
    name: { type: String, required: true, trim: true, unique: true },
    company: { type: String, default: '', trim: true },
    address: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    adminIds: [{ type: Number, index: true }],
    superadminId: { type: Number, index: true }
}, {
    timestamps: true
});
async function generateWorkspaceCode() {
    const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 25; attempt++) {
        let result = 'WS-';
        for (let i = 0; i < 6; i++) {
            result += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        const existing = await exports.WorkspaceModel.findOne({ code: result }).select('_id').lean().exec();
        if (!existing)
            return result;
    }
    throw new Error('Gagal membuat kode workspace unik');
}
WorkspaceSchema.pre('validate', async function () {
    if (!this.code) {
        this.code = await generateWorkspaceCode();
    }
    else {
        this.code = this.code.trim().toUpperCase();
    }
});
exports.WorkspaceModel = mongoose_1.default.models.Workspace
    || mongoose_1.default.model('Workspace', WorkspaceSchema);
