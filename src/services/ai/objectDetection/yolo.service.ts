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
  }> {
    const rawResult = await detectFile(imagePath);
    
    // Map raw boxes to YoloObject with Taxonomy Mapping
    const objects: YoloObject[] = (rawResult.boxes || []).map(b => {
      const rawCls = (b.label || '').toLowerCase();
      // Kenali semua varian person (PERSON_CLASSES dari aiDetection.service)
      const personVariants = ['person', 'cctv persons', 'cctx persons', 'people', 'sitting', 'standing', 'fall-detected', 'orang'];
      const isPerson = personVariants.some(v => rawCls.includes(v));
      const mappedClass = isPerson ? 'person' : (isTrashClass(rawCls) ? mapToTrashTaxonomy(rawCls).id : rawCls);
      return {
        class: mappedClass,
        confidence: b.confidence,
        bbox: [b.x, b.y, b.x + b.w, b.y + b.h],
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h
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
    };
  }
}

export const yoloObjectDetector = new YoloObjectDetector();
