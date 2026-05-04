<script setup>
import { ref } from 'vue';

const toasts = ref([]);
let nextId = 1;

function add(message, type = 'info', duration = 3000) {
  const id = nextId++;
  toasts.value.push({ id, message, type });
  if (duration > 0) setTimeout(() => dismiss(id), duration);
  return id;
}

function dismiss(id) {
  const idx = toasts.value.findIndex((t) => t.id === id);
  if (idx < 0) return;
  toasts.value[idx].leaving = true;
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, 180);
}

function success(msg) { return add(msg, 'success'); }
function error(msg) { return add(msg, 'error'); }
function warning(msg) { return add(msg, 'warning'); }
function info(msg) { return add(msg, 'info'); }

defineExpose({ add, dismiss, success, error, warning, info });
</script>

<template>
  <div class="toast-container" aria-live="polite">
    <div
      v-for="t in toasts"
      :key="t.id"
      class="toast"
      :class="[t.type, { dismissing: t.leaving }]"
    >
      <span>{{ t.message }}</span>
      <button class="toast-btn" @click="dismiss(t.id)">撤销</button>
    </div>
  </div>
</template>
