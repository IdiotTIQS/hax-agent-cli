import { ChannelAdapter } from "../adapter.js";
import type { SendMessage, SendResult } from "../adapter.js";

class MatrixAdapter extends ChannelAdapter {
  constructor(cfg: Record<string, unknown> = {}) { super({ name: "matrix", ...cfg }); }
  async send(_target: string | null, _message: SendMessage): Promise<SendResult> {
    return { ok: false, error: "Matrix adapter requires external API configuration" };
  }
}

export { MatrixAdapter };
