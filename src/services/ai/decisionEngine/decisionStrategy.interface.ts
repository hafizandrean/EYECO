import { FeatureVector, DecisionResult } from '../types/ai.types';

export interface IDecisionStrategy {
  evaluate(featureVector: FeatureVector): DecisionResult;
}
