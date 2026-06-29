import { ChannelAdapter } from "../adapter.js";
class MochatAdapter extends ChannelAdapter { constructor(cfg) { super({ name: "mochat", ...cfg }); } async send(target, message) { return { ok: false, error: "Mochat adapter requires Mochat server configuration" }; } }
export { MochatAdapter };
