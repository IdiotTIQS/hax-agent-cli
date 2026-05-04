<script setup>
import { reactive, watch } from 'vue';

const props = defineProps({
  visible: { type: Boolean, default: false },
  provider: { type: String, default: 'auto' },
  model: { type: String, default: '' },
  temperature: { type: Number, default: 0.3 },
  workspace: { type: String, default: '' },
});

const emit = defineEmits(['close', 'save']);

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
  { value: 'auto', label: '自动选择' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI (GPT)' },
  { value: 'google', label: 'Google (Gemini)' },
];
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="settings-overlay" @click.self="emit('close')">
      <div class="settings-panel">
        <div class="settings-panel-header">
          <div>
            <div class="subtitle">运行时配置</div>
            <h2>Agent 设置</h2>
          </div>
          <button class="settings-close" @click="emit('close')" aria-label="关闭">×</button>
        </div>
        <div class="settings-panel-body">
          <div class="settings-field">
            <label>AI 提供商</label>
            <select v-model="form.provider">
              <option v-for="p in providers" :key="p.value" :value="p.value">{{ p.label }}</option>
            </select>
          </div>
          <div class="settings-field">
            <label>模型名称</label>
            <input v-model="form.model" type="text" placeholder="留空使用默认模型" />
          </div>
          <div class="settings-field">
            <label>温度 ({{ form.temperature.toFixed(1) }})</label>
            <input v-model.number="form.temperature" type="range" min="0" max="1" step="0.1" />
          </div>
          <div class="settings-field">
            <label>工作区路径</label>
            <input v-model="form.workspace" type="text" placeholder="当前项目根目录" />
          </div>
        </div>
        <div class="settings-panel-footer">
          <button class="btn btn-ghost" @click="emit('close')">取消</button>
          <button class="btn btn-primary" @click="emit('save', { ...form })">保存设置</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
