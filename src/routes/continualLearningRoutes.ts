import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/authMiddleware';
import { roleGuard } from '../auth/RoleMiddleware';
import { datasetReadinessService } from '../services/ai/continualLearning/datasetReadinessService';
import { statisticalEvaluationService } from '../services/ai/continualLearning/statisticalEvaluationService';
import { StatisticalEvaluationJobModel } from '../database/models/StatisticalEvaluationJob';
import { StatisticalModelEvaluationModel } from '../database/models/StatisticalModelEvaluation';
import { AiModelRegistryModel } from '../database/models/AiModelRegistry';
import { AiDatasetCandidateModel } from '../database/models/AiDatasetCandidate';

const router = Router();

// 1. Dashboard Summary Endpoint
router.get('/dashboard-summary', authMiddleware, roleGuard(['admin', 'superadmin']), async (req: Request, res: Response): Promise<void> => {
  try {
    const activeModel = await AiModelRegistryModel.findOne({ status: 'ACTIVE' }).sort({ createdAt: -1 }).exec();
    const candidateModel = await AiModelRegistryModel.findOne({ status: 'TEST_ONLY' }).sort({ createdAt: -1 }).exec();
    
    const approvedCandidatesCount = await AiDatasetCandidateModel.countDocuments({ approvalStatus: 'APPROVED' }).exec();
    const latestReadiness = await datasetReadinessService.evaluateDatasetReadiness({
      evaluatedByUserId: req.userContext?.id ? String(req.userContext.id) : undefined
    });

    const latestEval = await StatisticalModelEvaluationModel.findOne().sort({ createdAt: -1 }).exec();

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
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch dashboard summary' });
  }
});

// 2. Dataset Readiness Evaluation Endpoints
router.get('/dataset-readiness', authMiddleware, roleGuard(['admin', 'superadmin']), async (req: Request, res: Response): Promise<void> => {
  try {
    const readiness = await datasetReadinessService.evaluateDatasetReadiness({
      evaluatedByUserId: req.userContext?.id ? String(req.userContext.id) : undefined
    });
    res.json(readiness);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to evaluate dataset readiness' });
  }
});

router.post('/evaluate-readiness', authMiddleware, roleGuard(['admin', 'superadmin']), async (req: Request, res: Response): Promise<void> => {
  try {
    const readiness = await datasetReadinessService.evaluateDatasetReadiness({
      evaluatedByUserId: req.userContext?.id ? String(req.userContext.id) : undefined
    });
    res.json(readiness);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to evaluate dataset readiness' });
  }
});

// 3. Asynchronous Statistical Evaluation Endpoints (HTTP 202 Accepted)
router.post('/statistical-evaluations', authMiddleware, roleGuard(['admin', 'superadmin']), async (req: Request, res: Response): Promise<void> => {
  try {
    const { candidateModelId, baselineModelId, goldenDatasetVersion } = req.body;
    if (!candidateModelId) {
      res.status(400).json({ error: 'MISSING_PARAM: candidateModelId is required.' });
      return;
    }

    const context = {
      artifactRoot: process.env.ARTIFACT_ROOT || 'artifacts',
      databaseName: process.env.DB_NAME || 'eyeco_dev',
      environment: (process.env.NODE_ENV === 'production' ? 'PRODUCTION' : 'STAGING') as any
    };

    const job = await statisticalEvaluationService.enqueueStatisticalEvaluationJob({
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
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to enqueue statistical evaluation job' });
  }
});

router.get('/statistical-evaluations/:jobId', authMiddleware, roleGuard(['admin', 'superadmin']), async (req: Request, res: Response): Promise<void> => {
  try {
    const { jobId } = req.params;
    const job = await StatisticalEvaluationJobModel.findOne({ jobId }).exec();
    if (!job) {
      res.status(404).json({ error: `Job '${jobId}' not found.` });
      return;
    }

    let evaluationResult = null;
    if (job.resultEvaluationId) {
      evaluationResult = await StatisticalModelEvaluationModel.findOne({ evaluationId: job.resultEvaluationId }).exec();
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
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch statistical evaluation job status' });
  }
});

export default router;
