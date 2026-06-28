"use strict";
const { getCost } = require("../pricing");

class CostTracker {
  constructor() { this._turns = []; this._totalInput = 0; this._totalOutput = 0; }

  recordTurn(model, input, output) {
    this._totalInput += input;
    this._totalOutput += output;
    const cost = getCost(model, input, output);
    this._turns.push({ model, input, output, cost, timestamp: Date.now() });
    return cost;
  }

  get summary() {
    return {
      turns: this._turns.length,
      totalInput: this._totalInput,
      totalOutput: this._totalOutput,
      totalCost: this._turns.reduce((s, t) => s + t.cost, 0).toFixed(6),
    };
  }
}
module.exports = { CostTracker };
