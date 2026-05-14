<script setup>
import { inject, nextTick, onMounted, onUpdated, ref, watch } from 'vue';
import { renderMarkdown } from '../markdown.mjs';

const t = inject('t');

const props = defineProps({
  messages: { type: Array, default: () => [] },
  toolCalls: { type: Array, default: () => [] },
  isThinking: { type: Boolean, default: false },
  isStreaming: { type: Boolean, default: false },
  activeAssistantId: { type: String, default: '' },
});

const emit = defineEmits(['copy-code', 'toggle-tool', 'retry']);

const chatRef = ref(null);
const expandedTools = ref(new Set());

function scrollToBottom() {
  nextTick(() => {
    if (chatRef.value) chatRef.value.scrollTop = chatRef.value.scrollHeight;
  });
}
onMounted(() => scrollToBottom());
onUpdated(() => scrollToBottom());
watch(() => props.messages.length, () => scrollToBottom());

function formatTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}

function isExpanded(id) { return expandedTools.value.has(id); }
function toggleTool(id) {
  const s = new Set(expandedTools.value);
  s.has(id) ? s.delete(id) : s.add(id);
  expandedTools.value = s;
}

function isSafeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const copyLabel = ref(t('desktop.chat.copy'));
const copiedLabel = ref(t('desktop.chat.copied'));

function onMessageClick(e) {
  const btn = e.target.closest('.code-block-btn');
  if (btn?.dataset.copy) {
    navigator.clipboard?.writeText(btn.dataset.copy);
    btn.textContent = copiedLabel.value;
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = copyLabel.value; btn.classList.remove('copied'); }, 2000);
    return;
  }

  const link = e.target.closest('a.markdown-link');
  if (!link) return;

  e.preventDefault();
  const href = link.getAttribute('href') || '';
  if (!isSafeExternalUrl(href)) return;
  window.haxAgent?.openExternal?.(href) ?? window.open(href, '_blank', 'noopener,noreferrer');
}

function getToolsForMessage(msg) {
  return props.toolCalls.filter((tc) => tc.turn === msg.turn || tc.messageId === msg.id);
}

function msgRoleLabel(msg) {
  if (msg.role === 'user') return t('desktop.chat.you');
  if (msg.role === 'system') return t('desktop.chat.system');
  return 'Hax Agent';
}

function toolStatusLabel(tc) {
  if (tc.status === 'running') return t('desktop.chat.running');
  if (tc.status === 'done') return t('desktop.chat.done');
  return t('desktop.chat.failed');
}

// ── Demo terminal & diff data ──
function isTerminalMessage(msg) {
  return msg.terminal && typeof msg.terminal === 'object';
}
function isDiffMessage(msg) {
  return msg.diff && typeof msg.diff === 'object';
}
</script>

<template>
  <div ref="chatRef" class="chat-area" @click="onMessageClick">
    <div class="chat-inner">
      <!-- Empty -->
      <div v-if="messages.length === 0 && !isThinking" class="empty-state">
        <div class="empty-state-icon">\u25C8</div>
        <h2>{{ t('desktop.chat.startChat') }}</h2>
        <p>{{ t('desktop.chat.startSubtitle') }}</p>
      </div>

      <template v-for="msg in messages" :key="msg.id">
        <!-- Regular message -->
        <div class="msg" :class="[msg.role, msg.tone]">
          <div class="msg-header">
            <span class="msg-role">{{ msgRoleLabel(msg) }}</span>
            <span class="msg-time">{{ formatTime(msg.createdAt) }}</span>
            <span v-if="msg.elapsed" class="msg-time" style="margin-left:4px">· {{ msg.elapsed }}</span>
          </div>
          <div class="msg-body" v-html="renderMarkdown(msg.content)"></div>
        </div>

        <!-- File change indicator -->
        <div v-if="msg.fileChanges" style="padding:0 4px;display:flex;gap:6px;flex-wrap:wrap;">
          <div v-for="fc in msg.fileChanges" :key="fc.file" class="file-change-indicator">
            <span class="file-name">{{ fc.file }}</span>
            <span class="added">+{{ fc.added }}</span>
            <span class="removed">\u2212{{ fc.removed }}</span>
          </div>
        </div>

        <!-- Diff view -->
        <div v-if="isDiffMessage(msg)" class="diff-view">
          <div class="diff-header">
            <span class="diff-file">{{ msg.diff.file }}</span>
            <span class="diff-stats">
              <span class="diff-added-count">+{{ msg.diff.added }}</span>
              <span class="diff-removed-count">\u2212{{ msg.diff.removed }}</span>
            </span>
          </div>
          <div class="diff-lines">
            <div
              v-for="(dl, di) in msg.diff.lines"
              :key="di"
              class="diff-line"
              :class="dl.type"
            >
              <span class="diff-line-num">{{ dl.oldNum || '' }} {{ dl.newNum || '' }}</span>
              <span class="diff-line-content">{{ dl.content }}</span>
            </div>
          </div>
        </div>

        <!-- Terminal block -->
        <div v-if="isTerminalMessage(msg)" class="terminal-block">
          <div class="terminal-header">
            <span class="terminal-dot red"></span>
            <span class="terminal-dot yellow"></span>
            <span class="terminal-dot green"></span>
            <span class="terminal-title">{{ msg.terminal.title || t('desktop.chat.terminal') }}</span>
          </div>
          <div class="terminal-body">
            <div v-for="(line, li) in msg.terminal.lines" :key="li" :class="'terminal-' + (line.type || 'output')">
              <template v-if="line.type === 'prompt'"><span class="terminal-prompt">$ </span>{{ line.text }}</template>
              <template v-else>{{ line.text }}</template>
            </div>
          </div>
        </div>

        <!-- Tool calls -->
        <div
          v-for="tc in getToolsForMessage(msg)"
          :key="tc.id"
          class="tool-call"
          :class="{ expanded: isExpanded(tc.id) }"
        >
          <div class="tool-call-header" @click="toggleTool(tc.id)">
            <div class="tool-call-icon" :class="tc.status">
              {{ tc.status === 'running' ? '\u21BB' : tc.status === 'done' ? '\u2713' : '\u2715' }}
            </div>
            <div class="tool-call-info">
              <div class="tool-call-name">{{ tc.name }}</div>
              <div class="tool-call-summary">{{ tc.summary || t('desktop.chat.clickToExpand') }}</div>
            </div>
            <span class="tool-call-status" :class="tc.status">
              {{ toolStatusLabel(tc) }}
            </span>
            <span class="tool-call-chevron">\u25BC</span>
          </div>
          <div class="tool-call-detail">
            <div v-if="tc.input" class="tool-call-section">
              <div class="tool-call-section-label">{{ t('desktop.chat.input') }}</div>
              <div class="tool-call-section-content">{{ tc.input }}</div>
            </div>
            <div v-if="tc.output" class="tool-call-section">
              <div class="tool-call-section-label">{{ t('desktop.chat.output') }}</div>
              <div class="tool-call-section-content">{{ tc.output }}</div>
            </div>
          </div>
        </div>
      </template>

      <!-- Thinking -->
      <div v-if="isThinking || isStreaming" class="thinking-indicator" :class="{ streaming: isStreaming && !isThinking }">
        <div class="thinking-avatar">HX</div>
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <span class="thinking-text">{{ isStreaming && !isThinking ? t('desktop.chat.outputting') : t('desktop.chat.thinking') }}</span>
      </div>
    </div>
  </div>
</template>
