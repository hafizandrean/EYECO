import { InferenceQueue } from './InferenceQueue';
import { AiMetricModel } from '../../database/models/AiMetric';
import { AiModelManager } from './AiModelManager';
import { EngineState } from './IAIEngine';

export class AiEngineHealthMonitor {
  /**
   * Retrieves comprehensive AI engine health metrics for observability.
   */
  public static async getMetrics(): Promise<any> {
    const queueLength = InferenceQueue.getQueueLength();
    const activeWorkers = InferenceQueue.getActiveWorkers();
    const busyWorkers = InferenceQueue.getBusyWorkers();
    const droppedFrames = InferenceQueue.droppedFramesCount;
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
      // If workers are 0 and not shutting down, state is FAILED
      engineState = EngineState.FAILED;
    }

    // Determine status based on queue delay and drop rate
    let status: 'HEALTHY' | 'SLOW' | 'DEGRADED' | 'OFFLINE' = 'HEALTHY';
    if (queueLength > 30) status = 'SLOW';
    if (droppedFrames > 10 || engineState === EngineState.DEGRADED) status = 'DEGRADED';
    if (activeWorkers === 0 || engineState === EngineState.FAILED || engineState === EngineState.STOPPED) status = 'OFFLINE';

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
