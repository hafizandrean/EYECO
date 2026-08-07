"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../auth/authMiddleware");
const RoleMiddleware_1 = require("../auth/RoleMiddleware");
const datasetReadinessService_1 = require("../services/ai/continualLearning/datasetReadinessService");
const statisticalEvaluationService_1 = require("../services/ai/continualLearning/statisticalEvaluationService");
const StatisticalEvaluationJob_1 = require("../database/models/StatisticalEvaluationJob");
const StatisticalModelEvaluation_1 = require("../database/models/StatisticalModelEvaluation");
const AiModelRegistry_1 = require("../database/models/AiModelRegistry");
const AiDatasetCandidate_1 = require("../database/models/AiDatasetCandidate");
const router = (0, express_1.Router)();
// 1. Dashboard Summary Endpoint
router.get('/dashboard-summary', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'superadmin']), async (req, res) => {
    try {
        const activeModel = await AiModelRegistry_1.AiModelRegistryModel.findOne({ status: 'ACTIVE' }).sort({ createdAt: -1 }).exec();
        const candidateModel = await AiModelRegistry_1.AiModelRegistryModel.findOne({ status: 'TEST_ONLY' }).sort({ createdAt: -1 }).exec();
        const approvedCandidatesCount = await AiDatasetCandidate_1.AiDatasetCandidateModel.countDocuments({ approvalStatus: 'APPROVED' }).exec();
        const latestReadiness = await datasetReadinessService_1.datasetReadinessService.evaluateDatasetReadiness({
            evaluatedByUserId: req.userContext?.id ? String(req.userContext.id) : undefined
        });
        const latestEval = await StatisticalModelEvaluation_1.StatisticalModelEvaluationModel.findOne().sort({ createdAt: -1 }).exec();
        res.json({
            activeModel: activeModel ? {
                modelId: activeModel.modelId,
                modelVersion: activeModel.modelVersion,
                environment: activeModel.environment,
                status: activeModel.status,
                metrics: activeModel.metrics
            } : null,
            candidateModel: candidateModel ? {
                modelId: candidateModel.modelId,
                modelVersion: candidateModel.modelVersion,
                environment: candidateModel.environment,
                status: candidateModel.status,
                metrics: candidateModel.metrics
            } : null,
            approvedCandidatesCount,
            readiness: {
                readyForTraining: latestReadiness.readyForTraining,
                overallReadinessPercentage: latestReadiness.overallReadinessPercentage,
                breakdown: latestReadiness.breakdown,
                unsatisfiedRuleReasons: latestReadiness.unsatisfiedRuleReasons
            },
            latestStatisticalEvaluation: latestEval ? {
                evaluationId: latestEval.evaluationId,
                statisticalDecision: latestEval.statisticalDecision,
                statisticallyMeaningful: latestEval.statisticallyMeaningful,
                shadowEligible: latestEval.shadowEligible,
                productionEligible: latestEval.productionEligible,
                deploymentEligibility: latestEval.deploymentEligibility,
                metricDeltas: latestEval.metricDeltas,
                cctvOperationalMetrics: latestEval.cctvOperationalMetrics,
                subgroupResults: latestEval.subgroupResults
            } : null
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message || 'Failed to fetch dashboard summary' });
    }
});
// 2. Dataset Readiness Evaluation Endpoints
router.get('/dataset-readiness', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'superadmin']), async (req, res) => {
    try {
        const readiness = await datasetReadinessService_1.datasetReadinessService.evaluateDatasetReadiness({
            evaluatedByUserId: req.userContext?.id ? String(req.userContext.id) : undefined
        });
        res.json(readiness);
    }
    catch (err) {
        res.status(500).json({ error: err.message || 'Failed to evaluate dataset readiness' });
    }
});
router.post('/evaluate-readiness', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'superadmin']), async (req, res) => {
    try {
        const readiness = await datasetReadinessService_1.datasetReadinessService.evaluateDatasetReadiness({
            evaluatedByUserId: req.userContext?.id ? String(req.userContext.id) : undefined
        });
        res.json(readiness);
    }
    catch (err) {
        res.status(500).json({ error: err.message || 'Failed to evaluate dataset readiness' });
    }
});
// 3. Asynchronous Statistical Evaluation Endpoints (HTTP 202 Accepted)
router.post('/statistical-evaluations', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'superadmin']), async (req, res) => {
    try {
        const { candidateModelId, baselineModelId, goldenDatasetVersion } = req.body;
        if (!candidateModelId) {
            res.status(400).json({ error: 'MISSING_PARAM: candidateModelId is required.' });
            return;
        }
        const context = {
            artifactRoot: process.env.ARTIFACT_ROOT || 'artifacts',
            databaseName: process.env.DB_NAME || 'eyeco_dev',
            environment: (process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'STAGING')
        };
        const job = await statisticalEvaluationService_1.statisticalEvaluationService.enqueueStatisticalEvaluationJob({
            candidateModelId,
            baselineModelId,
            goldenDatasetVersion,
            requestedByUserId: req.userContext?.id ? String(req.userContext.id) : undefined,
            context
        });
        res.status(202).json({
            evaluationJobId: job.jobId,
            status: job.status,
            candidateModelId: job.candidateModelId,
            baselineModelId: job.baselineModelId,
            createdAt: job.createdAt
        });
    }
    catch (err) {
        res.status(err.status || 500).json({ error: err.message || 'Failed to enqueue statistical evaluation job' });
    }
});
router.get('/statistical-evaluations/:jobId', authMiddleware_1.authMiddleware, (0, RoleMiddleware_1.roleGuard)(['admin', 'superadmin']), async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await StatisticalEvaluationJob_1.StatisticalEvaluationJobModel.findOne({ jobId }).exec();
        if (!job) {
            res.status(404).json({ error: `Job '${jobId}' not found.` });
            return;
        }
        let evaluationResult = null;
        if (job.resultEvaluationId) {
            evaluationResult = await StatisticalModelEvaluation_1.StatisticalModelEvaluationModel.findOne({ evaluationId: job.resultEvaluationId }).exec();
        }
        res.json({
            jobId: job.jobId,
            status: job.status,
            candidateModelId: job.candidateModelId,
            baselineModelId: job.baselineModelId,
            attemptCount: job.attemptCount,
            completedAt: job.completedAt,
            errorMessage: job.errorMessage,
            evaluationResult
        });
    }
    catch (err) {
        res.status(500).json({ error: err.message || 'Failed to fetch statistical evaluation job status' });
    }
});
exports.default = router;
