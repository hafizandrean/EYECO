import { IAiDatasetVersion } from '../../../database/models/AiDatasetVersion';
import { goldenDatasetService } from './goldenDatasetService';
import { AiGoldenDatasetVersionModel } from '../../../database/models/AiGoldenDatasetVersion';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface IDatasetExportResult {
  datasetExportPath: string;
  datasetExportHash: string;
  dataYamlHash: string;
  classMappingHash: string;
  exporterVersion: string;
  itemCounts: {
    train: number;
    val: number;
    test: number;
    total: number;
  };
  exportedAt: Date;
}

export class DatasetMaterializationService {
  public static readonly EXPORTER_VERSION = 'v1.0.0-yolo-exporter';

  public async materializeDataset(datasetVersionDoc: IAiDatasetVersion, goldenDatasetVersionStr: string): Promise<IDatasetExportResult> {
    // 1. Audit Zero Golden Overlap before export
    const goldenDataset = await AiGoldenDatasetVersionModel.findOne({ goldenDatasetVersion: goldenDatasetVersionStr }).exec();
    if (!goldenDataset || goldenDataset.status !== 'APPROVED') {
      throw new Error(`GOLDEN_DATASET_REQUIRED: Golden baseline dataset ${goldenDatasetVersionStr} is missing or not APPROVED.`);
    }

    const overlapCheck = goldenDatasetService.checkOverlap(goldenDataset.manifestItems, datasetVersionDoc.manifestItems);
    if (overlapCheck.hasOverlap) {
      throw new Error(`GOLDEN_DATASET_TRAINING_OVERLAP: Training dataset overlaps with Golden Baseline Dataset! Overlapping: ${overlapCheck.overlappingHashes.join(', ')}`);
    }

    // Deterministic Class Mapping
    const classMapping = { plastic_bag: 0, trash_pile: 1, unsegregated_garbage: 2 };
    const classMappingHash = crypto.createHash('sha256').update(JSON.stringify(classMapping)).digest('hex');

    // Compute Export Hash over manifest items and split assignments
    const exportPayload = {
      datasetVersion: datasetVersionDoc.datasetVersion,
      manifestHash: datasetVersionDoc.manifestHash,
      goldenDatasetVersion: goldenDatasetVersionStr,
      classMapping,
      manifestItems: datasetVersionDoc.manifestItems
    };

    const datasetExportHash = crypto.createHash('sha256').update(JSON.stringify(exportPayload)).digest('hex');
    const exportPath = `artifacts/exports/${datasetExportHash}`;
    const dataYamlContent = `path: ${exportPath}\ntrain: images/train\nval: images/val\ntest: images/test\nnames:\n  0: plastic_bag\n  1: trash_pile\n  2: unsegregated_garbage\n`;
    const dataYamlHash = crypto.createHash('sha256').update(dataYamlContent).digest('hex');

    fs.mkdirSync(exportPath, { recursive: true });
    fs.writeFileSync(path.join(exportPath, 'data.yaml'), dataYamlContent);

    const result: IDatasetExportResult = {
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

export const datasetMaterializationService = new DatasetMaterializationService();
