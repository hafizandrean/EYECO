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
exports.AdminValidationEventModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const AdminValidationEventSchema = new mongoose_1.Schema({
    eventId: { type: String, required: true, unique: true, index: true },
    reportId: { type: Number, required: true, index: true },
    snapshotId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'AiSnapshot', default: null, index: true },
    previousValidationStatus: { type: String, required: true },
    validationStatus: { type: String, enum: ['VALID', 'INVALID'], required: true, index: true },
    invalidReason: {
        type: String,
        enum: ['FALSE_POSITIVE', 'WRONG_OBJECT', 'WRONG_ACTIVITY', 'WRONG_CONTEXT', 'INSUFFICIENT_EVIDENCE', 'OTHER', null],
        default: null,
        index: true
    },
    correctionPayload: { type: mongoose_1.Schema.Types.Mixed, default: null },
    validatedByUserId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    validatedAt: { type: Date, default: Date.now },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    payloadHash: { type: String, required: true },
    mlFeedbackRole: {
        type: String,
        enum: [
            'CONFIRMED_POSITIVE',
            'NEGATIVE_EXAMPLE',
            'OBJECT_CORRECTION',
            'ACTIVITY_CORRECTION',
            'CONTEXT_CORRECTION',
            'EXCLUDED_FROM_TRAINING',
            'HUMAN_REVIEW_REQUIRED'
        ],
        required: true,
        index: true
    },
    createdAt: { type: Date, default: Date.now }
}, { timestamps: { createdAt: true, updatedAt: false } });
function blockMutation(errorMsg, next) {
    const err = new Error(errorMsg);
    err.status = 422;
    if (typeof next === 'function')
        return next(err);
    throw err;
}
AdminValidationEventSchema.pre('save', function (next) {
    if (!this.isNew) {
        return blockMutation('ADMIN_VALIDATION_EVENT_IMMUTABLE: AdminValidationEvent documents are strictly append-only. Modification and deletion are REJECTED.', next);
    }
    if (typeof next === 'function')
        next();
});
const queryBlocker = function (next) {
    blockMutation('ADMIN_VALIDATION_EVENT_IMMUTABLE: AdminValidationEvent documents are strictly append-only. Modification and deletion are REJECTED.', next);
};
AdminValidationEventSchema.pre('updateOne', queryBlocker);
AdminValidationEventSchema.pre('updateMany', queryBlocker);
AdminValidationEventSchema.pre('findOneAndUpdate', queryBlocker);
AdminValidationEventSchema.pre('replaceOne', queryBlocker);
AdminValidationEventSchema.pre('deleteOne', queryBlocker);
AdminValidationEventSchema.pre('deleteMany', queryBlocker);
AdminValidationEventSchema.pre('findOneAndDelete', queryBlocker);
AdminValidationEventSchema.pre('bulkWrite', queryBlocker);
exports.AdminValidationEventModel = mongoose_1.default.model('AdminValidationEvent', AdminValidationEventSchema);
