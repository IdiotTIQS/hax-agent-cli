/**
 * File-based message queue for leader-worker communication.
 * Ported from OpenHarness swarm/mailbox.py
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
} as const;

interface MailboxMessageOptions {
  id?: string;
  type?: string;
  sender?: string;
  recipient?: string;
  payload?: Record<string, unknown>;
  timestamp?: number;
  read?: boolean;
}

interface MailboxMessageJSON {
  id: string;
  type: string;
  sender: string;
  recipient: string;
  payload: Record<string, unknown>;
  timestamp: number;
  read: boolean;
}

class MailboxMessage {
  id: string;
  type: string;
  sender: string;
  recipient: string;
  payload: Record<string, unknown>;
  timestamp: number;
  read: boolean;

  constructor(o: MailboxMessageOptions = {}) {
    this.id = o.id || _uuid();
    this.type = o.type || MessageType.USER_MESSAGE;
    this.sender = o.sender || "";
    this.recipient = o.recipient || "";
    this.payload = o.payload || {};
    this.timestamp = o.timestamp || Date.now() / 1000;
    this.read = !!o.read;
  }

  toJSON(): MailboxMessageJSON {
    return {
      id: this.id, type: this.type, sender: this.sender,
      recipient: this.recipient, payload: this.payload,
      timestamp: this.timestamp, read: this.read,
    };
  }

  static fromJSON(d: MailboxMessageOptions): MailboxMessage { return new MailboxMessage(d); }
}

function _uuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getTeamDir(teamName: string): string {
  const dir = path.join(os.homedir(), ".haxagent", "teams", teamName);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getAgentMailboxDir(teamName: string, agentId: string): string {
  const dir = path.join(getTeamDir(teamName), "agents", agentId, "inbox");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

class TeammateMailbox {
  private teamName: string;
  private agentId: string;

  constructor(teamName: string, agentId: string) {
    this.teamName = teamName;
    this.agentId = agentId;
  }

  getMailboxDir(): string { return getAgentMailboxDir(this.teamName, this.agentId); }

  write(msg: MailboxMessage): void {
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

  readAll(unreadOnly = true): MailboxMessage[] {
    const inbox = this.getMailboxDir();
    const messages: MailboxMessage[] = [];
    for (const f of fs.readdirSync(inbox).sort()) {
      if (f.startsWith(".") || f.endsWith(".tmp")) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(inbox, f), "utf-8")) as MailboxMessageOptions;
        const msg = MailboxMessage.fromJSON(data);
        if (!unreadOnly || !msg.read) messages.push(msg);
      } catch (_) {}
    }
    return messages;
  }

  markRead(messageId: string): void {
    const inbox = this.getMailboxDir();
    const lockPath = path.join(inbox, ".write_lock");
    exclusiveFileLock(lockPath, () => {
      for (const f of fs.readdirSync(inbox)) {
        if (f.startsWith(".") || f.endsWith(".tmp")) continue;
        const fp = path.join(inbox, f);
        try {
          const data = JSON.parse(fs.readFileSync(fp, "utf-8")) as MailboxMessageJSON;
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

  clear(): void {
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

function createUserMessage(sender: string, recipient: string, content: string): MailboxMessage {
  return new MailboxMessage({ type: MessageType.USER_MESSAGE, sender, recipient, payload: { content }, timestamp: Date.now() / 1000 });
}
function createShutdownRequest(sender: string, recipient: string): MailboxMessage {
  return new MailboxMessage({ type: MessageType.SHUTDOWN, sender, recipient, payload: {}, timestamp: Date.now() / 1000 });
}
function createPermissionRequest(sender: string, recipient: string, requestData: Record<string, unknown>): MailboxMessage {
  return new MailboxMessage({ type: MessageType.PERMISSION_REQUEST, sender, recipient, payload: { type: "permission_request", ...requestData }, timestamp: Date.now() / 1000 });
}
function createPermissionResponse(sender: string, recipient: string, responseData: Record<string, unknown>): MailboxMessage {
  return new MailboxMessage({ type: MessageType.PERMISSION_RESPONSE, sender, recipient, payload: { type: "permission_response", ...responseData }, timestamp: Date.now() / 1000 });
}

export {
  MessageType, MailboxMessage, TeammateMailbox,
  getTeamDir, getAgentMailboxDir,
  createUserMessage, createShutdownRequest, createPermissionRequest, createPermissionResponse,
};
