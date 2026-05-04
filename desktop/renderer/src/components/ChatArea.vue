<script setup>
import { computed, nextTick, onMounted, onUpdated, ref, watch } from 'vue';

const props = defineProps({
  messages: { type: Array, default: () => [] },
  toolCalls: { type: Array, default: () => [] },
  isThinking: { type: Boolean, default: false },
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

// ── Strip <tool_name>...</tool_name> XML blocks ──
function stripToolCalls(text) {
  // Remove paired XML-like tool call blocks: <read>, <bash>, <write>, etc.
  return text.replace(/<(\w+)>[\s\S]*?<\/\1>/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

// ── Markdown → HTML ──
function renderMarkdown(content) {
  const src = stripToolCalls(String(content || ''));
  if (!src.trim()) return '';
  const blocks = [];
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) { codeLines.push(lines[i]); i++; }
      if (i < lines.length) i++;
      blocks.push(`<div class="code-block-wrap"><div class="code-block-header"><span class="code-block-lang">${esc(lang || 'code')}</span><button class="code-block-btn" data-copy="${escAttr(codeLines.join('\n'))}">复制</button></div><div class="code-block-body">${esc(codeLines.join('\n'))}</div></div>`);
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    const hm = line.match(/^(#{1,3})\s+(.+)/);
    if (hm) { blocks.push(`<h${hm[1].length}>${renderInline(hm[2])}</h${hm[1].length}>`); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(`<li>${renderInline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>`); i++; }
      blocks.push(`<ul>${items.join('')}</ul>`); continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(`<li>${renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''))}</li>`); i++; }
      blocks.push(`<ol>${items.join('')}</ol>`); continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].trim().startsWith('```') && !/^#{1,3}\s+/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) { para.push(lines[i]); i++; }
    blocks.push(`<p>${renderInline(para.join('\n'))}</p>`);
  }
  return blocks.join('');
}

function renderInline(text) {
  let h = esc(text);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  h = h.replace(/\n/g, '<br>');
  return h;
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function escAttr(s) { return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

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

function onCodeCopy(e) {
  const btn = e.target.closest('.code-block-btn');
  if (!btn || !btn.dataset.copy) return;
  navigator.clipboard.writeText(btn.dataset.copy.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'"));
  btn.textContent = '已复制';
  btn.classList.add('copied');
  setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('copied'); }, 2000);
}

function getToolsForMessage(msg) {
  return props.toolCalls.filter((tc) => tc.turn === msg.turn || tc.messageId === msg.id);
}

// ── Demo terminal & diff data (embedded in specific messages) ──
function isTerminalMessage(msg) {
  return msg.terminal && typeof msg.terminal === 'object';
}
function isDiffMessage(msg) {
  return msg.diff && typeof msg.diff === 'object';
}
</script>

<template>
  <div ref="chatRef" class="chat-area" @click="onCodeCopy">
    <div class="chat-inner">
      <!-- Empty -->
      <div v-if="messages.length === 0 && !isThinking" class="empty-state">
        <div class="empty-state-icon">◈</div>
        <h2>开始对话</h2>
        <p>输入任务指令，Agent 将自动读取项目文件、执行命令、调用工具来帮助您完成工作。</p>
      </div>

      <template v-for="msg in messages" :key="msg.id">
        <!-- Regular message -->
        <div class="msg" :class="[msg.role, msg.tone]">
          <div class="msg-header">
            <span class="msg-role">{{ msg.role === 'user' ? '你' : msg.role === 'system' ? '系统' : 'Hax Agent' }}</span>
            <span class="msg-time">{{ formatTime(msg.createdAt) }}</span>
            <span v-if="msg.elapsed" class="msg-time" style="margin-left:4px">· {{ msg.elapsed }}</span>
          </div>
          <div class="msg-body" v-html="renderMarkdown(msg.content)"></div>
        </div>

        <!-- File change indicator (attached to message) -->
        <div v-if="msg.fileChanges" style="padding:0 4px;display:flex;gap:6px;flex-wrap:wrap;">
          <div v-for="fc in msg.fileChanges" :key="fc.file" class="file-change-indicator">
            <span class="file-name">{{ fc.file }}</span>
            <span class="added">+{{ fc.added }}</span>
            <span class="removed">−{{ fc.removed }}</span>
          </div>
        </div>

        <!-- Diff view (embedded) -->
        <div v-if="isDiffMessage(msg)" class="diff-view">
          <div class="diff-header">
            <span class="diff-file">{{ msg.diff.file }}</span>
            <span class="diff-stats">
              <span class="diff-added-count">+{{ msg.diff.added }}</span>
              <span class="diff-removed-count">−{{ msg.diff.removed }}</span>
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

        <!-- Terminal block (embedded) -->
        <div v-if="isTerminalMessage(msg)" class="terminal-block">
          <div class="terminal-header">
            <span class="terminal-dot red"></span>
            <span class="terminal-dot yellow"></span>
            <span class="terminal-dot green"></span>
            <span class="terminal-title">{{ msg.terminal.title || '终端' }}</span>
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
              {{ tc.status === 'running' ? '↻' : tc.status === 'done' ? '✓' : '✕' }}
            </div>
            <div class="tool-call-info">
              <div class="tool-call-name">{{ tc.name }}</div>
              <div class="tool-call-summary">{{ tc.summary || '点击展开详情' }}</div>
            </div>
            <span class="tool-call-status" :class="tc.status">
              {{ tc.status === 'running' ? '执行中' : tc.status === 'done' ? '完成' : '失败' }}
            </span>
            <span class="tool-call-chevron">▼</span>
          </div>
          <div class="tool-call-detail">
            <div v-if="tc.input" class="tool-call-section">
              <div class="tool-call-section-label">输入</div>
              <div class="tool-call-section-content">{{ tc.input }}</div>
            </div>
            <div v-if="tc.output" class="tool-call-section">
              <div class="tool-call-section-label">输出</div>
              <div class="tool-call-section-content">{{ tc.output }}</div>
            </div>
          </div>
        </div>
      </template>

      <!-- Thinking -->
      <div v-if="isThinking" class="thinking-indicator">
        <div class="thinking-avatar">HX</div>
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <span class="thinking-text">思考中…</span>
      </div>
    </div>
  </div>
</template>
