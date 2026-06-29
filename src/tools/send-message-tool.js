/**
 * SendMessage Tool — inter-agent message passing.
 * Ported from OpenHarness tools/send_message_tool.py
 *
 * Supports:
 * - Direct messages (type: "message")
 * - Broadcast to all teammates (type: "broadcast")
 * - Shutdown requests (type: "shutdown_request")
 * - Named recipients and task-ID format (name@team)
 */

// === Message Store ===

/**
 * In-memory message queue for inter-agent communication.
 * In a production system, this would be a database or IPC mechanism.
 */
class AgentMessageStore {
  constructor() {
    this._queues = new Map(); // agentName → messages[]
    this._callbacks = new Map(); // agentName → callback fn
  }

  /**
   * Send a message to an agent's queue.
   */
  send(recipient, message) {
    if (!this._queues.has(recipient)) {
      this._queues.set(recipient, []);
    }
    this._queues.get(recipient).push({
      ...message,
      receivedAt: Date.now(),
    });

    // Notify callback if registered
    const cb = this._callbacks.get(recipient);
    if (cb) {
      try { cb(message); } catch (_) {}
    }
  }

  /**
   * Listen for messages for a specific agent.
   */
  onMessage(agentName, callback) {
    this._callbacks.set(agentName, callback);
  }

  /**
   * Get pending messages for an agent.
   */
  getPending(agentName, clear = true) {
    const queue = this._queues.get(agentName) || [];
    if (clear) {
      this._queues.delete(agentName);
    }
    return queue;
  }

  /**
   * Get count of pending messages.
   */
  pendingCount(agentName) {
    return (this._queues.get(agentName) || []).length;
  }
}

// Singleton message store
const messageStore = new AgentMessageStore();

// === Message Types ===

const SendMessageType = {
  MESSAGE: "message",
  BROADCAST: "broadcast",
  SHUTDOWN_REQUEST: "shutdown_request",
};

// === SendMessage Tool ===

const sendMessageTool = {
  name: "send_message",
  description:
    "Send a message to another agent or broadcast to all teammates. " +
    "Use this for inter-agent coordination, task delegation, and team communication. " +
    "Message types: message (direct DM), broadcast (to all), shutdown_request (end agent).",
  inputSchema: {
    type: "object",
    required: ["type", "content"],
    properties: {
      type: {
        type: "string",
        enum: ["message", "broadcast", "shutdown_request"],
        description: "Message type: message (direct), broadcast (to all), shutdown_request (end agent)",
      },
      recipient: {
        type: "string",
        description: "Recipient agent name (required for 'message' and 'shutdown_request'). Supports name@team format.",
      },
      content: {
        type: "string",
        description: "The message content to send",
      },
      summary: {
        type: "string",
        description: "A 5-10 word summary shown as a preview (for message and broadcast types)",
      },
      request_id: {
        type: "string",
        description: "Request ID to respond to (for shutdown_response type)",
      },
    },
  },

  isReadOnly: () => false,

  /**
   * Execute the send_message tool.
   */
  async execute(args, ctx) {
    const type = args.type || SendMessageType.MESSAGE;
    const content = args.content || "";
    const recipient = args.recipient || "";
    const summary = args.summary || "";

    // Get sender info from context
    const sender = ctx.agentId || ctx.sessionId || "main";

    const message = {
      type,
      sender,
      content: content.slice(0, 50000),
      summary: summary || content.slice(0, 50),
      timestamp: Date.now(),
    };

    switch (type) {
      case SendMessageType.MESSAGE:
        return _handleDirectMessage(sender, recipient, message);

      case SendMessageType.BROADCAST:
        return _handleBroadcast(sender, message);

      case SendMessageType.SHUTDOWN_REQUEST:
        return _handleShutdownRequest(sender, recipient, message, args);

      default:
        return {
          ok: false,
          error: {
            code: "INVALID_MESSAGE_TYPE",
            message: `Unknown message type: ${type}. Supported: message, broadcast, shutdown_request`,
          },
        };
    }
  },

  /**
   * Get pending messages for the current agent.
   */
  getPendingMessages(agentId) {
    return messageStore.getPending(agentId);
  },

  /**
   * Check for pending messages.
   */
  hasPendingMessages(agentId) {
    return messageStore.pendingCount(agentId) > 0;
  },
};

/**
 * Handle a direct message to a named recipient.
 */
function _handleDirectMessage(sender, recipient, message) {
  if (!recipient) {
    return {
      ok: false,
      error: {
        code: "MISSING_RECIPIENT",
        message: "Recipient name is required for direct messages",
      },
    };
  }

  // Parse name@team format
  const { agentName, teamName } = _parseRecipient(recipient);
  message.recipient = agentName;
  message.team = teamName;

  // Send to queue
  messageStore.send(agentName, message);

  return {
    ok: true,
    data: {
      type: "message",
      recipient: agentName,
      team: teamName,
      summary: message.summary,
      status: "delivered",
      message: `Message delivered to "${agentName}"${teamName ? ` in team "${teamName}"` : ""}.`,
    },
  };
}

/**
 * Handle a broadcast to all agents.
 */
function _handleBroadcast(sender, message) {
  // Broadcast: send to all known agents in the message store
  const recipients = [];
  for (const [name] of messageStore._queues) {
    if (name !== sender) {
      messageStore.send(name, { ...message, type: "broadcast" });
      recipients.push(name);
    }
  }

  return {
    ok: true,
    data: {
      type: "broadcast",
      recipients,
      count: recipients.length,
      summary: message.summary,
      status: "delivered",
      message: `Broadcast delivered to ${recipients.length} agent(s).`,
    },
  };
}

/**
 * Handle a shutdown request to a specific agent.
 */
function _handleShutdownRequest(sender, recipient, message, args) {
  if (!recipient) {
    return {
      ok: false,
      error: {
        code: "MISSING_RECIPIENT",
        message: "Recipient name is required for shutdown requests",
      },
    };
  }

  const { agentName, teamName } = _parseRecipient(recipient);
  message.recipient = agentName;
  message.type = "shutdown_request";
  message.requestId = args.request_id || `shutdown_${Date.now().toString(36)}`;

  messageStore.send(agentName, message);

  return {
    ok: true,
    data: {
      type: "shutdown_request",
      recipient: agentName,
      requestId: message.requestId,
      status: "requested",
      message: `Shutdown requested for "${agentName}". Waiting for response.`,
    },
  };
}

/**
 * Parse a recipient string in "name@team" format.
 */
function _parseRecipient(recipient) {
  const atIndex = recipient.lastIndexOf("@");
  if (atIndex > 0) {
    return {
      agentName: recipient.slice(0, atIndex),
      teamName: recipient.slice(atIndex + 1),
    };
  }
  return { agentName: recipient, teamName: null };
}

// === Team Message Coordination ===

/**
 * Team-level message coordination.
 * Routes messages between team members and tracks team state.
 */
class TeamMessageCoordinator {
  constructor(teamName) {
    this.teamName = teamName;
    this.members = new Set();
  }

  addMember(agentName) {
    this.members.add(agentName);
  }

  removeMember(agentName) {
    this.members.delete(agentName);
  }

  broadcast(content, sender) {
    const results = [];
    for (const member of this.members) {
      if (member !== sender) {
        messageStore.send(member, {
          type: "broadcast",
          sender,
          content,
          team: this.teamName,
          timestamp: Date.now(),
        });
        results.push(member);
      }
    }
    return results;
  }

  sendTo(recipient, content, sender) {
    if (!this.members.has(recipient)) {
      return { ok: false, error: `Agent "${recipient}" is not a member of team "${this.teamName}"` };
    }
    messageStore.send(recipient, {
      type: "message",
      sender,
      content,
      team: this.teamName,
      timestamp: Date.now(),
    });
    return { ok: true, recipient };
  }
}

export {
  sendMessageTool,
  AgentMessageStore,
  TeamMessageCoordinator,
  SendMessageType,
  messageStore,
};
