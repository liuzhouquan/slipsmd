<script setup lang="ts">
import type { FileNode } from '../../../shared/types'
import Icon from './Icon.vue'
defineProps<{ nodes: FileNode[]; selected: string | null; query: string }>()
const emit = defineEmits<{ open: [path: string, newWindow: boolean] }>()
function visible(node: FileNode, query: string): boolean {
  return (
    !query ||
    node.name.toLowerCase().includes(query.toLowerCase()) ||
    !!node.children?.some((n) => visible(n, query))
  )
}
</script>
<template>
  <ul class="file-tree">
    <template v-for="node in nodes" :key="node.path"
      ><li v-if="visible(node, query)">
        <details v-if="node.directory" :open="!!query || undefined">
          <summary>
            <Icon name="chevron" :size="13" /><Icon name="folder" :size="16" /><span>{{
              node.name
            }}</span>
          </summary>
          <FileTree
            :nodes="node.children || []"
            :selected="selected"
            :query="query"
            @open="(p, n) => emit('open', p, n)"
          />
        </details>
        <button
          v-else
          class="file-row"
          :class="{ selected: selected === node.path }"
          :title="node.path + ' · Ctrl+点击在新窗口打开'"
          @click="emit('open', node.path, $event.ctrlKey || $event.metaKey)"
        >
          <Icon name="file" :size="16" /><span>{{
            node.name.replace(/\.(md|markdown)$/i, '')
          }}</span>
        </button>
      </li></template
    >
  </ul>
</template>
