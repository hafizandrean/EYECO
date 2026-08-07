"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assetValidationService = exports.AssetValidationService = void 0;
const AiDatasetVersion_1 = require("../../../database/models/AiDatasetVersion");
const DatasetAssetValidationReport_1 = require("../../../database/models/DatasetAssetValidationReport");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
class AssetValidationService {
    static VALIDATOR_VERSION = 'v1.0.0';
    static SUPPORTED_CLASSES = ['plastic_bag', 'bottle', 'cup', 'trash', 'litter', 'person'];
    computeHammingDistance(hashA, hashB) {
        if (!hashA || !hashB || hashA.length !== hashB.length) {
            return 64; // Max distance if invalid
        }
        let distance = 0;
        for (let i = 0; i < hashA.length; i++) {
            const valA = parseInt(hashA[i], 16);
            const valB = parseInt(hashB[i], 16);
            if (isNaN(valA) || isNaN(valB))
                continue;
            let xor = valA ^ valB;
            while (xor > 0) {
                distance += (xor & 1);
                xor >>= 1;
            }
        }
        return distance;
    }
    checkNearDuplicateOverlap(trainPhashes, goldenPhashes, maxHammingDistance = 5) {
        for (let i = 0; i < trainPhashes.length; i++) {
            for (let j = 0; j < goldenPhashes.length; j++) {
                const dist = this.computeHammingDistance(trainPhashes[i], goldenPhashes[j]);
                if (dist <= maxHammingDistance) {
                    const err = new Error(`GOLDEN_TRAINING_NEAR_DUPLICATE: Near-duplicate visual asset detected between training image #${i} (pHash: ${trainPhashes[i]}) and golden image #${j} (pHash: ${goldenPhashes[j]}) with Hamming distance ${dist} <= threshold ${maxHammingDistance}.`);
                    err.status = 422;
                    throw err;
                }
            }
        }
    }
    async validateDatasetAssets(datasetVersionStr) {
        const datasetVersion = await AiDatasetVersion_1.AiDatasetVersionModel.findOne({ datasetVersion: datasetVersionStr }).exec();
        if (!datasetVersion) {
            throw new Error(`Dataset version ${datasetVersionStr} not found.`);
        }
        const items = datasetVersion.manifestItems || [];
        let validItemCount = 0;
        let missingAssetCount = 0;
        let hashMismatchCount = 0;
        let decodeFailureCount = 0;
        let invalidAnnotationCount = 0;
        const failureReasons = [];
        for (const item of items) {
            let isItemValid = true;
            // 1. Image Path, File Existence & Byte Hash Verification Guard
            if (!item.imagePath) {
                missingAssetCount++;
                isItemValid = false;
                failureReasons.push(`[ASSET_NOT_FOUND] Item report #${item.reportId}: missing imagePath`);
            }
            else {
                const fullPath = (item.imagePath.startsWith('/uploads/') || item.imagePath.startsWith('uploads/'))
                    ? path_1.default.join(process.cwd(), 'public', item.imagePath.startsWith('/') ? item.imagePath : '/' + item.imagePath)
                    : (path_1.default.isAbsolute(item.imagePath) ? item.imagePath : path_1.default.join(process.cwd(), 'public', item.imagePath));
                if (fs_1.default.existsSync(fullPath)) {
                    if (item.inputImageHash) {
                        const fileBytes = fs_1.default.readFileSync(fullPath);
                        const recomputedHash = crypto_1.default.createHash('sha256').update(fileBytes).digest('hex');
                        if (recomputedHash !== item.inputImageHash) {
                            hashMismatchCount++;
                            isItemValid = false;
                            failureReasons.push(`[ASSET_CONTENT_HASH_MISMATCH] Item report #${item.reportId}: stored hash ${item.inputImageHash} does not match file bytes hash ${recomputedHash}`);
                        }
                    }
                }
                else {
                    missingAssetCount++;
                    isItemValid = false;
                    failureReasons.push(`[ASSET_NOT_FOUND] Item report #${item.reportId}: image file not found at ${fullPath}`);
                }
            }
            // 2. Annotation Bounding Box & Class Validity Guard (INVALID_BOUNDING_BOX & UNSUPPORTED_CLASS)
            if (Array.isArray(item.annotations) && item.annotations.length > 0) {
                for (const ann of item.annotations) {
                    if (!AssetValidationService.SUPPORTED_CLASSES.includes(ann.className)) {
                        invalidAnnotationCount++;
                        isItemValid = false;
                        failureReasons.push(`[UNSUPPORTED_CLASS] Item report #${item.reportId}: class '${ann.className}' is not supported`);
                    }
                    const bbox = ann.bbox;
                    if (!Array.isArray(bbox) || bbox.length !== 4) {
                        invalidAnnotationCount++;
                        isItemValid = false;
                        failureReasons.push(`[INVALID_BOUNDING_BOX] Item report #${item.reportId}: invalid bbox format ${JSON.stringify(bbox)}`);
                    }
                    else {
                        const [x1, y1, x2, y2] = bbox;
                        if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2) || x2 <= x1 || y2 <= y1) {
                            invalidAnnotationCount++;
                            isItemValid = false;
                            failureReasons.push(`[INVALID_BOUNDING_BOX] Item report #${item.reportId}: invalid coordinates bbox [${x1},${y1},${x2},${y2}]`);
                        }
                    }
                }
            }
            if (isItemValid)
                validItemCount++;
        }
        const checkedItemCount = items.length;
        const invalidItemCount = checkedItemCount - validItemCount;
        const passed = invalidItemCount === 0 && checkedItemCount > 0;
        const reportPayload = {
            datasetVersion: datasetVersionStr,
            checkedItemCount,
            validItemCount,
            invalidItemCount,
            missingAssetCount,
            hashMismatchCount,
            decodeFailureCount,
            invalidAnnotationCount,
            passed,
            failureReasons,
            validatorVersion: AssetValidationService.VALIDATOR_VERSION
        };
        const reportHash = crypto_1.default.createHash('sha256').update(JSON.stringify(reportPayload)).digest('hex');
        const reportDoc = await DatasetAssetValidationReport_1.DatasetAssetValidationReportModel.create({
            ...reportPayload,
            reportHash,
            createdAt: new Date()
        });
        console.log(`[ASSET_VALIDATION] Created Asset Validation Report for ${datasetVersionStr} (Passed: ${passed}, Valid: ${validItemCount}/${checkedItemCount})`);
        return reportDoc;
    }
    validateDatasetAsset(params) {
        if (!fs_1.default.existsSync(params.assetPath)) {
            const err = new Error(`ASSET_NOT_FOUND: Asset file not found at ${params.assetPath}`);
            err.status = 404;
            throw err;
        }
        const bytes = fs_1.default.readFileSync(params.assetPath);
        const actualHash = crypto_1.default.createHash('sha256').update(bytes).digest('hex');
        if (actualHash !== params.storedSha256) {
            const err = new Error(`ASSET_CONTENT_HASH_MISMATCH: Stored hash ${params.storedSha256} does not match file bytes hash ${actualHash}`);
            err.status = 422;
            throw err;
        }
    }
}
exports.AssetValidationService = AssetValidationService;
exports.assetValidationService = new AssetValidationService();
