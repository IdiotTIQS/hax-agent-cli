class Session {
  constructor(input = {}) {
    this.id = input.id || createId('session');
    this.cwd = input.cwd || process.cwd();
    this.createdAt = toIsoString(input.createdAt || new Date(), 'session.createdAt');
    this.updatedAt = toIsoString(input.updatedAt || this.createdAt, 'session.updatedAt');
    this.metadata = { ...(input.metadata || {}) };
    this.messages = [...(input.messages || [])];
  }

  addMessage(message) {
    if (!message || typeof message.role !== 'string' || typeof message.content !== 'string') {
      throw new TypeError('session message requires role and content');
    }

    this.messages.push(message);
    this.touch();
    return message;
  }

  getTranscript() {
    return this.messages.map((message) => `${message.role}: ${message.content}`).join('\n');
  }

  snapshot() {
    return Object.freeze({
      id: this.id,
      cwd: this.cwd,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: Object.freeze({ ...this.metadata }),
      messages: Object.freeze([...this.messages]),
    });
  }

  touch(value = new Date()) {
    this.updatedAt = toIsoString(value, 'session.updatedAt');
  }
}

function createSession(input) {
  return new Session(input);
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toIsoString(value, name) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`${name} must be a valid date`);
  }

  return date.toISOString();
}

module.exports = { Session, createSession };
