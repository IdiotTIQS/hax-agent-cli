<script setup>
import { computed, inject, ref } from 'vue';

const t = inject('t');

const props = defineProps({
  title: { type: String, default: '' },
  status: { type: String, default: 'idle' },
  isBusy: { type: Boolean, default: false },
  model: { type: String, default: '' },
  models: { type: Array, default: () => [] },
  scopeLabel: { type: String, default: '' },
  scopeTitle: { type: String, default: '' },
  darkMode: { type: Boolean, default: false },
});

const emit = defineEmits(['interrupt', 'select-model', 'toggle-theme']);

const modelOpen = ref(false);

const displayStatus = computed(() => {
  switch (props.status) {
    case 'running': return t('desktop.topbar.running');
    case 'thinking': return t('desktop.topbar.thinking');
    case 'error': return t('desktop.topbar.error');
    default: return t('desktop.topbar.idle');
  }
});

const resolvedTitle = computed(() => props.title || t('desktop.topbar.title'));

function toggleDropdown() { modelOpen.value = !modelOpen.value; }
function selectModel(m) { emit('select-model', m); modelOpen.value = false; }
</script>

<template>
  <header class="topbar">
    <div class="topbar-title-group">
      <div class="topbar-title">{{ resolvedTitle }}</div>
      <div v-if="scopeLabel" class="topbar-scope" :title="scopeTitle">{{ scopeLabel }}</div>
    </div>
    <div class="topbar-actions">
      <button class="btn btn-ghost" :title="darkMode ? 'Light mode' : 'Dark mode'" @click="emit('toggle-theme')" style="font-size:16px;padding:0 8px;">
        {{ darkMode ? '\u2600' : '\u263D' }}
      </button>

      <span class="status-badge" :class="status">
        <span class="status-dot"></span> {{ displayStatus }}
      </span>

      <div class="model-selector">
        <button class="model-select-trigger" :class="{ open: modelOpen }" @click="toggleDropdown">
          <span>{{ model || t('desktop.topbar.defaultModel') }}</span>
          <span class="arrow">&#x25BC;</span>
        </button>
        <div v-if="modelOpen" class="model-select-dropdown">
          <button
            v-for="m in models" :key="m.value"
            class="model-select-option"
            :class="{ selected: m.value === model }"
            @click="selectModel(m.value)"
          >
            <span>{{ m.label }}</span>
            <span v-if="m.value === model" class="check">&#x2713;</span>
          </button>
        </div>
      </div>

      <button class="btn btn-danger" :disabled="!isBusy" @click="emit('interrupt')">{{ t('desktop.topbar.interrupt') }}</button>
    </div>
  </header>
</template>
