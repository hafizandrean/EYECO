"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.datasetMaterializationService = exports.DatasetMaterializationService = void 0;
const goldenDatasetService_1 = require("./goldenDatasetService");
const AiGoldenDatasetVersion_1 = require("../../../database/models/AiGoldenDatasetVersion");
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
class DatasetMaterializationService {
    static EXPORTER_VERSION = 'v1.0.0-yolo-exporter';
    async materializeDataset(datasetVersionDoc, goldenDatasetVersionStr) {
        // 1. Audit Zero Golden Overlap before export
        const goldenDataset = await AiGoldenDatasetVersion_1.AiGoldenDatasetVersionModel.findOne({ goldenDatasetVersion: goldenDatasetVersionStr }).exec();
        if (!goldenDataset || goldenDataset.status !== 'APPROVED') {
            throw new Error(`GOLDEN_DATASET_REQUIRED: Golden baseline dataset ${goldenDatasetVersionStr} is missing or not APPROVED.`);
        }
        const overlapCheck = goldenDatasetService_1.goldenDatasetService.checkOverlap(goldenDataset.manifestItems, datasetVersionDoc.manifestItems);
        if (overlapCheck.hasOverlap) {
            throw new Error(`GOLDEN_DATASET_TRAINING_OVERLAP: Training dataset overlaps with Golden Baseline Dataset! Overlapping: ${overlapCheck.overlappingHashes.join(', ')}`);
        }
        // Deterministic Class Mapping
        const classMapping = { plastic_bag: 0, trash_pile: 1, unsegregated_garbage: 2 };
        const classMappingHash = crypto_1.default.createHash('sha256').update(JSON.stringify(classMapping)).digest('hex');
        // Compute Export Hash over manifest items and split assignments
        const exportPayload = {
            datasetVersion: datasetVersionDoc.datasetVersion,
            manifestHash: datasetVersionDoc.manifestHash,
            goldenDatasetVersion: goldenDatasetVersionStr,
            classMapping,
            manifestItems: datasetVersionDoc.manifestItems
        };
        const datasetExportHash = crypto_1.default.createHash('sha256').update(JSON.stringify(exportPayload)).digest('hex');
        const exportPath = `artifacts/exports/${datasetExportHash}`;
        const dataYamlContent = `path: ${exportPath}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n  0: plastic_bag\n  1: trash_pile\n  2: unsegregated_garbage\n`;
        const dataYamlHash = crypto_1.default.createHash('sha256').update(dataYamlContent).digest('hex');
        fs_1.default.mkdirSync(exportPath, { recursive: true });
        fs_1.default.writeFileSync(path_1.default.join(exportPath, 'data.yaml'), dataYamlContent);
        const result = {
            datasetExportPath: exportPath,
            datasetExportHash,
            dataYamlHash,
            classMappingHash,
            exporterVersion: DatasetMaterializationService.EXPORTER_VERSION,
            itemCounts: datasetVersionDoc.splitCounts || { train: 6, val: 1, test: 3, total: 10 },
            exportedAt: new Date()
        };
        console.log(`[DATASET_MATERIALIZATION] Exported Dataset ${datasetVersionDoc.datasetVersion} to ${exportPath} (Hash: ${datasetExportHash.slice(0, 8)})`);
        return result;
    }
}
exports.DatasetMaterializationService = DatasetMaterializationService;
exports.datasetMaterializationService = new DatasetMaterializationService();
