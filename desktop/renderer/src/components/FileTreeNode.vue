<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  node: { type: Object, required: true },
  depth: { type: Number, default: 0 },
});

const emit = defineEmits(['select']);

const isDirectory = computed(() => Array.isArray(props.node.children) && props.node.children.length > 0);
const expanded = ref(props.depth < 1);

function toggle() {
  if (isDirectory.value) {
    expanded.value = !expanded.value;
  }
}

function handleRowClick() {
  if (isDirectory.value) {
    toggle();
  } else {
    emit('select', props.node.path);
  }
}
</script>

<template>
  <div>
    <div
      class="file-tree-item"
      :class="[isDirectory ? 'folder' : 'file', { expanded }]"
      :style="{ paddingLeft: (depth * 16 + 6) + 'px' }"
      @click="handleRowClick"
    >
      <button
        v-if="isDirectory"
        class="tree-toggle"
        type="button"
        :aria-label="expanded ? 'Collapse directory' : 'Expand directory'"
        @click.stop="toggle"
      >
        {{ expanded ? '▾' : '▸' }}
      </button>
      <span v-else class="tree-toggle placeholder" aria-hidden="true"></span>
      <span class="name">{{ node.name || node.path }}</span>
      <span v-if="node.changes" class="file-change">
        <span class="added">+{{ node.changes.added }}</span>
        <span class="sep">/</span>
        <span class="removed">−{{ node.changes.removed }}</span>
      </span>
    </div>
    <div v-if="isDirectory && expanded" class="file-tree-children">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        @select="(path) => emit('select', path)"
      />
    </div>
  </div>
</template>
