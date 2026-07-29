import { IAIEngine } from './IAIEngine';
import { MockAIEngine } from './MockAIEngine';
import { OnnxAIEngine } from './OnnxAIEngine';
import { FastApiAIEngine } from './FastApiAIEngine';
import { LocalPythonAIEngine } from './LocalPythonAIEngine';

export class AIEngineFactory {
  public static createEngine(type: string): IAIEngine {
    const normalized = (type || 'LOCAL_PYTHON').toUpperCase();
    switch (normalized) {
      case 'ONNX':
        return new OnnxAIEngine();
      case 'FASTAPI':
        return new FastApiAIEngine();
      case 'LOCAL_PYTHON':
        return new LocalPythonAIEngine();
      case 'MOCK':
        return new MockAIEngine();
      default:
        return new LocalPythonAIEngine();
    }
  }
}
