import { IPromotionRule, RuleContext } from './PromotionRule';
import { IAiDetection } from '../../database/models/AiDetection';
import { AiVerificationStateModel } from '../../database/models/AiVerificationState';

export class VerificationRule implements IPromotionRule {
  public name = 'Verification Window';

  public async evaluate(detection: IAiDetection, context: RuleContext): Promise<{ success: boolean; reason?: string }> {
    try {
      // Cari state verifikasi objek berdasarkan kombinasi kamera dan kelas deteksi
      let state = await AiVerificationStateModel.findOne({
        cameraId: detection.cameraId,
        lastDetectedClass: context.mainClass
      });

      if (state) {
        state.consecutiveFrames += 1;
        state.updatedAt = new Date();
        await state.save();
      } else {
        state = await AiVerificationStateModel.create({
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
    } catch (err: any) {
      console.error('[VerificationRule] Error evaluating verification window:', err.message);
      return { success: false, reason: `VERIFICATION_ERROR: ${err.message}` };
    }
  }
}
