"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VerificationRule = void 0;
const AiVerificationState_1 = require("../../database/models/AiVerificationState");
class VerificationRule {
    name = 'Verification Window';
    async evaluate(detection, context) {
        try {
            // Cari state verifikasi objek berdasarkan kombinasi kamera dan kelas deteksi
            let state = await AiVerificationState_1.AiVerificationStateModel.findOne({
                cameraId: detection.cameraId,
                lastDetectedClass: context.mainClass
            });
            if (state) {
                state.consecutiveFrames += 1;
                state.updatedAt = new Date();
                await state.save();
            }
            else {
                state = await AiVerificationState_1.AiVerificationStateModel.create({
                    cameraId: detection.cameraId,
                    trackingId: detection.trackingId,
                    consecutiveFrames: 1,
                    lastDetectedClass: context.mainClass,
                    updatedAt: new Date()
                });
            }
            const requiredFrames = context.settings.verificationFrames;
            if (state.consecutiveFrames < requiredFrames) {
                return {
                    success: false,
                    reason: `WAITING_VERIFICATION: Object verified for ${state.consecutiveFrames}/${requiredFrames} frames.`
                };
            }
            return { success: true };
        }
        catch (err) {
            console.error('[VerificationRule] Error evaluating verification window:', err.message);
            return { success: false, reason: `VERIFICATION_ERROR: ${err.message}` };
        }
    }
}
exports.VerificationRule = VerificationRule;
