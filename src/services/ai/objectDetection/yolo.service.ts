/**
 * EYECO AI Engine v3.0 — Layer 1A: Object Detection (YOLOv8)
 */

import { detectFile } from '../../aiDetection.service';
import { YoloObject } from '../types/ai.types';
import { mapToTrashTaxonomy, isTrashClass } from '../taxonomy/trashTaxonomy';

export class YoloObjectDetector {
  /**
   * Run YOLOv8 Object Detection on an image or video frame
   */
  public async detect(imagePath: string): Promise<{
    objects: YoloObject[];
    imageWidth: number;
    imageHeight: number;
    rawDetectionCount: number;
    confidenceMax: number;
    blurScore?: number;
    qualityStatus?: string;
    extractedFramePath?: string;
  }> {
    const rawResult = await detectFile(imagePath);
    
    const DECISION_MIN_CONF = 0.35;
    const VISUALIZATION_MIN_CONF = 0.20;

    // Map raw boxes to YoloObject with Taxonomy Mapping & Three-Tier Threshold Metadata
    const objects: YoloObject[] = (rawResult.boxes || []).map(b => {
      const rawCls = (b.label || '').toLowerCase();
      // Kenali semua varian person (PERSON_CLASSES dari aiDetection.service)
      const personVariants = ['person', 'cctv persons', 'cctx persons', 'people', 'sitting', 'standing', 'fall-detected', 'orang'];
      const isPerson = personVariants.some(v => rawCls.includes(v));
      const mappedClass = isPerson ? 'person' : (isTrashClass(rawCls) ? mapToTrashTaxonomy(rawCls).id : rawCls);
      
      const acceptedForVisualization = b.confidence >= VISUALIZATION_MIN_CONF;
      const acceptedForDecision = b.confidence >= DECISION_MIN_CONF;
      const rejectionReason = !acceptedForDecision
        ? `BELOW_DECISION_THRESHOLD_${Math.round(DECISION_MIN_CONF * 100)}`
        : undefined;

      return {
        class: mappedClass,
        confidence: b.confidence,
        bbox: [b.x, b.y, b.x + b.w, b.y + b.h],
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        acceptedForVisualization,
        acceptedForDecision,
        rejectionReason
      };
    });

    const confidences = objects.map(o => o.confidence);
    const confidenceMax = confidences.length > 0 ? Math.max(...confidences) : 0;

    return {
      objects,
      imageWidth: 100, // percentage normalized
      imageHeight: 100,
      rawDetectionCount: objects.length,
      confidenceMax: Math.round(confidenceMax * 100),
      blurScore: rawResult.blurScore,
      qualityStatus: rawResult.qualityStatus,
      extractedFramePath: rawResult.extractedFramePath,
    };
  }
}

export const yoloObjectDetector = new YoloObjectDetector();
