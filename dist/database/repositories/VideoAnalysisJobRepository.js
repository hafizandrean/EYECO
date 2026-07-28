"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VideoAnalysisJobRepository = void 0;
const VideoAnalysisJob_1 = require("../models/VideoAnalysisJob");
const crypto_1 = require("crypto");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const STORAGE_DIR = path_1.default.join(__dirname, '../../../storage/video-analysis');
const STORAGE_PUBLIC_PREFIX = '/storage/video-analysis';
class VideoAnalysisJobRepository {
    static async createFromUpload(sourceVideoId, sourceVideoHash, sourceStorageKey) {
        const analysisRunId = `analysis_${Date.now()}_${(0, crypto_1.randomUUID)().substring(0, 8)}`;
        return VideoAnalysisJob_1.VideoAnalysisJobModel.create({
            sourceVideoId,
            sourceVideoHash,
            sourceStorageKey,
            status: 'QUEUED',
            progressStage: 'VALIDATING',
            analysisRunId,
            schemaVersion: '3.0',
            attemptCount: 0,
            maxAttempts: 3,
            correlationId: `corr_${(0, crypto_1.randomUUID)().substring(0, 12)}`,
            nextAttemptAt: new Date(),
        });
    }
    static async findById(id) {
        return VideoAnalysisJob_1.VideoAnalysisJobModel.findById(id).exec();
    }
    static async findByAnalysisRunId(analysisRunId) {
        return VideoAnalysisJob_1.VideoAnalysisJobModel.findOne({ analysisRunId }).exec();
    }
    static async findBySourceVideoId(sourceVideoId) {
        return VideoAnalysisJob_1.VideoAnalysisJobModel.find({ sourceVideoId }).sort({ createdAt: -1 }).exec();
    }
    static async getProgress(jobId) {
        const job = await VideoAnalysisJob_1.VideoAnalysisJobModel.findById(jobId).lean().exec();
        if (!job)
            return { job: null, incidents: null };
        let incidents = null;
        if (job.resultManifestPath && fs_1.default.existsSync(job.resultManifestPath)) {
            try {
                const raw = fs_1.default.readFileSync(job.resultManifestPath, 'utf8');
                const manifest = JSON.parse(raw);
                incidents = manifest.incidents || [];
            }
            catch { }
        }
        return { job, incidents };
    }
    static async getEvidenceFile(jobId, incidentKey, fileType) {
        const job = await VideoAnalysisJob_1.VideoAnalysisJobModel.findById(jobId).exec();
        if (!job)
            return { filePath: null, mimeType: '' };
        const manifestDir = path_1.default.join(STORAGE_DIR, job.analysisRunId);
        switch (fileType) {
            case 'raw':
                return {
                    filePath: path_1.default.join(manifestDir, 'incidents', incidentKey, 'raw.jpg'),
                    mimeType: 'image/jpeg',
                };
            case 'clip':
                return {
                    filePath: path_1.default.join(manifestDir, 'incidents', incidentKey, 'evidence.mp4'),
                    mimeType: 'video/mp4',
                };
            case 'manifest':
                return {
                    filePath: path_1.default.join(manifestDir, 'manifest.json'),
                    mimeType: 'application/json',
                };
            default:
                return { filePath: null, mimeType: '' };
        }
    }
    static resolveStoragePath(relativePath) {
        const normalized = path_1.default.normalize(relativePath).replace(/^[/\\]+/, '');
        if (normalized.includes('..')) {
            throw new Error('Path traversal detected');
        }
        return path_1.default.join(STORAGE_DIR, normalized);
    }
    static ensureStorageDir(analysisRunId) {
        const dir = path_1.default.join(STORAGE_DIR, analysisRunId);
        fs_1.default.mkdirSync(dir, { recursive: true });
        return dir;
    }
}
exports.VideoAnalysisJobRepository = VideoAnalysisJobRepository;
