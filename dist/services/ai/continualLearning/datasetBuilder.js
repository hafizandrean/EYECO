"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.datasetBuilder = exports.DatasetBuilder = void 0;
const AiDatasetCandidate_1 = require("../../../database/models/AiDatasetCandidate");
const AiSnapshot_1 = require("../../../database/models/AiSnapshot");
const AiValidationLog_1 = require("../../../database/models/AiValidationLog");
const AiDatasetVersion_1 = require("../../../database/models/AiDatasetVersion");
const mongoose_1 = __importDefault(require("mongoose"));
const crypto_1 = __importDefault(require("crypto"));
class UnionFind {
    parent = new Map();
    find(i) {
        if (!this.parent.has(i)) {
            this.parent.set(i, i);
            return i;
        }
        let root = i;
        while (root !== this.parent.get(root)) {
            root = this.parent.get(root);
        }
        let curr = i;
        while (curr !== root) {
            const nxt = this.parent.get(curr);
            this.parent.set(curr, root);
            curr = nxt;
        }
        return root;
    }
    union(i, j) {
        const rootI = this.find(i);
        const rootJ = this.find(j);
        if (rootI !== rootJ) {
            this.parent.set(rootI, rootJ);
        }
    }
}
class DatasetBuilder {
    static BUILDER_VERSION = 'v3.0.0';
    static SPLIT_STRATEGY_VERSION = 'v1.0-deterministic-group';
    static SPLIT_SEED = 'eyeco-seed-2026';
    canonicalStringify(obj) {
        if (obj === null || obj === undefined)
            return 'null';
        if (typeof obj === 'object' && (obj._bsontype === 'ObjectID' || obj.constructor?.name === 'ObjectId')) {
            return JSON.stringify(obj.toString());
        }
        if (typeof obj !== 'object')
            return JSON.stringify(obj);
        if (Array.isArray(obj))
            return '[' + obj.map(item => this.canonicalStringify(item)).join(',') + ']';
        const keys = Object.keys(obj).filter(k => !k.startsWith('$') && k !== '_doc' && k !== '$init').sort();
        return '{' + keys.map(k => `${JSON.stringify(k)}:${this.canonicalStringify(obj[k])}`).join(',') + '}';
    }
    sanitizeManifestItemsForHash(items) {
        return items.map(item => ({
            candidateId: item.candidateId ? item.candidateId.toString() : '',
            snapshotId: item.snapshotId ? item.snapshotId.toString() : '',
            validationLogId: item.validationLogId ? item.validationLogId.toString() : '',
            reportId: Number(item.reportId),
            split: String(item.split),
            groupKey: String(item.groupKey),
            inputImageHash: String(item.inputImageHash),
            sourceVideoHash: String(item.sourceVideoHash || ''),
            incidentId: String(item.incidentId || ''),
            imagePath: String(item.imagePath || ''),
            operatorDecision: String(item.operatorDecision || ''),
            annotations: Array.isArray(item.annotations)
                ? item.annotations.map(ann => ({
                    className: String(ann.className),
                    bbox: Array.isArray(ann.bbox) ? ann.bbox.map(Number) : [],
                    confidence: Number(ann.confidence || 1.0),
                    annotationSource: String(ann.annotationSource)
                }))
                : []
        }));
    }
    // Transitive Connected Lineage Grouping Engine (Union-Find)
    buildTransitiveLineageGroups(candidates) {
        const uf = new UnionFind();
        const candidateIdMap = new Map();
        for (const cand of candidates) {
            const cId = cand._id.toString();
            candidateIdMap.set(cId, cand);
            const keys = [
                cand.sourceVideoHash ? `vid:${cand.sourceVideoHash}` : null,
                cand.incidentId ? `inc:${cand.incidentId}` : null,
                cand.parentImageHash ? `parent:${cand.parentImageHash}` : null,
                cand.inputImageHash ? `img:${cand.inputImageHash}` : null
            ].filter(Boolean);
            for (let k = 0; k < keys.length; k++) {
                uf.union(cId, keys[k]);
                if (k > 0)
                    uf.union(keys[k - 1], keys[k]);
            }
        }
        const groupMap = new Map();
        for (const cand of candidates) {
            const cId = cand._id.toString();
            const rootGroup = uf.find(cId);
            if (!groupMap.has(rootGroup)) {
                groupMap.set(rootGroup, []);
            }
            groupMap.get(rootGroup).push(cand);
        }
        return groupMap;
    }
    async buildDatasetVersion(params) {
        const mongoSession = await mongoose_1.default.startSession();
        let createdDatasetVersionDoc = null;
        const runTransactionWithRetry = async (fn, maxRetries = 3) => {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    await mongoSession.withTransaction(fn);
                    return;
                }
                catch (err) {
                    const isAtlasTransient = err.code === 8000 || err.codeName === 'AtlasError' || err.message?.includes('MaxTimeMSExpired') || err.message?.includes('context deadline exceeded');
                    if (isAtlasTransient && attempt < maxRetries) {
                        console.warn(`[DATASET_BUILDER] Transaction failed with transient Atlas error (attempt ${attempt}/${maxRetries}), retrying in 1000ms...`);
                        await new Promise((r) => setTimeout(r, 1000));
                        continue;
                    }
                    throw err;
                }
            }
        };
        try {
            await runTransactionWithRetry(async () => {
                // 1. Strict Candidate Eligibility Filter Query
                const candidateFilter = {
                    targetModel: params.targetModel,
                    approvalStatus: 'APPROVED',
                    isCurrentEvaluation: true,
                    supersededAt: null,
                    assignedDatasetVersion: null
                };
                if (Array.isArray(params.candidateIds) && params.candidateIds.length > 0) {
                    const ids = params.candidateIds.map((id) => new mongoose_1.default.Types.ObjectId(String(id)));
                    candidateFilter._id = { $in: ids };
                }
                if (params.isTestData) {
                    candidateFilter.isTestData = true;
                }
                // Atomic Reservation Lock: Mark candidates as RESERVED_FOR_BUILD
                const candidates = await AiDatasetCandidate_1.AiDatasetCandidateModel.find(candidateFilter, null, { session: mongoSession }).exec();
                if (candidates.length === 0) {
                    const err = new Error(`No APPROVED candidates available for building dataset version (targetModel: ${params.targetModel}).`);
                    err.code = 'NO_APPROVED_CANDIDATES';
                    err.status = 400;
                    throw err;
                }
                // Reserve Candidates
                const candIds = candidates.map(c => c._id);
                await AiDatasetCandidate_1.AiDatasetCandidateModel.updateMany({ _id: { $in: candIds }, approvalStatus: 'APPROVED' }, { $set: { approvalStatus: 'RESERVED_FOR_BUILD' } }, { session: mongoSession }).exec();
                // 2. Transitive Lineage Grouping Engine (Union-Find)
                const groupMap = this.buildTransitiveLineageGroups(candidates);
                const groupKeys = Array.from(groupMap.keys()).sort((a, b) => {
                    const hashA = crypto_1.default.createHash('sha256').update(a + DatasetBuilder.SPLIT_SEED).digest('hex');
                    const hashB = crypto_1.default.createHash('sha256').update(b + DatasetBuilder.SPLIT_SEED).digest('hex');
                    return hashA.localeCompare(hashB);
                });
                // 3. Deterministic Grouped Allocation Engine
                const groupSplits = new Map();
                const totalGroups = groupKeys.length;
                for (let i = 0; i < totalGroups; i++) {
                    const gKey = groupKeys[i];
                    let split = 'TRAIN';
                    if (totalGroups >= 3) {
                        // Allocate at least 1 group to TRAIN, VAL, TEST if totalGroups >= 3
                        if (i === 0)
                            split = 'TRAIN';
                        else if (i === 1)
                            split = 'VAL';
                        else if (i === 2)
                            split = 'TEST';
                        else {
                            const hashVal = parseInt(crypto_1.default.createHash('sha256').update(gKey + DatasetBuilder.SPLIT_SEED).digest('hex').slice(0, 8), 16) % 100;
                            if (hashVal < 70)
                                split = 'TRAIN';
                            else if (hashVal < 85)
                                split = 'VAL';
                            else
                                split = 'TEST';
                        }
                    }
                    else {
                        // Less than 3 groups -> Allocate TRAIN / VAL
                        split = i === 0 ? 'TRAIN' : 'VAL';
                    }
                    groupSplits.set(gKey, split);
                }
                const manifestItems = [];
                const splitCounts = { train: 0, val: 0, test: 0, total: 0 };
                const splitByGroupKey = {};
                const splitByImageHash = {};
                const splitByIncidentId = {};
                let crossSplitGroupLeaks = 0;
                let crossSplitHashLeaks = 0;
                let crossSplitParentLeaks = 0;
                let crossSplitIncidentLeaks = 0;
                // 4. Build Manifest Items & Audit Multi-Field Leakage
                for (const [groupRootKey, candGroup] of groupMap.entries()) {
                    const split = groupSplits.get(groupRootKey) || 'TRAIN';
                    for (const cand of candGroup) {
                        const snapshot = await AiSnapshot_1.AiSnapshotModel.findById(cand.snapshotId, null, { session: mongoSession }).exec();
                        const validationLog = cand.validationLogId ? await AiValidationLog_1.AiValidationLogModel.findById(cand.validationLogId, null, { session: mongoSession }).exec() : null;
                        // Audit Cross-Split Leaks
                        if (splitByGroupKey[groupRootKey] && splitByGroupKey[groupRootKey] !== split)
                            crossSplitGroupLeaks++;
                        else
                            splitByGroupKey[groupRootKey] = split;
                        if (splitByImageHash[cand.inputImageHash] && splitByImageHash[cand.inputImageHash] !== split)
                            crossSplitHashLeaks++;
                        else
                            splitByImageHash[cand.inputImageHash] = split;
                        if (cand.incidentId) {
                            if (splitByIncidentId[cand.incidentId] && splitByIncidentId[cand.incidentId] !== split)
                                crossSplitIncidentLeaks++;
                            else
                                splitByIncidentId[cand.incidentId] = split;
                        }
                        if (split === 'TRAIN')
                            splitCounts.train++;
                        else if (split === 'VAL')
                            splitCounts.val++;
                        else if (split === 'TEST')
                            splitCounts.test++;
                        splitCounts.total++;
                        // Extract Ground Truth Annotations
                        const annotations = [];
                        if (validationLog && Array.isArray(validationLog.correctedObjects) && validationLog.correctedObjects.length > 0) {
                            for (const obj of validationLog.correctedObjects) {
                                annotations.push({
                                    className: obj.class || 'plastic_bag',
                                    bbox: obj.bbox || [0, 0, 100, 100],
                                    confidence: 1.0,
                                    annotationSource: 'OPERATOR_GROUND_TRUTH'
                                });
                            }
                        }
                        else if (snapshot && Array.isArray(snapshot.objects)) {
                            for (const obj of snapshot.objects) {
                                annotations.push({
                                    className: obj.class || 'plastic_bag',
                                    bbox: obj.bbox || [0, 0, 100, 100],
                                    confidence: obj.confidence || 0.8,
                                    annotationSource: 'AI_PREDICTION'
                                });
                            }
                        }
                        manifestItems.push({
                            candidateId: cand._id,
                            snapshotId: cand.snapshotId,
                            validationLogId: cand.validationLogId,
                            reportId: cand.reportId,
                            split,
                            groupKey: groupRootKey,
                            inputImageHash: cand.inputImageHash,
                            sourceVideoHash: cand.sourceVideoHash || '',
                            incidentId: cand.incidentId || '',
                            imagePath: snapshot ? snapshot.imagePath : '',
                            operatorDecision: cand.operatorDecision || '',
                            annotations
                        });
                    }
                }
                // 5. Structural Readiness vs Training Eligibility Separation
                const totalLeaks = crossSplitGroupLeaks + crossSplitHashLeaks + crossSplitParentLeaks + crossSplitIncidentLeaks;
                const isLeakageFree = totalLeaks === 0;
                let status = 'BUILDING';
                let structurallyValid = false;
                let trainingEligibilityStatus = 'NOT_ELIGIBLE';
                let trainingEligible = false;
                if (!isLeakageFree) {
                    status = 'INVALID';
                    structurallyValid = false;
                    trainingEligibilityStatus = 'NOT_ELIGIBLE';
                    trainingEligible = false;
                    console.error(`[DATASET_BUILDER_ERROR] Data Leakage Audit Failed! Leaks: Group ${crossSplitGroupLeaks}, Hash ${crossSplitHashLeaks}`);
                }
                else if (splitCounts.train === 0 || splitCounts.val === 0 || splitCounts.test === 0 || splitCounts.total < 10) {
                    status = 'INSUFFICIENT_DATA';
                    structurallyValid = true; // Structurally valid manifest, but sample count is insufficient for training
                    trainingEligibilityStatus = 'NOT_ELIGIBLE';
                    trainingEligible = false;
                    console.warn(`[DATASET_BUILDER_WARN] Dataset ${splitCounts.total} samples (Train: ${splitCounts.train}, Val: ${splitCounts.val}, Test: ${splitCounts.test}) assigned INSUFFICIENT_DATA (structurallyValid = true, trainingEligibilityStatus = NOT_ELIGIBLE, trainingEligible = false)`);
                }
                else {
                    status = 'READY';
                    structurallyValid = true;
                    trainingEligibilityStatus = 'PENDING_GATE'; // To be evaluated by TrainingEligibilityService in Phase 4
                    trainingEligible = false;
                }
                const randomSuffix = crypto_1.default.randomBytes(3).toString('hex');
                const datasetVersion = `v3.1.0-ds-${params.targetModel.toLowerCase()}-${Date.now()}-${randomSuffix}`;
                // 6. Compute Canonical Manifest SHA-256 Hash
                const plainSanitizedItems = this.sanitizeManifestItemsForHash(manifestItems);
                const canonicalManifestJson = this.canonicalStringify(plainSanitizedItems);
                const manifestHash = crypto_1.default.createHash('sha256').update(canonicalManifestJson).digest('hex');
                // 7. Atomic Write: Create AiDatasetVersion Document
                const docs = await AiDatasetVersion_1.AiDatasetVersionModel.create([
                    {
                        datasetVersion,
                        targetModel: params.targetModel,
                        builderVersion: DatasetBuilder.BUILDER_VERSION,
                        splitStrategyVersion: DatasetBuilder.SPLIT_STRATEGY_VERSION,
                        splitSeed: DatasetBuilder.SPLIT_SEED,
                        manifestHash,
                        status,
                        structurallyValid,
                        trainingEligibilityStatus,
                        trainingEligible,
                        isTestData: !!params.isTestData,
                        splitCounts,
                        leakageCheckStatus: isLeakageFree ? 'PASSED' : 'FAILED',
                        leakageCheckDetails: {
                            crossSplitGroupLeaks,
                            crossSplitHashLeaks,
                            crossSplitParentLeaks,
                            crossSplitIncidentLeaks
                        },
                        includedCandidateIds: candIds,
                        manifestItems,
                        createdByUserId: params.createdByUserId ? new mongoose_1.default.Types.ObjectId(params.createdByUserId) : undefined
                    }
                ], { session: mongoSession });
                createdDatasetVersionDoc = docs[0];
                // 8. Candidate Assignment Guard:
                // If READY -> ASSIGNED_TO_DATASET
                // If INSUFFICIENT_DATA or INVALID -> RELEASE RESERVATION back to APPROVED!
                if (status === 'READY') {
                    await AiDatasetCandidate_1.AiDatasetCandidateModel.updateMany({ _id: { $in: candIds } }, {
                        $set: {
                            approvalStatus: 'ASSIGNED_TO_DATASET',
                            assignedDatasetVersion: datasetVersion,
                            assignedAt: new Date()
                        }
                    }, { session: mongoSession }).exec();
                }
                else {
                    // Release reservation so candidates remain available for future dataset builds
                    await AiDatasetCandidate_1.AiDatasetCandidateModel.updateMany({ _id: { $in: candIds } }, { $set: { approvalStatus: 'APPROVED' } }, { session: mongoSession }).exec();
                    console.log(`[DATASET_BUILDER] Released reservation for ${candIds.length} candidates back to APPROVED (Dataset Status: ${status})`);
                }
                console.log(`[DATASET_BUILDER] Created Dataset Version ${datasetVersion} (Status: ${status}, StructurallyValid: ${structurallyValid}, Hash: ${manifestHash})`);
            });
            return createdDatasetVersionDoc;
        }
        catch (err) {
            console.error('[DATASET_BUILDER_ERROR] Build failed, rolling back candidate reservation:', err);
            throw err;
        }
        finally {
            mongoSession.endSession();
        }
    }
    computeManifestHash(items) {
        const plainSanitizedItems = this.sanitizeManifestItemsForHash(items);
        const canonicalManifestJson = this.canonicalStringify(plainSanitizedItems);
        return crypto_1.default.createHash('sha256').update(canonicalManifestJson).digest('hex');
    }
}
exports.DatasetBuilder = DatasetBuilder;
exports.datasetBuilder = new DatasetBuilder();
