"use strict";
/**
 * EYECO AI — YOLOv8 Detection Service
 *
 * Service yang menjalankan Python detect.py via child_process.spawn,
 * memparsing hasil JSON, dan mengonversinya ke format Report.
 *
 * Didesain agar backend tetap hidup meskipun Python crash atau
 * model gagal dimuat (error handling di setiap level).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeWithAI = void 0;
exports.warmupAI = warmupAI;
exports.isAiReady = isAiReady;
exports.getWarmupError = getWarmupError;
exports.detectFile = detectFile;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const AI_DIR = path_1.default.resolve(__dirname, '../../ai');
const DETECT_SCRIPT = path_1.default.join(AI_DIR, 'detect.py');
const DEFAULT_MODEL = path_1.default.join(AI_DIR, 'models', 'best.pt');
const FALLBACK_MODEL = 'yolov8n.pt';
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';
// Warmup state — model dimuat sekali saat server start
let _warmupDone = false;
let _warmupError = null;
// ---------------------------------------------------------------------------
// Thresholds untuk menentukan tingkat status AI
// ---------------------------------------------------------------------------
const STATUS_THRESHOLDS = {
    LOW_MAX: 0.45,
    MEDIUM_MIN: 0.45,
    HIGH_MIN: 0.75,
    HIGH_MIN_COUNT: 2,
};
// ---------------------------------------------------------------------------
// Python Spawn
// ---------------------------------------------------------------------------
/**
 * Jalankan detect.py via child_process.spawn.
 * Selalu resolve (tidak throw) — error dikembalikan via AiDetectionResult.
 */
function runPythonDetection(filePath, options = {}) {
    const { model = DEFAULT_MODEL, conf = 0.15, iou = 0.45, maxFrames = 0, timeout = 30_000, } = options;
    return new Promise((resolve) => {
        const args = [
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
        const proc = (0, child_process_1.spawn)(PYTHON_CMD, args, {
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
        proc.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        proc.stderr.on('data', (chunk) => {
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
                    const parsed = JSON.parse(trimmed);
                    resolve(parsed);
                }
                catch {
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
            }
            else {
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
async function warmupAI(modelPath = DEFAULT_MODEL) {
    if (_warmupDone)
        return { success: true };
    console.log('[AI] Warming up YOLO model...');
    try {
        const result = await runPythonDetection('--warmup', { model: modelPath });
        if (result.success) {
            _warmupDone = true;
            _warmupError = null;
            console.log('[AI] Model loaded successfully');
            return { success: true };
        }
        else {
            _warmupError = result.error || 'Unknown warmup error';
            console.error('[AI] Warmup failed:', _warmupError);
            console.error('[AI] Backend will continue without AI. Detections will be disabled.');
            return { success: false, error: _warmupError };
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        _warmupError = msg;
        console.error('[AI] Warmup exception:', msg);
        return { success: false, error: msg };
    }
}
function isAiReady() {
    return _warmupDone;
}
function getWarmupError() {
    return _warmupError;
}
// ---------------------------------------------------------------------------
// Konversi YOLO bbox → format Report
// ---------------------------------------------------------------------------
/**
 * Konversi bbox absolut YOLO [x1,y1,x2,y2] ke format persentase
 * yang digunakan oleh schema Report: { x, y, w, h } dalam range 0-100.
 */
function yoloBboxToReportBox(bbox, imageWidth, imageHeight, className, confidence) {
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
// Penentuan Status AI — EYECO Smart Logic v2
// Person-only → Tidak Terindikasi
// Person + trash overlapping (di tangan) → RENDAH
// Person + trash terpisah (di tanah) → TINGGI
// Trash aja → confidence-based
// ---------------------------------------------------------------------------
const PERSON_CLASSES = ['people', 'sitting', 'standing'];
function determineAiStatus(detections, imageWidth, imageHeight) {
    if (detections.length === 0) {
        return {
            status: 'Tidak Terindikasi',
            confidence: null,
            boxes: [],
        };
    }
    const maxConf = Math.max(...detections.map((d) => d.confidence));
    const boxes = detections.map((d) => yoloBboxToReportBox(d.bbox, imageWidth, imageHeight, d.class, d.confidence));
    // Pisahkan person vs trash
    const personDets = detections.filter((d) => PERSON_CLASSES.includes(d.class.toLowerCase()));
    const trashDets = detections.filter((d) => !PERSON_CLASSES.includes(d.class.toLowerCase()));
    // Rule 1: Person AJA (tanpa trash) → Tidak Terindikasi
    if (personDets.length > 0 && trashDets.length === 0) {
        return {
            status: 'Tidak Terindikasi',
            confidence: null,
            boxes: [],
        };
    }
    // Rule 2: Person + Trash → cek overlap (IoU based)
    if (personDets.length > 0 && trashDets.length > 0) {
        let hasOverlap = false;
        for (const trash of trashDets) {
            const [tx1, ty1, tx2, ty2] = trash.bbox;
            const trashArea = (tx2 - tx1) * (ty2 - ty1);
            if (trashArea <= 0)
                continue;
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
            if (hasOverlap)
                break;
        }
        if (hasOverlap) {
            // Trash di tangan (overlap dengan person) → RENDAH
            return {
                status: 'RENDAH',
                confidence: Math.round(maxConf * 100),
                boxes,
            };
        }
        else {
            // Trash di tanah (tidak overlap person) → TINGGI
            return {
                status: 'TINGGI',
                confidence: Math.round(maxConf * 100),
                boxes,
            };
        }
    }
    // Rule 3: Trash aja (tanpa person) → confidence-based (existing logic)
    const highConfCount = detections.filter((d) => d.confidence >= STATUS_THRESHOLDS.HIGH_MIN).length;
    let status;
    let confidence;
    if (maxConf >= STATUS_THRESHOLDS.HIGH_MIN &&
        highConfCount >= STATUS_THRESHOLDS.HIGH_MIN_COUNT) {
        status = 'TINGGI';
        confidence = Math.round(maxConf * 100);
    }
    else if (maxConf >= STATUS_THRESHOLDS.HIGH_MIN) {
        const highClasses = detections
            .filter((d) => d.confidence >= STATUS_THRESHOLDS.HIGH_MIN)
            .map((d) => d.class.toLowerCase());
        const criticalKeywords = ['littering', 'buang sampah', 'limbah', 'illegal', 'mencurigakan'];
        const hasCritical = highClasses.some((cls) => criticalKeywords.some((kw) => cls.includes(kw)));
        if (hasCritical) {
            status = 'TINGGI';
            confidence = Math.round(maxConf * 100);
        }
        else {
            status = 'SEDANG';
            confidence = Math.round(maxConf * 100);
        }
    }
    else if (maxConf >= STATUS_THRESHOLDS.MEDIUM_MIN) {
        status = 'SEDANG';
        confidence = Math.round(maxConf * 100);
    }
    else {
        status = 'RENDAH';
        confidence = Math.round(maxConf * 100);
    }
    return { status, confidence, boxes };
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
async function detectFile(filePath, options = {}) {
    // Validasi file exist
    if (!fs_1.default.existsSync(filePath)) {
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
    console.log('[AI] detect.py dijalankan untuk:', path_1.default.basename(filePath));
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
    return determineAiStatus(result.detections, imageWidth, imageHeight);
}
/**
 * Alias untuk backward compatibility.
 */
exports.analyzeWithAI = detectFile;
