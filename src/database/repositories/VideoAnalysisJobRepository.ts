import { VideoAnalysisJobModel, IVideoAnalysisJob } from '../models/VideoAnalysisJob';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';

const STORAGE_DIR = path.join(__dirname, '../../../storage/video-analysis');
const STORAGE_PUBLIC_PREFIX = '/storage/video-analysis';

export class VideoAnalysisJobRepository {

  public static async createFromUpload(
    sourceVideoId: mongoose.Types.ObjectId,
    sourceVideoHash: string,
    sourceStorageKey: string
  ): Promise<IVideoAnalysisJob> {
    const analysisRunId = `analysis_${Date.now()}_${randomUUID().substring(0, 8)}`;
    return VideoAnalysisJobModel.create({
      sourceVideoId,
      sourceVideoHash,
      sourceStorageKey,
      status: 'QUEUED',
      progressStage: 'VALIDATING',
      analysisRunId,
      schemaVersion: '3.0',
      attemptCount: 0,
      maxAttempts: 3,
      correlationId: `corr_${randomUUID().substring(0, 12)}`,
      nextAttemptAt: new Date(),
    });
  }

  public static async findById(id: string): Promise<IVideoAnalysisJob | null> {
    return VideoAnalysisJobModel.findById(id).exec();
  }

  public static async findByAnalysisRunId(analysisRunId: string): Promise<IVideoAnalysisJob | null> {
    return VideoAnalysisJobModel.findOne({ analysisRunId }).exec();
  }

  public static async findBySourceVideoId(sourceVideoId: string): Promise<IVideoAnalysisJob[]> {
    return VideoAnalysisJobModel.find({ sourceVideoId }).sort({ createdAt: -1 }).exec();
  }

  public static async getProgress(jobId: string): Promise<{
    job: IVideoAnalysisJob | null;
    incidents: any[] | null;
  }> {
    const job = await VideoAnalysisJobModel.findById(jobId).lean().exec();
    if (!job) return { job: null, incidents: null };

    let incidents = null;
    if (job.resultManifestPath && fs.existsSync(job.resultManifestPath)) {
      try {
        const raw = fs.readFileSync(job.resultManifestPath, 'utf8');
        const manifest = JSON.parse(raw);
        incidents = manifest.incidents || [];
      } catch { }
    }

    return { job, incidents };
  }

  public static async getEvidenceFile(
    jobId: string,
    incidentKey: string,
    fileType: 'raw' | 'annotated' | 'clip' | 'manifest'
  ): Promise<{ filePath: string | null; mimeType: string }> {
    const job = await VideoAnalysisJobModel.findById(jobId).exec();
    if (!job) return { filePath: null, mimeType: '' };

    const manifestDir = path.join(STORAGE_DIR, job.analysisRunId);

    switch (fileType) {
      case 'raw':
        return {
          filePath: path.join(manifestDir, 'incidents', incidentKey, 'raw.jpg'),
          mimeType: 'image/jpeg',
        };
      case 'clip':
        return {
          filePath: path.join(manifestDir, 'incidents', incidentKey, 'evidence.mp4'),
          mimeType: 'video/mp4',
        };
      case 'manifest':
        return {
          filePath: path.join(manifestDir, 'manifest.json'),
          mimeType: 'application/json',
        };
      default:
        return { filePath: null, mimeType: '' };
    }
  }

  public static resolveStoragePath(relativePath: string): string {
    const normalized = path.normalize(relativePath).replace(/^[/\\]+/, '');
    if (normalized.includes('..')) {
      throw new Error('Path traversal detected');
    }
    return path.join(STORAGE_DIR, normalized);
  }

  public static ensureStorageDir(analysisRunId: string): string {
    const dir = path.join(STORAGE_DIR, analysisRunId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}
