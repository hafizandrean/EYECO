import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { randomUUID, createHash } from 'crypto';
import { connectDB } from '../../database/db';
import { VideoAnalysisJobModel, IVideoAnalysisJob } from '../../database/models/VideoAnalysisJob';
import { ReportModel } from '../../database/models/Report';
import { AiSnapshotModel } from '../../database/models/AiSnapshot';
import { featureExtractorService } from './featureExtraction/featureExtractor.service';
import { decisionEngine } from './decisionEngine/decisionEngine';
import { explainableService } from './explainable/explainable.service';
const ffmpegPath = require('ffmpeg-static') as string;

dotenv.config();

const CURRENT_WORKER_ID = `worker_${randomUUID()}`;
const VIDEO_JOB_LEASE_MS = 2 * 60 * 1000; // 2 minutes lease
const POLLING_INTERVAL_MS = 5000; // Poll every 5 seconds
const DETECT_SCRIPT = path.join(__dirname, '../../../ai/detect.py');
const STORAGE_DIR = path.join(__dirname, '../../../storage/video-analysis');

// Helper to sleep
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

// Helper to derive legacy status
export function deriveLegacyStatuses(validationStatus: string) {
  switch (validationStatus) {
    case 'PENDING':
    case 'IN_REVIEW':
      return { adminStatus: 'MENUNGGU', status: 'UNDER_REVIEW' };
    case 'CONFIRMED':
      return { adminStatus: 'VALID', status: 'VALIDATED' };
    case 'REJECTED':
      return { adminStatus: 'DIABAIKAN', status: 'REJECTED' };
    default:
      return { adminStatus: 'MENUNGGU', status: 'UNDER_REVIEW' };
  }
}

/**
 * Clean up/finalize processing/retry jobs that exceeded max attempts
 */
async function finalizeExhaustedJobs(): Promise<number> {
  const now = new Date();
  
  // 1. Process jobs that are stuck in PROCESSING state past their lease expiration, and have hit max attempts
  const exhaustedProcessing = await VideoAnalysisJobModel.updateMany(
    {
      status: 'PROCESSING',
      leaseExpiresAt: { $lte: now },
      $expr: { $gte: ['$attemptCount', '$maxAttempts'] }
    },
    {
      $set: {
        status: 'FAILED',
        progressStage: 'FINISHED',
        completedAt: now,
        errorCode: 'MAX_ATTEMPTS_EXCEEDED',
        errorDetails: 'Pekerjaan melebihi batas percobaan maksimal.',
      },
      $unset: {
        workerId: '',
        claimToken: '',
        heartbeatAt: '',
        leaseExpiresAt: ''
      }
    }
  );

  // 2. Process jobs that are stuck in RETRY_WAIT and have already hit max attempts
  const exhaustedRetryWait = await VideoAnalysisJobModel.updateMany(
    {
      status: 'RETRY_WAIT',
      $expr: { $gte: ['$attemptCount', '$maxAttempts'] }
    },
    {
      $set: {
        status: 'FAILED',
        progressStage: 'FINISHED',
        completedAt: now,
        errorCode: 'MAX_ATTEMPTS_EXCEEDED',
        errorDetails: 'Pekerjaan melebihi batas percobaan maksimal.',
      },
      $unset: {
        workerId: '',
        claimToken: '',
        heartbeatAt: '',
        leaseExpiresAt: ''
      }
    }
  );

  const totalModified = exhaustedProcessing.modifiedCount + exhaustedRetryWait.modifiedCount;
  if (totalModified > 0) {
    console.log(`[WORKER] Finalized ${totalModified} exhausted jobs to FAILED status.`);
  }
  return totalModified;
}

/**
 * Claim next available video job atomically
 */
async function claimNextJob(): Promise<IVideoAnalysisJob | null> {
  const now = new Date();
  const claimToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + VIDEO_JOB_LEASE_MS);

  const job = await VideoAnalysisJobModel.findOneAndUpdate(
    {
      $expr: {
        $lt: ['$attemptCount', '$maxAttempts'],
      },
      $or: [
        { status: 'QUEUED', nextAttemptAt: { $lte: now } },
        { status: 'RETRY_WAIT', nextAttemptAt: { $lte: now } },
        { status: 'PROCESSING', leaseExpiresAt: { $lte: now } },
      ],
    },
    {
      $set: {
        status: 'PROCESSING',
        workerId: CURRENT_WORKER_ID,
        claimToken,
        heartbeatAt: now,
        leaseExpiresAt,
        lastAttemptStartedAt: now,
        progressStage: 'VALIDATING',
      },
      $inc: { attemptCount: 1 }
    },
    {
      sort: { createdAt: 1 },
      new: true
    }
  );

  return job;
}

/**
 * Execute FFmpeg subprocess cleanly and safely to cut a video clip
 */
function cutEvidenceClip(
  inputPath: string,
  outputPath: string,
  startSec: number,
  durationSec: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const tempOutput = `${outputPath}.tmp.mp4`;
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-nostdin',
      '-y',
      '-ss', String(startSec),
      '-i', inputPath,
      '-t', String(durationSec),
      '-map', '0:v:0',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      tempOutput
    ];

    const child = spawn(ffmpegPath || 'ffmpeg', args, { shell: false, windowsHide: true });
    
    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('FFmpeg clip extraction timeout (30s)'));
    }, 30000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`FFmpeg failed with code ${code}. Stderr: ${stderr}`));
        return;
      }

      // Check validity and perform atomic rename
      try {
        if (!fs.existsSync(tempOutput) || fs.statSync(tempOutput).size === 0) {
          reject(new Error('FFmpeg output file is empty or missing.'));
          return;
        }
        fs.renameSync(tempOutput, outputPath);
        
        // Return file hash
        const fileBuffer = fs.readFileSync(outputPath);
        const hash = createHash('sha256').update(fileBuffer).digest('hex');
        resolve(hash);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Extract representative frame using FFmpeg (more robust seeking than OpenCV re-encoding)
 */
function extractFrame(
  inputPath: string,
  outputPath: string,
  timestampSec: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const tempOutput = `${outputPath}.tmp.jpg`;
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-nostdin',
      '-y',
      '-ss', String(timestampSec),
      '-i', inputPath,
      '-vframes', '1',
      '-f', 'image2',
      tempOutput
    ];

    const child = spawn(ffmpegPath || 'ffmpeg', args, { shell: false, windowsHide: true });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg frame extraction failed with code ${code}`));
        return;
      }

      try {
        if (!fs.existsSync(tempOutput)) {
          reject(new Error('Frame extraction output missing.'));
          return;
        }
        fs.renameSync(tempOutput, outputPath);
        
        // Calculate hash
        const fileBuffer = fs.readFileSync(outputPath);
        const hash = createHash('sha256').update(fileBuffer).digest('hex');
        resolve(hash);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Main worker execution logic
 */
async function runWorker() {
  console.log(`[WORKER] Starting Video Worker instance ${CURRENT_WORKER_ID}...`);
  await connectDB();
  
  while (true) {
    try {
      await finalizeExhaustedJobs();
      const job = await claimNextJob();
      if (!job) {
        await sleep(POLLING_INTERVAL_MS);
        continue;
      }

      const jobId = job._id;
      const workerId = CURRENT_WORKER_ID;
      const claimToken = job.claimToken!;
      console.log(`[WORKER] Claimed Job #${job.analysisRunId} (${jobId})`);

      // Start Heartbeat
      const heartbeatInterval = setInterval(async () => {
        try {
          const now = new Date();
          const extendedLease = new Date(now.getTime() + VIDEO_JOB_LEASE_MS);
          const updateRes = await VideoAnalysisJobModel.updateOne(
            {
              _id: jobId,
              status: 'PROCESSING',
              workerId,
              claimToken
            },
            {
              $set: {
                heartbeatAt: now,
                leaseExpiresAt: extendedLease
              }
            }
          );
          if (updateRes.modifiedCount === 0) {
            console.warn(`[WORKER] Failed to extend lease for job ${jobId} (claim lost)`);
          }
        } catch (err) {
          console.error(`[WORKER] Heartbeat failed for job ${jobId}:`, err);
        }
      }, 30000);

      try {
        // Step 1: Decode & Analyze
        await VideoAnalysisJobModel.updateOne(
          { _id: jobId, workerId, claimToken },
          { $set: { progressStage: 'DECODING', progressPercent: 10 } }
        );

        const parentReport = await ReportModel.findById(job.sourceVideoId).lean().exec();
        if (!parentReport) {
          throw new Error(`Parent Report not found for id ${job.sourceVideoId}`);
        }
        const numericReportId = parentReport.id;

        const videoPath = path.resolve(job.sourceStorageKey);
        const manifestDir = path.join(STORAGE_DIR, job.analysisRunId);
        fs.mkdirSync(manifestDir, { recursive: true });
        const manifestPath = path.join(manifestDir, 'manifest.json');

        // Spawn python detection script
        await VideoAnalysisJobModel.updateOne(
          { _id: jobId, workerId, claimToken },
          { $set: { progressStage: 'ANALYZING', progressPercent: 30 } }
        );

        const pythonArgs = [
          DETECT_SCRIPT,
          videoPath,
          '--model', 'ai/models/best.pt',
          '--conf', '0.45',
          '--iou', '0.45',
          '--output-manifest', manifestPath,
          '--analysis-run-id', job.analysisRunId
        ];

        const getPyExecutable = (): string => {
          const venvPy = path.join(process.cwd(), 'ai', '.venv', 'bin', 'python3');
          if (process.platform !== 'win32' && fs.existsSync(venvPy)) return venvPy;
          return process.platform === 'win32' ? 'python' : 'python3';
        };
        const pythonCmd = getPyExecutable();
        console.log(`[WORKER] Spawning python: ${pythonCmd} ${pythonArgs.join(' ')}`);
        const pythonProc = spawn(pythonCmd, pythonArgs, { shell: false, windowsHide: true });

        let pyStdout = '';
        let pyStderr = '';
        pythonProc.stdout.on('data', (data) => pyStdout += data.toString());
        pythonProc.stderr.on('data', (data) => pyStderr += data.toString());

        const pyExitCode = await new Promise<number>((resolve) => {
          pythonProc.on('close', resolve);
        });

        if (pyExitCode !== 0) {
          throw new Error(`Python execution failed with code ${pyExitCode}. Stderr: ${pyStderr}`);
        }

        // Validate manifest
        if (!fs.existsSync(manifestPath)) {
          throw new Error(`Python manifest file was not created at ${manifestPath}`);
        }

        const manifestContent = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent);
        
        await VideoAnalysisJobModel.updateOne(
          { _id: jobId, workerId, claimToken },
          {
            $set: {
              progressStage: 'GROUPING',
              progressPercent: 60,
              totalFrames: manifest.sourceVideo?.processedFrameCount || 0,
              decodedFrames: manifest.sourceVideo?.processedFrameCount || 0,
              analyzedFrames: manifest.sourceVideo?.processedFrameCount || 0,
              incidentCount: manifest.incidents?.length || 0,
              resultManifestPath: manifestPath,
              resultManifestHash: createHash('sha256').update(manifestContent).digest('hex')
            }
          }
        );

        // Step 2: Generate Evidences (Clips, snapshots) and persist inside transaction
        await VideoAnalysisJobModel.updateOne(
          { _id: jobId, workerId, claimToken },
          { $set: { progressStage: 'GENERATING_EVIDENCE', progressPercent: 80 } }
        );

        const incidents = manifest.incidents || [];
        let processedSuccess = 0;

        for (const inc of incidents) {
          try {
            const incSeq = inc.incidentKey
              ? parseInt(inc.incidentKey.split(':').pop() || '1')
              : (inc.incidentSequence || 1);
            const incDir = path.join(manifestDir, 'incidents', String(incSeq).padStart(4, '0'));
            fs.mkdirSync(incDir, { recursive: true });

            const rawFramePath = path.join(incDir, 'raw.jpg');
            const clipPath = path.join(incDir, 'evidence.mp4');

            // Extract raw representative frame
            const frameHash = await extractFrame(videoPath, rawFramePath, inc.representativeTimestampSec);

            // Cut evidence clip
            const clipStart = Math.max(0, inc.startSec - 3);
            const clipEnd = Math.min(manifest.sourceVideo?.durationSec || 60, inc.endSec + 3);
            const clipDuration = clipEnd - clipStart;
            const clipHash = await cutEvidenceClip(videoPath, clipPath, clipStart, clipDuration);

            // Prepare AI analysis metrics & Decision engine evaluation
            const mockObjects = inc.boundingBoxes || [];
            const mockPoses = inc.poses || [];
            const mockAvailable = ['YOLO_OBJECT'];
            
            const featureVector = featureExtractorService.extractFeatures(
              mockObjects,
              mockPoses,
              [],
              { categories: {} } as any,
              mockAvailable
            );

            const decision = decisionEngine.evaluate(featureVector);
            const allEvidence = explainableService.generateExplainableReport([], decision, featureVector);

            const snapshotKey = `${job.analysisRunId}:${incSeq}:snapshot-v1`;
            const incidentKey = `${job.analysisRunId}:${String(incSeq).padStart(4, '0')}`;

            // Store Snapshot & Report in Mongoose transaction
            await mongoose.connection.transaction(async (session) => {
              // 1. Upsert snapshot
              await AiSnapshotModel.updateOne(
                { snapshotKey },
                {
                  $setOnInsert: {
                    analysisId: `analysis_${randomUUID().substring(0, 8)}`,
                    snapshotKey,
                    reportId: numericReportId,
                    inputImageHash: job.sourceVideoHash,
                    imagePath: rawFramePath.replace(path.resolve(__dirname, '../../../'), '').replace(/\\/g, '/'),
                    pipelineVersion: 'v3.0.0',
                    featureSchemaVersion: 'feature-v1',
                    modelRegistryInfo: {
                      yoloVersion: 'v8.2.0-yolov8n',
                      poseVersion: 'yolov8n-pose-v1.0',
                      sceneVersion: 'SpatialAnalyzer-v1.0',
                      decisionVersion: 'RuleEngine-v1.0',
                      datasetVersion: 'dataset-v1.0',
                      featureSchemaVersion: 'feature-v1',
                      policyVersion: 'policy-v1.0',
                    },
                    featureVector,
                    evidenceItems: allEvidence.evidenceChecklist,
                    decision,
                    limitations: allEvidence.limitations,
                  }
                },
                { upsert: true, session }
              );

              const dbSnapshot = await AiSnapshotModel.findOne({ snapshotKey }).session(session).orFail();

              // 2. Fetch highest ID for auto-increment Report
              const latestReport = await ReportModel.findOne({}, { id: 1 }).sort({ id: -1 }).session(session).lean();
              const nextId = (latestReport?.id || 0) + 1;

              const relativeImage = rawFramePath.replace(path.resolve(__dirname, '../../../'), '').replace(/\\/g, '/');
              const relativeClip = clipPath.replace(path.resolve(__dirname, '../../../'), '').replace(/\\/g, '/');

              const validationStatus = 'PENDING';
              const legacy = deriveLegacyStatuses(validationStatus);

              // 3. Upsert report
              await ReportModel.updateOne(
                { sourceVideoId: job.sourceVideoId, incidentKey },
                {
                  $setOnInsert: {
                    id: nextId,
                    userId: new mongoose.Types.ObjectId(), // placeholder, actual user ID mapped at route
                    tenantId: 'BBWS',
                    location: 'Kamera Video',
                    timestamp: new Date(inc.representativeTimestampSec * 1000),
                    image: relativeImage,
                    identity: 'Belum diketahui',
                    sourceType: 'Video',
                    additionalNotes: `Kandidat kejadian terdeteksi pada detik ${inc.startSec.toFixed(1)}–${inc.endSec.toFixed(1)}.`,
                    comments: [],
                    assignedOfficer: '',
                    validationStatus,
                    needsHumanValidation: true,
                    createdFrom: 'VIDEO_AI',
                    sourceMetadata: {
                      cameraId: 1,
                      confidence: inc.decisionConfidence
                    },
                    sla: {
                      detectedAt: new Date()
                    }
                  },
                  $set: {
                    activeSnapshotId: dbSnapshot._id,
                    aiStatus: legacy.status === 'VALIDATED' ? 'Indikasi Tinggi' : 'Tidak Terindikasi',
                    violationScore: inc.violationScore,
                    decisionConfidence: inc.decisionConfidence,
                    priority: inc.priority || 'NONE',
                    recommendedAction: inc.recommendedAction || '',
                    boundingBoxes: mockObjects.map((o: any) => ({
                      label: o.class,
                      confidence: o.confidence,
                      x: o.x,
                      y: o.y,
                      w: o.w,
                      h: o.h
                    })),
                    // Set compatibility fields
                    adminStatus: legacy.adminStatus,
                    status: legacy.status
                  }
                },
                { upsert: true, session }
              );
            });

            processedSuccess++;
            await VideoAnalysisJobModel.updateOne(
              { _id: jobId, workerId, claimToken },
              { $set: { processedIncidents: processedSuccess } }
            );

          } catch (incErr) {
            console.error(`[WORKER] Failed to process incident in job ${jobId}:`, incErr);
          }
        }

        // Complete job
        const finalStatus = processedSuccess === incidents.length ? 'COMPLETED' : (processedSuccess > 0 ? 'PARTIAL' : 'FAILED');
        
        await VideoAnalysisJobModel.updateOne(
          {
            _id: jobId,
            status: 'PROCESSING',
            workerId,
            claimToken
          },
          {
            $set: {
              status: finalStatus,
              progressStage: 'FINISHED',
              progressPercent: 100,
              completedAt: new Date()
            }
          }
        );
        console.log(`[WORKER] Job ${jobId} finished with status ${finalStatus}`);

      } catch (err: any) {
        console.error(`[WORKER] Job ${jobId} failed with error:`, err.message);
        
        // Transition job to RETRY_WAIT or FAILED based on attempts
        const isLastAttempt = job.attemptCount >= job.maxAttempts;
        const nextStatus = isLastAttempt ? 'FAILED' : 'RETRY_WAIT';
        
        await VideoAnalysisJobModel.updateOne(
          {
            _id: jobId,
            status: 'PROCESSING',
            workerId,
            claimToken
          },
          {
            $set: {
              status: nextStatus,
              progressStage: 'FINISHED',
              errorCode: 'PROCESSING_ERROR',
              errorDetails: err.message,
              completedAt: isLastAttempt ? new Date() : undefined,
              nextAttemptAt: new Date(Date.now() + 30 * 1000) // retry after 30 seconds
            }
          }
        );
      } finally {
        clearInterval(heartbeatInterval);
      }

    } catch (err: any) {
      console.error(`[WORKER] Polling cycle failed:`, err.message);
      await sleep(POLLING_INTERVAL_MS);
    }
  }
}

// Start executing worker if run directly
if (require.main === module) {
  runWorker().catch((err) => {
    console.error('[WORKER CRITICAL ERROR] main process exited:', err);
    process.exit(1);
  });
}
