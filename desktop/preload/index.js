"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const agent = {
  createSession(options) {
    return ipcRenderer.invoke("agent:createSession", options);
  },

  resumeSession(payload) {
    return ipcRenderer.invoke("agent:resumeSession", payload);
  },

  sendMessage(payload) {
    return ipcRenderer.invoke("agent:sendMessage", payload);
  },

  interrupt(payload) {
    return ipcRenderer.invoke("agent:interrupt", payload);
  },

  onEvent(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("agent.onEvent requires a listener function");
    }

    const wrapped = (_event, agentEvent) => listener(agentEvent);
    ipcRenderer.on("agent:event", wrapped);

    return () => {
      ipcRenderer.removeListener("agent:event", wrapped);
    };
  },
};

const settings = {
  get(options) {
    return ipcRenderer.invoke("settings:get", options);
  },

  update(updates) {
    return ipcRenderer.invoke("settings:update", updates);
  },
};

const workspace = {
  getSnapshot(options) {
    return ipcRenderer.invoke("workspace:getSnapshot", options);
  },
};

contextBridge.exposeInMainWorld("haxAgent", {
  agent,
  settings,
  workspace,
  createSession: agent.createSession,
  resumeSession: agent.resumeSession,
  sendMessage: agent.sendMessage,
  interrupt: agent.interrupt,
  onAgentEvent: agent.onEvent,
  getSettings: settings.get,
  updateSettings: settings.update,
  getWorkspaceSnapshot: workspace.getSnapshot,
});
