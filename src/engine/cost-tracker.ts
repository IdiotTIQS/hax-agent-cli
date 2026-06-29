import { getCost } from "../pricing.js";

interface TurnRecord {
  model: string;
  input: number;
  output: number;
  cost: number;
  timestamp: number;
}

class CostTracker {
  _turns: TurnRecord[];
  _totalInput: number;
  _totalOutput: number;

  constructor() { this._turns = []; this._totalInput = 0; this._totalOutput = 0; }

  recordTurn(model: string, input: number, output: number) {
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
export { CostTracker };
