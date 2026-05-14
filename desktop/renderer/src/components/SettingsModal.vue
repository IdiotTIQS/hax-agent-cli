<script setup>
import { inject, reactive, watch } from 'vue';

const t = inject('t');

const props = defineProps({
  visible: { type: Boolean, default: false },
  provider: { type: String, default: 'auto' },
  model: { type: String, default: '' },
  temperature: { type: Number, default: 0.3 },
  workspace: { type: String, default: '' },
});

const emit = defineEmits(['close', 'save', 'choose-workspace']);

const form = reactive({
  provider: props.provider,
  model: props.model,
  temperature: props.temperature,
  workspace: props.workspace,
});

watch(() => props.provider, (v) => { form.provider = v; });
watch(() => props.model, (v) => { form.model = v; });
watch(() => props.temperature, (v) => { form.temperature = v; });
watch(() => props.workspace, (v) => { form.workspace = v; });

const providers = [
  { value: 'auto', label: t('desktop.settings.autoSelect') },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI (GPT)' },
  { value: 'google', label: 'Google (Gemini)' },
];

async function chooseWorkspace() {
  const selected = await new Promise((resolve) => emit('choose-workspace', resolve));
  if (selected) form.workspace = selected;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="settings-overlay" @click.self="emit('close')">
      <div class="settings-panel">
        <div class="settings-panel-header">
          <div>
            <div class="subtitle">{{ t('desktop.settings.subtitle') }}</div>
            <h2>{{ t('desktop.settings.title') }}</h2>
          </div>
          <button class="settings-close" @click="emit('close')" :aria-label="t('desktop.settings.close')">\u00D7</button>
        </div>
        <div class="settings-panel-body">
          <div class="settings-field">
            <label>{{ t('desktop.settings.provider') }}</label>
            <select v-model="form.provider">
              <option v-for="p in providers" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </div>
          <div class="settings-field">
            <label>{{ t('desktop.settings.modelName') }}</label>
            <input v-model="form.model" type="text" :placeholder="t('desktop.settings.modelPlaceholder')" />
          </div>
          <div class="settings-field">
            <label>{{ t('desktop.settings.temperature') }} ({{ form.temperature.toFixed(1) }})</label>
            <input v-model.number="form.temperature" type="range" min="0" max="1" step="0.1" />
          </div>
          <div class="settings-field">
            <label>{{ t('desktop.settings.workspacePath') }}</label>
            <div class="settings-path-row">
              <input v-model="form.workspace" type="text" :placeholder="t('desktop.settings.workspacePlaceholder')" />
              <button class="btn btn-ghost" type="button" @click="chooseWorkspace">{{ t('desktop.settings.choose') }}</button>
            </div>
          </div>
        </div>
        <div class="settings-panel-footer">
          <button class="btn btn-ghost" @click="emit('close')">{{ t('desktop.settings.cancel') }}</button>
          <button class="btn btn-primary" @click="emit('save', { ...form })">{{ t('desktop.settings.save') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
