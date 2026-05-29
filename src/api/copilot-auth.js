"use strict";
class CopilotAuth { constructor(o={}) { this._token=o.token||null; this._deviceCode=null; }
  async authenticate() { return { ok:false, error:"GitHub Copilot OAuth requires interactive browser authentication" }; }
  get isAuthenticated() { return !!this._token; }
}
module.exports = { CopilotAuth };
