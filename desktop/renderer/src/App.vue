<script setup>
import { onMounted, onUnmounted, reactive, ref, watch } from 'vue';

import Sidebar from './components/Sidebar.vue';
import TopBar from './components/TopBar.vue';
import ChatArea from './components/ChatArea.vue';
import InputBar from './components/InputBar.vue';
import RightPanel from './components/RightPanel.vue';
import SettingsModal from './components/SettingsModal.vue';
import Toast from './components/Toast.vue';

/* ═══════════════════════════════════════════════════════════════════════
   API
   ═══════════════════════════════════════════════════════════════════════ */

const api = window.haxAgent ?? {};

function ensureApi(name) {
  if (typeof api[name] !== 'function')
    throw new Error(`window.haxAgent.${name} 不可用`);
  return api[name];
}

/* ═══════════════════════════════════════════════════════════════════════
   Session state
   ═══════════════════════════════════════════════════════════════════════ */

const sessionId = ref('');
const isBusy = ref(false);
const isThinking = ref(false);
const statusState = ref('idle'); // idle | running | thinking | error
const activeAssistantId = ref('');
const errorText = ref('');
const currentTurn = ref(0);

/* ── Messages ── */
const messages = ref([
  {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: getWelcomeMessage(),
    createdAt: new Date(),
    turn: 0,
  },
]);

/* ── Tool calls ── */
const toolCalls = ref([]);

/* ── Run log ── */
const runLog = ref([
  { id: crypto.randomUUID(), label: '桌面端已初始化', time: new Date(), type: 'info' },
]);

/* ── Stats (populated from session) ── */
const elapsed = ref('0s');
const stepsTotal = ref(0);
const stepsDone = ref(0);
const tokenUsed = ref(0);
const cost = ref('$0.00');
const gitBranch = ref('master');
const gitAhead = ref(0);
const gitBehind = ref(0);
const gitChanged = ref(0);
const sessionList = ref([]);

/* ── Elapsed timer ── */
let elapsedTimer = null;
let turnStartTime = null;

function startElapsedTimer() {
  turnStartTime = Date.now();
  elapsedTimer = setInterval(() => {
    const sec = Math.floor((Date.now() - turnStartTime) / 1000);
    elapsed.value = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
  turnStartTime = null;
}

function updateStats(sessionResult) {
  const s = sessionResult?.status ?? sessionResult;
  if (!s) return;
  if (typeof s.turns === 'number') stepsTotal.value = s.turns;
  if (typeof s.toolCalls === 'number') stepsDone.value = s.toolCalls;
  if (typeof s.tokens === 'number') tokenUsed.value = s.tokens;
  else if (typeof s.inputTokens === 'number' || typeof s.outputTokens === 'number') {
    tokenUsed.value = Number(s.inputTokens || 0) + Number(s.outputTokens || 0);
  }
  if (typeof s.cost === 'number') cost.value = `$${s.cost.toFixed(4)}`;
  if (typeof s.elapsed === 'string') elapsed.value = s.elapsed;
  if (sessionResult?.provider?.model) {
    settings.model = sessionResult.provider.model;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   Settings
   ═══════════════════════════════════════════════════════════════════════ */

const showSettings = ref(false);
const settings = reactive({
  provider: 'auto',
  model: '',
  temperature: 0.3,
  workspace: '',
});

function normalizeSettings(payload) {
  const src = payload?.settings ?? payload;
  if (!src || typeof src !== 'object') return;
  const agent = src.agent ?? src;
  if (agent.provider !== undefined) settings.provider = agent.provider;
  if (agent.model !== undefined) settings.model = agent.model;
  if (typeof agent.temperature === 'number') settings.temperature = agent.temperature;
  if (src.projectRoot || src.workspace) settings.workspace = src.projectRoot ?? src.workspace;
}

/* ═══════════════════════════════════════════════════════════════════════
   UI state
   ═══════════════════════════════════════════════════════════════════════ */

const activeNav = ref('chat');
const activeTab = ref('summary');
const composer = ref('');
const permissionMode = ref('normal');

/* ── Resize ── */
const sidebarWidth = ref(260);
const inspectorWidth = ref(290);
const resizing = ref(null);

/* ── Model options ── */
const modelOptions = [
  { value: '', label: '默认模型' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];

const fileTreeData = ref([]);

/* ── Toast ref ── */
const toastRef = ref(null);

/* ═══════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════ */

function serializeSession(r) { if (!r) return ''; return r.id ?? r.sessionId ?? ''; }

function getWelcomeMessage() {
  return '欢迎使用 Hax Agent。我可以读取项目文件、执行命令、调用外部工具来完成你的任务。输入指令即可开始。';
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
  currentTurn.value = 0;
  tokenUsed.value = 0;
  elapsed.value = '0s';
  errorText.value = '';
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
  // Composite key: name + attempt + turn (only fields present in both start & result events)
  const id = event.id ?? event.toolCallId ?? event.callId ?? event.tool_use_id ?? `${name}:${attempt}:${turn}`;
  let existing = toolCalls.value.find((t) => t.id === id);
  if (!existing && (event.status === 'done' || event.status === 'failed')) {
    existing = toolCalls.value.find((t) => t.name === name && t.status === 'running');
  }

  const isResult = event.type === 'tool.result';
  const detail = event.displayInput ?? event.summary ?? '';

  const patch = {
    id,
    name,
    status: event.status ?? (isResult ? (event.isError ? 'failed' : 'done') : 'running'),
    summary: isResult
      ? (event.isError ? `错误 — ${event.durationMs ?? '?'}ms` : `完成 — ${event.durationMs ?? '?'}ms`)
      : detail,
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

/* ═══════════════════════════════════════════════════════════════════════
   Agent IPC actions
   ═══════════════════════════════════════════════════════════════════════ */

async function createSession() {
  errorText.value = '';
  appendLog('正在创建会话…', 'start');
  try {
    const result = await ensureApi('createSession')();
    sessionId.value = serializeSession(result) || crypto.randomUUID();
    resetConversationView();
    updateStats(result);
    // Append provider info to log
    const provider = result?.provider;
    if (provider) {
      appendLog(`提供商: ${provider.name} / ${provider.model || '默认模型'}`, 'done');
    }
    appendLog(`会话 ${sessionId.value.slice(0, 8)} 已就绪`, 'done');
    toastRef.value?.success('会话已创建');
    await loadWorkspaceSnapshot();
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
    const result = await ensureApi('resumeSession')({
      sessionId: targetSessionId,
      projectRoot: settings.workspace || undefined,
    });
    sessionId.value = serializeSession(result) || targetSessionId;
    setMessagesFromSession(result);
    toolCalls.value = [];
    activeAssistantId.value = '';
    updateStats(result);
    appendLog(`已切换到 ${sessionId.value.slice(0, 8)}`, 'done');
    toastRef.value?.success('会话已切换');
  } catch (e) {
    errorText.value = e.message;
    appendLog('会话切换失败', 'fail');
    toastRef.value?.error('会话切换失败: ' + e.message);
  }
}

async function loadWorkspaceSnapshot() {
  if (typeof api.getWorkspaceSnapshot !== 'function') return;

  try {
    const snapshot = await api.getWorkspaceSnapshot({
      projectRoot: settings.workspace || undefined,
    });
    fileTreeData.value = snapshot.fileTree || [];
    sessionList.value = snapshot.sessions || [];

    if (snapshot.projectRoot) settings.workspace = snapshot.projectRoot;
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

async function sendMessage() {
  const content = composer.value.trim();
  if (!content || isBusy.value) return;

  // Auto-create session
  if (!sessionId.value) {
    try { await createSession(); } catch { return; }
    if (!sessionId.value) return;
  }

  composer.value = '';
  appendMessage('user', content);
  isBusy.value = true;
  isThinking.value = true;
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

    // Update stats from session result
    updateStats(result);

    // Handle sync response fallback
    if (!isBusy.value) {
      // Already handled by events
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

/* ═══════════════════════════════════════════════════════════════════════
   Agent streaming events
   ═══════════════════════════════════════════════════════════════════════ */

function handleAgentEvent(event) {
  const type = event?.type ?? event?.event;
  if (!type) return;

  switch (type) {
    case 'turn.started':
      isBusy.value = true;
      isThinking.value = true;
      activeAssistantId.value = '';
      statusState.value = 'thinking';
      appendLog('回合开始', 'start');
      break;

    case 'message.delta':
      appendAssistantDelta(event.delta);
      statusState.value = 'running';
      isThinking.value = false;
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
      // Real-time token tracking from provider
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
      activeAssistantId.value = '';
      statusState.value = 'idle';
      updateStats(event);
      stopElapsedTimer();
      appendLog('回合完成', 'done');
      break;

    case 'turn.interrupted':
      isBusy.value = false;
      isThinking.value = false;
      activeAssistantId.value = '';
      statusState.value = 'idle';
      stopElapsedTimer();
      appendMessage('system', '任务已被中断。');
      appendLog('回合被中断');
      break;

    case 'turn.failed':
      isBusy.value = false;
      isThinking.value = false;
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

/* ═══════════════════════════════════════════════════════════════════════
   Settings IPC
   ═══════════════════════════════════════════════════════════════════════ */

async function loadSettings() {
  if (typeof api.getSettings !== 'function') return;
  try {
    const result = await api.getSettings();
    normalizeSettings(result);
  } catch (e) {
    errorText.value = e.message;
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
  } catch (e) {
    errorText.value = e.message;
    toastRef.value?.error('保存设置失败');
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   Panel resize
   ═══════════════════════════════════════════════════════════════════════ */

function startResize(panel) { resizing.value = panel; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; }
function onMouseMove(e) {
  if (!resizing.value) return;
  if (resizing.value === 'sidebar') sidebarWidth.value = Math.max(200, Math.min(380, e.clientX));
  else if (resizing.value === 'inspector') inspectorWidth.value = Math.max(240, Math.min(460, window.innerWidth - e.clientX));
}
function stopResize() { resizing.value = null; document.body.style.cursor = ''; document.body.style.userSelect = ''; }

/* ═══════════════════════════════════════════════════════════════════════
   Keyboard shortcuts
   ═══════════════════════════════════════════════════════════════════════ */

function onKeyDown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); showSettings.value = !showSettings.value; }
  if (e.key === 'Escape' && showSettings.value) showSettings.value = false;
}

/* ═══════════════════════════════════════════════════════════════════════
   Sidebar events
   ═══════════════════════════════════════════════════════════════════════ */

function handleSelectNav(key) { activeNav.value = key; }
function handleSelectFile(path) { appendLog('选中文件: ' + path); }
function handleTogglePermission() {
  permissionMode.value = permissionMode.value === 'full' ? 'normal' : 'full';
}

/* ═══════════════════════════════════════════════════════════════════════
   Lifecycle
   ═══════════════════════════════════════════════════════════════════════ */

let unsubAgent = null;

onMounted(async () => {
  await loadSettings();
  await loadWorkspaceSnapshot();

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
    <!-- Left Sidebar -->
    <Sidebar
      :sessions="sessionList"
      :active-id="sessionId"
      :file-tree="fileTreeData"
      :active-nav="activeNav"
      :is-busy="isBusy"
      @select-nav="handleSelectNav"
      @new-task="createSession"
      @select-session="resumeSession"
      @toggle-section="() => {}"
      @open-settings="showSettings = true"
      @select-file="handleSelectFile"
    />

    <div class="resize-handle" @mousedown="startResize('sidebar')"></div>

    <!-- Main workspace -->
    <section class="workspace">
      <div><!-- grid row 1: TopBar + ErrorBanner -->
        <TopBar
          :title="sessionId ? `会话 ${sessionId.slice(0, 8)}` : 'Agent 工作区'"
          :status="statusState"
          :is-busy="isBusy"
          :model="settings.model"
          :models="modelOptions"
          @interrupt="interruptAgent"
          @select-model="(m) => settings.model = m"
        />
        <div v-if="errorText" class="error-banner" role="alert">
          <strong>错误</strong>
          <span>{{ errorText }}</span>
        </div>
      </div>

      <ChatArea
        :messages="messages"
        :tool-calls="toolCalls"
        :is-thinking="isThinking"
        :active-assistant-id="activeAssistantId"
      />

      <InputBar
        v-model="composer"
        :is-busy="isBusy"
        :permission-mode="permissionMode"
        @send="sendMessage"
        @toggle-permission="handleTogglePermission"
      />
    </section>

    <div class="resize-handle" @mousedown="startResize('inspector')"></div>

    <!-- Right inspector -->
    <RightPanel
      :active-tab="activeTab"
      :log-entries="runLog"
      :tool-calls="toolCalls"
      :file-tree="fileTreeData"
      :workspace="settings.workspace"
      :elapsed="elapsed"
      :steps-total="stepsTotal"
      :steps-done="stepsDone"
      :token-used="tokenUsed"
      :cost="cost"
      :git-branch="gitBranch"
      :git-ahead="gitAhead"
      :git-behind="gitBehind"
      :git-changed="gitChanged"
      @select-tab="(t) => activeTab = t"
    />

    <SettingsModal
      :visible="showSettings"
      :provider="settings.provider"
      :model="settings.model"
      :temperature="settings.temperature"
      :workspace="settings.workspace"
      @close="showSettings = false"
      @save="saveSettings"
    />

    <Toast ref="toastRef" />
  </main>
</template>
