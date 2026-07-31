/**
 * EYECO AI — YOLOv8 Detection Service
 *
 * Service yang menjalankan Python detect.py via child_process.spawn,
 * memparsing hasil JSON, dan mengonversinya ke format Report.
 *
 * Didesain agar backend tetap hidup meskipun Python crash atau
 * model gagal dimuat (error handling di setiap level).
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiDetectionBox {
  /** Nama class dari YOLO (e.g. 'littering', 'person', 'boat') */
  class: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Bounding box dalam format [x1, y1, x2, y2] — pixel absolut */
  bbox: [number, number, number, number];
  /** Frame index (video only) */
  frame?: number;
  /** Timestamp in seconds (video only) */
  timestamp_sec?: number;
}

export interface AiDetectionResult {
  success: boolean;
  error?: string;
  detections: AiDetectionBox[];
  totalDetections: number;
  processingTimeMs?: number;
  imageWidth?: number;
  imageHeight?: number;
  blurScore?: number;
  qualityStatus?: string;
  videoMeta?: {
    totalFrames: number;
    fps: number;
    processedFrames: number;
    framesWithDetections: number;
  };
  warmup?: boolean;
}

export interface AiStatusResult {
  status: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi';
  confidence: number | null;
  boxes: Array<{
    label: string;
    confidence: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }>;
  blurScore?: number;
  qualityStatus?: string;
  extractedFramePath?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const AI_DIR = path.resolve(__dirname, '../../ai');
const DETECT_SCRIPT = path.join(AI_DIR, 'detect.py');
const DEFAULT_MODEL = path.join(AI_DIR, 'models', 'best.pt');
const FALLBACK_MODEL = 'yolov8n.pt';
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';

// Warmup state — model dimuat sekali saat server start
let _warmupDone = false;
let _warmupError: string | null = null;

// ---------------------------------------------------------------------------
// Python Spawn
// ---------------------------------------------------------------------------

/**
 * Jalankan detect.py via child_process.spawn.
 * Selalu resolve (tidak throw) — error dikembalikan via AiDetectionResult.
 */
function runPythonDetection(
  filePath: string,
  options: {
    model?: string;
    conf?: number;
    iou?: number;
    maxFrames?: number;
    timeout?: number;
  } = {}
): Promise<AiDetectionResult> {
  const {
    model = DEFAULT_MODEL,
    conf = 0.20,
    iou = 0.45,
    maxFrames = 0,
    timeout = 30_000,
  } = options;

  return new Promise((resolve) => {
    const args: string[] = [
      DETECT_SCRIPT,
      filePath,
      '--model', model,
      '--conf', String(conf),
      '--iou', String(iou),
    ];

    if (maxFrames > 0) {
      args.push('--max-frames', String(maxFrames));
    }

    // Cek apakah --warmup flag (bukan positional arg)
    if (filePath === '--warmup') {
      // Hanya kirim --warmup dan --model
      args.length = 0;
      args.push(DETECT_SCRIPT, '--warmup', '--model', model);
    }

    console.log(`[AI] Spawning: ${PYTHON_CMD} ${args.join(' ')}`);

    const proc = spawn(PYTHON_CMD, args, {
      cwd: AI_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      console.error(`[AI] Python inference timeout after ${timeout}ms`);
      resolve({
        success: false,
        error: `Python inference timeout after ${timeout}ms`,
        detections: [],
        totalDetections: 0,
      });
    }, timeout);

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      // Log stderr (warnings, fallback messages, dll)
      if (stderr.trim()) {
        stderr.trim().split('\n').forEach((line) => {
          console.log(`[AI:stderr] ${line}`);
        });
      }

      // Coba parse stdout sebagai JSON
      const trimmed = stdout.trim();
      if (trimmed) {
        try {
          const parsed = JSON.parse(trimmed) as AiDetectionResult;
          resolve(parsed);
        } catch {
          // stdout bukan JSON
          const snippet = trimmed.slice(0, 300);
          console.error(`[AI] Output bukan JSON valid: ${snippet}`);
          resolve({
            success: false,
            error: `Python output tidak valid: ${snippet}`,
            detections: [],
            totalDetections: 0,
          });
        }
      } else {
        // Tidak ada stdout
        const errMsg = stderr.trim() || `Python exited with code ${code}`;
        console.error(`[AI] No stdout. stderr: ${errMsg.slice(0, 500)}`);
        resolve({
          success: false,
          error: errMsg.slice(0, 500),
          detections: [],
          totalDetections: 0,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      console.error(`[AI] Failed to spawn Python: ${err.message}`);
      resolve({
        success: false,
        error: `Gagal spawn Python: ${err.message}`,
        detections: [],
        totalDetections: 0,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Warmup — pre-load model saat server start
// ---------------------------------------------------------------------------

/**
 * Pre-load model YOLO dengan dummy inference.
 * Panggil sekali saat server start.
 * Backend tetap jalan meskipun warmup gagal.
 */
export async function warmupAI(
  modelPath: string = DEFAULT_MODEL
): Promise<{ success: boolean; error?: string }> {
  if (_warmupDone) return { success: true };

  console.log('[AI] Warming up YOLO model...');

  try {
    const result = await runPythonDetection('--warmup', { model: modelPath });
    if (result.success) {
      _warmupDone = true;
      _warmupError = null;
      console.log('[AI] Model loaded successfully');
      return { success: true };
    } else {
      _warmupError = result.error || 'Unknown warmup error';
      console.error('[AI] Warmup failed:', _warmupError);
      console.error('[AI] Backend will continue without AI. Detections will be disabled.');
      return { success: false, error: _warmupError };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _warmupError = msg;
    console.error('[AI] Warmup exception:', msg);
    return { success: false, error: msg };
  }
}

export function isAiReady(): boolean {
  return _warmupDone;
}

export function getWarmupError(): string | null {
  return _warmupError;
}

// ---------------------------------------------------------------------------
// Konversi YOLO bbox → format Report
// ---------------------------------------------------------------------------

/**
 * Konversi bbox absolut YOLO [x1,y1,x2,y2] ke format persentase
 * yang digunakan oleh schema Report: { x, y, w, h } dalam range 0-100.
 */
function yoloBboxToReportBox(
  bbox: [number, number, number, number],
  imageWidth: number,
  imageHeight: number,
  className: string,
  confidence: number
): {
  label: string;
  confidence: number;
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const [x1, y1, x2, y2] = bbox;

  const x = Math.round((x1 / imageWidth) * 100 * 10) / 10;
  const y = Math.round((y1 / imageHeight) * 100 * 10) / 10;
  const w = Math.round(((x2 - x1) / imageWidth) * 100 * 10) / 10;
  const h = Math.round(((y2 - y1) / imageHeight) * 100 * 10) / 10;

  return {
    label: className,
    confidence: Math.round(confidence * 100) / 100,
    x: Math.min(x, 100),
    y: Math.min(y, 100),
    w: Math.min(w, 100),
    h: Math.min(h, 100),
  };
}

// ---------------------------------------------------------------------------
// Penentuan Status AI — EYECO Smart Logic v3 (Overhauled)
// Person only (walking by, no trash) → "Tidak Terindikasi" with boxes shown
// Person + trash overlapping (holding/carrying at wrist) → "SEDANG"
// Person + trash no overlap (thrown/discarded on ground) → "TINGGI"
// Trash only (no person) → "RENDAH"
// Continuous confidence (1 decimal, NOT multiples of 5)
// ---------------------------------------------------------------------------

const PERSON_CLASSES = ['person', 'cctv persons', 'cctv persons - v1 2024-09-16 8-18pm', 'people', 'sitting', 'standing', 'fall-detected'];

const TRASH_TRANSPORT_CLASSES = new Set([
  'handbag', 'backpack', 'suitcase', 'bag', 'plastic_bag', 'shopping bag',
]);
// Carrying/holding objects that could reasonably be in a person's hand/wrist area

function determineAiStatus(
  detections: AiDetectionBox[],
  imageWidth: number,
  imageHeight: number,
  qualityStatus: string = 'UNKNOWN',
  blurScore: number = 0,
): AiStatusResult {
  // Helper untuk attach qualityStatus ke result
  const withQuality = (result: Omit<AiStatusResult, 'qualityStatus' | 'blurScore'>): AiStatusResult => ({
    ...result,
    blurScore,
    qualityStatus,
  });

  if (detections.length === 0) {
    return withQuality({
      status: 'Tidak Terindikasi',
      confidence: null,
      boxes: [],
    });
  }

  const maxConf = Math.max(...detections.map((d) => d.confidence));
  const boxes = detections.map((d) =>
    yoloBboxToReportBox(d.bbox, imageWidth, imageHeight, d.class, d.confidence)
  );

  // ── Continuous confidence scoring (1 decimal, not multiples of 5) ──
  const confMultiplier = Math.round(maxConf * 100 * 10) / 10; // 0-100, 1 desimal

  // Pisahkan person vs trash
  const personDets = detections.filter((d) =>
    PERSON_CLASSES.includes(d.class.toLowerCase())
  );
  const trashDets = detections.filter(
    (d) => !PERSON_CLASSES.includes(d.class.toLowerCase())
  );

  // Rule 1: Person ONLY (no trash detected) → Tidak Terindikasi, show boxes
  if (personDets.length > 0 && trashDets.length === 0) {
    return withQuality({
      status: 'Tidak Terindikasi',
      confidence: null,
      boxes, // boxes tetap dikirim agar bounding box tampil di UI
    });
  }

  // Rule 2: Person + Trash → check overlap to determine holding vs thrown
  if (personDets.length > 0 && trashDets.length > 0) {
    let hasOverlap = false;
    for (const trash of trashDets) {
      const [tx1, ty1, tx2, ty2] = trash.bbox;
      const trashArea = (tx2 - tx1) * (ty2 - ty1);
      if (trashArea <= 0) continue;
      for (const person of personDets) {
        const [px1, py1, px2, py2] = person.bbox;
        const ix1 = Math.max(tx1, px1);
        const iy1 = Math.max(ty1, py1);
        const ix2 = Math.min(tx2, px2);
        const iy2 = Math.min(ty2, py2);
        if (ix1 < ix2 && iy1 < iy2) {
          const interArea = (ix2 - ix1) * (iy2 - iy1);
          const overlapRatio = interArea / trashArea;
          if (overlapRatio > 0.3) {
            hasOverlap = true;
            break;
          }
        }
      }
      if (hasOverlap) break;
    }

    if (hasOverlap) {
      // Trash overlapping with person (holding/carrying) → SEDANG
      // Continuous score: base 50 + up to 24 based on maxConf → 50-74
      const confidence = Math.round((50 + 24 * maxConf) * 10) / 10;
      return withQuality({
        status: 'SEDANG',
        confidence,
        boxes,
      });
    } else {
      // Trash not overlapping person (thrown/discarded on ground) → TINGGI
      // Continuous score: base 65 + up to 25 based on maxConf → 65-90
      const confidence = Math.round((65 + 25 * maxConf) * 10) / 10;
      return withQuality({
        status: 'TINGGI',
        confidence,
        boxes,
      });
    }
  }

  // Rule 3: Trash ONLY (no person) → RENDAH with continuous confidence
  // Continuous score: base 25 + up to 15 based on maxConf → 25-40
  const confidence = Math.round((25 + 15 * maxConf) * 10) / 10;
  return withQuality({
    status: 'RENDAH',
    confidence,
    boxes,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Jalankan deteksi AI pada file gambar/video.
 *
 * @param filePath Absolute path ke file yang akan dideteksi
 * @param options Opsi tambahan (model, conf threshold, dll)
 * @returns AiStatusResult siap untuk disimpan ke database
 */
function extractFrame(
  inputPath: string,
  outputPath: string,
  timestampSec: number
): Promise<void> {
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
    const ffmpegPath = require('ffmpeg-static') as string;
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
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

export async function detectFile(
  filePath: string,
  options: {
    model?: string;
    conf?: number;
    iou?: number;
  } = {}
): Promise<AiStatusResult> {
  // Validasi file exist
  if (!fs.existsSync(filePath)) {
    console.error('[AI] File not found:', filePath);
    return {
      status: 'Tidak Terindikasi',
      confidence: null,
      boxes: [],
    };
  }

  // Cek apakah model sudah diwarmup
  if (!_warmupDone && !_warmupError) {
    console.warn('[AI] Model not warmed up yet, running cold inference...');
  }

  console.log('[AI] detect.py dijalankan untuk:', path.basename(filePath));

  // Jalankan Python
  const result = await runPythonDetection(filePath, options);

  if (!result.success) {
    console.error('[AI] Detection failed:', result.error);
    return {
      status: 'Tidak Terindikasi',
      confidence: null,
      boxes: [],
    };
  }

  console.log(`[AI] YOLO selesai — ${result.totalDetections} deteksi dalam ${result.processingTimeMs}ms`);

  // Konversi
  const imageWidth = result.imageWidth || 640;
  const imageHeight = result.imageHeight || 640;
  const qualityStatus = result.qualityStatus || 'UNKNOWN';
  const blurScore = result.blurScore || 0;

  const isVideo = filePath.toLowerCase().endsWith('.mp4') ||
                  filePath.toLowerCase().endsWith('.avi') ||
                  filePath.toLowerCase().endsWith('.mov') ||
                  filePath.toLowerCase().endsWith('.mkv') ||
                  filePath.toLowerCase().endsWith('.wmv');

  if (isVideo) {
    let bestFrameNum = 0;
    let bestStatus: 'TINGGI' | 'SEDANG' | 'RENDAH' | 'Tidak Terindikasi' = 'Tidak Terindikasi';
    let bestConfidence = 0;
    let bestBoxes: any[] = [];
    let bestTimestampSec = 0;

    // Group detections by frame
    const frameDetections: { [key: number]: any[] } = {};
    for (const d of result.detections) {
      const fNum = d.frame ?? 0;
      if (!frameDetections[fNum]) {
        frameDetections[fNum] = [];
      }
      frameDetections[fNum].push(d);
    }

    const severityOrder = { 'TINGGI': 3, 'SEDANG': 2, 'RENDAH': 1, 'Tidak Terindikasi': 0 };

    for (const frameStr of Object.keys(frameDetections)) {
      const frameNum = parseInt(frameStr);
      const dets = frameDetections[frameNum];
      
      const evalResult = determineAiStatus(dets, imageWidth, imageHeight, qualityStatus, blurScore);
      const currentSeverity = severityOrder[evalResult.status] || 0;
      const bestSeverity = severityOrder[bestStatus] || 0;

      if (currentSeverity > bestSeverity || (currentSeverity === bestSeverity && (evalResult.confidence || 0) > bestConfidence)) {
        bestFrameNum = frameNum;
        bestStatus = evalResult.status;
        bestConfidence = evalResult.confidence || 0;
        bestBoxes = evalResult.boxes;
        bestTimestampSec = dets[0].timestamp_sec || 0;
      }
    }

    // Extract the representative frame image
    const uploadDir = path.dirname(filePath);
    const baseName = path.basename(filePath, path.extname(filePath));
    const extractedImageName = `capture_${Date.now()}_${baseName}.jpg`;
    const extractedImagePath = path.join(uploadDir, extractedImageName);
    
    try {
      await extractFrame(filePath, extractedImagePath, bestTimestampSec);
      console.log(`[AI] Representative frame extracted at ${bestTimestampSec}s to ${extractedImagePath}`);
    } catch (err: any) {
      console.error('[AI] Failed to extract representative frame:', err.message);
      // Fallback: extract at 0s if fails
      try {
        await extractFrame(filePath, extractedImagePath, 0);
      } catch (fErr: any) {
        console.error('[AI] Fallback frame extraction failed:', fErr.message);
      }
    }

    return {
      status: bestStatus,
      confidence: bestConfidence || null,
      boxes: bestBoxes,
      extractedFramePath: `/uploads/${extractedImageName}`
    };
  }

  return determineAiStatus(result.detections, imageWidth, imageHeight, qualityStatus, blurScore);
}

/**
 * Alias untuk backward compatibility.
 */
export const analyzeWithAI = detectFile;
