import { IAIEngine } from './IAIEngine';
import { MockAIEngine } from './MockAIEngine';
import { OnnxAIEngine } from './OnnxAIEngine';
import { FastApiAIEngine } from './FastApiAIEngine';

export class AIEngineFactory {
  public static createEngine(type: string): IAIEngine {
    const normalized = (type || 'MOCK').toUpperCase();
    switch (normalized) {
      case 'ONNX':
        return new OnnxAIEngine();
      case 'FASTAPI':
        return new FastApiAIEngine();
      default:
        return new MockAIEngine();
    }
  }
}
