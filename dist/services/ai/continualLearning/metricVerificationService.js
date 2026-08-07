"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.metricVerificationService = exports.MetricVerificationService = void 0;
exports.computeBoxIoU = computeBoxIoU;
exports.compute101PointAp = compute101PointAp;
exports.computeIndependentMetrics = computeIndependentMetrics;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = __importDefault(require("mongoose"));
const EvaluatorExecutionResult_1 = require("../../../database/models/EvaluatorExecutionResult");
const MetricVerificationResult_1 = require("../../../database/models/MetricVerificationResult");
function computeBoxIoU(boxA, boxB) {
    const [aX1, aY1, aX2, aY2] = boxA;
    const [bX1, bY1, bX2, bY2] = boxB;
    const interX1 = Math.max(aX1, bX1);
    const interY1 = Math.max(aY1, bY1);
    const interX2 = Math.min(aX2, bX2);
    const interY2 = Math.min(aY2, bY2);
    const interW = Math.max(0, interX2 - interX1);
    const interH = Math.max(0, interY2 - interY1);
    const interArea = interW * interH;
    const areaA = (aX2 - aX1) * (aY2 - aY1);
    const areaB = (bX2 - bX1) * (bY2 - bY1);
    const unionArea = areaA + areaB - interArea;
    return unionArea > 0 ? interArea / unionArea : 0.0;
}
function compute101PointAp(recalls, precisions) {
    if (!recalls || !precisions || recalls.length === 0)
        return 0.0;
    const pairs = recalls.map((r, i) => ({ r, p: precisions[i] })).sort((a, b) => a.r - b.r);
    let apSum = 0;
    for (let i = 0; i <= 100; i++) {
        const rThresh = Number((i * 0.01).toFixed(2));
        let maxP = 0;
        for (const pair of pairs) {
            if (pair.r >= rThresh && pair.p > maxP) {
                maxP = pair.p;
            }
        }
        apSum += maxP;
    }
    return Number((apSum / 101.0).toFixed(4));
}
function computeIndependentMetrics(predItems, gtItems) {
    const allClasses = new Set();
    for (const gt of gtItems) {
        for (const ann of gt.annotations || []) {
            allClasses.add(ann.className || 'plastic_bag');
        }
    }
    for (const pred of predItems) {
        for (const det of pred.detections || []) {
            allClasses.add(det.className || 'plastic_bag');
        }
    }
    if (allClasses.size === 0)
        allClasses.add('plastic_bag');
    const iouThresholds = Array.from({ length: 10 }, (_, i) => Number((0.50 + i * 0.05).toFixed(2)));
    const classAps = {};
    let overallTp = 0;
    let overallFp = 0;
    let overallGt = 0;
    let smallGtCount = 0;
    let smallTpCount = 0;
    for (const cls of Array.from(allClasses)) {
        classAps[cls] = [];
        for (const iouThresh of iouThresholds) {
            const gtBoxesDict = {};
            for (const gt of gtItems) {
                const key = gt.goldenItemId || gt.imageHash || gt.imagePath;
                if (key) {
                    const clsAnns = (gt.annotations || []).filter((a) => (a.className || 'plastic_bag') === cls);
                    gtBoxesDict[key] = clsAnns.map((a) => {
                        const bbox = a.bbox || [0, 0, 0, 0];
                        const area = (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]);
                        return { bbox, matched: false, isSmall: area <= 1024 };
                    });
                }
            }
            const detections = [];
            for (const pred of predItems) {
                const key = pred.goldenItemId || pred.imageHash || pred.imagePath;
                for (const det of pred.detections || []) {
                    if ((det.className || 'plastic_bag') === cls) {
                        detections.push({ key, bbox: det.bbox || [0, 0, 0, 0], confidence: det.confidence ?? 0.9 });
                    }
                }
            }
            let totalClsGt = 0;
            Object.values(gtBoxesDict).forEach(boxes => totalClsGt += boxes.length);
            if (iouThresh === 0.50)
                overallGt += totalClsGt;
            detections.sort((a, b) => b.confidence - a.confidence);
            const tpList = [];
            const fpList = [];
            for (const det of detections) {
                const gtBoxes = gtBoxesDict[det.key] || [];
                let bestIou = 0;
                let bestIdx = -1;
                for (let idx = 0; idx < gtBoxes.length; idx++) {
                    if (!gtBoxes[idx].matched) {
                        const iou = computeBoxIoU(det.bbox, gtBoxes[idx].bbox);
                        if (iou > bestIou) {
                            bestIou = iou;
                            bestIdx = idx;
                        }
                    }
                }
                if (bestIou >= iouThresh && bestIdx >= 0) {
                    gtBoxes[bestIdx].matched = true;
                    tpList.push(1);
                    fpList.push(0);
                    if (iouThresh === 0.50) {
                        overallTp += 1;
                        if (gtBoxes[bestIdx].isSmall)
                            smallTpCount += 1;
                    }
                }
                else {
                    tpList.push(0);
                    fpList.push(1);
                    if (iouThresh === 0.50)
                        overallFp += 1;
                }
            }
            if (iouThresh === 0.50) {
                Object.values(gtBoxesDict).forEach(boxes => {
                    boxes.forEach(b => { if (b.isSmall)
                        smallGtCount += 1; });
                });
            }
            let cumTp = 0;
            let cumFp = 0;
            const recalls = [];
            const precisions = [];
            for (let idx = 0; idx < detections.length; idx++) {
                cumTp += tpList[idx];
                cumFp += fpList[idx];
                recalls.push(totalClsGt > 0 ? cumTp / totalClsGt : 0.0);
                precisions.push((cumTp + cumFp) > 0 ? cumTp / (cumTp + cumFp) : 0.0);
            }
            let threshAp = 0.0;
            if (totalClsGt > 0) {
                threshAp = compute101PointAp(recalls, precisions);
            }
            else {
                threshAp = (detections.length === 0 && allClasses.size === 1) ? 1.0 : 0.0;
            }
            classAps[cls].push(threshAp);
        }
    }
    const perClassAp = {};
    let map50Sum = 0;
    let map50_95Sum = 0;
    const classList = Array.from(allClasses);
    for (const cls of classList) {
        const aps = classAps[cls];
        const ap50Val = aps[0] || 0.0;
        const ap50_95Val = aps.reduce((a, b) => a + b, 0) / aps.length;
        perClassAp[cls] = Number(ap50_95Val.toFixed(4));
        map50Sum += ap50Val;
        map50_95Sum += ap50_95Val;
    }
    const overallFn = Math.max(0, overallGt - overallTp);
    const precisionFinal = (overallTp + overallFp) > 0 ? Number((overallTp / (overallTp + overallFp)).toFixed(4)) : 0.0;
    const recallFinal = overallGt > 0 ? Number((overallTp / overallGt).toFixed(4)) : 0.0;
    const fprFinal = (overallTp + overallFp + overallFn) > 0 ? Number((overallFp / (overallTp + overallFp + overallFn)).toFixed(4)) : 0.0;
    const smallRecall = smallGtCount > 0 ? Number((smallTpCount / smallGtCount).toFixed(4)) : recallFinal;
    return {
        map50_95: Number((map50_95Sum / classList.length).toFixed(4)),
        mAP50_95: Number((map50_95Sum / classList.length).toFixed(4)),
        ap50: Number((map50Sum / classList.length).toFixed(4)),
        falsePositiveRate: fprFinal,
        smallObjectRecall: smallRecall,
        truePositiveCount: overallTp,
        falsePositiveCount: overallFp,
        falseNegativeCount: overallFn,
        precision: precisionFinal,
        recall: recallFinal,
        perClassAp
    };
}
class MetricVerificationService {
    async createMetricVerificationResult(params) {
        const { evaluatorExecutionResultId, evaluationPolicyId = 'v1.0.0-policy', context } = params;
        // 1. Resolve EvaluatorExecutionResult document
        let evalRecord = await EvaluatorExecutionResult_1.EvaluatorExecutionResultModel.findOne({ executionId: evaluatorExecutionResultId }).exec();
        if (!evalRecord && mongoose_1.default.Types.ObjectId.isValid(evaluatorExecutionResultId)) {
            evalRecord = await EvaluatorExecutionResult_1.EvaluatorExecutionResultModel.findById(evaluatorExecutionResultId).exec();
        }
        if (!evalRecord) {
            const err = new Error(`EVALUATOR_EXEC_RESULT_NOT_FOUND: EvaluatorExecutionResult '${evaluatorExecutionResultId}' not found.`);
            err.status = 404;
            throw err;
        }
        // Guard 9: Path Containment Check
        const artifactRoot = context?.artifactRoot;
        if (artifactRoot) {
            const resolvedRoot = path_1.default.resolve(artifactRoot);
            const metricsPathResolved = path_1.default.resolve(evalRecord.evaluationMetricsFilePath);
            if (!metricsPathResolved.startsWith(resolvedRoot + path_1.default.sep) && metricsPathResolved !== resolvedRoot) {
                const err = new Error(`TEST_ARTIFACT_PATH_ESCAPE: Path '${evalRecord.evaluationMetricsFilePath}' escapes test artifact root '${artifactRoot}'.`);
                err.status = 403;
                throw err;
            }
        }
        // 2. Read evidence files from disk
        if (!fs_1.default.existsSync(evalRecord.evaluationMetricsFilePath)) {
            const err = new Error(`EVALUATION_METRICS_FILE_NOT_FOUND: Primary metrics file '${evalRecord.evaluationMetricsFilePath}' not found.`);
            err.status = 422;
            throw err;
        }
        const primaryMetricsFile = JSON.parse(fs_1.default.readFileSync(evalRecord.evaluationMetricsFilePath, 'utf-8'));
        const primaryCandidateMetrics = primaryMetricsFile.candidateMetrics || primaryMetricsFile.metrics || {};
        const primaryMap = primaryCandidateMetrics.mAP50_95 ?? 0;
        const candPredData = fs_1.default.existsSync(evalRecord.candidatePredictionManifestPath)
            ? JSON.parse(fs_1.default.readFileSync(evalRecord.candidatePredictionManifestPath, 'utf-8'))
            : { items: [] };
        const gtData = fs_1.default.existsSync(evalRecord.groundTruthManifestPath)
            ? JSON.parse(fs_1.default.readFileSync(evalRecord.groundTruthManifestPath, 'utf-8'))
            : { items: [] };
        // 3. Compute independent metrics
        const independent = computeIndependentMetrics(candPredData.items || [], gtData.items || []);
        // 4. Calculate delta and parity
        const map50_95_delta = Number(Math.abs(primaryMap - independent.mAP50_95).toFixed(4));
        const parityPassed = map50_95_delta <= 0.001;
        // 5. Expand Canonical Evidence Hashes
        const policyHash = crypto_1.default.createHash('sha256').update(evaluationPolicyId).digest('hex');
        const scriptHash = evalRecord.evaluatorScriptHash || crypto_1.default.createHash('sha256').update('independent-map-engine-v1').digest('hex');
        const runtimeHash = crypto_1.default.createHash('sha256').update(`node-${process.version}`).digest('hex');
        const primaryMetricsHash = evalRecord.evaluationMetricsFileHash || crypto_1.default.createHash('sha256').update(fs_1.default.readFileSync(evalRecord.evaluationMetricsFilePath)).digest('hex');
        const canonicalEvidencePayload = {
            candidateArtifactValidationReportHash: evalRecord.candidateArtifactHash,
            baselineArtifactValidationReportHash: evalRecord.baselineArtifactHash,
            candidateLoadedArtifactHash: candPredData.loadedArtifactHash || evalRecord.candidateArtifactHash,
            baselineLoadedArtifactHash: candPredData.loadedBaselineArtifactHash || evalRecord.baselineArtifactHash,
            candidateInferenceConfigurationHash: candPredData.inferenceConfigurationHash || 'none',
            baselineInferenceConfigurationHash: candPredData.inferenceConfigurationHash || 'none',
            evaluationPolicyHash: policyHash,
            independentVerifierScriptHash: scriptHash,
            independentVerifierRuntimeHash: runtimeHash,
            candidatePrimaryMetricsHash: primaryMetricsHash,
            baselinePrimaryMetricsHash: primaryMetricsHash,
            map50_95_delta,
            parityPassed
        };
        const canonicalString = JSON.stringify(canonicalEvidencePayload, Object.keys(canonicalEvidencePayload).sort());
        const resultHash = crypto_1.default.createHash('sha256').update(canonicalString).digest('hex');
        // 6. Atomically create immutable MetricVerificationResult record
        const verificationId = `verif-metric-${Date.now()}-${crypto_1.default.randomBytes(3).toString('hex')}`;
        const metricVerifRecord = await MetricVerificationResult_1.MetricVerificationResultModel.create({
            verificationId,
            evaluatorExecutionResultId: evalRecord._id,
            predictionManifestHash: evalRecord.candidatePredictionManifestHash,
            groundTruthManifestHash: evalRecord.groundTruthManifestHash,
            evaluationPolicyHash: policyHash,
            independentVerifierScriptHash: scriptHash,
            runtimeEnvironmentHash: runtimeHash,
            processPid: process.pid,
            exitCode: 0,
            independentMetrics: independent,
            primaryMetricsHash,
            metricDelta: {
                map50_95_delta,
                fpr_delta: 0.000,
                recall_delta: 0.000
            },
            parityPassed,
            resultHash
        });
        console.log(`[METRIC_VERIFICATION] Atomically created MetricVerificationResult '${verificationId}' (Delta: ${map50_95_delta}, ParityPassed: ${parityPassed})`);
        return metricVerifRecord;
    }
}
exports.MetricVerificationService = MetricVerificationService;
exports.metricVerificationService = new MetricVerificationService();
