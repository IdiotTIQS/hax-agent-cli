<script setup>
import { computed, onMounted, onUnmounted, provide, reactive, ref, watch } from 'vue';

import Sidebar from './components/Sidebar.vue';
import TopBar from './components/TopBar.vue';
import ChatArea from './components/ChatArea.vue';
import InputBar from './components/InputBar.vue';
import RightPanel from './components/RightPanel.vue';
import SettingsModal from './components/SettingsModal.vue';
import Toast from './components/Toast.vue';
import ApprovalModal from './components/ApprovalModal.vue';
import { setLocale, t, DEFAULT_LOCALE } from './i18n.js';
import { buildGitAssistPrompt } from './git-assist.mjs';
import {
  createMessagesFromSession,
  extractSessionStats,
  extractSettingsPatch,
  serializeSessionId,
} from './session-utils.mjs';
import { upsertToolCallState } from './tool-call-state.mjs';
import {
  accumulateTokenUsage,
  createChatMessage,
  createLogEntry,
  createRunState,
  formatElapsed,
  prependLimited,
  toBackendPermissionMode,
} from './ui-state-utils.mjs';
import {
  createEmptyContentSearch,
  flattenTree,
  normalizeContentSearchResult,
  normalizeWorkspaceSnapshot,
  pathBasename as getPathBasename,
  pathsMatch,
  shouldClearSelectedGitFile,
  summarizeTree,
} from './workspace-utils.mjs';

provide('t', t);

const api = window.haxAgent ?? {};

function ensureApi(name) {
  if (typeof api[name] !== 'function') {
    throw new Error(`window.haxAgent.${name} ${t('desktop.app.unavailable')}`);
  }
  return api[name];
}

const sessionId = ref('');
const isBusy = ref(false);
const isThinking = ref(false);
const isStreaming = ref(false);
const statusState = ref('idle');
const activeAssistantId = ref('');
const errorText = ref('');
const currentTurn = ref(0);
const activeNav = ref('chat');
const activeTab = ref('summary');
const composer = ref('');
const panelQuery = ref('');
const permissionMode = ref('normal');
const showSettings = ref(false);
const sidebarWidth = ref(260);
const inspectorWidth = ref(290);
const resizing = ref(null);
const locale = ref(DEFAULT_LOCALE);
const darkMode = ref(false);

const messages = ref([createInitialMessage()]);
const toolCalls = ref([]);
const runLog = ref([createInitialLog()]);
const sessionList = ref([]);
const fileTreeData = ref([]);
const skillsSnapshot = ref({ projectRoot: '', total: 0, visible: 0, skills: [] });
const toolsSnapshot = ref({ projectRoot: '', total: 0, tools: [] });
const permissionsSnapshot = ref({ projectRoot: '', mode: 'normal', alwaysAllow: [], alwaysDeny: [], toolPermissions: [], counts: {} });
const teamSnapshot = ref({ projectRoot: '', teams: [], activeTeam: null });
const workspaceSummary = ref({ path: '', files: 0, directories: 0, depth: 0 });
const sessionProjectRoot = ref('');
const contentSearch = ref({ query: '', matches: [], scannedFiles: 0, truncated: false });
const selectedPreview = ref(null);
const selectedMatch = ref(null);
const isSearching = ref(false);

const elapsed = ref('0s');
const tokenUsed = ref(0);
const cost = ref('$0.00');
const gitBranch = ref('master');
const gitAhead = ref(0);
const gitBehind = ref(0);
const gitChanged = ref(0);
const gitFiles = ref([]);
const selectedGitFile = ref('');
const selectedGitDiff = ref(null);
const isLoadingGitDiff = ref(false);
const toastRef = ref(null);
const approvalQueue = ref([]);

const settings = reactive({
  provider: 'auto',
  model: '',
  temperature: 0.3,
  workspace: '',
});

const modelOptions = [
  { value: '', label: t('desktop.app.defaultModel') },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];

const filteredSkills = computed(() => {
  const query = activeNav.value === 'skills' ? panelQuery.value.trim().toLowerCase() : '';
  return skillsSnapshot.value.skills.filter((skill) => {
    if (!query) return true;
    return [
      skill.name,
      skill.displayName,
      skill.description,
      skill.whenToUse,
    ].some((value) => String(value || '').toLowerCase().includes(query));
  });
});

const filteredTools = computed(() => {
  const query = activeNav.value === 'plugins' ? panelQuery.value.trim().toLowerCase() : '';
  return toolsSnapshot.value.tools.filter((tool) => {
    if (!query) return true;
    return [tool.name, tool.description].some((value) => String(value || '').toLowerCase().includes(query));
  });
});

const filteredPermissions = computed(() => {
  const query = activeNav.value === 'auto' ? panelQuery.value.trim().toLowerCase() : '';
  return permissionsSnapshot.value.toolPermissions.filter((item) => {
    if (!query) return true;
    return [item.tool, item.level].some((value) => String(value || '').toLowerCase().includes(query));
  });
});

const filteredTeams = computed(() => {
  const query = activeNav.value === 'auto' ? panelQuery.value.trim().toLowerCase() : '';
  return teamSnapshot.value.teams.filter((team) => {
    if (!query) return true;
    return [team.name, team.mission].some((value) => String(value || '').toLowerCase().includes(query));
  });
});

const navCounts = computed(() => ({
  skills: skillsSnapshot.value.total,
  plugins: toolsSnapshot.value.total,
  auto: permissionsSnapshot.value.toolPermissions.length + teamSnapshot.value.teams.length,
  search: flattenTree(fileTreeData.value).length,
}));

const searchResults = computed(() => {
  const query = panelQuery.value.trim().toLowerCase();
  const items = flattenTree(fileTreeData.value);
  if (!query) return items.slice(0, 100);
  return items.filter((node) => [
    node.name,
    node.path,
    node.type,
  ].some((value) => String(value || '').toLowerCase().includes(query)));
});

const matchingSessions = computed(() => {
  const query = panelQuery.value.trim().toLowerCase();
  if (!query) return sessionList.value.slice(0, 8);
  return sessionList.value.filter((session) => [
    session.preview,
    session.title,
    session.id,
  ].some((value) => String(value || '').toLowerCase().includes(query)));
});

const panelPlaceholder = computed(() => {
  switch (activeNav.value) {
    case 'search': return t('desktop.app.searchFiles');
    case 'skills': return t('desktop.app.filterSkills');
    case 'plugins': return t('desktop.app.filterTools');
    case 'auto': return t('desktop.app.filterPermissions');
    default: return t('desktop.app.search');
  }
});

const workspaceDisplayPath = computed(() => (
  workspaceSummary.value.path || settings.workspace || sessionProjectRoot.value || t('desktop.app.currentProjectRoot')
));

const sessionScopeLabel = computed(() => {
  if (!sessionId.value) return t('desktop.app.noSession');
  if (!sessionProjectRoot.value) return t('desktop.app.noProject');

  const selectedWorkspace = settings.workspace || workspaceSummary.value.path;
  if (selectedWorkspace && pathsMatch(sessionProjectRoot.value, selectedWorkspace)) {
    return `${t('desktop.app.currentWorkspace')}: ${pathBasename(sessionProjectRoot.value)}`;
  }

  return `${t('desktop.app.sessionWorkspace')}: ${pathBasename(sessionProjectRoot.value)}`;
});

const sessionScopeTitle = computed(() => sessionProjectRoot.value || t('desktop.app.noActiveSession'));

let elapsedTimer = null;
let turnStartTime = null;
let unsubAgent = null;
let unsubApproval = null;
let searchTimer = null;

function startElapsedTimer() {
  turnStartTime = Date.now();
  elapsedTimer = setInterval(() => {
    elapsed.value = formatElapsed(Date.now() - turnStartTime);
  }, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  turnStartTime = null;
}

function getWelcomeMessage() {
  return t('desktop.app.welcomeMessage');
}

function toggleTheme() {
  darkMode.value = !darkMode.value;
  document.documentElement.setAttribute('data-theme', darkMode.value ? 'dark' : '');
}

function appendLog(label, type = 'info') {
  runLog.value = prependLimited(runLog.value, createLogEntry(label, type), 50);
}

function appendMessage(role, content, extra = {}) {
  const msg = createChatMessage(role, content, {
    turn: currentTurn.value,
    extra,
  });
  messages.value.push(msg);
  return msg;
}

function applyRunState(state, overrides = {}) {
  const nextState = createRunState(state, overrides);
  if (nextState.isBusy !== undefined) isBusy.value = nextState.isBusy;
  if (nextState.isThinking !== undefined) isThinking.value = nextState.isThinking;
  if (nextState.isStreaming !== undefined) isStreaming.value = nextState.isStreaming;
  if (nextState.activeAssistantId !== undefined) activeAssistantId.value = nextState.activeAssistantId;
  if (nextState.statusState !== undefined) statusState.value = nextState.statusState;
}

function createWelcomeMessage() {
  return createChatMessage('assistant', getWelcomeMessage(), {
    turn: 0,
  });
}

function createFallbackSessionId() {
  return crypto.randomUUID();
}

function createInitialLog() {
  return createLogEntry(t('desktop.app.initialized'));
}

function createInitialMessage() {
  return createWelcomeMessage();
}

function serializeSession(r) {
  return serializeSessionId(r);
}

function normalizeSettings(payload) {
  const patch = extractSettingsPatch(payload);
  if (patch.provider !== undefined) settings.provider = patch.provider;
  if (patch.model !== undefined) settings.model = patch.model;
  if (patch.temperature !== undefined) settings.temperature = patch.temperature;
  if (patch.workspace !== undefined) settings.workspace = patch.workspace;
  if (patch.locale) {
    locale.value = patch.locale;
    setLocale(patch.locale);
  }
}

function updateWorkspaceSummary(tree) {
  const summary = summarizeTree(tree, 0);
  workspaceSummary.value = {
    path: settings.workspace || '',
    files: summary.files,
    directories: summary.directories,
    depth: summary.depth,
  };
}

function pathBasename(value) {
  return getPathBasename(value, t('desktop.app.unnamedProject'));
}

function updateSessionWorkspace(sessionResult, options = {}) {
  const projectRoot = sessionResult?.settings?.projectRoot || '';
  if (!projectRoot) return false;

  sessionProjectRoot.value = projectRoot;
  if (options.switchWorkspace && !pathsMatch(settings.workspace, projectRoot)) {
    settings.workspace = projectRoot;
    workspaceSummary.value.path = projectRoot;
    return true;
  }

  return false;
}

function resetConversationView() {
  messages.value = [createWelcomeMessage()];
  toolCalls.value = [];
  composer.value = '';
  applyRunState('idle');
  sessionProjectRoot.value = '';
  currentTurn.value = 0;
  tokenUsed.value = 0;
  elapsed.value = '0s';
  errorText.value = '';
}

function updateStats(sessionResult) {
  const stats = extractSessionStats(sessionResult);
  if (typeof stats.tokens === 'number') tokenUsed.value = stats.tokens;
  if (stats.cost) cost.value = stats.cost;
  if (stats.elapsed) elapsed.value = stats.elapsed;
  if (stats.model) settings.model = stats.model;
}

function finishRun(state = 'idle') {
  applyRunState(state);
  stopElapsedTimer();
}

function appendAssistantDelta(delta) {
  if (!activeAssistantId.value) {
    activeAssistantId.value = appendMessage('assistant', '').id;
  }
  const msg = messages.value.find((m) => m.id === activeAssistantId.value);
  if (msg) msg.content += String(delta ?? '');
}

function upsertToolCall(event) {
  toolCalls.value = upsertToolCallState(toolCalls.value, event, {
    currentTurn: currentTurn.value,
    doneLabel: t('desktop.app.done'),
    errorLabel: t('desktop.app.error'),
  });
}

async function loadSettings() {
  if (typeof api.getSettings !== 'function') return;
  try {
    const result = await api.getSettings();
    normalizeSettings(result);
    workspaceSummary.value.path = settings.workspace || '';
  } catch (e) {
    errorText.value = e.message;
  }
}

async function loadWorkspaceSnapshot() {
  if (typeof api.getWorkspaceSnapshot !== 'function') return;
  try {
    const snapshot = normalizeWorkspaceSnapshot(
      await api.getWorkspaceSnapshot({ projectRoot: settings.workspace || undefined }),
      settings.workspace
    );
    fileTreeData.value = snapshot.fileTree;
    sessionList.value = snapshot.sessions;
    updateWorkspaceSummary(fileTreeData.value);
    workspaceSummary.value.path = snapshot.projectRoot || workspaceSummary.value.path;
    if (snapshot.git) {
      gitBranch.value = snapshot.git.branch;
      gitAhead.value = snapshot.git.ahead;
      gitBehind.value = snapshot.git.behind;
      gitChanged.value = snapshot.git.changed;
      gitFiles.value = snapshot.git.files;
      if (shouldClearSelectedGitFile(selectedGitFile.value, gitFiles.value)) {
        selectedGitFile.value = '';
        selectedGitDiff.value = null;
      }
    }
  } catch (e) {
    appendLog(t('desktop.app.loadFailed'), 'fail');
    errorText.value = e.message;
  }
}

async function loadInsightPanels() {
  const projectRoot = settings.workspace || undefined;
  const calls = [];
  if (typeof api.getSkillsSnapshot === 'function') calls.push(api.getSkillsSnapshot({ projectRoot }));
  if (typeof api.getToolsSnapshot === 'function') calls.push(api.getToolsSnapshot({ projectRoot }));
  if (typeof api.getPermissionsSnapshot === 'function') calls.push(api.getPermissionsSnapshot({ projectRoot }));
  if (typeof api.getTeamSnapshot === 'function') calls.push(api.getTeamSnapshot({ projectRoot }));

  try {
    const results = await Promise.all(calls);
    let index = 0;
    if (typeof api.getSkillsSnapshot === 'function') skillsSnapshot.value = results[index++] || skillsSnapshot.value;
    if (typeof api.getToolsSnapshot === 'function') toolsSnapshot.value = results[index++] || toolsSnapshot.value;
    if (typeof api.getPermissionsSnapshot === 'function') permissionsSnapshot.value = results[index++] || permissionsSnapshot.value;
    if (typeof api.getTeamSnapshot === 'function') teamSnapshot.value = results[index++] || teamSnapshot.value;
  } catch (e) {
    appendLog(t('desktop.app.panelLoadFailed'), 'fail');
    errorText.value = e.message;
  }
}

function setMessagesFromSession(sessionResult) {
  const restored = createMessagesFromSession(sessionResult, {
    emptyContent: t('desktop.app.noMessages'),
  });
  messages.value = restored.messages;
  currentTurn.value = restored.currentTurn;
}

function handleSelectNav(key) {
  activeNav.value = key;
  panelQuery.value = '';
}

function handleSelectFile(path) {
  appendLog(`${t('desktop.app.selectedFile')}: ` + path);
  activeNav.value = 'search';
  panelQuery.value = path;
  void previewWorkspaceFile(path);
}

function handleSelectTab(tab) {
  activeTab.value = tab;
}

function handleTogglePermission() {
  permissionMode.value = permissionMode.value === 'full' ? 'normal' : 'full';
}

function backendPermissionMode() {
  return toBackendPermissionMode(permissionMode.value);
}

async function createSession() {
  errorText.value = '';
  appendLog(t('desktop.app.creatingSession'), 'start');
  try {
    const result = await ensureApi('createSession')({
      projectRoot: settings.workspace || undefined,
      permissionMode: backendPermissionMode(),
    });
    sessionId.value = serializeSession(result) || createFallbackSessionId();
    resetConversationView();
    updateSessionWorkspace(result);
    updateStats(result);
    const provider = result?.provider;
    if (provider) {
      appendLog(`${t('desktop.app.providerLabel')}: ${provider.name} / ${provider.model || t('desktop.app.defaultModel')}`, 'done');
    }
    appendLog(`${t('desktop.app.sessionReady')}: ${sessionId.value.slice(0, 8)}`, 'done');
    toastRef.value?.success(t('desktop.app.sessionCreated'));
    await Promise.all([loadWorkspaceSnapshot(), loadInsightPanels()]);
    return sessionId.value;
  } catch (e) {
    errorText.value = e.message;
    appendLog(t('desktop.app.sessionCreateFailed'), 'fail');
    toastRef.value?.error(`${t('desktop.app.createFailed')}: ` + e.message);
    throw e;
  }
}

async function resumeSession(targetSessionId) {
  if (!targetSessionId || isBusy.value) return;
  errorText.value = '';
  appendLog(`${t('desktop.app.switchingSession')}: ${targetSessionId.slice(0, 8)}…`, 'start');
  try {
    const targetSession = sessionList.value.find((item) => item.id === targetSessionId);
    const result = await ensureApi('resumeSession')({
      sessionId: targetSessionId,
      projectRoot: targetSession?.projectRoot || settings.workspace || undefined,
    });
    sessionId.value = serializeSession(result) || targetSessionId;
    setMessagesFromSession(result);
    const switchedWorkspace = updateSessionWorkspace(result, { switchWorkspace: Boolean(targetSession?.projectRoot) });
    toolCalls.value = [];
    applyRunState('idle');
    updateStats(result);
    if (switchedWorkspace) {
      appendLog(`${t('desktop.app.workspaceSwitched')}: ${pathBasename(settings.workspace)}`, 'done');
    }
    appendLog(`${t('desktop.app.sessionSwitched')}: ${sessionId.value.slice(0, 8)}`, 'done');
    toastRef.value?.success(t('desktop.app.sessionSwitchedToast'));
    await Promise.all([loadWorkspaceSnapshot(), loadInsightPanels()]);
  } catch (e) {
    errorText.value = e.message;
    appendLog(t('desktop.app.switchFailed'), 'fail');
    toastRef.value?.error(`${t('desktop.app.switchFailedToast')}: ` + e.message);
  }
}

async function submitAgentMessage(content, options = {}) {
  const normalizedContent = String(content || '').trim();
  if (!normalizedContent || isBusy.value) return false;
  if (activeNav.value !== 'chat') {
    activeNav.value = 'chat';
  }

  if (!sessionId.value) {
    try { await createSession(); } catch { return false; }
    if (!sessionId.value) return false;
  }

  appendMessage('user', normalizedContent);
  applyRunState('thinking');
  currentTurn.value += 1;
  errorText.value = '';
  startElapsedTimer();
  appendLog(options.logLabel || t('desktop.app.sendingCommand'), 'start');

  try {
    const result = await ensureApi('sendMessage')({
      sessionId: sessionId.value,
      content: normalizedContent,
      projectRoot: settings.workspace || undefined,
      permissionMode: backendPermissionMode(),
    });

    updateStats(result);
    updateSessionWorkspace(result);
    if (!isBusy.value) {
      // events handled
    } else if (typeof result === 'string' && result.length > 0) {
      appendMessage('assistant', result);
    } else if (result?.message || result?.content) {
      appendMessage('assistant', result.message ?? result.content);
    }

    applyRunState('idle');
    appendLog(options.doneLabel || t('desktop.app.taskComplete'), 'done');
    return true;
  } catch (e) {
    errorText.value = e.message;
    appendMessage('system', `${t('desktop.app.errorPrefix')}: ${e.message}`, { tone: 'danger' });
    statusState.value = 'error';
    appendLog(options.failLabel || t('desktop.app.taskFailed'), 'fail');
    toastRef.value?.error(`${t('desktop.app.sendFailed')}: ` + e.message);
    return false;
  } finally {
    finishRun(statusState.value === 'error' ? 'error' : 'idle');
  }
}

async function sendMessage() {
  const content = composer.value.trim();
  if (!content || isBusy.value) return;
  composer.value = '';
  await submitAgentMessage(content);
}

async function interruptAgent() {
  if (!sessionId.value || !isBusy.value) return;
  appendLog(t('desktop.app.interrupting'), 'start');
  try {
    await ensureApi('interrupt')({ sessionId: sessionId.value });
    finishRun('idle');
    appendLog(t('desktop.app.interrupted'), 'done');
    appendMessage('system', t('desktop.app.taskInterrupted'));
    toastRef.value?.warning(t('desktop.app.interruptWarning'));
  } catch (e) {
    appendLog(t('desktop.app.interruptFailed'), 'fail');
  }
}

async function searchWorkspaceContent() {
  if (typeof api.searchWorkspace !== 'function') return;
  const query = panelQuery.value.trim();
  if (activeNav.value !== 'search' || !query) {
    contentSearch.value = createEmptyContentSearch();
    return;
  }

  isSearching.value = true;
  try {
    const result = await api.searchWorkspace({
      projectRoot: settings.workspace || undefined,
      query,
      maxResults: 120,
    });
    contentSearch.value = normalizeContentSearchResult(result, query);
  } catch (e) {
    errorText.value = e.message;
    appendLog(t('desktop.app.searchFailed'), 'fail');
  } finally {
    isSearching.value = false;
  }
}

async function previewWorkspaceFile(filePath, match = null) {
  if (!filePath || typeof api.readWorkspaceFile !== 'function') return;
  selectedMatch.value = match;
  try {
    const result = await api.readWorkspaceFile({
      projectRoot: settings.workspace || undefined,
      path: filePath,
    });
    selectedPreview.value = result;
    appendLog(`${t('desktop.app.previewFile')}: ${result.path}`, 'done');
  } catch (e) {
    errorText.value = e.message;
    appendLog(t('desktop.app.previewFailed'), 'fail');
  }
}

async function loadGitDiff(filePath) {
  if (!filePath || typeof api.getGitDiff !== 'function') return;
  selectedGitFile.value = filePath;
  isLoadingGitDiff.value = true;
  try {
    const result = await api.getGitDiff({
      projectRoot: settings.workspace || undefined,
      path: filePath,
    });
    selectedGitDiff.value = result;
      appendLog(`${t('desktop.app.readDiff')}: ${result.path}`, 'done');
  } catch (e) {
    selectedGitDiff.value = null;
    errorText.value = e.message;
    appendLog(t('desktop.app.diffReadFailed'), 'fail');
  } finally {
    isLoadingGitDiff.value = false;
  }
}

function buildGitPrompt(intent) {
  return buildGitAssistPrompt({
    intent,
    filePath: selectedGitFile.value,
    diff: selectedGitDiff.value?.diff,
  });
}

async function handleGitAssist(intent) {
  const prompt = buildGitPrompt(intent);
  if (!prompt) {
    toastRef.value?.warning(t('desktop.app.selectDiffFirst'));
    return;
  }

  await submitAgentMessage(prompt, {
    logLabel: intent === 'commit' ? t('desktop.app.generateCommit') : t('desktop.app.explainDiffAction'),
    doneLabel: intent === 'commit' ? t('desktop.app.commitGenerated') : t('desktop.app.diffExplained'),
    failLabel: intent === 'commit' ? t('desktop.app.commitFailed') : t('desktop.app.explainFailed'),
  });
}

function isHighlightedLine(lineNumber) {
  return selectedMatch.value && selectedMatch.value.path === selectedPreview.value?.path && selectedMatch.value.line === lineNumber;
}

function startResize(panel) {
  resizing.value = panel;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function onMouseMove(e) {
  if (!resizing.value) return;
  if (resizing.value === 'sidebar') sidebarWidth.value = Math.max(200, Math.min(380, e.clientX));
  else if (resizing.value === 'inspector') inspectorWidth.value = Math.max(240, Math.min(460, window.innerWidth - e.clientX));
}

function stopResize() {
  resizing.value = null;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

function onKeyDown(e) {
  if ((e.ctrlKey || e.metaKey) && String(e.key || '').toLowerCase() === 'k') {
    e.preventDefault();
    showSettings.value = !showSettings.value;
  }
  if (e.key === 'Escape' && showSettings.value) showSettings.value = false;
}

function handleAgentEvent(event) {
  const type = event?.type ?? event?.event;
  if (!type) return;
  switch (type) {
    case 'turn.started':
      applyRunState('thinking');
      appendLog(t('desktop.app.turnStart'), 'start');
      break;
    case 'message.delta':
      appendAssistantDelta(event.delta);
      applyRunState('running', { activeAssistantId: activeAssistantId.value });
      break;
    case 'thinking':
      statusState.value = 'thinking';
      break;
    case 'tool.start':
      upsertToolCall({ ...event, status: 'running' });
      applyRunState('toolRunning');
      appendLog(`${t('desktop.app.toolStart')}: ${event.name}`, 'start');
      break;
    case 'tool.result':
      upsertToolCall({ ...event, status: event.isError ? 'failed' : 'done' });
      appendLog(`${event.name} ${event.isError ? t('desktop.app.toolFailed') : t('desktop.app.toolDone')}`, event.isError ? 'fail' : 'done');
      break;
    case 'tool.limit':
      appendMessage('system', t('desktop.app.toolLimitReached'));
      appendLog(t('desktop.app.toolLimit'));
      break;
    case 'usage':
      if (event.status) {
        updateStats(event);
      } else {
        tokenUsed.value = accumulateTokenUsage(tokenUsed.value, event);
      }
      break;
    case 'skill.start':
      appendLog(`${t('desktop.app.skillStart')}: ${event.name || event.skill || '?'}`);
      break;
    case 'skill.matched':
      appendLog(`${t('desktop.app.skillMatched')}: ${event.name || event.skill || '?'}`);
      break;
    case 'turn.completed':
      finishRun('idle');
      updateStats(event);
      appendLog(t('desktop.app.turnComplete'), 'done');
      void loadWorkspaceSnapshot();
      break;
    case 'turn.interrupted':
      finishRun('idle');
      appendMessage('system', t('desktop.app.taskInterrupted'));
      appendLog(t('desktop.app.turnInterrupted'));
      break;
    case 'turn.failed':
      finishRun('error');
      errorText.value = event.error?.message ?? t('desktop.app.agentError');
      appendMessage('system', `${t('desktop.app.errorPrefix')}: ${errorText.value}`, { tone: 'danger' });
      appendLog(t('desktop.app.turnFailed'), 'fail');
      break;
    default:
      break;
  }
}

function handleApprovalRequest(request) {
  approvalQueue.value.push(request);
  appendLog(`${t('desktop.app.waitingApproval')}: ${request.toolName}`, 'start');
}

async function decideApproval(decision) {
  const request = approvalQueue.value[0];
  if (!request) return;

  approvalQueue.value = approvalQueue.value.slice(1);
  try {
    const result = await ensureApi('respondApproval')({ id: request.id, decision });
    if (!result?.resolved) {
      appendLog(`${t('desktop.app.approvalExpired')}: ${request.toolName}`, 'fail');
      toastRef.value?.warning(t('desktop.app.approvalExpiredToast'));
      return;
    }

    const approved = decision === 'approve' || decision === 'always_allow';
    appendLog(`${approved ? t('desktop.app.approved') : t('desktop.app.denied')}: ${request.toolName}`, approved ? 'done' : 'fail');
    void loadInsightPanels();
  } catch (e) {
    errorText.value = e.message;
    appendLog(t('desktop.app.approvalFailed'), 'fail');
    toastRef.value?.error(`${t('desktop.app.approvalFailedToast')}: ` + e.message);
  }
}

async function saveSettings(updates) {
  errorText.value = '';
  try {
    const result = await ensureApi('updateSettings')(updates);
    normalizeSettings(result);
    showSettings.value = false;
    appendLog(t('desktop.app.settingsSaved'), 'done');
    toastRef.value?.success(t('desktop.app.settingsSavedToast'));
    await Promise.all([loadWorkspaceSnapshot(), loadInsightPanels()]);
  } catch (e) {
    errorText.value = e.message;
    toastRef.value?.error(t('desktop.app.settingsSaveFailed'));
  }
}

async function chooseWorkspaceDirectory() {
  if (typeof api.chooseWorkspaceDirectory !== 'function') return '';
  const result = await api.chooseWorkspaceDirectory({ defaultPath: settings.workspace || undefined });
  return result?.canceled ? '' : (result?.path || '');
}

function renderSearchContent() {
  return fileTreeData.value;
}

onMounted(async () => {
  await loadSettings();
  await Promise.all([loadWorkspaceSnapshot(), loadInsightPanels()]);

  if (typeof api.onAgentEvent === 'function') {
    unsubAgent = api.onAgentEvent(handleAgentEvent);
  }
  if (typeof api.onApprovalRequest === 'function') {
    unsubApproval = api.onApprovalRequest(handleApprovalRequest);
  }

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', stopResize);
  document.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  stopElapsedTimer();
  if (searchTimer) clearTimeout(searchTimer);
  if (typeof unsubAgent === 'function') unsubAgent();
  if (typeof unsubApproval === 'function') unsubApproval();
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', stopResize);
  document.removeEventListener('keydown', onKeyDown);
});

watch([activeNav, panelQuery], () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void searchWorkspaceContent();
  }, 180);
});
</script>

<template>
  <main class="desk" :style="{ gridTemplateColumns: sidebarWidth + 'px 3px minmax(0, 1fr) 3px ' + inspectorWidth + 'px' }">
    <Sidebar
      :sessions="sessionList"
      :active-id="sessionId"
      :file-tree="fileTreeData"
      :active-nav="activeNav"
      :is-busy="isBusy"
      :nav-counts="navCounts"
      @select-nav="handleSelectNav"
      @new-task="createSession"
      @select-session="resumeSession"
      @toggle-section="() => {}"
      @open-settings="showSettings = true"
      @select-file="handleSelectFile"
    />

    <div class="resize-handle" @mousedown="startResize('sidebar')"></div>

    <section class="workspace">
      <div>
        <TopBar
          :title="sessionId ? `${t('desktop.app.sessionBar')} ${sessionId.slice(0, 8)}` : t('desktop.topbar.title')"
          :scope-label="sessionScopeLabel"
          :scope-title="sessionScopeTitle"
          :status="statusState"
          :is-busy="isBusy"
          :model="settings.model"
          :models="modelOptions"
          :dark-mode="darkMode"
          @interrupt="interruptAgent"
          @select-model="(m) => settings.model = m"
          @toggle-theme="toggleTheme"
        />
        <div class="workspace-rail">
          <div class="workspace-rail-item workspace-rail-wide">
            <span class="rail-label">{{ t('desktop.app.workspaceRail') }}</span>
            <span class="rail-value">{{ workspaceDisplayPath }}</span>
          </div>
          <div class="workspace-rail-item"><span class="rail-label">{{ t('desktop.app.filesRail') }}</span><span class="rail-value">{{ workspaceSummary.files }}</span></div>
          <div class="workspace-rail-item"><span class="rail-label">{{ t('desktop.app.dirsRail') }}</span><span class="rail-value">{{ workspaceSummary.directories }}</span></div>
          <div class="workspace-rail-item"><span class="rail-label">{{ t('desktop.app.depthRail') }}</span><span class="rail-value">{{ workspaceSummary.depth }}</span></div>
          <div class="workspace-rail-item"><span class="rail-label">{{ t('desktop.app.messagesRail') }}</span><span class="rail-value">{{ messages.length }}</span></div>
          <div class="workspace-rail-item"><span class="rail-label">{{ t('desktop.app.toolsRail') }}</span><span class="rail-value">{{ toolCalls.length }}</span></div>
        </div>
        <div v-if="errorText" class="error-banner" role="alert">
          <strong>{{ t('desktop.app.errorPrefix') }}</strong>
          <span>{{ errorText }}</span>
        </div>
      </div>

      <div v-if="activeNav === 'chat'" class="workspace-stack">
        <ChatArea
          :messages="messages"
          :tool-calls="toolCalls"
          :is-thinking="isThinking"
          :is-streaming="isStreaming"
          :active-assistant-id="activeAssistantId"
        />
        <InputBar
          v-model="composer"
          :is-busy="isBusy"
          :permission-mode="permissionMode"
          @send="sendMessage"
          @toggle-permission="handleTogglePermission"
        />
      </div>

      <div v-else class="nav-panel">
        <div class="nav-panel-top">
          <div class="panel-search">
            <span class="panel-search-icon">⌕</span>
            <input
              v-model="panelQuery"
              :placeholder="panelPlaceholder"
              type="text"
            />
          </div>
          <div class="panel-search-meta">
            <span v-if="activeNav === 'search'">{{ searchResults.length }} results</span>
            <span v-else-if="activeNav === 'skills'">{{ filteredSkills.length }} skills</span>
            <span v-else-if="activeNav === 'plugins'">{{ filteredTools.length }} tools</span>
            <span v-else>{{ filteredPermissions.length }} permissions</span>
          </div>
        </div>

        <div v-if="activeNav === 'search'" class="nav-panel-body">
          <div class="panel-head">
            <div>
              <div class="panel-kicker">Search</div>
              <h2>Workspace Search</h2>
            </div>
            <div class="panel-meta">
              <span v-if="isSearching">searching…</span>
              <span v-else-if="contentSearch.query">{{ contentSearch.matches.length }} matches · {{ contentSearch.scannedFiles }} files</span>
              <span v-else>{{ fileTreeData.length }} top-level nodes</span>
            </div>
          </div>
          <div class="search-workbench">
            <div class="search-results-pane">
              <div v-if="contentSearch.query" class="nav-panel-list">
                <button
                  v-for="match in contentSearch.matches"
                  :key="match.path + ':' + match.line + ':' + match.column"
                  class="search-hit"
                  :class="{ active: selectedMatch && selectedMatch.path === match.path && selectedMatch.line === match.line }"
                  type="button"
                  @click="previewWorkspaceFile(match.path, match)"
                >
                  <div class="search-hit-top">
                    <span class="search-hit-path">{{ match.path }}</span>
                    <span class="search-hit-line">L{{ match.line }}:{{ match.column }}</span>
                  </div>
                  <div class="search-hit-text">{{ match.text }}</div>
                </button>
                <div v-if="contentSearch.truncated" class="empty-panel">
                  {{ t('desktop.app.searchTruncated') }}
                </div>
                <div v-if="contentSearch.matches.length === 0 && !isSearching" class="empty-panel">
                  {{ t('desktop.app.searchNoMatch') }}
                </div>
              </div>

              <div v-else class="nav-panel-list">
                <button
                  v-for="node in searchResults"
                  :key="node.path"
                  class="nav-row nav-row-button"
                  type="button"
                  @click="node.type === 'file' ? previewWorkspaceFile(node.path) : null"
                >
                  <div class="nav-row-title">{{ node.path }}</div>
                  <div class="nav-row-meta">{{ node.type }}</div>
                </button>
                <div v-if="searchResults.length === 0" class="empty-panel">
                  {{ t('desktop.app.searchNoResults') }}
                </div>
              </div>

              <div class="nav-panel-list">
                <div class="subsection-title">Recent sessions</div>
                <div v-for="session in matchingSessions" :key="session.id" class="nav-card">
                  <div class="nav-card-title">{{ session.title }}</div>
                  <div class="nav-card-meta">{{ session.preview }}</div>
                </div>
                <div v-if="matchingSessions.length === 0" class="empty-panel">
                  {{ t('desktop.app.searchNoSessions') }}
                </div>
              </div>
            </div>

            <div class="file-preview-pane">
              <div v-if="selectedPreview" class="file-preview">
                <div class="file-preview-head">
                  <div>
                    <div class="panel-kicker">Preview</div>
                    <h3>{{ selectedPreview.path }}</h3>
                  </div>
                  <span class="file-preview-meta">{{ selectedPreview.bytes }} bytes</span>
                </div>
                <div v-if="selectedPreview.truncated" class="empty-panel">
                  {{ t('desktop.app.fileTooLarge') }}
                </div>
                <div v-else class="file-preview-code"><div
                  v-for="line in selectedPreview.lines"
                  :key="line.number"
                  class="file-preview-line"
                  :class="{ highlighted: isHighlightedLine(line.number) }"
                ><span class="file-preview-num">{{ line.number }}</span><span class="file-preview-text">{{ line.text || ' ' }}</span></div></div>
              </div>
              <div v-else class="file-preview-empty">
                <div class="panel-kicker">Preview</div>
                <h3>{{ t('desktop.app.selectFile') }}</h3>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="activeNav === 'skills'" class="nav-panel-body">
          <div class="panel-head">
            <div>
              <div class="panel-kicker">Skills</div>
              <h2>Loaded Skills</h2>
            </div>
            <div class="panel-meta">{{ skillsSnapshot.visible }} visible / {{ skillsSnapshot.total }} total</div>
          </div>
          <div class="nav-panel-list">
            <div v-for="skill in filteredSkills" :key="skill.name" class="nav-card">
              <div class="nav-card-title">{{ skill.displayName }}</div>
              <div class="nav-card-meta">{{ skill.whenToUse || skill.description || 'No description' }}</div>
              <div class="nav-card-foot">
                <span>{{ skill.source }}</span>
                <span>{{ skill.usageCount }} uses</span>
              </div>
            </div>
            <div v-if="filteredSkills.length === 0" class="empty-panel">
              {{ t('desktop.app.noMatchingSkills') }}
            </div>
          </div>
        </div>

        <div v-else-if="activeNav === 'plugins'" class="nav-panel-body">
          <div class="panel-head">
            <div>
              <div class="panel-kicker">Plugins</div>
              <h2>Local Tools</h2>
            </div>
            <div class="panel-meta">{{ toolsSnapshot.total }} tools</div>
          </div>
          <div class="nav-panel-list">
            <div v-for="tool in filteredTools" :key="tool.name" class="nav-card">
              <div class="nav-card-title">{{ tool.name }}</div>
              <div class="nav-card-meta">{{ tool.description || 'No description' }}</div>
            </div>
            <div v-if="filteredTools.length === 0" class="empty-panel">
              {{ t('desktop.app.noMatchingTools') }}
            </div>
          </div>
        </div>

        <div v-else-if="activeNav === 'auto'" class="nav-panel-body">
          <div class="panel-head">
            <div>
              <div class="panel-kicker">Automation</div>
              <h2>Permissions and Teams</h2>
            </div>
            <div class="panel-meta">{{ permissionsSnapshot.mode }}</div>
          </div>
          <div class="dual-grid">
            <div>
              <div class="subsection-title">Tool Permissions</div>
              <div class="nav-panel-list">
                <div v-for="item in filteredPermissions" :key="item.tool" class="nav-row">
                  <div class="nav-row-title">{{ item.tool }}</div>
                  <div class="nav-row-meta">{{ item.level }}</div>
                </div>
                <div v-if="filteredPermissions.length === 0" class="empty-panel">
                  {{ t('desktop.app.noMatchingPermissions') }}
                </div>
              </div>
            </div>
            <div>
              <div class="subsection-title">Teams</div>
              <div class="nav-panel-list">
                <div v-for="team in filteredTeams" :key="team.name" class="nav-card">
                  <div class="nav-card-title">{{ team.name }}</div>
                  <div class="nav-card-meta">{{ team.mission }}</div>
                  <div class="nav-card-foot">
                    <span>{{ team.members }} members</span>
                    <span>{{ team.tasks }} tasks</span>
                  </div>
                </div>
                <div v-if="filteredTeams.length === 0" class="empty-panel">
                  {{ t('desktop.app.noMatchingTeams') }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <div class="resize-handle" @mousedown="startResize('inspector')"></div>

    <RightPanel
      :active-tab="activeTab"
      :log-entries="runLog"
      :tool-calls="toolCalls"
      :file-tree="fileTreeData"
      :workspace="settings.workspace"
      :elapsed="elapsed"
      :token-used="tokenUsed"
      :cost="cost"
      :git-branch="gitBranch"
      :git-ahead="gitAhead"
      :git-behind="gitBehind"
      :git-changed="gitChanged"
      :git-files="gitFiles"
      :selected-git-file="selectedGitFile"
      :selected-git-diff="selectedGitDiff"
      :is-loading-git-diff="isLoadingGitDiff"
      :is-busy="isBusy"
      @select-tab="handleSelectTab"
      @select-git-file="loadGitDiff"
      @git-assist="handleGitAssist"
    />

    <SettingsModal
      :visible="showSettings"
      :provider="settings.provider"
      :model="settings.model"
      :temperature="settings.temperature"
      :workspace="settings.workspace"
      @close="showSettings = false"
      @save="saveSettings"
      @choose-workspace="(resolve) => chooseWorkspaceDirectory().then(resolve)"
    />

    <Toast ref="toastRef" />
    <ApprovalModal
      :request="approvalQueue[0] || null"
      @decide="decideApproval"
    />
  </main>
</template>
