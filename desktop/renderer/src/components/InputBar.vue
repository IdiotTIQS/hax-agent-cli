<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  isBusy: { type: Boolean, default: false },
  maxLength: { type: Number, default: 4000 },
  placeholder: { type: String, default: '向 Agent 发送指令…' },
  permissionMode: { type: String, default: 'normal' },
});

const emit = defineEmits(['update:modelValue', 'send', 'attach', 'toggle-permission']);

const textareaRef = ref(null);

const charCount = computed(() => props.modelValue.length);
const canSend = computed(() => props.modelValue.trim().length > 0 && !props.isBusy);

function onInput(e) {
  emit('update:modelValue', e.target.value);
  const el = e.target;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 150) + 'px';
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (canSend.value) emit('send');
  }
}

function focus() { textareaRef.value?.focus(); }
defineExpose({ focus });
</script>

<template>
  <div class="input-bar">
    <div class="input-bar-inner">
      <div class="input-wrapper">
        <textarea
          ref="textareaRef"
          :value="modelValue"
          :placeholder="placeholder"
          :disabled="isBusy"
          :maxlength="maxLength"
          rows="1"
          @input="onInput"
          @keydown="onKeydown"
        ></textarea>

        <div class="input-actions">
          <button class="btn-icon" title="附加文件" :disabled="isBusy" @click="emit('attach')">+</button>
          <button
            class="perm-toggle"
            :class="{ full: permissionMode === 'full' }"
            :title="permissionMode === 'full' ? '完全访问权限' : '受限权限'"
            @click="emit('toggle-permission')"
          >
            {{ permissionMode === 'full' ? '完全权限' : '受限' }}
          </button>
          <button class="input-send-btn" :disabled="!canSend" title="发送 (Enter)" @click="emit('send')">↑</button>
        </div>
      </div>

      <div class="input-footer">
        <div class="input-hints">
          <span><kbd>Enter</kbd> 发送</span>
          <span><kbd>Shift</kbd>+<kbd>Enter</kbd> 换行</span>
          <span><kbd>Ctrl</kbd>+<kbd>K</kbd> 面板</span>
        </div>
        <div class="input-charcount">{{ charCount }}/{{ maxLength }}</div>
      </div>
    </div>
  </div>
</template>
