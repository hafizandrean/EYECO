"use strict";
/**
 * EYECO AI Engine v3.0 — Policy Loader & Runtime Validator (Guardrail #8)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvalidDecisionPolicyError = void 0;
exports.loadDecisionPolicy = loadDecisionPolicy;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class InvalidDecisionPolicyError extends Error {
    constructor(message) {
        super(`[POLICY ERROR] ${message}`);
        this.name = 'InvalidDecisionPolicyError';
    }
}
exports.InvalidDecisionPolicyError = InvalidDecisionPolicyError;
const DEFAULT_POLICY = {
    policyVersion: 'policy-v1.0-fallback',
    weights: {
        personDetected: 20,
        trashDetected: 50,
        trashHighConfidence: 10,
        trashNearWrist: 20,
        trashAppearsAirborne: 15,
        trashOnWaterZone: 15,
        trashOnRoadZone: 10,
        trashInsideBinZone: -35,
        noPersonDetected: -15,
        noTrashDetected: -30,
    },
    thresholds: {
        highMinScore: 65,
        mediumMinScore: 40,
        lowMinScore: 20,
    },
};
function loadDecisionPolicy() {
    const policyPath = path_1.default.resolve(__dirname, '../../../config/decision-policy.json');
    try {
        if (!fs_1.default.existsSync(policyPath)) {
            console.warn('[POLICY] decision-policy.json not found, using validated fallback policy.');
            return DEFAULT_POLICY;
        }
        const raw = fs_1.default.readFileSync(policyPath, 'utf8');
        const policy = JSON.parse(raw);
        // Strict Runtime Validation (Guardrail #8)
        if (!policy.policyVersion || typeof policy.policyVersion !== 'string') {
            throw new InvalidDecisionPolicyError('policyVersion field is missing or not a string');
        }
        if (!policy.weights || typeof policy.weights !== 'object') {
            throw new InvalidDecisionPolicyError('weights field is missing or not an object');
        }
        for (const [key, val] of Object.entries(policy.weights)) {
            if (typeof val !== 'number' || !Number.isFinite(val)) {
                throw new InvalidDecisionPolicyError(`Weight '${key}' is not a finite number: ${val}`);
            }
        }
        const { thresholds } = policy;
        if (!thresholds || typeof thresholds !== 'object') {
            throw new InvalidDecisionPolicyError('thresholds object is missing');
        }
        const { highMinScore, mediumMinScore, lowMinScore } = thresholds;
        if ([highMinScore, mediumMinScore, lowMinScore].some(t => typeof t !== 'number' || t < 0 || t > 100)) {
            throw new InvalidDecisionPolicyError('Threshold values must be numbers between 0 and 100');
        }
        if (!(highMinScore > mediumMinScore && mediumMinScore > lowMinScore)) {
            throw new InvalidDecisionPolicyError(`Threshold ordering invalid: expected highMinScore (${highMinScore}) > mediumMinScore (${mediumMinScore}) > lowMinScore (${lowMinScore})`);
        }
        return policy;
    }
    catch (err) {
        console.error('[POLICY VALIDATION FAILED]:', err.message);
        return DEFAULT_POLICY;
    }
}
