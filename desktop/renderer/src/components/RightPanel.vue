<script setup>
import { computed } from 'vue';
import FileTreeNode from './FileTreeNode.vue';

const props = defineProps({
  activeTab: { type: String, default: 'summary' },
  logEntries: { type: Array, default: () => [] },
  toolCalls: { type: Array, default: () => [] },
  fileTree: { type: Array, default: () => [] },
  workspace: { type: String, default: '' },
  // Stats
  elapsed: { type: String, default: '0s' },
  tokenUsed: { type: Number, default: 0 },
  cost: { type: String, default: '$0.00' },
  gitBranch: { type: String, default: 'master' },
  gitAhead: { type: Number, default: 0 },
  gitBehind: { type: Number, default: 0 },
  gitChanged: { type: Number, default: 0 },
  gitFiles: { type: Array, default: () => [] },
  selectedGitFile: { type: String, default: '' },
  selectedGitDiff: { type: Object, default: null },
  isLoadingGitDiff: { type: Boolean, default: false },
  isBusy: { type: Boolean, default: false },
});

const emit = defineEmits(['select-tab', 'select-git-file', 'git-assist']);

const tabs = [
  { key: 'summary', label: '摘要' },
  { key: 'git', label: 'Git' },
  { key: 'logs', label: '日志' },
  { key: 'files', label: '文件' },
  { key: 'tools', label: '工具' },
];

function formatTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

const hasToolActivity = computed(() => props.toolCalls.some((tc) => tc && tc.status));
const sessionMode = computed(() => (hasToolActivity.value ? '工具执行中' : '普通对话'));
const hasSelectedDiff = computed(() => Boolean(String(props.selectedGitDiff?.diff || '').trim()));
const diffLines = computed(() => String(props.selectedGitDiff?.diff || '').split(/\r?\n/).map((text, index) => ({
  id: `${index}:${text}`,
  text,
  type: text.startsWith('+') && !text.startsWith('+++') ? 'added'
    : text.startsWith('-') && !text.startsWith('---') ? 'removed'
      : text.startsWith('@@') ? 'hunk'
        : text.startsWith('diff --git') || text.startsWith('# ') ? 'header'
          : 'context',
})));

function statusLabel(status) {
  switch (status) {
    case 'modified': return 'M';
    case 'added': return 'A';
    case 'deleted': return 'D';
    case 'renamed': return 'R';
    case 'untracked': return '?';
    default: return '•';
  }
}
</script>

<template>
  <aside class="inspector">
    <div class="inspector-tabs">
      <button
        v-for="tab in tabs" :key="tab.key"
        class="inspector-tab"
        :class="{ active: activeTab === tab.key }"
        @click="emit('select-tab', tab.key)"
      >{{ tab.label }}</button>
    </div>

    <div class="inspector-content">
      <!-- Summary -->
      <div v-if="activeTab === 'summary'">
        <!-- Session card -->
        <div class="info-card">
          <div class="info-card-header">
            <span>会话状态</span>
            <span class="badge">{{ sessionMode }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">已处理</span>
            <span class="value">{{ elapsed }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">工具调用</span>
            <span class="value">{{ toolCalls.length }} 次</span>
          </div>
        </div>

        <!-- Performance card -->
        <div class="info-card">
          <div class="info-card-header">
            <span>性能指标</span>
          </div>
          <div class="info-card-row">
            <span class="label">Token 消耗</span>
            <span class="value">{{ tokenUsed.toLocaleString() }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">预估费用</span>
            <span class="value accent">{{ cost }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">工具调用</span>
            <span class="value">{{ toolCalls.length }} 次</span>
          </div>
        </div>

        <!-- Git card -->
        <div class="info-card">
          <div class="info-card-header">
            <span>Git 状态</span>
            <span class="badge">{{ gitBranch }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">分支</span>
            <span class="value">{{ gitBranch }}</span>
          </div>
          <div class="info-card-row" v-if="gitAhead > 0">
            <span class="label">领先</span>
            <span class="value success">{{ gitAhead }} commits</span>
          </div>
          <div class="info-card-row" v-if="gitBehind > 0">
            <span class="label">落后</span>
            <span class="value error">{{ gitBehind }} commits</span>
          </div>
          <div class="info-card-row" v-if="gitChanged > 0">
            <span class="label">变更</span>
            <span class="value accent">{{ gitChanged }} files</span>
          </div>
          <div class="info-card-row" v-if="gitAhead === 0 && gitBehind === 0 && gitChanged === 0">
            <span class="label">状态</span>
            <span class="value success">已同步</span>
          </div>
        </div>

        <!-- Workspace -->
        <div class="info-card">
          <div class="info-card-header"><span>工作区</span></div>
          <div style="font-size:12px;font-family:var(--font-mono);color:var(--text-secondary);word-break:break-all;">
            {{ workspace || '当前项目根目录' }}
          </div>
        </div>
      </div>

      <!-- Git -->
      <div v-if="activeTab === 'git'" class="git-panel">
        <div class="info-card">
          <div class="info-card-header">
            <span>变更概览</span>
            <span class="badge">{{ gitBranch }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">变更文件</span>
            <span class="value accent">{{ gitFiles.length }}</span>
          </div>
          <div class="info-card-row" v-if="gitAhead > 0 || gitBehind > 0">
            <span class="label">远端</span>
            <span class="value">{{ gitAhead }}↑ {{ gitBehind }}↓</span>
          </div>
        </div>

        <div class="git-file-list">
          <button
            v-for="file in gitFiles"
            :key="file.path"
            class="git-file-item"
            :class="{ active: selectedGitFile === file.path }"
            type="button"
            @click="emit('select-git-file', file.path)"
          >
            <span class="git-file-status" :class="file.status">{{ statusLabel(file.status) }}</span>
            <span class="git-file-path">{{ file.path }}</span>
          </button>
          <div v-if="gitFiles.length === 0" class="empty-panel">
            没有工作区变更
          </div>
        </div>

        <div class="git-diff-card">
          <div class="git-diff-head">
            <span>{{ selectedGitFile || '选择文件查看 diff' }}</span>
            <span v-if="isLoadingGitDiff">loading…</span>
          </div>
          <div class="git-actions">
            <button
              class="git-action-btn"
              type="button"
              :disabled="!hasSelectedDiff || isBusy"
              @click="emit('git-assist', 'explain')"
            >
              解释 diff
            </button>
            <button
              class="git-action-btn"
              type="button"
              :disabled="!hasSelectedDiff || isBusy"
              @click="emit('git-assist', 'commit')"
            >
              提交说明
            </button>
          </div>
          <div v-if="selectedGitDiff?.truncated" class="empty-panel">Diff 已截断</div>
          <div v-if="selectedGitDiff?.diff" class="git-diff-lines">
            <div
              v-for="line in diffLines"
              :key="line.id"
              class="git-diff-line"
              :class="line.type"
            >
              {{ line.text || ' ' }}
            </div>
          </div>
          <div v-else-if="selectedGitFile && !isLoadingGitDiff" class="empty-panel">
            没有可显示的 diff
          </div>
        </div>
      </div>

      <!-- Logs -->
      <div v-if="activeTab === 'logs'" class="log-list">
        <div v-if="logEntries.length === 0" style="padding:16px;color:var(--text-disabled);font-size:12px;text-align:center;">
          暂无日志
        </div>
        <div v-for="entry in logEntries" :key="entry.id" class="log-entry">
          <span class="log-entry-time">{{ formatTime(entry.time) }}</span>
          <span class="log-entry-text">{{ entry.label }}</span>
        </div>
      </div>

      <!-- Files -->
      <div v-if="activeTab === 'files'">
        <div v-if="!fileTree || fileTree.length === 0" style="padding:16px;color:var(--text-disabled);font-size:12px;text-align:center;">
          暂无文件
        </div>
        <div v-else class="file-tree">
          <FileTreeNode
            v-for="node in fileTree" :key="node.path"
            :node="node" :depth="0"
            @select="(p) => {}"
          />
        </div>
      </div>

      <!-- Tools -->
      <div v-if="activeTab === 'tools'" class="tool-list-inspector">
        <div v-if="toolCalls.length === 0" style="padding:16px;color:var(--text-disabled);font-size:12px;text-align:center;">
          暂无工具调用
        </div>
        <div v-for="tc in toolCalls" :key="tc.id" class="tool-item-inspector">
          <div class="tool-item-header">
            <span class="tool-item-name">{{ tc.name }}</span>
            <span class="tool-item-status" :class="tc.status">
              {{ tc.status === 'running' ? '执行中' : tc.status === 'done' ? '完成' : '失败' }}
            </span>
          </div>
          <div class="tool-item-detail">{{ tc.summary || tc.detail || '等待输出…' }}</div>
        </div>
      </div>
    </div>
  </aside>
</template>
