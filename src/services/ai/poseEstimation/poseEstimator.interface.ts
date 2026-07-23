import { PersonPose } from '../types/ai.types';

export interface IPoseEstimator {
  estimate(imagePath: string, personBoxes: Array<{ x: number; y: number; w: number; h: number }>): Promise<{
    poses: PersonPose[];
    available: boolean;
    error?: string;
  }>;
}
