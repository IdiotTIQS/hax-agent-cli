const remoteTriggerTool = {
  name: "remote_trigger", description: "Trigger a remote agent or workflow execution.", inputSchema: { type: "object", required: ["url"], properties: { url: { type: "string" }, method: { type: "string", default: "POST" }, body: { type: "object" }, headers: { type: "object" } } },
  isReadOnly: () => false,
  async execute(args) { try { const r = await fetch(args.url, { method: args.method || "POST", headers: { "Content-Type": "application/json", ...(args.headers || {}) }, body: args.body ? JSON.stringify(args.body) : undefined }); return { ok: true, data: { status: r.status, ok: r.ok } }; } catch (err) { return { ok: false, error: { code: "TRIGGER_ERROR", message: err.message } }; } }
};
export { remoteTriggerTool };
