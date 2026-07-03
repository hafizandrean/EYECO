import { IAIEngine } from './IAIEngine';
import { AIEngineFactory } from './AIEngineFactory';
import { AiModelModel } from '../../database/models/AiModel';
import { SystemSettingsModel } from '../../database/models/SystemSettings';

export class AiModelManager {
  private static activeEngine: IAIEngine | null = null;
  private static activeModelId: string | null = null;

  private static canaryEngine: IAIEngine | null = null;
  private static canaryModelId: string | null = null;

  /**
   * Initializes the active AI engines and runs warm-up cycles.
   */
  public static async initialize(): Promise<void> {
    try {
      // 1. Fetch the primary active model from the registry
      const activeModel = await AiModelModel.findOne({ isActive: true }).exec();
      const modelId = activeModel ? activeModel.id : 'yolov8-river-v1.0';
      
      console.log(`[AiModelManager] Loading active model registry: ${modelId}`);
      
      this.activeModelId = modelId;
      this.activeEngine = AIEngineFactory.createEngine('MOCK');
      await this.activeEngine.initialize(`/weights/${modelId}.pt`);

      // 2. Load Canary Routing configurations if enabled
      const canarySetting = await SystemSettingsModel.findOne({ key: 'ai.canary' }).exec();
      if (canarySetting && canarySetting.value && canarySetting.value.enabled) {
        const { canaryModelId, engineType } = canarySetting.value;
        this.canaryModelId = canaryModelId;
        this.canaryEngine = AIEngineFactory.createEngine(engineType || 'MOCK');
        await this.canaryEngine.initialize(`/weights/${canaryModelId}.pt`);
        console.log(`[AiModelManager] Canary model ${canaryModelId} loaded and warmed up.`);
      }
    } catch (err: any) {
      console.error('[AiModelManager] Failed to initialize model registry:', err.message);
      this.activeEngine = AIEngineFactory.createEngine('MOCK');
      await this.activeEngine.initialize('/weights/yolov8-river-v1.0.pt');
    }
  }

  /**
   * Resolves the correct engine instance for the camera feed, supporting Canary Routing.
   * Also checks if the database active model has changed and triggers an instant hot-swap.
   */
  public static async getEngineForCamera(cameraId: number): Promise<IAIEngine> {
    // Check if active model has changed in DB (hot-swap / rollback)
    try {
      const activeModelInDb = await AiModelModel.findOne({ isActive: true }).exec();
      const currentActiveId = activeModelInDb ? activeModelInDb.id : 'yolov8-river-v1.0';
      
      if (this.activeEngine && currentActiveId !== this.activeModelId) {
        console.log(`[AiModelManager] DB active model changed from ${this.activeModelId} to ${currentActiveId}. Triggering auto-rollback/hot-swap.`);
        await this.swapActiveModel(currentActiveId, 'MOCK');
      }
    } catch (err: any) {
      console.warn('[AiModelManager] Failed to check/sync active model from database:', err.message);
    }

    if (!this.activeEngine) {
      await this.initialize();
    }

    try {
      const canarySetting = await SystemSettingsModel.findOne({ key: 'ai.canary' }).exec();
      if (canarySetting && canarySetting.value && canarySetting.value.enabled) {
        const { routingType, cameraIds = [], percentage = 10 } = canarySetting.value;
        let routeToCanary = false;

        if (routingType === 'ODD_EVEN') {
          routeToCanary = (cameraId % 2 !== 0); // odd goes to canary, even to stable
        } else if (routingType === 'PERCENTAGE') {
          // e.g. 10% camera routing by modulo
          routeToCanary = (cameraId % 10 < Math.round(percentage / 10));
        } else {
          // Default to LIST
          routeToCanary = cameraIds.includes(cameraId);
        }

        if (routeToCanary && this.canaryEngine) {
          console.log(`[AiModelManager] Routing Camera #${cameraId} to Canary Engine (${this.canaryModelId}) via ${routingType || 'LIST'}`);
          return this.canaryEngine;
        }
      }
    } catch (err) {
      // Ignored: fallback to default activeEngine
    }

    return this.activeEngine!;
  }

  /**
   * Performs an instant rollback / hot-swap of the active model.
   */
  public static async swapActiveModel(modelId: string, engineType: string): Promise<void> {
    console.log(`[AiModelManager] Hot-swapping active model to: ${modelId} (${engineType})`);
    const newEngine = AIEngineFactory.createEngine(engineType);
    await newEngine.initialize(`/weights/${modelId}.pt`);
    
    this.activeEngine = newEngine;
    this.activeModelId = modelId;
    console.log(`[AiModelManager] Hot-swap completed successfully.`);
  }

  public static getActiveModelId(): string {
    return this.activeModelId || 'yolov8-river-v1.0';
  }
}
