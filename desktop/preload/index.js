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

  chooseDirectory(options) {
    return ipcRenderer.invoke("workspace:chooseDirectory", options);
  },

  search(options) {
    return ipcRenderer.invoke("workspace:search", options);
  },

  readFile(options) {
    return ipcRenderer.invoke("workspace:readFile", options);
  },
};

const skills = {
  getSnapshot(options) {
    return ipcRenderer.invoke("skills:getSnapshot", options);
  },
};

const tools = {
  getSnapshot(options) {
    return ipcRenderer.invoke("tools:getSnapshot", options);
  },
};

const permissions = {
  getSnapshot(options) {
    return ipcRenderer.invoke("permissions:getSnapshot", options);
  },

  respondApproval(payload) {
    return ipcRenderer.invoke("approval:respond", payload);
  },

  onApprovalRequest(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("permissions.onApprovalRequest requires a listener function");
    }

    const wrapped = (_event, approvalRequest) => listener(approvalRequest);
    ipcRenderer.on("approval:request", wrapped);

    return () => {
      ipcRenderer.removeListener("approval:request", wrapped);
    };
  },
};

const team = {
  getSnapshot(options) {
    return ipcRenderer.invoke("team:getSnapshot", options);
  },
};

const git = {
  getDiff(options) {
    return ipcRenderer.invoke("git:getDiff", options);
  },
};

const shell = {
  openExternal(url) {
    return ipcRenderer.invoke("shell:openExternal", url);
  },
};

contextBridge.exposeInMainWorld("haxAgent", {
  agent,
  settings,
  workspace,
  skills,
  tools,
  permissions,
  team,
  shell,
  createSession: agent.createSession,
  resumeSession: agent.resumeSession,
  sendMessage: agent.sendMessage,
  interrupt: agent.interrupt,
  onAgentEvent: agent.onEvent,
  getSettings: settings.get,
  updateSettings: settings.update,
  getWorkspaceSnapshot: workspace.getSnapshot,
  chooseWorkspaceDirectory: workspace.chooseDirectory,
  searchWorkspace: workspace.search,
  readWorkspaceFile: workspace.readFile,
  getSkillsSnapshot: skills.getSnapshot,
  getToolsSnapshot: tools.getSnapshot,
  getPermissionsSnapshot: permissions.getSnapshot,
  respondApproval: permissions.respondApproval,
  onApprovalRequest: permissions.onApprovalRequest,
  getTeamSnapshot: team.getSnapshot,
  getGitDiff: git.getDiff,
  openExternal: shell.openExternal,
});
