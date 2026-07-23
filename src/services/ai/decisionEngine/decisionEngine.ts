/**
 * EYECO AI Engine v3.0 — Layer 3: Decision Engine Core
 */

import { IDecisionStrategy } from './decisionStrategy.interface';
import { ruleBasedStrategy } from './ruleBasedStrategy';
import { FeatureVector, DecisionResult } from '../types/ai.types';

export class DecisionEngine {
  private strategy: IDecisionStrategy;

  constructor(strategy?: IDecisionStrategy) {
    this.strategy = strategy || ruleBasedStrategy;
  }

  public setStrategy(strategy: IDecisionStrategy): void {
    this.strategy = strategy;
  }

  public evaluate(featureVector: FeatureVector): DecisionResult {
    return this.strategy.evaluate(featureVector);
  }
}

export const decisionEngine = new DecisionEngine();
