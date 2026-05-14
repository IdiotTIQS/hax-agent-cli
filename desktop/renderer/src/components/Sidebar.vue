<script setup>
import { computed, inject, ref } from 'vue';
import FileTreeNode from './FileTreeNode.vue';

const t = inject('t');

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
const navItems = computed(() => [
  { key: 'chat',    icon: '\u25B8', label: t('desktop.sidebar.chat') },
  { key: 'search',  icon: '\u2315', label: t('desktop.sidebar.search') },
  { key: 'skills',  icon: '\u25C6', label: t('desktop.sidebar.skills') },
  { key: 'plugins', icon: '\u2B21', label: t('desktop.sidebar.plugins') },
  { key: 'auto',    icon: '\u21BB', label: t('desktop.sidebar.automation') },
]);

const maxSessionsPerGroup = 6;

const sessionGroups = computed(() => {
  const groups = [
    { key: 'current', label: t('desktop.sidebar.currentProject'), sessions: [] },
    { key: 'other', label: t('desktop.sidebar.otherProjects'), sessions: [] },
    { key: 'unassigned', label: t('desktop.sidebar.unassignedChats'), sessions: [] },
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
        <span>{{ t('desktop.sidebar.controlPanel') }}</span>
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
        {{ t('desktop.sidebar.newTask') }}
      </button>
    </nav>

    <div class="sidebar-sessions">
      <div class="sidebar-section-label">
        <span>{{ t('desktop.sidebar.recentSessions') }}</span>
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
      <div v-else class="session-empty">{{ t('desktop.sidebar.noHistory') }}</div>
    </div>

    <!-- File Tree -->
    <div class="sidebar-files">
      <div
        class="sidebar-section-label"
        :class="sectionArrow('project')"
        @click="toggleSection('project')"
      >
        <span>{{ t('desktop.sidebar.projectFiles') }}</span>
        <span class="arrow">&#x25BC;</span>
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
        <span style="margin-right:6px">&#x2699;</span> {{ t('desktop.sidebar.settings') }}
      </button>
    </div>
  </aside>
</template>
