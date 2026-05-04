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
  stepsTotal: { type: Number, default: 0 },
  stepsDone: { type: Number, default: 0 },
  tokenUsed: { type: Number, default: 0 },
  cost: { type: String, default: '$0.00' },
  gitBranch: { type: String, default: 'master' },
  gitAhead: { type: Number, default: 0 },
  gitBehind: { type: Number, default: 0 },
  gitChanged: { type: Number, default: 0 },
});

const emit = defineEmits(['select-tab']);

const tabs = [
  { key: 'summary', label: '摘要' },
  { key: 'logs', label: '日志' },
  { key: 'files', label: '文件' },
  { key: 'tools', label: '工具' },
];

function formatTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

const progressPct = computed(() => {
  if (props.stepsTotal === 0) return 0;
  return Math.round((props.stepsDone / props.stepsTotal) * 100);
});
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
        <!-- Task card -->
        <div class="info-card">
          <div class="info-card-header">
            <span>任务进度</span>
            <span class="badge">{{ stepsDone }}/{{ stepsTotal }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">已处理</span>
            <span class="value">{{ elapsed }}</span>
          </div>
          <div class="info-card-row">
            <span class="label">步骤</span>
            <span class="value">{{ stepsDone }}/{{ stepsTotal }} 完成</span>
          </div>
          <div class="progress-bar">
            <div class="progress-bar-fill" :style="{ width: progressPct + '%' }"></div>
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
