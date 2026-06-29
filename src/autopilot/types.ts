/** Autopilot type definitions. Ported from OpenHarness autopilot/types.py */

const AutopilotTaskStatus = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

const AutopilotTriggerType = {
  CRON: "cron",
  MANUAL: "manual",
  WEBHOOK: "webhook",
  EVENT: "event",
} as const;

interface AutopilotTaskOptions {
  id?: string;
  name?: string;
  prompt?: string;
  status?: string;
  triggerType?: string;
  createdAt?: number;
  startedAt?: number | null;
  completedAt?: number | null;
  result?: unknown;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

class AutopilotTask {
  id: string;
  name: string;
  prompt: string;
  status: string;
  triggerType: string;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  result: unknown;
  error: string | null;
  metadata: Record<string, unknown>;

  constructor(o: AutopilotTaskOptions = {}) {
    this.id = o.id || "";
    this.name = o.name || "";
    this.prompt = o.prompt || "";
    this.status = o.status || AutopilotTaskStatus.PENDING;
    this.triggerType = o.triggerType || AutopilotTriggerType.MANUAL;
    this.createdAt = o.createdAt || Date.now();
    this.startedAt = o.startedAt || null;
    this.completedAt = o.completedAt || null;
    this.result = o.result || null;
    this.error = o.error || null;
    this.metadata = o.metadata || {};
  }
}

export { AutopilotTaskStatus, AutopilotTriggerType, AutopilotTask };
