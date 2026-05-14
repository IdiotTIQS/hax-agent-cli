<script setup>
import { computed, inject, ref } from 'vue';

const props = defineProps({
  modelValue: { type: String, default: '' },
  isBusy: { type: Boolean, default: false },
  maxLength: { type: Number, default: 4000 },
  placeholder: { type: String, default: '' },
  permissionMode: { type: String, default: 'normal' },
});

const emit = defineEmits(['update:modelValue', 'send', 'attach', 'toggle-permission']);

const t = inject('t');
const textareaRef = ref(null);

const charCount = computed(() => props.modelValue.length);
const canSend = computed(() => props.modelValue.trim().length > 0 && !props.isBusy);

const resolvedPlaceholder = computed(() => props.placeholder || t('desktop.input.placeholder'));

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
          :placeholder="resolvedPlaceholder"
          :disabled="isBusy"
          :maxlength="maxLength"
          rows="1"
          @input="onInput"
          @keydown="onKeydown"
        ></textarea>

        <div class="input-actions">
          <button class="btn-icon" :title="t('desktop.input.attach')" :disabled="isBusy" @click="emit('attach')">+</button>
          <button
            class="perm-toggle"
            :class="{ full: permissionMode === 'full' }"
            :title="permissionMode === 'full' ? t('desktop.input.fullAccess') : t('desktop.input.restrictedAccess')"
            @click="emit('toggle-permission')"
          >
            {{ permissionMode === 'full' ? t('desktop.input.fullPerm') : t('desktop.input.restricted') }}
          </button>
          <button class="input-send-btn" :disabled="!canSend" :title="t('desktop.input.sendTitle')" @click="emit('send')">↑</button>
        </div>
      </div>

      <div class="input-footer">
        <div class="input-hints">
          <span><kbd>Enter</kbd> {{ t('desktop.input.send') }}</span>
          <span><kbd>Shift</kbd>+<kbd>Enter</kbd> {{ t('desktop.input.newline') }}</span>
          <span><kbd>Ctrl</kbd>+<kbd>K</kbd> {{ t('desktop.input.panel') }}</span>
        </div>
        <div class="input-charcount">{{ charCount }}/{{ maxLength }}</div>
      </div>
    </div>
  </div>
</template>
