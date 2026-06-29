class UsageTracker {
  private _inputTokens: number;
  private _outputTokens: number;
  private _requests: number;
  private _cost: number;

  constructor() {
    this._inputTokens = 0;
    this._outputTokens = 0;
    this._requests = 0;
    this._cost = 0;
  }

  track(input: number, output: number, _model?: string): this {
    this._inputTokens += input || 0;
    this._outputTokens += output || 0;
    this._requests++;
    return this;
  }

  get total() {
    return {
      inputTokens: this._inputTokens,
      outputTokens: this._outputTokens,
      totalTokens: this._inputTokens + this._outputTokens,
      requests: this._requests,
      cost: this._cost,
    };
  }

  reset(): void {
    this._inputTokens = 0;
    this._outputTokens = 0;
    this._requests = 0;
    this._cost = 0;
  }
}

export { UsageTracker };
