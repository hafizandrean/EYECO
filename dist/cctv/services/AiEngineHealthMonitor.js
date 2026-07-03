"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiEngineHealthMonitor = void 0;
const InferenceQueue_1 = require("./InferenceQueue");
const AiMetric_1 = require("../../database/models/AiMetric");
const AiModelManager_1 = require("./AiModelManager");
const IAIEngine_1 = require("./IAIEngine");
class AiEngineHealthMonitor {
    /**
     * Retrieves comprehensive AI engine health metrics for observability.
     */
    static async getMetrics() {
        const queueLength = InferenceQueue_1.InferenceQueue.getQueueLength();
        const activeWorkers = InferenceQueue_1.InferenceQueue.getActiveWorkers();
        const busyWorkers = InferenceQueue_1.InferenceQueue.getBusyWorkers();
        const droppedFrames = InferenceQueue_1.InferenceQueue.droppedFramesCount;
        const totalProcessed = InferenceQueue_1.InferenceQueue.totalProcessedCount;
        const fpsThroughput = InferenceQueue_1.InferenceQueue.getFpsThroughput();
        const averageWaitingTimeMs = InferenceQueue_1.InferenceQueue.getAverageWaitingTimeMs();
        const workerUtilization = InferenceQueue_1.InferenceQueue.getWorkerUtilization();
        // Fetch average latency in last 5 minutes from DB
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        let averageInferenceTimeMs = 0;
        try {
            const recentMetrics = await AiMetric_1.AiMetricModel.find({ timestamp: { $gte: fiveMinutesAgo } }).lean();
            if (recentMetrics.length > 0) {
                const sum = recentMetrics.reduce((acc, curr) => acc + curr.averageInferenceTimeMs, 0);
                averageInferenceTimeMs = Math.round(sum / recentMetrics.length);
            }
        }
        catch {
            // Fallback
        }
        // Resolve engine state from active engine
        let engineState = IAIEngine_1.EngineState.READY;
        try {
            const engine = await AiModelManager_1.AiModelManager.getEngineForCamera(1);
            engineState = engine.state || IAIEngine_1.EngineState.READY;
        }
        catch {
            engineState = IAIEngine_1.EngineState.FAILED;
        }
        // Handle shutdown state transitions dynamically
        const isAccepting = InferenceQueue_1.InferenceQueue.accepting !== false;
        if (!isAccepting) {
            engineState = activeWorkers > 0 ? IAIEngine_1.EngineState.STOPPING : IAIEngine_1.EngineState.STOPPED;
        }
        else if (activeWorkers === 0) {
            // If workers are 0 and not shutting down, state is FAILED
            engineState = IAIEngine_1.EngineState.FAILED;
        }
        // Determine status based on queue delay and drop rate
        let status = 'HEALTHY';
        if (queueLength > 30)
            status = 'SLOW';
        if (droppedFrames > 10 || engineState === IAIEngine_1.EngineState.DEGRADED)
            status = 'DEGRADED';
        if (activeWorkers === 0 || engineState === IAIEngine_1.EngineState.FAILED || engineState === IAIEngine_1.EngineState.STOPPED)
            status = 'OFFLINE';
        return {
            status,
            engineState,
            queueLength,
            activeWorkers,
            busyWorkers,
            droppedFrames,
            totalProcessed,
            fpsThroughput,
            averageWaitingTimeMs,
            workerUtilization,
            averageInferenceTimeMs,
            timestamp: new Date()
        };
    }
}
exports.AiEngineHealthMonitor = AiEngineHealthMonitor;
