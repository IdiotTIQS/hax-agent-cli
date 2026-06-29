/**
 * Persistent team lifecycle management.
 * Ported from OpenHarness swarm/team_lifecycle.py
 */

import fs from "fs";
import path from "path";
import os from "os";
import { getTeamDir } from "./mailbox.js";

const TEAM_FILE_NAME = "team.json";

function sanitizeName(name) { return (name || "").replace(/[^a-zA-Z0-9]/g, "-").toLowerCase(); }
function sanitizeAgentName(name) { return (name || "").replace(/@/g, "-"); }

class AllowedPath {
  constructor(o = {}) { this.path = o.path || ""; this.toolName = o.toolName || o.tool_name || ""; this.addedBy = o.addedBy || o.added_by || ""; this.addedAt = o.addedAt || o.added_at || Date.now() / 1000; }
  toJSON() { return { path: this.path, tool_name: this.toolName, added_by: this.addedBy, added_at: this.addedAt }; }
}

class TeamMember {
  constructor(o = {}) {
    this.agentId = o.agentId || o.agent_id || "";
    this.name = o.name || "";
    this.backendType = o.backendType || o.backend_type || "subprocess";
    this.joinedAt = o.joinedAt || o.joined_at || Date.now() / 1000;
    this.agentType = o.agentType || o.agent_type || null;
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
  toJSON() { return { agent_id: this.agentId, name: this.name, backend_type: this.backendType, joined_at: this.joinedAt, agent_type: this.agentType, model: this.model, prompt: this.prompt, color: this.color, plan_mode_required: this.planModeRequired, session_id: this.sessionId, subscriptions: this.subscriptions, is_active: this.isActive, mode: this.mode, tmux_pane_id: this.tmuxPaneId, cwd: this.cwd, worktree_path: this.worktreePath, permissions: this.permissions, status: this.status }; }
  static fromJSON(d) { return new TeamMember(d); }
}

class TeamFile {
  constructor(o = {}) {
    this.name = o.name || "";
    this.createdAt = o.createdAt || o.created_at || Date.now() / 1000;
    this.description = o.description || "";
    this.leadAgentId = o.leadAgentId || o.lead_agent_id || "";
    this.leadSessionId = o.leadSessionId || o.lead_session_id || null;
    this.hiddenPaneIds = o.hiddenPaneIds || o.hidden_pane_ids || [];
    this.members = {};
    if (o.members) for (const [k, v] of Object.entries(o.members)) this.members[k] = v instanceof TeamMember ? v : TeamMember.fromJSON(v);
    this.teamAllowedPaths = (o.teamAllowedPaths || o.team_allowed_paths || []).map(p => p instanceof AllowedPath ? p : new AllowedPath(p));
    this.allowedPaths = o.allowedPaths || o.allowed_paths || [];
    this.metadata = o.metadata || {};
  }
  toJSON() { return { name: this.name, description: this.description, created_at: this.createdAt, lead_agent_id: this.leadAgentId, lead_session_id: this.leadSessionId, hidden_pane_ids: this.hiddenPaneIds, members: Object.fromEntries(Object.entries(this.members).map(([k,v]) => [k, v.toJSON()])), team_allowed_paths: this.teamAllowedPaths.map(p => p.toJSON()), allowed_paths: this.allowedPaths, metadata: this.metadata }; }
  static fromJSON(d) { return new TeamFile(d); }
  save(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(this.toJSON(), null, 2), "utf-8");
    fs.renameSync(tmp, filePath);
  }
  static load(filePath) { return TeamFile.fromJSON(JSON.parse(fs.readFileSync(filePath, "utf-8"))); }
}

function teamFilePath(name) { return path.join(getTeamDir(name), TEAM_FILE_NAME); }
function readTeamFile(teamName) {
  const fp = teamFilePath(teamName);
  if (!fs.existsSync(fp)) return null;
  try { return TeamFile.load(fp); } catch (_) { return null; }
}
function writeTeamFile(teamName, teamFile) { teamFile.save(teamFilePath(teamName)); }

class TeamLifecycleManager {
  createTeam(name, description = "") {
    const fp = teamFilePath(name);
    if (fs.existsSync(fp)) throw new Error(`Team '${name}' already exists`);
    const team = new TeamFile({ name, description, createdAt: Date.now() / 1000 });
    team.save(fp);
    return team;
  }
  deleteTeam(name) {
    const dir = getTeamDir(name);
    if (!fs.existsSync(path.join(dir, TEAM_FILE_NAME))) throw new Error(`Team '${name}' does not exist`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  getTeam(name) { return readTeamFile(name); }
  listTeams() {
    const base = path.join(os.homedir(), ".haxagent", "teams");
    if (!fs.existsSync(base)) return [];
    const teams = [];
    for (const d of fs.readdirSync(base).sort()) {
      const tf = path.join(base, d, TEAM_FILE_NAME);
      if (!fs.existsSync(tf)) continue;
      try { teams.push(TeamFile.load(tf)); } catch (_) {}
    }
    return teams;
  }
  addMember(teamName, member) {
    const fp = teamFilePath(teamName);
    const team = readTeamFile(teamName);
    if (!team) throw new Error(`Team '${teamName}' does not exist`);
    team.members[member.agentId] = member;
    team.save(fp);
    return team;
  }
  removeMember(teamName, agentId) {
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
