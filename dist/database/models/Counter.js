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
exports.CounterModel = void 0;
exports.getNextSequence = getNextSequence;
const mongoose_1 = __importStar(require("mongoose"));
const CounterSchema = new mongoose_1.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 }
}, { _id: false });
exports.CounterModel = mongoose_1.default.models.Counter || mongoose_1.default.model('Counter', CounterSchema);
/**
 * Atomic counter sequence generator using findOneAndUpdate with $inc.
 * Prevents race conditions and E11000 duplicate key errors under concurrent executions.
 */
async function getNextSequence(sequenceName, seedModel) {
    let counter = await exports.CounterModel.findOneAndUpdate({ _id: sequenceName }, { $inc: { seq: 1 } }, { returnDocument: 'after', upsert: true, new: true }).exec();
    if (!counter)
        return 1;
    // If counter was just initialized to 1 and seedModel exists, seed to maxId + 1 if maxId >= 1
    if (counter.seq === 1 && seedModel) {
        const maxDoc = await seedModel.findOne().sort({ id: -1 }).exec();
        if (maxDoc && typeof maxDoc.id === 'number' && maxDoc.id >= 1) {
            const seeded = await exports.CounterModel.findOneAndUpdate({ _id: sequenceName }, { $set: { seq: maxDoc.id + 1 } }, { returnDocument: 'after', upsert: true, new: true }).exec();
            return seeded ? seeded.seq : maxDoc.id + 1;
        }
    }
    return counter.seq;
}
