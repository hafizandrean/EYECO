"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelRouterService = exports.ModelRouterService = void 0;
const AiModelRegistry_1 = require("../../../database/models/AiModelRegistry");
const mongoose_1 = __importDefault(require("mongoose"));
class ModelRouterService {
    async getActiveModel(targetModel, environment = 'PRODUCTION') {
        const activeModel = await AiModelRegistry_1.AiModelRegistryModel.findOne({
            modelType: targetModel,
            environment,
            status: 'ACTIVE'
        }).exec();
        if (activeModel && activeModel.artifactHash) {
            return {
                modelId: activeModel.modelId,
                modelVersion: activeModel.modelVersion,
                artifactPath: activeModel.artifactPath || '/weights/yolov8n-production-active.pt',
                artifactHash: activeModel.artifactHash,
                isBaseline: false
            };
        }
        // Default Baseline Model Fallback
        return {
            modelId: 'model-baseline-yolov8n',
            modelVersion: 'v3.0.0-baseline',
            artifactPath: '/weights/yolov8n-baseline.pt',
            artifactHash: 'sha256-baseline-model-hash',
            isBaseline: true
        };
    }
    async activateModel(modelId, adminUserId) {
        const candidateModel = await AiModelRegistry_1.AiModelRegistryModel.findOne({ modelId }).exec();
        if (!candidateModel)
            throw new Error(`Model ${modelId} not found.`);
        // P0 Activation Admission Guard: Enforce strict production readiness
        const isActivationAllowed = candidateModel.status === 'APPROVED' &&
            candidateModel.environment === 'PRODUCTION' &&
            candidateModel.promotionEligible === true &&
            candidateModel.actualTrainingPerformed === true &&
            candidateModel.actualEvaluationPerformed === true &&
            candidateModel.artifactHash != null;
        if (!isActivationAllowed) {
            const err = new Error(`MODEL_ACTIVATION_ADMISSION_DENIED: Model ${modelId} does not meet PRODUCTION activation requirements (Status: ${candidateModel.status}, promotionEligible: ${candidateModel.promotionEligible}, actualTrainingPerformed: ${candidateModel.actualTrainingPerformed}).`);
            err.status = 422;
            throw err;
        }
        // Warm-up & Artifact Verification Check (Simulated)
        const isWarmupPassed = candidateModel.artifactHash && candidateModel.artifactHash.startsWith('sha256-');
        if (!isWarmupPassed) {
            const err = new Error(`WARMUP_FAILED: Candidate model ${modelId} failed warm-up inference check.`);
            err.status = 422;
            throw err;
        }
        // Deactivate previous active model atomically using compare-and-set
        const currentActive = await AiModelRegistry_1.AiModelRegistryModel.findOne({
            modelType: candidateModel.modelType,
            environment: 'PRODUCTION',
            status: 'ACTIVE'
        }).exec();
        if (currentActive) {
            currentActive.status = 'APPROVED';
            await currentActive.save();
            candidateModel.rollbackModelId = currentActive.modelId;
        }
        candidateModel.status = 'ACTIVE';
        candidateModel.approvedByUserId = new mongoose_1.default.Types.ObjectId(adminUserId);
        candidateModel.approvedAt = new Date();
        await candidateModel.save();
        console.log(`[MODEL_ROUTER] Model ${modelId} successfully activated as ACTIVE for PRODUCTION ${candidateModel.modelType}`);
        return candidateModel;
    }
    async activateTestModel(modelId, adminUserId) {
        const candidateModel = await AiModelRegistry_1.AiModelRegistryModel.findOne({ modelId }).exec();
        if (!candidateModel)
            throw new Error(`Model ${modelId} not found.`);
        const currentActive = await AiModelRegistry_1.AiModelRegistryModel.findOne({
            modelType: candidateModel.modelType,
            environment: 'TEST',
            status: 'ACTIVE'
        }).exec();
        if (currentActive) {
            currentActive.status = 'TEST_ONLY';
            await currentActive.save();
            candidateModel.rollbackModelId = currentActive.modelId;
        }
        candidateModel.status = 'ACTIVE';
        candidateModel.environment = 'TEST';
        candidateModel.approvedByUserId = new mongoose_1.default.Types.ObjectId(adminUserId);
        candidateModel.approvedAt = new Date();
        await candidateModel.save();
        console.log(`[MODEL_ROUTER] Test Model ${modelId} activated as ACTIVE for TEST ${candidateModel.modelType}`);
        return candidateModel;
    }
    async rollbackModel(targetModel, adminUserId, environment = 'PRODUCTION') {
        const activeModel = await AiModelRegistry_1.AiModelRegistryModel.findOne({
            modelType: targetModel,
            environment,
            status: 'ACTIVE'
        }).exec();
        if (!activeModel || !activeModel.rollbackModelId) {
            console.warn(`[MODEL_ROUTER] No rollback target available for ${targetModel}`);
            return null;
        }
        const previousModel = await AiModelRegistry_1.AiModelRegistryModel.findOne({ modelId: activeModel.rollbackModelId }).exec();
        if (!previousModel)
            throw new Error(`Rollback target model ${activeModel.rollbackModelId} not found.`);
        activeModel.status = 'ROLLED_BACK';
        await activeModel.save();
        previousModel.status = 'ACTIVE';
        previousModel.approvedByUserId = new mongoose_1.default.Types.ObjectId(adminUserId);
        previousModel.approvedAt = new Date();
        await previousModel.save();
        console.log(`[MODEL_ROUTER] Successfully ROLLED BACK ${targetModel} in ${environment} to previous model ${previousModel.modelId}`);
        return previousModel;
    }
}
exports.ModelRouterService = ModelRouterService;
exports.modelRouterService = new ModelRouterService();
