<script setup lang="ts">
import { ref } from 'vue'
import type { FileNode } from '../../../shared/types'
import Icon from './Icon.vue'
defineProps<{ nodes: FileNode[]; selected: string | null; query: string }>()
const emit = defineEmits<{
  open: [path: string, newWindow: boolean]
  directory: [path: string]
  'relocate-directory': [path: string]
}>()
const host = ref<HTMLUListElement>()
function reveal(path: string, focus = false) {
  const target = path.replace(/\\/g, '/').replace(/\/$/, '')
  for (const node of host.value?.querySelectorAll<HTMLDetailsElement>('details[data-directory]') ??
    []) {
    const folder = node.dataset.directory!.replace(/\\/g, '/').replace(/\/$/, '')
    if (target === folder || target.startsWith(folder + '/')) node.open = true
  }
  const row = [...(host.value?.querySelectorAll<HTMLElement>('[data-path]') ?? [])].find(
    (el) => el.dataset.path === path,
  )
  row?.scrollIntoView({ block: 'nearest' })
  if (focus) row?.focus({ preventScroll: true })
}
defineExpose({ reveal })
function visible(node: FileNode, query: string): boolean {
  return (
    !query ||
    node.name.toLowerCase().includes(query.toLowerCase()) ||
    !!node.children?.some((n) => visible(n, query))
  )
}
</script>
<template>
  <ul ref="host" class="file-tree">
    <template v-for="node in nodes" :key="node.path"
      ><li v-if="visible(node, query)">
        <details v-if="node.directory" :data-directory="node.path" :open="!!query || undefined">
          <summary :data-path="node.path" :title="node.path" @click="emit('directory', node.path)">
            <Icon name="chevron" :size="13" /><Icon name="folder" :size="16" /><span>{{
              node.name
            }}</span
            ><button
              type="button"
              class="icon-button tree-action"
              :aria-label="'重命名或移动文件夹 ' + node.name"
              title="重命名或移动文件夹"
              @click.stop.prevent="emit('relocate-directory', node.path)"
            >
              <Icon name="pencil" :size="13" />
            </button>
          </summary>
          <FileTree
            :nodes="node.children || []"
            :selected="selected"
            :query="query"
            @open="(p, n) => emit('open', p, n)"
            @directory="(p) => emit('directory', p)"
            @relocate-directory="(p) => emit('relocate-directory', p)"
          />
        </details>
        <button
          v-else
          class="file-row"
          :data-path="node.path"
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
