<script setup>
import { computed, inject } from 'vue';
import FileTreeNode from './FileTreeNode.vue';

const t = inject('t');

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

const tabs = computed(() => [
  { key: 'summary', label: t('desktop.panel.summary') },
  { key: 'git', label: t('desktop.panel.git') },
  { key: 'logs', label: t('desktop.panel.logs') },
  { key: 'files', label: t('desktop.panel.files') },
  { key: 'tools', label: t('desktop.panel.tools') },
]);

function formatTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

const hasToolActivity = computed(() => props.toolCalls.some((tc) => tc && tc.status));
const sessionMode = computed(() => hasToolActivity.value ? t('desktop.panel.toolRunning') : t('desktop.panel.normalChat'));
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
    default: return '\u2022';
  }
}

const toolStatusLabel = (tc) => {
  if (tc.status === 'running') return t('desktop.panel.running');
  if (tc.status === 'done') return t('desktop.panel.done');
  return t('desktop.panel.failed');
};
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
            <span>{{ t('desktop.panel.sessionStatus') }}</span>
            <span class="badge">{{ sessionMode }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">{{ t('desktop.panel.processed') }}</span>
            <span class="value">{{ elapsed }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">{{ t('desktop.panel.toolCalls') }}</span>
            <span class="value">{{ toolCalls.length }}</span>
          </div>
        </div>

        <!-- Performance card -->
        <div class="info-card">
          <div class="info-card-header">
            <span>{{ t('desktop.panel.performance') }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">{{ t('desktop.panel.tokenUsed') }}</span>
            <span class="value">{{ tokenUsed.toLocaleString() }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">{{ t('desktop.panel.estimatedCost') }}</span>
            <span class="value accent">{{ cost }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">{{ t('desktop.panel.toolCalls') }}</span>
            <span class="value">{{ toolCalls.length }}</span>
          </div>
        </div>

        <!-- Git card -->
        <div class="info-card">
          <div class="info-card-header">
            <span>{{ t('desktop.panel.gitStatus') }}</span>
            <span class="badge">{{ gitBranch }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">{{ t('desktop.panel.branch') }}</span>
            <span class="value">{{ gitBranch }}</span>
          </div>
          <div class="info-card-row" v-if="gitAhead > 0">
            <span class="label">{{ t('desktop.panel.ahead') }}</span>
            <span class="value success">{{ gitAhead }} commits</span>
          </div>
          <div class="info-card-row" v-if="gitBehind > 0">
            <span class="label">{{ t('desktop.panel.behind') }}</span>
            <span class="value error">{{ gitBehind }} commits</span>
          </div>
          <div class="info-card-row" v-if="gitChanged > 0">
            <span class="label">{{ t('desktop.panel.changes') }}</span>
            <span class="value accent">{{ gitChanged }} files</span>
          </div>
          <div class="info-card-row" v-if="gitAhead === 0 && gitBehind === 0 && gitChanged === 0">
            <span class="label">{{ t('desktop.panel.status') }}</span>
            <span class="value success">{{ t('desktop.panel.synced') }}</span>
          </div>
        </div>

        <!-- Workspace -->
        <div class="info-card">
          <div class="info-card-header"><span>{{ t('desktop.panel.workspace') }}</span></div>
          <div style="font-size:12px;font-family:var(--font-mono);color:var(--text-secondary);word-break:break-all;">
            {{ workspace || t('desktop.panel.currentProjectRoot') }}
          </div>
        </div>
      </div>

      <!-- Git -->
      <div v-if="activeTab === 'git'" class="git-panel">
        <div class="info-card">
          <div class="info-card-header">
            <span>{{ t('desktop.panel.changeOverview') }}</span>
            <span class="badge">{{ gitBranch }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">{{ t('desktop.panel.changedFiles') }}</span>
            <span class="value accent">{{ gitFiles.length }}</span>
          </div>
          <div class="info-card-row" v-if="gitAhead > 0 || gitBehind > 0">
            <span class="label">{{ t('desktop.panel.remote') }}</span>
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
            {{ t('desktop.panel.noChanges') }}
          </div>
        </div>

        <div class="git-diff-card">
          <div class="git-diff-head">
            <span>{{ selectedGitFile || t('desktop.panel.selectFile') }}</span>
            <span v-if="isLoadingGitDiff">loading…</span>
          </div>
          <div class="git-actions">
            <button
              class="git-action-btn"
              type="button"
              :disabled="!hasSelectedDiff || isBusy"
              @click="emit('git-assist', 'explain')"
            >
              {{ t('desktop.panel.explainDiff') }}
            </button>
            <button
              class="git-action-btn"
              type="button"
              :disabled="!hasSelectedDiff || isBusy"
              @click="emit('git-assist', 'commit')"
            >
              {{ t('desktop.panel.commitMessage') }}
            </button>
            <button
              class="git-action-btn"
              type="button"
              :disabled="!hasSelectedDiff || isBusy"
              @click="emit('git-assist', 'pr')"
            >
              {{ t('desktop.panel.prDescription') }}
            </button>
            <button
              class="git-action-btn"
              type="button"
              :disabled="!hasSelectedDiff || isBusy"
              @click="emit('git-assist', 'review')"
            >
              {{ t('desktop.panel.reviewChecklist') }}
            </button>
          </div>
          <div v-if="selectedGitDiff?.truncated" class="empty-panel">{{ t('desktop.panel.diffTruncated') }}</div>
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
            {{ t('desktop.panel.noDiff') }}
          </div>
        </div>
      </div>

      <!-- Logs -->
      <div v-if="activeTab === 'logs'" class="log-list">
        <div v-if="logEntries.length === 0" style="padding:16px;color:var(--text-disabled);font-size:12px;text-align:center;">
          {{ t('desktop.panel.noLogs') }}
        </div>
        <div v-for="entry in logEntries" :key="entry.id" class="log-entry">
          <span class="log-entry-time">{{ formatTime(entry.time) }}</span>
          <span class="log-entry-text">{{ entry.label }}</span>
        </div>
      </div>

      <!-- Files -->
      <div v-if="activeTab === 'files'">
        <div v-if="!fileTree || fileTree.length === 0" style="padding:16px;color:var(--text-disabled);font-size:12px;text-align:center;">
          {{ t('desktop.panel.noFiles') }}
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
          {{ t('desktop.panel.noToolCalls') }}
        </div>
        <div v-for="tc in toolCalls" :key="tc.id" class="tool-item-inspector">
          <div class="tool-item-header">
            <span class="tool-item-name">{{ tc.name }}</span>
            <span class="tool-item-status" :class="tc.status">
              {{ toolStatusLabel(tc) }}
            </span>
          </div>
          <div class="tool-item-detail">{{ tc.summary || tc.detail || t('desktop.panel.waitingOutput') }}</div>
        </div>
      </div>
    </div>
  </aside>
</template>
