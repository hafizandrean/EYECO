import { InferenceQueue } from './InferenceQueue';
import { AiMetricModel } from '../../database/models/AiMetric';
import { AiModelManager } from './AiModelManager';
import { AiModelModel } from '../../database/models/AiModel';
import { EngineState } from './IAIEngine';

export class AiEngineHealthMonitor {
  /**
   * Retrieves comprehensive AI engine health metrics for observability.
   */
  public static async getMetrics(): Promise<any> {
    const queueLength = InferenceQueue.getQueueLength();
    const queueCapacity = (InferenceQueue as any).cachedMaxQueueSize || 50;
    const activeWorkers = InferenceQueue.getActiveWorkers();
    const busyWorkers = InferenceQueue.getBusyWorkers();
    const droppedFrames = InferenceQueue.droppedFramesCount;
    const expiredFrames = InferenceQueue.expiredFramesCount;
    const totalProcessed = InferenceQueue.totalProcessedCount;
    const fpsThroughput = InferenceQueue.getFpsThroughput();
    const averageWaitingTimeMs = InferenceQueue.getAverageWaitingTimeMs();
    const workerUtilization = InferenceQueue.getWorkerUtilization();

    // Fetch average latency in last 5 minutes from DB
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    let averageInferenceTimeMs = 0;
    try {
      const recentMetrics = await AiMetricModel.find({ timestamp: { $gte: fiveMinutesAgo } }).lean();
      if (recentMetrics.length > 0) {
        const sum = recentMetrics.reduce((acc, curr) => acc + curr.averageInferenceTimeMs, 0);
        averageInferenceTimeMs = Math.round(sum / recentMetrics.length);
      }
    } catch {
      // Fallback
    }

    // Resolve engine state from active engine
    let engineState: EngineState = EngineState.READY;
    try {
      const engine = await AiModelManager.getEngineForCamera(1);
      engineState = engine.state || EngineState.READY;
    } catch {
      engineState = EngineState.FAILED;
    }

    // Handle shutdown state transitions dynamically
    const isAccepting = (InferenceQueue as any).accepting !== false;
    if (!isAccepting) {
      engineState = activeWorkers > 0 ? EngineState.STOPPING : EngineState.STOPPED;
    } else if (activeWorkers === 0) {
      engineState = EngineState.FAILED;
    }

    // Determine status based on queue delay and drop rate
    let status: 'HEALTHY' | 'SLOW' | 'DEGRADED' | 'OFFLINE' = 'HEALTHY';
    if (queueLength > 30) status = 'SLOW';
    if (droppedFrames > 10 || engineState === EngineState.DEGRADED) status = 'DEGRADED';
    if (activeWorkers === 0 || engineState === EngineState.FAILED || engineState === EngineState.STOPPED) status = 'OFFLINE';

    // Retrieve active model details
    let modelLoadedSince: Date | null = null;
    let activeModelName = 'yolov8-river-v1.0';
    try {
      const activeModel = await AiModelModel.findOne({ id: AiModelManager.getActiveModelId() }).exec();
      if (activeModel) {
        modelLoadedSince = activeModel.updatedAt;
        activeModelName = activeModel.name;
      }
    } catch (err) {
      // fallback
    }

    return {
      status,
      engineState,
      queueLength,
      queueCapacity,
      activeWorkers,
      busyWorkers,
      droppedFrames,
      expiredFrames,
      totalProcessed,
      fpsThroughput,
      averageWaitingTimeMs,
      workerUtilization,
      averageInferenceTimeMs,
      modelLoadedSince,
      activeModelName,
      timestamp: new Date()
    };
  }
}
