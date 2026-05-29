"use strict";
class CostTracker { constructor() { this._turns=[]; this._totalInput=0; this._totalOutput=0; 
  this._pricing={anthropic:{input:3,output:15},openai:{input:2.5,output:10},deepseek:{input:0.14,output:0.28}}; }
  recordTurn(model,input,output) { this._totalInput+=input; this._totalOutput+=output; 
    const provider=model.includes("claude")?"anthropic":model.includes("gpt")?"openai":"deepseek";
    const p=this._pricing[provider]||{input:1,output:5};
    const cost=(input*p.input+output*p.output)/1000000;
    this._turns.push({model,input,output,cost,timestamp:Date.now()}); return cost; }
  get summary() { return {turns:this._turns.length,totalInput:this._totalInput,totalOutput:this._totalOutput,totalCost:this._turns.reduce((s,t)=>s+t.cost,0).toFixed(6)}; }
}
module.exports = { CostTracker };
