/**
 * EYECO AI Engine v3.0 — Model Trainer Stub (Guardrail #12)
 * Honest stub interface for MLOps retraining pipeline planned for v4.0.
 */

export class ModelTrainerStub {
  public async triggerRetraining(): Promise<{
    supported: false;
    status: 'PLANNED_FOR_V4';
    message: string;
  }> {
    return {
      supported: false,
      status: 'PLANNED_FOR_V4',
      message: 'Training pipeline belum diaktifkan pada EYECO v3.0. Diperlukan minimal 1.000 sampel terverifikasi + quality gate approval.',
    };
  }
}

export const modelTrainerStub = new ModelTrainerStub();
