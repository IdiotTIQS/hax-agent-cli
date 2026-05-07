<script setup>
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';

import Sidebar from './components/Sidebar.vue';
import TopBar from './components/TopBar.vue';
import ChatArea from './components/ChatArea.vue';
import InputBar from './components/InputBar.vue';
import RightPanel from './components/RightPanel.vue';
import SettingsModal from './components/SettingsModal.vue';
import Toast from './components/Toast.vue';

const api = window.haxAgent ?? {};

function ensureApi(name) {
  if (typeof api[name] !== 'function') {
    throw new Error(`window.haxAgent.${name} 不可用`);
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

const messages = ref([{
  id: crypto.randomUUID(),
  role: 'assistant',
  content: getWelcomeMessage(),
  createdAt: new Date(),
  turn: 0,
}]);
const toolCalls = ref([]);
const runLog = ref([{ id: crypto.randomUUID(), label: '桌面端已初始化', time: new Date(), type: 'info' }]);
const sessionList = ref([]);
const fileTreeData = ref([]);
const skillsSnapshot = ref({ projectRoot: '', total: 0, visible: 0, skills: [] });
const toolsSnapshot = ref({ projectRoot: '', total: 0, tools: [] });
const permissionsSnapshot = ref({ projectRoot: '', mode: 'normal', alwaysAllow: [], alwaysDeny: [], toolPermissions: [], counts: {} });
const teamSnapshot = ref({ projectRoot: '', teams: [], activeTeam: null });
const workspaceSummary = ref({ path: '', files: 0, directories: 0, depth: 0 });

const elapsed = ref('0s');
const tokenUsed = ref(0);
const cost = ref('$0.00');
const gitBranch = ref('master');
const gitAhead = ref(0);
const gitBehind = ref(0);
const gitChanged = ref(0);
const toastRef = ref(null);

const settings = reactive({
  provider: 'auto',
  model: '',
  temperature: 0.3,
  workspace: '',
});

const modelOptions = [
  { value: '', label: '默认模型' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];

function flattenTree(nodes, bucket = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) continue;
    bucket.push(node);
    if (Array.isArray(node.children) && node.children.length > 0) {
      flattenTree(node.children, bucket);
    }
  }
  return bucket;
}

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
    case 'search': return '搜索文件、路径、会话';
    case 'skills': return '筛选技能';
    case 'plugins': return '筛选工具';
    case 'auto': return '筛选权限或团队';
    default: return '搜索';
  }
});

let elapsedTimer = null;
let turnStartTime = null;
let unsubAgent = null;

function startElapsedTimer() {
  turnStartTime = Date.now();
  elapsedTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - turnStartTime) / 1000);
    elapsed.value = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
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
  return '欢迎使用 Hax Agent。我可以读取项目文件、执行命令、调用外部工具来完成你的任务。输入指令即可开始。';
}

function appendLog(label, type = 'info') {
  runLog.value.unshift({ id: crypto.randomUUID(), label, time: new Date(), type });
  runLog.value = runLog.value.slice(0, 50);
}

function appendMessage(role, content, extra = {}) {
  const msg = {
    id: crypto.randomUUID(),
    role,
    content: String(content ?? ''),
    createdAt: new Date(),
    turn: currentTurn.value,
    ...extra,
  };
  messages.value.push(msg);
  return msg;
}

function serializeSession(r) {
  if (!r) return '';
  return r.id ?? r.sessionId ?? '';
}

function normalizeSettings(payload) {
  const src = payload?.settings ?? payload;
  if (!src || typeof src !== 'object') return;
  const agent = src.agent ?? src;
  if (agent.provider !== undefined) settings.provider = agent.provider;
  if (agent.model !== undefined) settings.model = agent.model;
  if (typeof agent.temperature === 'number') settings.temperature = agent.temperature;
  if (src.desktop?.workspace !== undefined || src.workspace !== undefined) {
    settings.workspace = src.desktop?.workspace ?? src.workspace ?? '';
  }
}

function summarizeTree(nodes, depth = 0) {
  let files = 0;
  let directories = 0;
  let maxDepth = depth;
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) continue;
    if (Array.isArray(node.children) && node.children.length > 0) {
      directories += 1;
      const nested = summarizeTree(node.children, depth + 1);
      files += nested.files;
      directories += nested.directories;
      maxDepth = Math.max(maxDepth, nested.depth);
    } else {
      files += 1;
      maxDepth = Math.max(maxDepth, depth);
    }
  }
  return { files, directories, depth: maxDepth };
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

function resetConversationView() {
  messages.value = [{
    id: crypto.randomUUID(),
    role: 'assistant',
    content: getWelcomeMessage(),
    createdAt: new Date(),
    turn: 0,
  }];
  toolCalls.value = [];
  composer.value = '';
  activeAssistantId.value = '';
  isStreaming.value = false;
  currentTurn.value = 0;
  tokenUsed.value = 0;
  elapsed.value = '0s';
  errorText.value = '';
}

function updateStats(sessionResult) {
  const s = sessionResult?.status ?? sessionResult;
  if (!s) return;
  if (typeof s.tokens === 'number') tokenUsed.value = s.tokens;
  else if (typeof s.inputTokens === 'number' || typeof s.outputTokens === 'number') {
    tokenUsed.value = Number(s.inputTokens || 0) + Number(s.outputTokens || 0);
  }
  if (typeof s.cost === 'number') cost.value = `$${s.cost.toFixed(4)}`;
  if (typeof s.elapsed === 'string') elapsed.value = s.elapsed;
  if (sessionResult?.provider?.model) settings.model = sessionResult.provider.model;
}

function appendAssistantDelta(delta) {
  if (!activeAssistantId.value) {
    activeAssistantId.value = appendMessage('assistant', '').id;
  }
  const msg = messages.value.find((m) => m.id === activeAssistantId.value);
  if (msg) msg.content += String(delta ?? '');
}

function upsertToolCall(event) {
  const name = event.name ?? event.tool ?? 'tool';
  const attempt = event.attempt ?? 0;
  const turn = event.turn ?? currentTurn.value;
  const id = event.id ?? event.toolCallId ?? event.callId ?? event.tool_use_id ?? `${name}:${attempt}:${turn}`;
  let existing = toolCalls.value.find((t) => t.id === id);
  if (!existing && (event.status === 'done' || event.status === 'failed')) {
    existing = toolCalls.value.find((t) => t.name === name && t.status === 'running');
  }

  const isResult = event.type === 'tool.result';
  const patch = {
    id,
    name,
    status: event.status ?? (isResult ? (event.isError ? 'failed' : 'done') : 'running'),
    summary: isResult
      ? (event.isError ? `错误 — ${event.durationMs ?? '?'}ms` : `完成 — ${event.durationMs ?? '?'}ms`)
      : (event.displayInput ?? event.summary ?? ''),
    input: event.input ? (typeof event.input === 'object' ? JSON.stringify(event.input, null, 2) : String(event.input)) : '',
    output: isResult && event.data
      ? (typeof event.data === 'object' ? JSON.stringify(event.data, null, 2) : String(event.data))
      : (event.error ? String(event.error) : ''),
    turn,
    updatedAt: new Date(),
  };

  if (existing) {
    Object.assign(existing, patch);
  } else {
    toolCalls.value.unshift(patch);
    toolCalls.value = toolCalls.value.slice(0, 20);
  }
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
    const snapshot = await api.getWorkspaceSnapshot({ projectRoot: settings.workspace || undefined });
    fileTreeData.value = snapshot.fileTree || [];
    sessionList.value = snapshot.sessions || [];
    updateWorkspaceSummary(fileTreeData.value);
    workspaceSummary.value.path = settings.workspace || workspaceSummary.value.path;
    if (snapshot.git) {
      gitBranch.value = snapshot.git.branch || 'none';
      gitAhead.value = Number(snapshot.git.ahead || 0);
      gitBehind.value = Number(snapshot.git.behind || 0);
      gitChanged.value = Number(snapshot.git.changed || 0);
    }
  } catch (e) {
    appendLog('工作区快照加载失败', 'fail');
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
    appendLog('面板数据加载失败', 'fail');
    errorText.value = e.message;
  }
}

function setMessagesFromSession(sessionResult) {
  const restored = Array.isArray(sessionResult?.messages) ? sessionResult.messages : [];
  messages.value = restored.length > 0
    ? restored.map((message, index) => ({
        id: crypto.randomUUID(),
        role: message.role,
        content: message.content || '',
        createdAt: new Date(),
        turn: Math.floor(index / 2),
      }))
    : [{
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '这个会话没有可显示的历史消息。',
        createdAt: new Date(),
        turn: 0,
      }];
  currentTurn.value = Math.ceil(restored.length / 2);
}

function handleSelectNav(key) {
  activeNav.value = key;
  panelQuery.value = '';
}

function handleSelectFile(path) {
  appendLog('选中文件: ' + path);
  activeNav.value = 'search';
  panelQuery.value = path;
}

function handleSelectTab(tab) {
  activeTab.value = tab;
}

function handleTogglePermission() {
  permissionMode.value = permissionMode.value === 'full' ? 'normal' : 'full';
}

async function createSession() {
  errorText.value = '';
  appendLog('正在创建会话…', 'start');
  try {
    const result = await ensureApi('createSession')({ projectRoot: settings.workspace || undefined });
    sessionId.value = serializeSession(result) || crypto.randomUUID();
    resetConversationView();
    updateStats(result);
    const provider = result?.provider;
    if (provider) {
      appendLog(`提供商: ${provider.name} / ${provider.model || '默认模型'}`, 'done');
    }
    appendLog(`会话 ${sessionId.value.slice(0, 8)} 已就绪`, 'done');
    toastRef.value?.success('会话已创建');
    await Promise.all([loadWorkspaceSnapshot(), loadInsightPanels()]);
    return sessionId.value;
  } catch (e) {
    errorText.value = e.message;
    appendLog('会话创建失败', 'fail');
    toastRef.value?.error('创建失败: ' + e.message);
    throw e;
  }
}

async function resumeSession(targetSessionId) {
  if (!targetSessionId || isBusy.value) return;
  errorText.value = '';
  appendLog(`切换会话 ${targetSessionId.slice(0, 8)}…`, 'start');
  try {
    const targetSession = sessionList.value.find((item) => item.id === targetSessionId);
    const result = await ensureApi('resumeSession')({
      sessionId: targetSessionId,
      projectRoot: targetSession?.projectRoot || settings.workspace || undefined,
    });
    sessionId.value = serializeSession(result) || targetSessionId;
    setMessagesFromSession(result);
    toolCalls.value = [];
    activeAssistantId.value = '';
    isStreaming.value = false;
    updateStats(result);
    appendLog(`已切换到 ${sessionId.value.slice(0, 8)}`, 'done');
    toastRef.value?.success('会话已切换');
    await loadWorkspaceSnapshot();
  } catch (e) {
    errorText.value = e.message;
    appendLog('会话切换失败', 'fail');
    toastRef.value?.error('会话切换失败: ' + e.message);
  }
}

async function sendMessage() {
  const content = composer.value.trim();
  if (!content || isBusy.value) return;
  if (activeNav.value === 'search') {
    activeNav.value = 'chat';
  }

  if (!sessionId.value) {
    try { await createSession(); } catch { return; }
    if (!sessionId.value) return;
  }

  composer.value = '';
  appendMessage('user', content);
  isBusy.value = true;
  isThinking.value = true;
  isStreaming.value = false;
  statusState.value = 'thinking';
  currentTurn.value += 1;
  activeAssistantId.value = '';
  errorText.value = '';
  startElapsedTimer();
  appendLog('发送指令', 'start');

  try {
    const result = await ensureApi('sendMessage')({
      sessionId: sessionId.value,
      content,
    });

    updateStats(result);
    if (!isBusy.value) {
      // events handled
    } else if (typeof result === 'string' && result.length > 0) {
      appendMessage('assistant', result);
    } else if (result?.message || result?.content) {
      appendMessage('assistant', result.message ?? result.content);
    }

    statusState.value = 'idle';
    appendLog('任务完成', 'done');
  } catch (e) {
    errorText.value = e.message;
    appendMessage('system', `错误: ${e.message}`, { tone: 'danger' });
    statusState.value = 'error';
    appendLog('任务失败', 'fail');
    toastRef.value?.error('发送失败: ' + e.message);
  } finally {
    isBusy.value = false;
    isThinking.value = false;
    isStreaming.value = false;
    activeAssistantId.value = '';
    stopElapsedTimer();
    if (statusState.value !== 'error') statusState.value = 'idle';
  }
}

async function interruptAgent() {
  if (!sessionId.value || !isBusy.value) return;
  appendLog('请求中断…', 'start');
  try {
    await ensureApi('interrupt')({ sessionId: sessionId.value });
    isBusy.value = false;
    isThinking.value = false;
    isStreaming.value = false;
    activeAssistantId.value = '';
    statusState.value = 'idle';
    stopElapsedTimer();
    appendLog('已中断', 'done');
    appendMessage('system', '任务已被中断。');
    toastRef.value?.warning('任务已中断');
  } catch (e) {
    errorText.value = e.message;
    appendLog('中断失败', 'fail');
  }
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
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
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
      isBusy.value = true;
      isThinking.value = true;
      isStreaming.value = false;
      activeAssistantId.value = '';
      statusState.value = 'thinking';
      appendLog('回合开始', 'start');
      break;
    case 'message.delta':
      appendAssistantDelta(event.delta);
      statusState.value = 'running';
      isThinking.value = false;
      isStreaming.value = true;
      break;
    case 'thinking':
      statusState.value = 'thinking';
      break;
    case 'tool.start':
      upsertToolCall({ ...event, status: 'running' });
      statusState.value = 'running';
      appendLog(`工具 ${event.name} 开始执行`, 'start');
      break;
    case 'tool.result':
      upsertToolCall({ ...event, status: event.isError ? 'failed' : 'done' });
      appendLog(`工具 ${event.name} ${event.isError ? '执行失败' : '完成'}`, event.isError ? 'fail' : 'done');
      break;
    case 'tool.limit':
      appendMessage('system', '已达到工具调用上限。');
      appendLog('工具调用上限');
      break;
    case 'usage':
      if (event.status) {
        updateStats(event);
      } else {
        if (typeof event.inputTokens === 'number') tokenUsed.value += event.inputTokens;
        if (typeof event.outputTokens === 'number') tokenUsed.value += event.outputTokens;
      }
      break;
    case 'skill.start':
      appendLog(`技能开始: ${event.name || event.skill || '未知'}`);
      break;
    case 'skill.matched':
      appendLog(`技能匹配: ${event.name || event.skill || '未知'}`);
      break;
    case 'turn.completed':
      isBusy.value = false;
      isThinking.value = false;
      isStreaming.value = false;
      activeAssistantId.value = '';
      statusState.value = 'idle';
      updateStats(event);
      stopElapsedTimer();
      appendLog('回合完成', 'done');
      void loadWorkspaceSnapshot();
      break;
    case 'turn.interrupted':
      isBusy.value = false;
      isThinking.value = false;
      isStreaming.value = false;
      activeAssistantId.value = '';
      statusState.value = 'idle';
      stopElapsedTimer();
      appendMessage('system', '任务已被中断。');
      appendLog('回合被中断');
      break;
    case 'turn.failed':
      isBusy.value = false;
      isThinking.value = false;
      isStreaming.value = false;
      activeAssistantId.value = '';
      errorText.value = event.error?.message ?? 'Agent 错误';
      statusState.value = 'error';
      stopElapsedTimer();
      appendMessage('system', `错误: ${errorText.value}`, { tone: 'danger' });
      appendLog('回合失败', 'fail');
      break;
    default:
      break;
  }
}

async function saveSettings(updates) {
  errorText.value = '';
  try {
    const result = await ensureApi('updateSettings')(updates);
    normalizeSettings(result);
    showSettings.value = false;
    appendLog('设置已保存', 'done');
    toastRef.value?.success('设置已保存');
    await Promise.all([loadWorkspaceSnapshot(), loadInsightPanels()]);
  } catch (e) {
    errorText.value = e.message;
    toastRef.value?.error('保存设置失败');
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

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', stopResize);
  document.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  stopElapsedTimer();
  if (typeof unsubAgent === 'function') unsubAgent();
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', stopResize);
  document.removeEventListener('keydown', onKeyDown);
});
</script>

<template>
  <main class="desk" :style="{ gridTemplateColumns: sidebarWidth + 'px 3px 1fr 3px ' + inspectorWidth + 'px' }">
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
          :title="sessionId ? `会话 ${sessionId.slice(0, 8)}` : 'Agent 工作区'"
          :status="statusState"
          :is-busy="isBusy"
          :model="settings.model"
          :models="modelOptions"
          @interrupt="interruptAgent"
          @select-model="(m) => settings.model = m"
        />
        <div class="workspace-rail">
          <div class="workspace-rail-item workspace-rail-wide">
            <span class="rail-label">工作区</span>
            <span class="rail-value">{{ workspaceSummary.path || settings.workspace || '当前项目根目录' }}</span>
          </div>
          <div class="workspace-rail-item"><span class="rail-label">文件</span><span class="rail-value">{{ workspaceSummary.files }}</span></div>
          <div class="workspace-rail-item"><span class="rail-label">目录</span><span class="rail-value">{{ workspaceSummary.directories }}</span></div>
          <div class="workspace-rail-item"><span class="rail-label">深度</span><span class="rail-value">{{ workspaceSummary.depth }}</span></div>
          <div class="workspace-rail-item"><span class="rail-label">消息</span><span class="rail-value">{{ messages.length }}</span></div>
          <div class="workspace-rail-item"><span class="rail-label">工具</span><span class="rail-value">{{ toolCalls.length }}</span></div>
        </div>
        <div v-if="errorText" class="error-banner" role="alert">
          <strong>错误</strong>
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
            <div class="panel-meta">{{ fileTreeData.length }} top-level nodes</div>
          </div>
          <div class="nav-panel-list">
            <div v-for="node in searchResults" :key="node.path" class="nav-row">
              <div class="nav-row-title">{{ node.path }}</div>
              <div class="nav-row-meta">{{ node.type }}</div>
            </div>
            <div v-if="searchResults.length === 0" class="empty-panel">
              没有匹配结果
            </div>
          </div>
          <div class="nav-panel-list">
            <div class="subsection-title">Recent sessions</div>
            <div v-for="session in matchingSessions" :key="session.id" class="nav-card">
              <div class="nav-card-title">{{ session.title }}</div>
              <div class="nav-card-meta">{{ session.preview }}</div>
            </div>
            <div v-if="matchingSessions.length === 0" class="empty-panel">
              没有匹配会话
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
              没有匹配的技能
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
              没有匹配的工具
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
                  没有匹配的权限规则
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
                  没有匹配的团队
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
      @select-tab="handleSelectTab"
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
  </main>
</template>
