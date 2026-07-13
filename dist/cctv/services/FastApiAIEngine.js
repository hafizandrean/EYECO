"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FastApiAIEngine = void 0;
const IAIEngine_1 = require("./IAIEngine");
const SystemSettings_1 = require("../../database/models/SystemSettings");
const AiModel_1 = require("../../database/models/AiModel");
const ModelDeploymentLog_1 = require("../../database/models/ModelDeploymentLog");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
class FastApiAIEngine {
    name = 'FastAPI Microservice Engine';
    maxBatchSize = 16;
    state = IAIEngine_1.EngineState.STARTING;
    isInitialized = false;
    predictUrl = 'http://localhost:8000/api/v1/predict';
    reloadUrl = 'http://localhost:8000/api/v1/reload_model';
    // Model state variables
    activeModelId = 'yolov8-river-v1.0';
    deploymentId = 'deploy-init-000';
    deploymentGeneration = 1;
    // Circuit Breaker State
    circuitState = 'CLOSED';
    consecutiveFailures = 0;
    lastStateChange = Date.now();
    recoveryTimeoutMs = 30000; // 30s recovery window
    // Telemetry buffer state
    static inferenceMetricsBuffer = [];
    static telemetryInterval = null;
    async initialize(modelPath) {
        this.state = IAIEngine_1.EngineState.STARTING;
        this.isInitialized = false;
        // Extract Model ID from path
        const modelId = path_1.default.basename(modelPath, '.pt');
        const oldModelId = this.activeModelId;
        this.deploymentId = `deploy-init-${Date.now()}`;
        this.deploymentGeneration += 1;
        console.log(`[FastApiAIEngine] Pre-deployment check for: ${modelId} (${modelPath})`);
        // Get target runtime info from FastAPI first
        let runtimeInfo = { apiVersion: '1.0', engineVersion: '8.3.0', pythonVersion: '3.10.0', cudaVersion: '', torchVersion: '' };
        try {
            const verRes = await fetch('http://localhost:8000/version', { signal: AbortSignal.timeout(3000) });
            if (verRes.ok) {
                runtimeInfo = await verRes.json();
            }
        }
        catch (verErr) {
            console.warn(`[FastApiAIEngine] Failed to fetch FastAPI version, using defaults for check:`, verErr.message);
        }
        try {
            // 1. Fetch model details from MongoDB registry if exists
            let checksum = '';
            let version = '1.0';
            let recordObj = null;
            try {
                const modelRecord = await AiModel_1.AiModelModel.findOne({ id: modelId }).exec();
                if (modelRecord) {
                    version = modelRecord.version;
                    recordObj = modelRecord.toObject();
                    checksum = recordObj.checksum || '';
                }
            }
            catch (dbErr) {
                console.warn(`[FastApiAIEngine] Failed to read model metadata from database:`, dbErr);
            }
            // 2. Perform Compatibility Validation on Node.js side before calling FastAPI
            if (recordObj) {
                let isCompatible = true;
                let incompatibilityReason = '';
                // supportedTasks check (e.g. ['DETECTION'])
                const supportedTasks = recordObj.supportedTasks || ['DETECTION'];
                if (!supportedTasks.includes('DETECTION')) {
                    isCompatible = false;
                    incompatibilityReason = 'Model does not support DETECTION task';
                }
                // minimumApiVersion check
                const minApi = recordObj.minimumApiVersion || '1.0';
                if (isCompatible && !this.compareVersions(runtimeInfo.apiVersion, minApi)) {
                    isCompatible = false;
                    incompatibilityReason = `Incompatible API version: Active=${runtimeInfo.apiVersion}, Required >= ${minApi}`;
                }
                // minimumPython check
                const minPy = recordObj.minimumPython || '3.8';
                if (isCompatible && !this.compareVersions(runtimeInfo.pythonVersion, minPy)) {
                    isCompatible = false;
                    incompatibilityReason = `Incompatible Python version: Active=${runtimeInfo.pythonVersion}, Required >= ${minPy}`;
                }
                // minimumCuda check
                const minCuda = recordObj.minimumCuda || '';
                if (isCompatible && minCuda) {
                    if (!runtimeInfo.cudaVersion) {
                        isCompatible = false;
                        incompatibilityReason = `Model requires CUDA >= ${minCuda} but CUDA is not active on server.`;
                    }
                    else if (!this.compareVersions(runtimeInfo.cudaVersion, minCuda)) {
                        isCompatible = false;
                        incompatibilityReason = `Incompatible CUDA version: Active=${runtimeInfo.cudaVersion}, Required >= ${minCuda}`;
                    }
                }
                // minimumTorch check
                const minTorch = recordObj.minimumTorch || '';
                if (isCompatible && minTorch && !this.compareVersions(runtimeInfo.torchVersion, minTorch)) {
                    isCompatible = false;
                    incompatibilityReason = `Incompatible PyTorch version: Active=${runtimeInfo.torchVersion}, Required >= ${minTorch}`;
                }
                // minimumUltralytics check
                const minUltra = recordObj.minimumUltralytics || '';
                if (isCompatible && minUltra && !this.compareVersions(runtimeInfo.engineVersion, minUltra)) {
                    isCompatible = false;
                    incompatibilityReason = `Incompatible Ultralytics version: Active=${runtimeInfo.engineVersion}, Required >= ${minUltra}`;
                }
                if (!isCompatible) {
                    console.error(`[FastApiAIEngine] Compatibility check FAILED: ${incompatibilityReason}`);
                    // Audit Log FAILED Deployment History
                    await ModelDeploymentLog_1.ModelDeploymentLogModel.create({
                        modelIdFrom: oldModelId,
                        modelIdTo: modelId,
                        deployedBy: 'Admin',
                        deploymentType: recordObj.isRollbackCandidate ? 'ROLLBACK' : 'HOT_SWAP',
                        validationResult: 'FAILED',
                        rollbackReason: incompatibilityReason,
                        pythonVersion: runtimeInfo.pythonVersion,
                        cudaVersion: runtimeInfo.cudaVersion,
                        ultralyticsVersion: runtimeInfo.engineVersion,
                        downloadLatencyMs: 0,
                        checksumLatencyMs: 0,
                        loadLatencyMs: 0,
                        warmupLatencyMs: 0,
                        smokeValidationLatencyMs: 0,
                        totalDeploymentLatencyMs: 0
                    });
                    throw new Error(`AI_MODEL_INCOMPATIBLE: ${incompatibilityReason}`);
                }
            }
            // Compute weights file checksum if weights file exists locally
            const localWeightsPath = this.resolveAbsolutePath(modelPath);
            if (fs_1.default.existsSync(localWeightsPath) && !checksum) {
                try {
                    const fileBuffer = fs_1.default.readFileSync(localWeightsPath);
                    checksum = crypto_1.default.createHash('sha256').update(fileBuffer).digest('hex');
                }
                catch (hashErr) {
                    console.warn(`[FastApiAIEngine] Failed to compute file hash:`, hashErr);
                }
            }
            // 3. Call FastAPI reload model endpoint (Safe: already passed pre-deployment compatibility checks)
            const payload = {
                modelId: modelId,
                deploymentId: this.deploymentId,
                deploymentGeneration: this.deploymentGeneration,
                weightsPath: modelPath,
                checksum: checksum || 'sha256-dummy-hash',
                expectedApiVersion: '1.0',
                minimumPython: recordObj?.minimumPython || '3.8',
                minimumCuda: recordObj?.minimumCuda || '',
                minimumTorch: recordObj?.minimumTorch || '',
                minimumUltralytics: recordObj?.minimumUltralytics || ''
            };
            console.log(`[FastApiAIEngine] Sending reload payload to: ${this.reloadUrl}`);
            const response = await fetch(this.reloadUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(15000) // 15s reload timeout for warm-up
            });
            if (!response.ok) {
                const errBody = await response.json().catch(() => ({}));
                throw new Error(`FastAPI reload failed: ${errBody.message || response.statusText} (${response.status})`);
            }
            const resData = await response.json();
            console.log(`[FastApiAIEngine] Reload completed successfully:`, resData);
            // Save load & warmup latency stats to Mongoose AiModel document
            try {
                await AiModel_1.AiModelModel.updateOne({ id: modelId }, {
                    $set: {
                        modelLoadLatencyMs: resData.loadLatencyMs || 0,
                        warmupLatencyMs: resData.warmupLatencyMs || 0
                    }
                }).exec();
                console.log(`[FastApiAIEngine] Updated model reload latency stats in database.`);
            }
            catch (dbErr) {
                console.warn(`[FastApiAIEngine] Failed to save load latency to DB:`, dbErr.message);
            }
            // 4. Log SUCCESS Deployment History
            await ModelDeploymentLog_1.ModelDeploymentLogModel.create({
                modelIdFrom: oldModelId,
                modelIdTo: modelId,
                deployedBy: 'Admin',
                deploymentType: (recordObj?.isRollbackCandidate || oldModelId === modelId) ? 'ROLLBACK' : 'HOT_SWAP',
                validationResult: 'SUCCESS',
                pythonVersion: runtimeInfo.pythonVersion,
                cudaVersion: runtimeInfo.cudaVersion,
                ultralyticsVersion: runtimeInfo.engineVersion,
                downloadLatencyMs: resData.downloadLatencyMs || 0,
                checksumLatencyMs: resData.checksumLatencyMs || 0,
                loadLatencyMs: resData.loadLatencyMs || 0,
                warmupLatencyMs: resData.warmupLatencyMs || 0,
                smokeValidationLatencyMs: resData.smokeValidationLatencyMs || 0,
                totalDeploymentLatencyMs: resData.totalDeploymentLatencyMs || 0
            });
            this.isInitialized = true;
            this.activeModelId = modelId;
            this.state = IAIEngine_1.EngineState.READY;
            this.consecutiveFailures = 0;
            this.circuitState = 'CLOSED';
            // 5. Start Telemetry aggregation flushing interval (10-second intervals)
            if (FastApiAIEngine.telemetryInterval) {
                clearInterval(FastApiAIEngine.telemetryInterval);
            }
            FastApiAIEngine.telemetryInterval = setInterval(() => this.flushTelemetry(), 10000);
        }
        catch (err) {
            console.error(`[FastApiAIEngine] Initialization failed:`, err.message);
            this.state = IAIEngine_1.EngineState.FAILED;
            // If we failed after pre-check (e.g. FastAPI threw loading/smoke validation error)
            if (!err.message.includes('AI_MODEL_INCOMPATIBLE')) {
                await ModelDeploymentLog_1.ModelDeploymentLogModel.create({
                    modelIdFrom: oldModelId,
                    modelIdTo: modelId,
                    deployedBy: 'Admin',
                    deploymentType: oldModelId === modelId ? 'ROLLBACK' : 'HOT_SWAP',
                    validationResult: 'FAILED',
                    rollbackReason: err.message,
                    pythonVersion: runtimeInfo.pythonVersion,
                    cudaVersion: runtimeInfo.cudaVersion,
                    ultralyticsVersion: runtimeInfo.engineVersion,
                    downloadLatencyMs: 0,
                    checksumLatencyMs: 0,
                    loadLatencyMs: 0,
                    warmupLatencyMs: 0,
                    smokeValidationLatencyMs: 0,
                    totalDeploymentLatencyMs: 0
                });
            }
            throw err;
        }
    }
    async detect(frame) {
        if (!this.isInitialized) {
            throw new Error('FastApiAIEngine is not initialized.');
        }
        // Check Circuit Breaker State Machine
        const now = Date.now();
        if (this.circuitState === 'OPEN') {
            if (now - this.lastStateChange > this.recoveryTimeoutMs) {
                console.log('[FastApiAIEngine CB] Attempting recovery (HALF_OPEN)...');
                this.circuitState = 'HALF_OPEN';
            }
            else {
                console.log('[FastApiAIEngine CB] Circuit is OPEN. Fallback to empty detections.');
                return [];
            }
        }
        try {
            // 1. Fetch AI rules/configuration thresholds
            let confidenceThreshold = 0.50;
            let nmsThreshold = 0.45;
            let classesFilter = '[]';
            try {
                const settings = await SystemSettings_1.SystemSettingsModel.findOne({ key: 'ai.rules' }).exec();
                if (settings && settings.value) {
                    confidenceThreshold = settings.value.confidenceThreshold ?? 0.50;
                }
            }
            catch (err) {
                // Fallback to default
            }
            // 2. Resolve frame image path and read file as buffer
            const resolvedPath = this.resolveAbsolutePath(frame.imagePath);
            if (!fs_1.default.existsSync(resolvedPath)) {
                throw new Error(`Captured frame file not found: ${resolvedPath}`);
            }
            const fileBuffer = fs_1.default.readFileSync(resolvedPath);
            const blob = new Blob([fileBuffer], { type: 'image/jpeg' });
            // 3. Build multipart form data body
            const formData = new FormData();
            formData.append('file', blob, path_1.default.basename(resolvedPath));
            formData.append('confidence', confidenceThreshold.toString());
            formData.append('nms', nmsThreshold.toString());
            formData.append('classes', classesFilter);
            formData.append('image_size', '640');
            formData.append('requestId', crypto_1.default.randomUUID());
            formData.append('cameraId', frame.cameraId.toString());
            formData.append('task_type', 'DETECTION');
            formData.append('traceId', crypto_1.default.randomUUID());
            formData.append('correlationId', crypto_1.default.randomUUID());
            // 4. Send request with 3s Timeout and Selective Retry Policy (1x retry for network/timeout errors, skips 4xx)
            let attempt = 1;
            let response = null;
            while (attempt <= 2) {
                try {
                    response = await fetch(this.predictUrl, {
                        method: 'POST',
                        body: formData,
                        signal: AbortSignal.timeout(3000) // 3s Timeout
                    });
                    break; // success, exit retry loop
                }
                catch (err) {
                    if (attempt === 1) {
                        console.warn(`[FastApiAIEngine] Inference attempt 1 failed (${err.message}). Retrying in 100ms...`);
                        await new Promise(resolve => setTimeout(resolve, 100));
                        attempt++;
                    }
                    else {
                        throw err; // propagate exception to trip circuit breaker
                    }
                }
            }
            if (!response || !response.ok) {
                const statusVal = response ? response.status : 500;
                if (statusVal >= 400 && statusVal < 500) {
                    // Client error: skip CB counting, throw immediately
                    throw new Error(`CLIENT_ERROR: API predict responded with status ${statusVal}`);
                }
                else {
                    throw new Error(`SERVER_ERROR: API predict responded with status ${statusVal}`);
                }
            }
            const data = await response.json();
            // Reset circuit breaker on success
            this.consecutiveFailures = 0;
            this.circuitState = 'CLOSED';
            this.state = IAIEngine_1.EngineState.READY;
            // 5. Buffer performance metrics for MLOps telemetry flushing (sampled at 1 FPS)
            FastApiAIEngine.inferenceMetricsBuffer.push({
                timestamp: new Date(),
                cameraId: frame.cameraId,
                modelId: this.activeModelId,
                inferenceLatencyMs: data.inferenceLatencyMs || 0,
                preprocessMs: data.preprocessMs || 0,
                inferenceMs: data.inferenceMs || 0,
                postprocessMs: data.postprocessMs || 0
            });
            // 6. Map Universal Geometry Abstraction response back to IDetectionResult
            if (data && data.objects) {
                return data.objects.map((obj) => ({
                    class: obj.class,
                    confidence: obj.confidence,
                    bbox: obj.geometry.value,
                    geometry: obj.geometry
                }));
            }
            return [];
        }
        catch (err) {
            console.warn(`[FastApiAIEngine CB Error] Inference failed: ${err.message}`);
            // Trip circuit breaker only if it's NOT a client 4xx error
            if (!err.message.includes('CLIENT_ERROR')) {
                this.consecutiveFailures++;
                if (this.circuitState === 'HALF_OPEN') {
                    console.error('[FastApiAIEngine CB] Failure in HALF_OPEN. Tripping back to OPEN.');
                    this.circuitState = 'OPEN';
                    this.lastStateChange = Date.now();
                }
                else if (this.consecutiveFailures >= 5) {
                    console.error('[FastApiAIEngine CB] 5 consecutive failures reached. Opening circuit breaker.');
                    this.circuitState = 'OPEN';
                    this.state = IAIEngine_1.EngineState.DEGRADED;
                    this.lastStateChange = Date.now();
                }
            }
            // Fallback empty results to prevent blocking main backend threads
            return [];
        }
    }
    async detectBatch(frames) {
        return Promise.all(frames.map(f => this.detect(f)));
    }
    /**
     * Semantic Version String comparison helper
     */
    compareVersions(current, required) {
        if (!required || required.toLowerCase() === 'any' || required.trim() === '')
            return true;
        if (!current)
            return false;
        const currParts = current.replace(/[^\d.]/g, '').split('.').map(Number);
        const reqParts = required.replace(/[^\d.]/g, '').split('.').map(Number);
        for (let i = 0; i < Math.max(currParts.length, reqParts.length); i++) {
            const currPart = currParts[i] || 0;
            const reqPart = reqParts[i] || 0;
            if (currPart > reqPart)
                return true;
            if (currPart < reqPart)
                return false;
        }
        return true; // equal
    }
    /**
     * Periodically flushes collected inference performance metrics and queries hardware stats
     */
    async flushTelemetry() {
        const metricsToInsert = [...FastApiAIEngine.inferenceMetricsBuffer];
        FastApiAIEngine.inferenceMetricsBuffer = []; // clear memory buffer
        // Bulk write inference metrics
        if (metricsToInsert.length > 0) {
            try {
                const { AiInferenceMetricsModel } = require('../../database/models/AiInferenceMetrics');
                await AiInferenceMetricsModel.insertMany(metricsToInsert);
                console.log(`[FastApiAIEngine Telemetry] Flushed ${metricsToInsert.length} performance latency records to MongoDB.`);
            }
            catch (err) {
                console.error(`[FastApiAIEngine Telemetry] Failed to flush inference metrics to database:`, err.message);
                // Put back in buffer so we don't lose data
                FastApiAIEngine.inferenceMetricsBuffer.unshift(...metricsToInsert);
            }
        }
        // Collect and record system hardware metrics from FastAPI health/system
        try {
            const sysResponse = await fetch('http://localhost:8000/health/system', { signal: AbortSignal.timeout(2000) });
            if (sysResponse.ok) {
                const sysStats = await sysResponse.json();
                const { AiSystemMetricsModel } = require('../../database/models/AiSystemMetrics');
                await AiSystemMetricsModel.create({
                    timestamp: new Date(),
                    cpuUsage: sysStats.cpu || 0,
                    ramUsage: sysStats.ram || 0,
                    gpuUsage: sysStats.gpu || 0,
                    vramUsed: sysStats.vramUsed || 0,
                    vramFree: sysStats.vramFree || 0,
                    diskUsage: sysStats.diskUsage || 0
                });
                console.log(`[FastApiAIEngine Telemetry] Flushed current GPU/CPU system telemetry to MongoDB.`);
            }
        }
        catch (sysErr) {
            console.warn(`[FastApiAIEngine Telemetry] Failed to fetch system hardware stats from FastAPI:`, sysErr.message);
        }
    }
    /**
     * Helper to resolve path of simulated captured files
     */
    resolveAbsolutePath(imagePath) {
        let cleanPath = imagePath;
        if (cleanPath.startsWith('/')) {
            cleanPath = cleanPath.substring(1);
        }
        // Check if it's public assets uploads
        if (cleanPath.startsWith('uploads') || cleanPath.startsWith('public')) {
            return path_1.default.join(process.cwd(), 'public', cleanPath.replace(/^public\//, ''));
        }
        return path_1.default.join(process.cwd(), cleanPath);
    }
}
exports.FastApiAIEngine = FastApiAIEngine;
