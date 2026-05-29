"use strict";
const { ChannelAdapter } = require("../adapter");
class MochatAdapter extends ChannelAdapter { constructor(cfg) { super({ name: "mochat", ...cfg }); } async send(target, message) { return { ok: false, error: "Mochat adapter requires Mochat server configuration" }; } }
module.exports = { MochatAdapter };
