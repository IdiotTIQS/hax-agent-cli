<script setup>
import { computed, ref } from 'vue';
import FileTreeNode from './FileTreeNode.vue';

const props = defineProps({
  sessions: { type: Array, default: () => [] },
  activeId: { type: String, default: '' },
  fileTree: { type: Array, default: () => [] },
  activeNav: { type: String, default: 'chat' },
  isBusy: { type: Boolean, default: false },
  navCounts: { type: Object, default: () => ({}) },
});

const emit = defineEmits([
  'select-session', 'new-task', 'open-settings',
  'select-nav', 'toggle-section', 'select-file',
]);

const collapsedSections = ref({ project: false });

// Navigation modules
const navItems = [
  { key: 'chat',    icon: '▸', label: '对话' },
  { key: 'search',  icon: '⌕', label: '搜索' },
  { key: 'skills',  icon: '◆', label: '技能' },
  { key: 'plugins', icon: '⬡', label: '插件' },
  { key: 'auto',    icon: '↻', label: '自动化' },
];

const maxSessionsPerGroup = 6;

const sessionGroups = computed(() => {
  const groups = [
    { key: 'current', label: '当前项目', sessions: [] },
    { key: 'other', label: '其他项目', sessions: [] },
    { key: 'unassigned', label: '未归属对话', sessions: [] },
  ];
  const byKey = new Map(groups.map((group) => [group.key, group]));

  for (const session of props.sessions) {
    const key = session.projectScope || 'unassigned';
    const group = byKey.get(key) || byKey.get('unassigned');
    if (group.sessions.length < maxSessionsPerGroup) {
      group.sessions.push(session);
    }
  }

  return groups.filter((group) => group.sessions.length > 0);
});

function toggleSection(key) {
  collapsedSections.value[key] = !collapsedSections.value[key];
}

function sectionArrow(key) {
  return collapsedSections.value[key] ? 'collapsed' : '';
}
</script>

<template>
  <aside class="sidebar">
    <!-- Brand -->
    <div class="sidebar-brand">
      <div class="sidebar-logo">HX</div>
      <div class="sidebar-brand-text">
        <h1>Hax Agent</h1>
        <span>控制面板</span>
      </div>
    </div>

    <!-- Navigation Modules -->
    <nav class="sidebar-nav">
      <button
        v-for="item in navItems"
        :key="item.key"
        class="nav-item"
        :class="{ active: activeNav === item.key }"
        @click="emit('select-nav', item.key)"
      >
        <span class="nav-icon">{{ item.icon }}</span>
        {{ item.label }}
        <span v-if="navCounts[item.key] !== undefined" class="nav-badge">{{ navCounts[item.key] }}</span>
      </button>
      <div class="nav-separator"></div>
      <button class="nav-item" @click="emit('new-task')" :disabled="isBusy">
        <span class="nav-icon">+</span>
        新任务
      </button>
    </nav>

    <div class="sidebar-sessions">
      <div class="sidebar-section-label">
        <span>最近会话</span>
        <span class="count">{{ sessions.length }}</span>
      </div>
      <div v-if="sessionGroups.length" class="session-list">
        <div v-for="group in sessionGroups" :key="group.key" class="session-group">
          <div class="session-group-label">{{ group.label }}</div>
          <button
            v-for="session in group.sessions"
            :key="session.id"
            class="session-item"
            :class="{ active: activeId === session.id }"
            @click="emit('select-session', session.id)"
          >
            <span class="session-title">{{ session.preview }}</span>
            <span class="session-meta">{{ session.projectName }} · {{ session.messageCount }} messages</span>
          </button>
        </div>
      </div>
      <div v-else class="session-empty">暂无历史会话</div>
    </div>

    <!-- File Tree -->
    <div class="sidebar-files">
      <div
        class="sidebar-section-label"
        :class="sectionArrow('project')"
        @click="toggleSection('project')"
      >
        <span>项目文件</span>
        <span class="arrow">▼</span>
      </div>
      <div v-if="!collapsedSections.project" class="file-tree">
        <FileTreeNode
          v-for="node in fileTree"
          :key="node.path"
          :node="node"
          :depth="0"
          @select="(p) => emit('select-file', p)"
        />
      </div>
    </div>

    <!-- Footer -->
    <div class="sidebar-footer">
      <button class="sidebar-footer-btn" @click="emit('open-settings')">
        <span style="margin-right:6px">⚙</span> 设置
      </button>
    </div>
  </aside>
</template>
