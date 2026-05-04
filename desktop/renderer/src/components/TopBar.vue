<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  title: { type: String, default: 'Agent 工作区' },
  status: { type: String, default: 'idle' },
  isBusy: { type: Boolean, default: false },
  model: { type: String, default: '' },
  models: { type: Array, default: () => [] },
});

const emit = defineEmits(['interrupt', 'select-model']);

const modelOpen = ref(false);

const displayStatus = computed(() => {
  switch (props.status) {
    case 'running': return '运行中';
    case 'thinking': return '思考中';
    case 'error': return '错误';
    default: return '空闲';
  }
});

function toggleDropdown() { modelOpen.value = !modelOpen.value; }
function selectModel(m) { emit('select-model', m); modelOpen.value = false; }
</script>

<template>
  <header class="topbar">
    <div class="topbar-title">{{ title }}</div>
    <div class="topbar-actions">
      <span class="status-badge" :class="status">
        <span class="status-dot"></span> {{ displayStatus }}
      </span>

      <div class="model-selector">
        <button class="model-select-trigger" :class="{ open: modelOpen }" @click="toggleDropdown">
          <span>{{ model || '默认模型' }}</span>
          <span class="arrow">▼</span>
        </button>
        <div v-if="modelOpen" class="model-select-dropdown">
          <button
            v-for="m in models" :key="m.value"
            class="model-select-option"
            :class="{ selected: m.value === model }"
            @click="selectModel(m.value)"
          >
            <span>{{ m.label }}</span>
            <span v-if="m.value === model" class="check">✓</span>
          </button>
        </div>
      </div>

      <button class="btn btn-danger" :disabled="!isBusy" @click="emit('interrupt')">■ 中断</button>
    </div>
  </header>
</template>
