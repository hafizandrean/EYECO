import { IAIEngine } from './IAIEngine';
import { AIEngineFactory } from './AIEngineFactory';
import { AiModelModel } from '../../database/models/AiModel';
import { SystemSettingsModel } from '../../database/models/SystemSettings';
import crypto from 'crypto';

export class AiModelManager {
  private static activeEngine: IAIEngine | null = null;
  private static activeModelId: string | null = null;

  private static canaryEngine: IAIEngine | null = null;
  private static canaryModelId: string | null = null;

  // Distributed Lock state
  private static instanceId = crypto.randomUUID();
  private static heartbeatTimer: NodeJS.Timeout | null = null;
  private static lastFailedSwap = { modelId: '', engineType: '', timestamp: 0 };

  /**
   * Initializes the active AI engines and runs warm-up cycles.
   */
  public static async initialize(): Promise<void> {
    try {
      // 1. Fetch the primary active model from the registry
      const activeModel = await AiModelModel.findOne({ isActive: true }).exec();
      const modelId = activeModel ? activeModel.id : 'yolov8-river-v1.0';
      
      // Get active AI engine type from system settings
      const engineSetting = await SystemSettingsModel.findOne({ key: 'ai.engine' }).exec();
      const engineType = engineSetting ? (engineSetting.value as string) : 'MOCK';
      
      console.log(`[AiModelManager] Loading active model registry: ${modelId} via engine: ${engineType}`);
      
      this.activeModelId = modelId;
      this.activeEngine = AIEngineFactory.createEngine(engineType);
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
      
      const engineSetting = await SystemSettingsModel.findOne({ key: 'ai.engine' }).exec();
      const engineType = engineSetting ? (engineSetting.value as string) : 'MOCK';
      
      // Check if engine name contains type to confirm match
      const engineName = this.activeEngine ? this.activeEngine.name.toUpperCase() : '';
      const isEngineMatch = engineName.includes(engineType.toUpperCase()) || 
                            (engineType === 'FASTAPI' && engineName.includes('FASTAPI'));

      if (this.activeEngine && (currentActiveId !== this.activeModelId || !isEngineMatch)) {
        // Prevent infinite reload loops on failed engine swaps (e.g. FastAPI server offline)
        const isRecentlyFailed = this.lastFailedSwap.modelId === currentActiveId && 
                                 this.lastFailedSwap.engineType === engineType &&
                                 (Date.now() - this.lastFailedSwap.timestamp < 60000); // 1-minute backoff
                                 
        if (!isRecentlyFailed) {
          try {
            console.log(`[AiModelManager] active model/engine changed. Swapping to: ${currentActiveId} (${engineType})`);
            await this.swapActiveModel(currentActiveId, engineType);
          } catch (swapErr: any) {
            console.warn(`[AiModelManager] Failed to hot-swap to ${currentActiveId} (${engineType}), backing off for 1 minute:`, swapErr.message);
            this.lastFailedSwap = {
              modelId: currentActiveId,
              engineType: engineType,
              timestamp: Date.now()
            };
          }
        }
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
   * Performs an instant rollback / hot-swap of the active model under a distributed deployment lock.
   */
  public static async swapActiveModel(modelId: string, engineType: string): Promise<void> {
    console.log(`[AiModelManager] Hot-swapping active model to: ${modelId} (${engineType})`);
    
    // Acquire distributed lock 'ai.deployment.lock'
    const now = new Date();
    let currentToken = 0;
    
    try {
      const currentLock = await SystemSettingsModel.findOne({ key: 'ai.deployment.lock' }).exec();
      if (currentLock && currentLock.value) {
        currentToken = currentLock.value.fencingToken || 0;
      }
    } catch (err) {
      // fallback to token 0
    }
    
    const nextToken = currentToken + 1;
    
    const lockAcquired = await SystemSettingsModel.findOneAndUpdate(
      {
        key: 'ai.deployment.lock',
        $or: [
          { 'value.locked': false },
          { 'value.expiresAt': { $lt: now } }
        ]
      },
      {
        $set: {
          value: {
            locked: true,
            lockedBy: this.instanceId,
            fencingToken: nextToken,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5-minute lease expiry
            heartbeatAt: new Date()
          }
        }
      },
      { returnDocument: 'after' }
    ).exec();

    if (!lockAcquired) {
      throw new Error('DEPLOYMENT_LOCKED: Another deployment process is currently active.');
    }

    // Start distributed lock heartbeat (30s interval)
    this.heartbeatTimer = setInterval(async () => {
      try {
        await SystemSettingsModel.updateOne(
          {
            key: 'ai.deployment.lock',
            'value.lockedBy': this.instanceId,
            'value.fencingToken': nextToken
          },
          {
            $set: {
              'value.expiresAt': new Date(Date.now() + 5 * 60 * 1000),
              'value.heartbeatAt': new Date()
            }
          }
        ).exec();
      } catch (err) {
        console.warn('[AiModelManager] Heartbeat renewal for deployment lock failed:', err);
      }
    }, 30000);

    try {
      const newEngine = AIEngineFactory.createEngine(engineType);
      await newEngine.initialize(`/weights/${modelId}.pt`);
      
      this.activeEngine = newEngine;
      this.activeModelId = modelId;
      console.log(`[AiModelManager] Hot-swap completed successfully.`);
    } finally {
      // Clear heartbeat timer
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      
      // Release distributed lock
      try {
        await SystemSettingsModel.updateOne(
          { 
            key: 'ai.deployment.lock', 
            'value.lockedBy': this.instanceId 
          },
          {
            $set: {
              'value.locked': false,
              'value.lockedBy': null,
              'value.expiresAt': null,
              'value.heartbeatAt': null
            }
          }
        ).exec();
        console.log('[AiModelManager] Distributed deployment lock released.');
      } catch (releaseErr) {
        console.error('[AiModelManager] Failed to release distributed deployment lock:', releaseErr);
      }
    }
  }

  public static getActiveModelId(): string {
    return this.activeModelId || 'yolov8-river-v1.0';
  }
}
