"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.goldenDatasetService = exports.GoldenDatasetService = void 0;
const AiGoldenDatasetVersion_1 = require("../../../database/models/AiGoldenDatasetVersion");
const AiDatasetVersion_1 = require("../../../database/models/AiDatasetVersion");
const AiDatasetCandidate_1 = require("../../../database/models/AiDatasetCandidate");
const GoldenDatasetCompositionPolicy_1 = require("../../../database/models/GoldenDatasetCompositionPolicy");
const mongoose_1 = __importDefault(require("mongoose"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
class GoldenDatasetService {
    static VERSION_PREFIX = 'v3.0.0-golden';
    async getOrCreateDefaultCompositionPolicy() {
        let policy = await GoldenDatasetCompositionPolicy_1.GoldenDatasetCompositionPolicyModel.findOne({ policyVersion: 'v1.0.0-golden-policy' }).exec();
        if (!policy) {
            const config = {
                minimumTotalItems: 5,
                minimumPositiveItems: 3,
                minimumNegativeItems: 1,
                minimumItemsPerClass: 1,
                minimumCameraCount: 1,
                minimumLocationCount: 1,
                requireDayExamples: false,
                requireNightExamples: false,
                minimumSmallObjectItems: 0,
                minimumBlurOrOcclusionItems: 0
            };
            const policyHash = crypto_1.default.createHash('sha256').update(JSON.stringify(config)).digest('hex');
            policy = await GoldenDatasetCompositionPolicy_1.GoldenDatasetCompositionPolicyModel.create({
                policyId: 'policy-golden-v1.0.0-prod',
                policyVersion: 'v1.0.0-golden-policy',
                policyHash,
                targetModel: 'OBJECT_DETECTOR',
                environment: 'PRODUCTION',
                status: 'APPROVED',
                configuration: config,
                approvedByUserId: new mongoose_1.default.Types.ObjectId(),
                approvedAt: new Date()
            });
        }
        return policy;
    }
    checkOverlap(goldenItems, candidateItems) {
        const candidateHashes = new Set();
        for (const cItem of candidateItems) {
            if (cItem.inputImageHash)
                candidateHashes.add(`img:${cItem.inputImageHash}`);
            if (cItem.parentImageHash)
                candidateHashes.add(`parent:${cItem.parentImageHash}`);
            if (cItem.sourceVideoHash)
                candidateHashes.add(`vid:${cItem.sourceVideoHash}`);
            if (cItem.incidentId)
                candidateHashes.add(`inc:${cItem.incidentId}`);
        }
        const overlappingHashes = [];
        for (const gItem of goldenItems) {
            if (gItem.inputImageHash && candidateHashes.has(`img:${gItem.inputImageHash}`))
                overlappingHashes.push(`img:${gItem.inputImageHash}`);
            if (gItem.parentImageHash && candidateHashes.has(`parent:${gItem.parentImageHash}`))
                overlappingHashes.push(`parent:${gItem.parentImageHash}`);
            if (gItem.sourceVideoHash && candidateHashes.has(`vid:${gItem.sourceVideoHash}`))
                overlappingHashes.push(`vid:${gItem.sourceVideoHash}`);
            if (gItem.incidentId && candidateHashes.has(`inc:${gItem.incidentId}`))
                overlappingHashes.push(`inc:${gItem.incidentId}`);
        }
        return {
            hasOverlap: overlappingHashes.length > 0,
            overlappingHashes
        };
    }
    async createGoldenDatasetVersion(params) {
        const policy = await this.getOrCreateDefaultCompositionPolicy();
        const config = policy.configuration;
        // 1. Candidate Approval Lineage Verification & Recompute SHA-256 Byte Hashes
        for (const item of params.manifestItems) {
            if (item.candidateId) {
                const candDoc = await AiDatasetCandidate_1.AiDatasetCandidateModel.findById(item.candidateId).exec();
                if (!candDoc || candDoc.approvalStatus !== 'APPROVED' || !candDoc.approvedByUserId || !candDoc.reviewedAt) {
                    const err = new Error(`GOLDEN_ITEM_CANDIDATE_NOT_APPROVED: Candidate ${item.candidateId} is missing or not APPROVED (Status: ${candDoc?.approvalStatus}).`);
                    err.status = 422;
                    throw err;
                }
            }
            // 2. Label Consistency Verification
            const isNeg = item.operatorDecision === 'FALSE_OBJECT_DETECTION' || item.operatorDecision === 'REJECTED';
            const isPos = item.operatorDecision === 'TRUE_OBJECT_DETECTION' || item.operatorDecision === 'ACCEPTED';
            if (isNeg && Array.isArray(item.annotations) && item.annotations.length > 0) {
                const err = new Error(`GOLDEN_LABEL_CONTRADICTION: Item report #${item.reportId} has decision ${item.operatorDecision} but contains positive annotations.`);
                err.status = 422;
                throw err;
            }
            if (isPos && (!Array.isArray(item.annotations) || item.annotations.length === 0)) {
                const err = new Error(`GOLDEN_LABEL_CONTRADICTION: Item report #${item.reportId} has decision ${item.operatorDecision} but contains 0 annotations.`);
                err.status = 422;
                throw err;
            }
            // Recompute file byte SHA-256 hash from disk if file exists
            if (item.imagePath) {
                const fullPath = (item.imagePath.startsWith('/uploads/') || item.imagePath.startsWith('uploads/'))
                    ? path_1.default.join(process.cwd(), 'public', item.imagePath.startsWith('/') ? item.imagePath : '/' + item.imagePath)
                    : (path_1.default.isAbsolute(item.imagePath) ? item.imagePath : path_1.default.join(process.cwd(), 'public', item.imagePath));
                if (fs_1.default.existsSync(fullPath)) {
                    const fileBytes = fs_1.default.readFileSync(fullPath);
                    item.inputImageHash = crypto_1.default.createHash('sha256').update(fileBytes).digest('hex');
                }
            }
        }
        // Check for contradictory label classes on items sharing the same inputImageHash
        const hashToClasses = new Map();
        for (const item of params.manifestItems) {
            if (item.inputImageHash) {
                const classes = new Set((item.annotations || []).map(a => a.className));
                if (hashToClasses.has(item.inputImageHash)) {
                    const existing = hashToClasses.get(item.inputImageHash);
                    for (const cls of classes) {
                        if (existing.size > 0 && !existing.has(cls)) {
                            const err = new Error(`GOLDEN_LABEL_CONTRADICTION: Duplicate inputImageHash ${item.inputImageHash} has contradictory label classes.`);
                            err.status = 422;
                            throw err;
                        }
                    }
                }
                else {
                    hashToClasses.set(item.inputImageHash, classes);
                }
            }
        }
        // 3. Exact Training Overlap Verification across Candidates and Approved Dataset Versions
        const goldenCandIdSet = new Set(params.manifestItems.map(i => i.candidateId ? String(i.candidateId) : ''));
        const approvedCandidates = await AiDatasetCandidate_1.AiDatasetCandidateModel.find({ approvalStatus: 'APPROVED' }).exec();
        const candidateManifestItems = approvedCandidates
            .filter(c => !goldenCandIdSet.has(String(c._id)))
            .map((c, idx) => ({
            candidateId: c._id,
            snapshotId: c.snapshotId,
            reportId: c.reportId,
            imagePath: '',
            inputImageHash: c.inputImageHash,
            sourceVideoHash: c.sourceVideoHash,
            operatorDecision: c.operatorDecision || 'TRUE_OBJECT_DETECTION',
            split: 'TRAIN',
            groupKey: `cand-group-${idx}`,
            annotations: []
        }));
        const approvedDatasets = await AiDatasetVersion_1.AiDatasetVersionModel.find({ status: 'READY' }).exec();
        for (const ds of approvedDatasets) {
            if (Array.isArray(ds.manifestItems)) {
                candidateManifestItems.push(...ds.manifestItems);
            }
        }
        const overlapResult = this.checkOverlap(params.manifestItems, candidateManifestItems);
        if (overlapResult.hasOverlap) {
            const timestamp = Date.now();
            const goldenDatasetVersion = `${GoldenDatasetService.VERSION_PREFIX}-${params.targetModel.toLowerCase()}-${timestamp}-${crypto_1.default.randomBytes(3).toString('hex')}`;
            const manifestHash = crypto_1.default.createHash('sha256').update(JSON.stringify(params.manifestItems)).digest('hex');
            const invalidDoc = await AiGoldenDatasetVersion_1.AiGoldenDatasetVersionModel.create({
                goldenDatasetVersion,
                targetModel: params.targetModel,
                status: 'INVALID',
                structurallyValid: false,
                compositionEligible: false,
                approvalEligible: false,
                manifestHash,
                itemCount: params.manifestItems.length,
                positiveCount: 0,
                negativeCount: 0,
                classDistribution: {},
                locationDistribution: {},
                manifestItems: params.manifestItems
            });
            const err = new Error(`GOLDEN_TRAINING_EXACT_OVERLAP: Golden dataset creation REJECTED due to exact image byte overlap with training dataset. Overlapping: ${overlapResult.overlappingHashes.join(', ')}`);
            err.status = 409;
            err.goldenDatasetVersion = goldenDatasetVersion;
            throw err;
        }
        const positiveCount = params.manifestItems.filter((i) => i.operatorDecision === 'TRUE_OBJECT_DETECTION' || i.operatorDecision === 'ACCEPTED').length;
        const negativeCount = params.manifestItems.filter((i) => i.operatorDecision === 'FALSE_OBJECT_DETECTION' || i.operatorDecision === 'REJECTED').length;
        const classDist = {};
        const locDist = {};
        for (const item of params.manifestItems) {
            if (item.annotations) {
                for (const ann of item.annotations) {
                    classDist[ann.className] = (classDist[ann.className] || 0) + 1;
                }
            }
            if (item.groupKey) {
                locDist[item.groupKey] = (locDist[item.groupKey] || 0) + 1;
            }
        }
        const isTotalSufficient = params.manifestItems.length >= config.minimumTotalItems;
        const isPosSufficient = positiveCount >= config.minimumPositiveItems;
        const isNegSufficient = negativeCount >= config.minimumNegativeItems;
        const approvalEligible = isTotalSufficient && isPosSufficient && isNegSufficient;
        const status = approvalEligible ? 'READY_FOR_REVIEW' : 'INSUFFICIENT_DATA';
        const timestamp = Date.now();
        const goldenDatasetVersion = `${GoldenDatasetService.VERSION_PREFIX}-${params.targetModel.toLowerCase()}-${timestamp}-${crypto_1.default.randomBytes(3).toString('hex')}`;
        const manifestHash = crypto_1.default.createHash('sha256').update(JSON.stringify(params.manifestItems)).digest('hex');
        const doc = await AiGoldenDatasetVersion_1.AiGoldenDatasetVersionModel.create({
            goldenDatasetVersion,
            targetModel: params.targetModel,
            status,
            structurallyValid: true,
            compositionEligible: approvalEligible,
            approvalEligible,
            manifestHash,
            itemCount: params.manifestItems.length,
            positiveCount,
            negativeCount,
            classDistribution: classDist,
            locationDistribution: locDist,
            manifestItems: params.manifestItems
        });
        console.log(`[GOLDEN_DATASET] Created Golden Dataset ${goldenDatasetVersion} (Status: ${status}, Items: ${params.manifestItems.length}, ApprovalEligible: ${approvalEligible})`);
        return doc;
    }
    async approveGoldenDataset(goldenDatasetVersion, approvedByUserId) {
        const doc = await AiGoldenDatasetVersion_1.AiGoldenDatasetVersionModel.findOne({ goldenDatasetVersion }).exec();
        if (!doc) {
            throw new Error(`Golden dataset version ${goldenDatasetVersion} not found.`);
        }
        if (doc.status === 'INVALID') {
            const err = new Error(`GOLDEN_DATASET_INVALID: Cannot approve Golden Dataset ${goldenDatasetVersion} with status INVALID (GOLDEN_TRAINING_EXACT_OVERLAP).`);
            err.status = 409;
            throw err;
        }
        if (doc.status === 'INSUFFICIENT_DATA' || !doc.approvalEligible) {
            const err = new Error(`GOLDEN_DATASET_INSUFFICIENT: Cannot approve Golden Dataset ${goldenDatasetVersion} with status INSUFFICIENT_DATA (item count ${doc.itemCount} below minimum).`);
            err.status = 422;
            throw err;
        }
        doc.status = 'APPROVED';
        doc.approvedByUserId = new mongoose_1.default.Types.ObjectId(approvedByUserId);
        doc.approvedAt = new Date();
        await doc.save();
        console.log(`[GOLDEN_DATASET] Golden Dataset ${goldenDatasetVersion} APPROVED by admin ${approvedByUserId}`);
        return doc;
    }
    async materializeEvaluationManifest(goldenDatasetVersion, targetFilePath) {
        const doc = await AiGoldenDatasetVersion_1.AiGoldenDatasetVersionModel.findOne({ goldenDatasetVersion }).exec();
        if (!doc || doc.status !== 'APPROVED') {
            throw new Error(`GOLDEN_DATASET_NOT_APPROVED: Golden dataset ${goldenDatasetVersion} is missing or not APPROVED.`);
        }
        const materializedItems = doc.manifestItems.map((item, idx) => {
            const annHash = crypto_1.default.createHash('sha256').update(JSON.stringify(item.annotations || [])).digest('hex');
            return {
                goldenItemId: item._id ? String(item._id) : `golden-item-${idx}`,
                candidateId: item.candidateId ? String(item.candidateId) : String(new mongoose_1.default.Types.ObjectId()),
                snapshotId: item.snapshotId ? String(item.snapshotId) : String(new mongoose_1.default.Types.ObjectId()),
                imagePath: item.imagePath,
                recomputedImageHash: item.inputImageHash,
                annotationHash: annHash,
                split: item.split || 'TEST'
            };
        });
        const manifestFilePath = targetFilePath || path_1.default.join('artifacts/manifests', `eval-manifest-${doc.goldenDatasetVersion}.json`);
        const manifestContent = JSON.stringify({ goldenDatasetVersion, items: materializedItems }, null, 2);
        const fileHash = crypto_1.default.createHash('sha256').update(manifestContent).digest('hex');
        if (!fs_1.default.existsSync(manifestFilePath)) {
            fs_1.default.mkdirSync(path_1.default.dirname(manifestFilePath), { recursive: true });
            fs_1.default.writeFileSync(manifestFilePath, manifestContent);
        }
        return {
            goldenDatasetVersion,
            goldenManifestHash: fileHash,
            manifestFilePath,
            items: materializedItems
        };
    }
    async materializeGroundTruthManifest(goldenDatasetVersion, targetFilePath) {
        const doc = await AiGoldenDatasetVersion_1.AiGoldenDatasetVersionModel.findOne({ goldenDatasetVersion }).exec();
        if (!doc || doc.status !== 'APPROVED') {
            throw new Error(`GOLDEN_DATASET_NOT_APPROVED: Golden dataset ${goldenDatasetVersion} is missing or not APPROVED.`);
        }
        const items = doc.manifestItems.map((item, idx) => {
            const annHash = crypto_1.default.createHash('sha256').update(JSON.stringify(item.annotations || [])).digest('hex');
            return {
                goldenItemId: item._id ? String(item._id) : `golden-item-${idx}`,
                imagePath: item.imagePath,
                recomputedImageHash: item.inputImageHash,
                annotationHash: annHash,
                operatorDecision: item.operatorDecision || 'TRUE_OBJECT_DETECTION',
                annotations: item.annotations || []
            };
        });
        const manifestFilePath = targetFilePath || path_1.default.join('artifacts/manifests', `gt-manifest-${doc.goldenDatasetVersion}.json`);
        const manifestContent = JSON.stringify({ sourceGoldenDatasetHash: doc.manifestHash, items }, null, 2);
        const fileHash = crypto_1.default.createHash('sha256').update(manifestContent).digest('hex');
        if (!fs_1.default.existsSync(manifestFilePath)) {
            fs_1.default.mkdirSync(path_1.default.dirname(manifestFilePath), { recursive: true });
            fs_1.default.writeFileSync(manifestFilePath, manifestContent);
        }
        return {
            sourceGoldenDatasetHash: doc.manifestHash,
            groundTruthManifestHash: fileHash,
            manifestFilePath,
            items
        };
    }
}
exports.GoldenDatasetService = GoldenDatasetService;
exports.goldenDatasetService = new GoldenDatasetService();
