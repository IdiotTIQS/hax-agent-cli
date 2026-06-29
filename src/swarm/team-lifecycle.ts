/**
 * Persistent team lifecycle management.
 * Ported from OpenHarness swarm/team_lifecycle.py
 */

import fs from "fs";
import path from "path";
import os from "os";
import { getTeamDir } from "./mailbox.js";

const TEAM_FILE_NAME = "team.json";

function sanitizeName(name: string): string {
  return (name || "").replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
}

function sanitizeAgentName(name: string): string {
  return (name || "").replace(/@/g, "-");
}

interface AllowedPathOptions {
  path?: string;
  toolName?: string;
  tool_name?: string;
  addedBy?: string;
  added_by?: string;
  addedAt?: number;
  added_at?: number;
}

interface AllowedPathJSON {
  path: string;
  tool_name: string;
  added_by: string;
  added_at: number;
}

class AllowedPath {
  path: string;
  toolName: string;
  addedBy: string;
  addedAt: number;

  constructor(o: AllowedPathOptions = {}) {
    this.path = o.path || "";
    this.toolName = o.toolName || o.tool_name || "";
    this.addedBy = o.addedBy || o.added_by || "";
    this.addedAt = o.addedAt || o.added_at || Date.now() / 1000;
  }

  toJSON(): AllowedPathJSON {
    return { path: this.path, tool_name: this.toolName, added_by: this.addedBy, added_at: this.addedAt };
  }
}

interface TeamMemberOptions {
  agentId?: string;
  agent_id?: string;
  name?: string;
  backendType?: string;
  backend_type?: string;
  joinedAt?: number;
  joined_at?: number;
  agentType?: string | null;
  agent_type?: string | null;
  model?: string | null;
  prompt?: string | null;
  color?: string | null;
  planModeRequired?: boolean;
  plan_mode_required?: boolean;
  sessionId?: string | null;
  session_id?: string | null;
  subscriptions?: string[];
  isActive?: boolean;
  is_active?: boolean;
  mode?: string | null;
  tmuxPaneId?: string;
  tmux_pane_id?: string;
  cwd?: string;
  worktreePath?: string | null;
  worktree_path?: string | null;
  permissions?: string[];
  status?: string;
}

interface TeamMemberJSON {
  agent_id: string;
  name: string;
  backend_type: string;
  joined_at: number;
  agent_type: string | null;
  model: string | null;
  prompt: string | null;
  color: string | null;
  plan_mode_required: boolean;
  session_id: string | null;
  subscriptions: string[];
  is_active: boolean;
  mode: string | null;
  tmux_pane_id: string;
  cwd: string;
  worktree_path: string | null;
  permissions: string[];
  status: string;
}

class TeamMember {
  agentId: string;
  name: string;
  backendType: string;
  joinedAt: number;
  agentType: string | null;
  model: string | null;
  prompt: string | null;
  color: string | null;
  planModeRequired: boolean;
  sessionId: string | null;
  subscriptions: string[];
  isActive: boolean;
  mode: string | null;
  tmuxPaneId: string;
  cwd: string;
  worktreePath: string | null;
  permissions: string[];
  status: string;

  constructor(o: TeamMemberOptions = {}) {
    this.agentId = o.agentId || o.agent_id || "";
    this.name = o.name || "";
    this.backendType = o.backendType || o.backend_type || "subprocess";
    this.joinedAt = o.joinedAt || o.joined_at || Date.now() / 1000;
    this.agentType = o.agentType !== undefined ? o.agentType : (o.agent_type !== undefined ? o.agent_type : null);
    this.model = o.model || null;
    this.prompt = o.prompt || null;
    this.color = o.color || null;
    this.planModeRequired = !!o.planModeRequired || !!o.plan_mode_required;
    this.sessionId = o.sessionId || o.session_id || null;
    this.subscriptions = o.subscriptions || [];
    this.isActive = o.isActive !== undefined ? o.isActive : (o.is_active !== undefined ? o.is_active : true);
    this.mode = o.mode || null;
    this.tmuxPaneId = o.tmuxPaneId || o.tmux_pane_id || "";
    this.cwd = o.cwd || "";
    this.worktreePath = o.worktreePath || o.worktree_path || null;
    this.permissions = o.permissions || [];
    this.status = o.status || "active";
  }

  toJSON(): TeamMemberJSON {
    return {
      agent_id: this.agentId, name: this.name, backend_type: this.backendType,
      joined_at: this.joinedAt, agent_type: this.agentType, model: this.model,
      prompt: this.prompt, color: this.color, plan_mode_required: this.planModeRequired,
      session_id: this.sessionId, subscriptions: this.subscriptions, is_active: this.isActive,
      mode: this.mode, tmux_pane_id: this.tmuxPaneId, cwd: this.cwd,
      worktree_path: this.worktreePath, permissions: this.permissions, status: this.status,
    };
  }

  static fromJSON(d: TeamMemberOptions): TeamMember { return new TeamMember(d); }
}

interface TeamFileOptions {
  name?: string;
  createdAt?: number;
  created_at?: number;
  description?: string;
  leadAgentId?: string;
  lead_agent_id?: string;
  leadSessionId?: string | null;
  lead_session_id?: string | null;
  hiddenPaneIds?: string[];
  hidden_pane_ids?: string[];
  members?: Record<string, TeamMember | TeamMemberOptions>;
  teamAllowedPaths?: Array<AllowedPath | AllowedPathOptions>;
  team_allowed_paths?: Array<AllowedPath | AllowedPathOptions>;
  allowedPaths?: string[];
  allowed_paths?: string[];
  metadata?: Record<string, unknown>;
}

interface TeamFileJSON {
  name: string;
  description: string;
  created_at: number;
  lead_agent_id: string;
  lead_session_id: string | null;
  hidden_pane_ids: string[];
  members: Record<string, TeamMemberJSON>;
  team_allowed_paths: AllowedPathJSON[];
  allowed_paths: string[];
  metadata: Record<string, unknown>;
}

class TeamFile {
  name: string;
  createdAt: number;
  description: string;
  leadAgentId: string;
  leadSessionId: string | null;
  hiddenPaneIds: string[];
  members: Record<string, TeamMember>;
  teamAllowedPaths: AllowedPath[];
  allowedPaths: string[];
  metadata: Record<string, unknown>;

  constructor(o: TeamFileOptions = {}) {
    this.name = o.name || "";
    this.createdAt = o.createdAt || o.created_at || Date.now() / 1000;
    this.description = o.description || "";
    this.leadAgentId = o.leadAgentId || o.lead_agent_id || "";
    this.leadSessionId = o.leadSessionId !== undefined ? o.leadSessionId : (o.lead_session_id || null);
    this.hiddenPaneIds = o.hiddenPaneIds || o.hidden_pane_ids || [];
    this.members = {};
    if (o.members) {
      for (const [k, v] of Object.entries(o.members)) {
        this.members[k] = v instanceof TeamMember ? v : TeamMember.fromJSON(v as TeamMemberOptions);
      }
    }
    const rawPaths = o.teamAllowedPaths || o.team_allowed_paths || [];
    this.teamAllowedPaths = rawPaths.map(p => p instanceof AllowedPath ? p : new AllowedPath(p as AllowedPathOptions));
    this.allowedPaths = o.allowedPaths || o.allowed_paths || [];
    this.metadata = o.metadata || {};
  }

  toJSON(): TeamFileJSON {
    return {
      name: this.name, description: this.description, created_at: this.createdAt,
      lead_agent_id: this.leadAgentId, lead_session_id: this.leadSessionId,
      hidden_pane_ids: this.hiddenPaneIds,
      members: Object.fromEntries(Object.entries(this.members).map(([k, v]) => [k, v.toJSON()])),
      team_allowed_paths: this.teamAllowedPaths.map(p => p.toJSON()),
      allowed_paths: this.allowedPaths, metadata: this.metadata,
    };
  }

  static fromJSON(d: TeamFileOptions): TeamFile { return new TeamFile(d); }

  save(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.toJSON(), null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
  }

  static load(filePath: string): TeamFile {
    return TeamFile.fromJSON(JSON.parse(fs.readFileSync(filePath, "utf-8")) as TeamFileOptions);
  }
}

function teamFilePath(name: string): string { return path.join(getTeamDir(name), TEAM_FILE_NAME); }

function readTeamFile(teamName: string): TeamFile | null {
  const fp = teamFilePath(teamName);
  if (!fs.existsSync(fp)) return null;
  try { return TeamFile.load(fp); } catch (_) { return null; }
}

function writeTeamFile(teamName: string, teamFile: TeamFile): void { teamFile.save(teamFilePath(teamName)); }

class TeamLifecycleManager {
  createTeam(name: string, description = ""): TeamFile {
    const fp = teamFilePath(name);
    if (fs.existsSync(fp)) throw new Error(`Team '${name}' already exists`);
    const team = new TeamFile({ name, description, createdAt: Date.now() / 1000 });
    team.save(fp);
    return team;
  }

  deleteTeam(name: string): void {
    const dir = getTeamDir(name);
    if (!fs.existsSync(path.join(dir, TEAM_FILE_NAME))) throw new Error(`Team '${name}' does not exist`);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  getTeam(name: string): TeamFile | null { return readTeamFile(name); }

  listTeams(): TeamFile[] {
    const base = path.join(os.homedir(), ".haxagent", "teams");
    if (!fs.existsSync(base)) return [];
    const teams: TeamFile[] = [];
    for (const d of fs.readdirSync(base).sort()) {
      const tf = path.join(base, d, TEAM_FILE_NAME);
      if (!fs.existsSync(tf)) continue;
      try { teams.push(TeamFile.load(tf)); } catch (_) {}
    }
    return teams;
  }

  addMember(teamName: string, member: TeamMember): TeamFile {
    const fp = teamFilePath(teamName);
    const team = readTeamFile(teamName);
    if (!team) throw new Error(`Team '${teamName}' does not exist`);
    team.members[member.agentId] = member;
    team.save(fp);
    return team;
  }

  removeMember(teamName: string, agentId: string): TeamFile {
    const fp = teamFilePath(teamName);
    const team = readTeamFile(teamName);
    if (!team) throw new Error(`Team '${teamName}' does not exist`);
    if (!team.members[agentId]) throw new Error(`Agent '${agentId}' is not a member of team '${teamName}'`);
    delete team.members[agentId];
    team.save(fp);
    return team;
  }
}

export {
  sanitizeName, sanitizeAgentName, AllowedPath, TeamMember, TeamFile,
  readTeamFile, writeTeamFile, teamFilePath, TeamLifecycleManager,
};
