/**
 * File-based message queue for leader-worker communication.
 * Ported from OpenHarness swarm/mailbox.py
 *
 * Each message is stored as an individual JSON file:
 *   ~/.haxagent/teams/<team>/agents/<agent_id>/inbox/<timestamp>_<id>.json
 *
 * Atomic writes use a .tmp file followed by fs.rename.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { exclusiveFileLock } from "../utils/file-lock.js";

const MessageType = {
  USER_MESSAGE: "user_message",
  PERMISSION_REQUEST: "permission_request",
  PERMISSION_RESPONSE: "permission_response",
  SANDBOX_PERMISSION_REQUEST: "sandbox_permission_request",
  SANDBOX_PERMISSION_RESPONSE: "sandbox_permission_response",
  SHUTDOWN: "shutdown",
  IDLE_NOTIFICATION: "idle_notification",
};

class MailboxMessage {
  constructor(o = {}) {
    this.id = o.id || _uuid();
    this.type = o.type || MessageType.USER_MESSAGE;
    this.sender = o.sender || "";
    this.recipient = o.recipient || "";
    this.payload = o.payload || {};
    this.timestamp = o.timestamp || Date.now() / 1000;
    this.read = !!o.read;
  }
  toJSON() { return { id: this.id, type: this.type, sender: this.sender, recipient: this.recipient, payload: this.payload, timestamp: this.timestamp, read: this.read }; }
  static fromJSON(d) { return new MailboxMessage(d); }
}

function _uuid() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }

function getTeamDir(teamName) {
  const dir = path.join(os.homedir(), ".haxagent", "teams", teamName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getAgentMailboxDir(teamName, agentId) {
  const dir = path.join(getTeamDir(teamName), "agents", agentId, "inbox");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

class TeammateMailbox {
  constructor(teamName, agentId) {
    this.teamName = teamName;
    this.agentId = agentId;
  }

  getMailboxDir() { return getAgentMailboxDir(this.teamName, this.agentId); }

  write(msg) {
    const inbox = this.getMailboxDir();
    const filename = `${msg.timestamp.toFixed(6)}_${msg.id}.json`;
    const finalPath = path.join(inbox, filename);
    const tmpPath = path.join(inbox, `${filename}.tmp`);
    const lockPath = path.join(inbox, ".write_lock");
    const payload = JSON.stringify(msg.toJSON(), null, 2);
    exclusiveFileLock(lockPath, () => {
      fs.writeFileSync(tmpPath, payload, "utf-8");
      fs.renameSync(tmpPath, finalPath);
    });
  }

  readAll(unreadOnly = true) {
    const inbox = this.getMailboxDir();
    const messages = [];
    for (const f of fs.readdirSync(inbox).sort()) {
      if (f.startsWith(".") || f.endsWith(".tmp")) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(inbox, f), "utf-8"));
        const msg = MailboxMessage.fromJSON(data);
        if (!unreadOnly || !msg.read) messages.push(msg);
      } catch (_) {}
    }
    return messages;
  }

  markRead(messageId) {
    const inbox = this.getMailboxDir();
    const lockPath = path.join(inbox, ".write_lock");
    exclusiveFileLock(lockPath, () => {
      for (const f of fs.readdirSync(inbox)) {
        if (f.startsWith(".") || f.endsWith(".tmp")) continue;
        const fp = path.join(inbox, f);
        try {
          const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
          if (data.id === messageId) {
            data.read = true;
            const tmpPath = fp + ".tmp";
            fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
            fs.renameSync(tmpPath, fp);
            return;
          }
        } catch (_) {}
      }
    });
  }

  clear() {
    const inbox = this.getMailboxDir();
    const lockPath = path.join(inbox, ".write_lock");
    exclusiveFileLock(lockPath, () => {
      for (const f of fs.readdirSync(inbox)) {
        if (f.startsWith(".")) continue;
        try { fs.unlinkSync(path.join(inbox, f)); } catch (_) {}
      }
    });
  }
}

// Factory helpers
function createUserMessage(sender, recipient, content) {
  return new MailboxMessage({ type: MessageType.USER_MESSAGE, sender, recipient, payload: { content }, timestamp: Date.now() / 1000 });
}
function createShutdownRequest(sender, recipient) {
  return new MailboxMessage({ type: MessageType.SHUTDOWN, sender, recipient, payload: {}, timestamp: Date.now() / 1000 });
}
function createPermissionRequest(sender, recipient, requestData) {
  return new MailboxMessage({ type: MessageType.PERMISSION_REQUEST, sender, recipient, payload: { type: "permission_request", ...requestData }, timestamp: Date.now() / 1000 });
}
function createPermissionResponse(sender, recipient, responseData) {
  return new MailboxMessage({ type: MessageType.PERMISSION_RESPONSE, sender, recipient, payload: { type: "permission_response", ...responseData }, timestamp: Date.now() / 1000 });
}

export {
  MessageType, MailboxMessage, TeammateMailbox,
  getTeamDir, getAgentMailboxDir,
  createUserMessage, createShutdownRequest, createPermissionRequest, createPermissionResponse,
};
