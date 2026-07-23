"use strict";
/**
 * EYECO AI Engine v3.0 — Model Trainer Stub (Guardrail #12)
 * Honest stub interface for MLOps retraining pipeline planned for v4.0.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelTrainerStub = exports.ModelTrainerStub = void 0;
class ModelTrainerStub {
    async triggerRetraining() {
        return {
            supported: false,
            status: 'PLANNED_FOR_V4',
            message: 'Training pipeline belum diaktifkan pada EYECO v3.0. Diperlukan minimal 1.000 sampel terverifikasi + quality gate approval.',
        };
    }
}
exports.ModelTrainerStub = ModelTrainerStub;
exports.modelTrainerStub = new ModelTrainerStub();
