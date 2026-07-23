"use strict";
/**
 * EYECO AI Engine v3.0 — Layer 3: Decision Engine Core
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.decisionEngine = exports.DecisionEngine = void 0;
const ruleBasedStrategy_1 = require("./ruleBasedStrategy");
class DecisionEngine {
    strategy;
    constructor(strategy) {
        this.strategy = strategy || ruleBasedStrategy_1.ruleBasedStrategy;
    }
    setStrategy(strategy) {
        this.strategy = strategy;
    }
    evaluate(featureVector) {
        return this.strategy.evaluate(featureVector);
    }
}
exports.DecisionEngine = DecisionEngine;
exports.decisionEngine = new DecisionEngine();
