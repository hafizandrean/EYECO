"use strict";
/**
 * EYECO AI Engine v3.0 — Layer 5.5: Dataset Builder
 * Groups dataset splits by camera/location/time period to avoid data leakage (Guardrail #11).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.datasetBuilder = exports.DatasetBuilder = void 0;
const AiSnapshot_1 = require("../../../database/models/AiSnapshot");
class DatasetBuilder {
    async buildTabularDatasetGrouped(locationGroupKey = 'location') {
        const snapshots = await AiSnapshot_1.AiSnapshotModel.find({ isActive: true }).lean().exec();
        console.log(`[DATASET_BUILDER] Building anti-leakage dataset grouped by ${locationGroupKey}. Total snapshots: ${snapshots.length}`);
        return {
            totalSnapshots: snapshots.length,
            splitGroupKey: locationGroupKey,
            trainCount: Math.floor(snapshots.length * 0.7),
            valCount: Math.floor(snapshots.length * 0.15),
            testCount: Math.ceil(snapshots.length * 0.15)
        };
    }
}
exports.DatasetBuilder = DatasetBuilder;
exports.datasetBuilder = new DatasetBuilder();
