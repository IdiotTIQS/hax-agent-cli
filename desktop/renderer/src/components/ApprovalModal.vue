<script setup>
import { computed, inject } from 'vue';

const t = inject('t');

const props = defineProps({
  request: { type: Object, default: null },
});

const emit = defineEmits(['decide']);

const visible = computed(() => Boolean(props.request));
const levelLabel = computed(() => {
  const level = props.request?.level || 'ask';
  if (level === 'dangerous') return t('desktop.approval.highRisk');
  if (level === 'ask') return t('desktop.approval.needsConfirm');
  return level;
});
const levelTone = computed(() => (props.request?.level === 'dangerous' ? 'danger' : 'ask'));
const argsPreview = computed(() => {
  const args = props.request?.toolArgs;
  if (args == null) return '';
  if (typeof args === 'string') return args;
  return JSON.stringify(args, null, 2);
});

function decide(decision) {
  emit('decide', decision);
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="approval-overlay">
      <section class="approval-panel" role="dialog" aria-modal="true" aria-labelledby="approval-title">
        <div class="approval-header">
          <div>
            <div class="approval-kicker">Tool Approval</div>
            <h2 id="approval-title">{{ t('desktop.approval.title') }}</h2>
          </div>
          <span class="approval-level" :class="levelTone">{{ levelLabel }}</span>
        </div>

        <div class="approval-body">
          <div class="approval-summary">
            <span class="approval-tool">{{ request.toolName }}</span>
            <span v-if="request.toolKey" class="approval-key">{{ request.toolKey }}</span>
          </div>
          <p class="approval-description">{{ request.description }}</p>
          <pre v-if="argsPreview" class="approval-args">{{ argsPreview }}</pre>
        </div>

        <div class="approval-actions">
          <button class="btn btn-ghost" type="button" @click="decide('deny')">{{ t('desktop.approval.deny') }}</button>
          <button class="btn btn-danger" type="button" @click="decide('always_deny')">{{ t('desktop.approval.alwaysDeny') }}</button>
          <button class="btn btn-ghost" type="button" @click="decide('always_allow')">{{ t('desktop.approval.alwaysAllow') }}</button>
          <button class="btn btn-primary" type="button" autofocus @click="decide('approve')">{{ t('desktop.approval.allowOnce') }}</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
