<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import type {
  Capture,
  DocumentSnapshot,
  FileNode,
  LinkInfo,
  Settings,
  Workspace,
  AppEvent,
  PinKind,
  PinnedLocation,
} from '../../shared/types'
import EditorPane from './components/EditorPane.vue'
import FileTree from './components/FileTree.vue'
import Icon from './components/Icon.vue'
import { ReadingPositions } from './editor/positions'
const mainPositions = new ReadingPositions()
const rightPositions = new ReadingPositions()
type Pane = InstanceType<typeof EditorPane>
const api = window.slipsmd
const workspace = ref<Workspace | null>(null)
const mainDoc = ref<DocumentSnapshot | null>(null)
const rightDoc = ref<DocumentSnapshot | null>(null)
const mainPane = ref<Pane>()
const rightPane = ref<Pane>()
const settings = ref<Settings>({
  theme: 'light',
  imageMode: 'local',
  picgoUrl: 'http://127.0.0.1:36677/upload',
  recentWorkspaces: [],
  pins: [],
})
const pinMenu = ref<HTMLDetailsElement>()
const version = ref('')
const query = ref('')
const notice = ref('')
const noticeKind = ref('info')
const busy = ref(false)
const relocating = ref(false)
const moveDialog = ref<HTMLDialogElement>()
const moveInput = ref<HTMLInputElement>()
const moveSource = ref('')
const moveDestination = ref('')
const moveError = ref('')
const moveInWorkspace = computed(
  () => !!workspace.value && relative(moveSource.value) !== moveSource.value,
)
const showSettings = ref(false)
const showChat = ref(false)
const showNew = ref(false)
const newName = ref('')
const chatText = ref('')
const captures = ref<Capture[]>([])
const linkInfo = ref<LinkInfo>({ outgoing: [], backlinks: [] })
const history = ref<string[]>([])
const historyIndex = ref(-1)
const dirtyPaths = new Set<string>()
let unsubscribe: () => void
let systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
function applyTheme() {
  document.documentElement.dataset.theme =
    settings.value.theme === 'system'
      ? systemTheme.matches
        ? 'dark'
        : 'light'
      : settings.value.theme
}
watch(() => settings.value.theme, applyTheme, { immediate: true })
const basename = (file: string) =>
  file
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(md|markdown)$/i, '') ?? file
const relative = (file: string) => {
  const root = workspace.value?.root.replace(/[\\/]+$/, '')
  return root && (file.startsWith(root + '/') || file.startsWith(root + '\\'))
    ? file.slice(root.length + 1)
    : file
}
const outsideWorkspace = computed(
  () => !!workspace.value && !!mainDoc.value && relative(mainDoc.value.path) === mainDoc.value.path,
)
const pinnedFile = computed(() =>
  settings.value.pins.find((pin) => pin.kind === 'file' && pin.path === mainDoc.value?.path),
)
const pinnedFolder = computed(() =>
  settings.value.pins.find((pin) => pin.kind === 'folder' && pin.path === workspace.value?.root),
)
const wordCount = computed(() => mainDoc.value?.text.trim().length ?? 0)
const allFiles = computed(() => {
  const collect = (nodes: FileNode[]): string[] =>
    nodes.flatMap((n) => (n.directory ? collect(n.children ?? []) : [n.path]))
  return collect(workspace.value?.tree ?? [])
})
const fileCount = computed(() => {
  const count = (nodes: FileNode[]): number =>
    nodes.reduce((n, f) => n + (f.directory ? count(f.children ?? []) : 1), 0)
  return count(workspace.value?.tree ?? [])
})
function notify(message: string, error = false) {
  notice.value = message
  noticeKind.value = error ? 'error' : 'info'
}
async function run(task: () => Promise<void>) {
  if (busy.value || moveDialog.value?.open) return
  busy.value = true
  try {
    await task()
  } catch (e) {
    notify((e as Error).message, true)
  } finally {
    busy.value = false
  }
}
async function showMove(file: string) {
  if (busy.value || moveDialog.value?.open) return
  moveSource.value = file
  moveDestination.value = moveInWorkspace.value ? relative(file) : file.split(/[\\/]/).pop()!
  moveError.value = ''
  moveDialog.value!.showModal()
  await nextTick()
  moveInput.value!.focus()
  const value = moveDestination.value
  moveInput.value!.setSelectionRange(
    Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1,
    value.lastIndexOf('.'),
  )
}
function applyMove(previous: string, doc: DocumentSnapshot) {
  if (previous === doc.path) return
  if (mainDoc.value?.path === previous) mainPane.value?.rememberPosition()
  if (rightDoc.value?.path === previous) rightPane.value?.rememberPosition()
  mainPositions.move(previous, doc.path)
  rightPositions.move(previous, doc.path)
  dirtyPaths.delete(previous)
  if (mainDoc.value?.path === previous) {
    mainDoc.value = doc
    document.title = basename(doc.path) + ' — SlipsMD'
  }
  if (rightDoc.value?.path === previous) rightDoc.value = doc
  history.value = history.value.map((file) => (file === previous ? doc.path : file))
}
async function moveDocument() {
  if (busy.value) return
  busy.value = true
  relocating.value = true
  moveError.value = ''
  await nextTick()
  let movedPath: string | undefined
  try {
    if (!(await flushAll())) {
      moveError.value = '正文尚未保存。请取消并处理保存错误或等待图片处理完成。'
      return
    }
    const previous = moveSource.value
    const result = await api.moveDocument(previous, moveDestination.value.trim())
    movedPath = result.document.path
    applyMove(previous, result.document)
    moveDialog.value!.close()
    notify(
      result.warning ??
        (result.document.path === previous
          ? '文件位置未改变。'
          : '已移至 ' + relative(result.document.path) + '。请检查原有链接与相对图片路径。'),
      !!result.warning,
    )
    await refresh()
  } catch (e) {
    moveError.value = (e as Error).message
  } finally {
    relocating.value = false
    busy.value = false
    await nextTick()
    if (moveDialog.value?.open && moveError.value) moveInput.value?.focus()
    else if (movedPath && mainDoc.value?.path === movedPath) mainPane.value?.focus()
    else if (movedPath && rightDoc.value?.path === movedPath) rightPane.value?.focus()
  }
}
async function flushAll() {
  if (mainPane.value?.uploading || rightPane.value?.uploading) {
    notify('图片仍在处理中，请稍候再切换或关闭。', true)
    return false
  }
  const first = (await mainPane.value?.save()) ?? true
  const second = (await rightPane.value?.save()) ?? true
  return first && second
}
async function openDocument(file: string, newWindow = false) {
  await run(async () => {
    if (!(await flushAll())) return
    if (newWindow) {
      await api.openWindow(file)
      return
    }
    await openMainInternal(file)
  })
}
async function openMainInternal(file: string) {
  if (mainDoc.value?.path === file) {
    mainPane.value?.focus()
    return
  }
  if (rightDoc.value?.path === file) await closeRightInternal()
  const previous = mainDoc.value
  const doc = await api.readDocument(file)
  if (previous) await api.releaseDocument(previous.path)
  mainDoc.value = doc
  document.title = basename(doc.path) + ' — SlipsMD'
  await updateLinks()
}
async function openRight(file: string, record = true) {
  if (mainDoc.value?.path === file) {
    mainPane.value?.focus()
    return
  }
  if (!(await flushAll())) return
  const doc = await api.readDocument(file)
  if (rightDoc.value && rightDoc.value.path !== file) await api.releaseDocument(rightDoc.value.path)
  rightDoc.value = doc
  if (record) {
    history.value = history.value.slice(0, historyIndex.value + 1)
    history.value.push(file)
    historyIndex.value = history.value.length - 1
  }
}
async function follow(source: string, href: string, newWindow = false) {
  await run(async () => {
    if (/^https?:\/\//i.test(href)) {
      await api.external(href)
      return
    }
    if (href.startsWith('#')) {
      notify('请使用编辑器查找定位标题；首版暂不支持锚点跳转。')
      return
    }
    const target = await api.resolveLink(source, href)
    if (newWindow) {
      if (await flushAll()) await api.openWindow(target)
    } else await openRight(target)
  })
}
async function travel(delta: number) {
  await run(async () => {
    const i = historyIndex.value + delta
    if (i < 0 || i >= history.value.length) return
    await openRight(history.value[i], false)
    historyIndex.value = i
  })
}
async function closeRightInternal() {
  if (rightDoc.value) {
    await api.releaseDocument(rightDoc.value.path)
    rightDoc.value = null
  }
}
async function closeRight() {
  await run(async () => {
    if (await flushAll()) await closeRightInternal()
  })
}
async function openFolder() {
  await run(async () => {
    if (!(await flushAll())) return
    const next = await api.openFolder()
    if (!next) return
    await applyWorkspace(next)
  })
}
async function applyWorkspace(next: Workspace | null) {
  if (mainDoc.value) await api.releaseDocument(mainDoc.value.path)
  await closeRightInternal()
  mainDoc.value = null
  workspace.value = next
  linkInfo.value = { outgoing: [], backlinks: [] }
  showChat.value = false
  history.value = []
  historyIndex.value = -1
  captures.value = []
  query.value = ''
  document.title = 'SlipsMD'
}
async function pinLocation(kind: PinKind, path?: string) {
  if (pinMenu.value) pinMenu.value.open = false
  await run(async () => {
    settings.value = await api.pinLocation(kind, path)
  })
}
async function removePin(id: string) {
  await run(async () => {
    settings.value = await api.removePin(id)
  })
}
async function openPin(pin: PinnedLocation, newWindow: boolean) {
  await run(async () => {
    if (!(await flushAll())) return
    const navigation = await api.openPin(pin.id, newWindow)
    if (!navigation) return
    if (pin.kind === 'folder') {
      if (workspace.value?.root === navigation.workspace?.root)
        workspace.value = navigation.workspace
      else await applyWorkspace(navigation.workspace)
    } else if (navigation.document) await openMainInternal(navigation.document)
  })
}
function dismissPinMenu(e: Event) {
  if (pinMenu.value && !pinMenu.value.contains(e.target as Node)) pinMenu.value.open = false
}
async function openFile() {
  if (!(await flushAll())) return
  try {
    const file = await api.openFile()
    if (file) await openDocument(file)
  } catch (e) {
    notify((e as Error).message, true)
  }
}
async function createFile() {
  await run(async () => {
    if (!(await flushAll())) return
    const file = await api.createFile(newName.value.trim())
    if (mainDoc.value) await api.releaseDocument(mainDoc.value.path)
    await closeRightInternal()
    mainDoc.value = await api.readDocument(file)
    workspace.value = await api.refreshWorkspace()
    showNew.value = false
    newName.value = ''
    await updateLinks()
  })
}
async function updateLinks() {
  if (!mainDoc.value) return
  const file = mainDoc.value.path
  const result = await api.links(file)
  if (mainDoc.value?.path === file) linkInfo.value = result
}
async function refresh() {
  try {
    workspace.value = await api.refreshWorkspace()
    for (const field of [mainDoc, rightDoc]) {
      const file = field.value?.path
      if (!file || dirtyPaths.has(file)) continue
      try {
        const doc = await api.readDocument(file)
        if (field.value?.path === file && !dirtyPaths.has(file)) field.value = doc
      } catch (error) {
        if (field.value?.path === file) throw error
      }
    }
    await updateLinks()
    if (showChat.value && workspace.value) captures.value = await api.chat()
  } catch (e) {
    notify((e as Error).message, true)
  }
}
function changed(path: string, dirty: boolean) {
  if (dirty) dirtyPaths.add(path)
  else dirtyPaths.delete(path)
}
function saved(doc: DocumentSnapshot) {
  if (mainDoc.value?.path === doc.path) {
    mainDoc.value = { ...doc, readOnly: mainDoc.value.readOnly }
    void updateLinks()
  }
  if (rightDoc.value?.path === doc.path)
    rightDoc.value = { ...doc, readOnly: rightDoc.value.readOnly }
}
async function toggleChat() {
  if (!workspace.value) {
    notify('先打开文件夹，为收集箱选择保存位置。')
    return
  }
  showChat.value = !showChat.value
  if (showChat.value)
    try {
      captures.value = await api.chat()
    } catch (e) {
      notify((e as Error).message, true)
    }
}
async function capture() {
  await run(async () => {
    if (!chatText.value.trim() || !(await flushAll())) return
    captures.value = await api.capture(chatText.value)
    chatText.value = ''
    await refresh()
  })
}
async function archive(id: string) {
  await run(async () => {
    if (!mainDoc.value) {
      notify('先打开一份笔记，作为整理目标。')
      return
    }
    if (!(await flushAll())) return
    captures.value = await api.archiveCapture(id, mainDoc.value.path)
    await refresh()
    notify('已整理到 ' + basename(mainDoc.value.path) + '，原始记录保留在 Chat.md。')
  })
}
async function updateSettings(patch: Partial<Pick<Settings, 'theme' | 'imageMode' | 'picgoUrl'>>) {
  try {
    settings.value = await api.updateSettings(patch)
  } catch (e) {
    notify((e as Error).message, true)
  }
}
async function command(name: string) {
  if (moveDialog.value?.open) {
    if (name === 'close' && !relocating.value) moveDialog.value.close()
    return
  }
  if (name === 'close') {
    if (await flushAll()) await api.closeWindow()
    return
  }
  if (name === 'save') {
    await flushAll()
    return
  }
  if (name === 'move-file') {
    if (mainDoc.value && !mainDoc.value.readOnly) await showMove(mainDoc.value.path)
    else notify('请在原编辑窗口打开要重命名或移动的笔记。')
    return
  }
  if (name === 'open-file') {
    await openFile()
    return
  }
  if (name === 'open-folder') {
    await openFolder()
    return
  }
  if (name === 'new-file') {
    if (!workspace.value) notify('请先打开文件夹。')
    else showNew.value = true
    return
  }
  if (name === 'chat') await toggleChat()
}
function event(e: AppEvent) {
  if (e.type === 'relocated') applyMove(e.previous, e.document)
  if (e.type === 'settings') settings.value = e.settings
  if (e.type === 'navigate') void openDocument(e.path)
  if (e.type === 'command') void command(e.command)
  if (e.type === 'filesystem') void refresh()
  if (e.type === 'document' && !dirtyPaths.has(e.document.path)) saved(e.document)
}
function shortcut(e: KeyboardEvent) {
  if (e.key === 'F2') {
    e.preventDefault()
    void command('move-file')
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('#file-search')?.focus()
  }
  if (e.key === 'Escape') {
    if (pinMenu.value) pinMenu.value.open = false
    showSettings.value = false
    showNew.value = false
  }
}
onMounted(async () => {
  unsubscribe = api.onEvent(event)
  window.addEventListener('focus', refresh)
  window.addEventListener('keydown', shortcut)
  window.addEventListener('pointerdown', dismissPinMenu)
  systemTheme.addEventListener('change', applyTheme)
  try {
    const boot = await api.bootstrap()
    workspace.value = boot.workspace
    settings.value = boot.settings
    version.value = boot.version
    if (boot.document) await openDocument(boot.document)
  } catch (e) {
    notify((e as Error).message, true)
  }
})
onBeforeUnmount(() => {
  unsubscribe?.()
  window.removeEventListener('focus', refresh)
  window.removeEventListener('keydown', shortcut)
  window.removeEventListener('pointerdown', dismissPinMenu)
  systemTheme.removeEventListener('change', applyTheme)
})
</script>
<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><Icon name="ink" :size="25" /><strong>SlipsMD</strong></div>
      <div class="sidebar-actions">
        <button @click="openFolder" title="打开文件夹 · Ctrl+Shift+O">
          <Icon name="folder" /><span>打开文件夹</span></button
        ><button
          class="icon-button"
          aria-label="新建笔记"
          title="新建笔记 · Ctrl+N"
          @click="command('new-file')"
        >
          <Icon name="plus" />
        </button>
      </div>
      <label class="search-box"
        ><Icon name="search" :size="16" /><input
          id="file-search"
          v-model="query"
          placeholder="查找笔记…"
          aria-label="查找笔记"
        /><kbd>Ctrl K</kbd></label
      >
      <section class="pins-section" aria-label="快捷方式">
        <div class="workspace-heading">
          <span>快捷方式</span>
          <details ref="pinMenu" class="pin-menu">
            <summary class="icon-button" aria-label="添加快捷方式" title="添加快捷方式">
              <Icon name="plus" :size="15" />
            </summary>
            <div class="pin-menu-items">
              <button :disabled="busy" @click="pinLocation('file')">
                <Icon name="file" :size="15" />固定文件…
              </button>
              <button :disabled="busy" @click="pinLocation('folder')">
                <Icon name="folder" :size="15" />固定文件夹…
              </button>
            </div>
          </details>
        </div>
        <ul v-if="settings.pins.length" class="pin-list">
          <li v-for="pin in settings.pins" :key="pin.id" class="pin-row">
            <button
              class="file-row pin-open"
              :class="{
                selected:
                  pin.kind === 'folder' ? workspace?.root === pin.path : mainDoc?.path === pin.path,
              }"
              :aria-label="
                (pin.kind === 'folder' ? '打开固定文件夹：' : '打开固定文件：') + pin.name
              "
              :title="pin.path + ' · Ctrl+点击在独立窗口打开'"
              :disabled="busy"
              @click="openPin(pin, $event.ctrlKey || $event.metaKey)"
            >
              <Icon :name="pin.kind === 'folder' ? 'folder' : 'file'" :size="16" /><span>{{
                pin.kind === 'file' ? basename(pin.name) : pin.name
              }}</span>
            </button>
            <button
              class="icon-button pin-remove"
              :aria-label="'取消固定：' + pin.name"
              title="取消固定（保留文件）"
              :disabled="busy"
              @click="removePin(pin.id)"
            >
              <Icon name="close" :size="13" />
            </button>
          </li>
        </ul>
        <p v-else class="pins-empty">固定常用文件或文件夹，随时打开。</p>
      </section>
      <div class="workspace-heading">
        <span>{{ workspace?.name || '文件工作区' }}</span>
        <button
          v-if="workspace"
          class="icon-button"
          :class="{ 'is-pinned': pinnedFolder }"
          :aria-label="pinnedFolder ? '取消固定当前工作区' : '固定当前工作区'"
          :title="pinnedFolder ? '取消固定当前工作区' : '固定当前工作区'"
          :disabled="busy"
          @click="pinnedFolder ? removePin(pinnedFolder.id) : pinLocation('folder', workspace.root)"
        >
          <Icon name="pin" :size="14" />
        </button>
        <button class="icon-button" title="刷新文件列表" aria-label="刷新文件列表" @click="refresh">
          <Icon name="refresh" :size="14" />
        </button>
      </div>
      <div class="tree-scroll">
        <FileTree
          v-if="workspace"
          :nodes="workspace.tree"
          :selected="mainDoc?.path || null"
          :query="query"
          @open="openDocument"
        />
        <div v-else class="sidebar-empty">
          打开存放 Markdown 的文件夹，<br />在这里浏览和连接你的笔记。
        </div>
        <p v-if="workspace && !fileCount" class="sidebar-empty">还没有笔记，点击上方 + 开始。</p>
      </div>
      <div class="sidebar-bottom">
        <button :class="{ active: showChat }" @click="toggleChat">
          <Icon name="chat" /><span>收集箱</span><kbd>Ctrl ↵</kbd></button
        ><button @click="showSettings = !showSettings">
          <Icon name="settings" /><span>设置</span>
        </button>
      </div>
    </aside>
    <main class="main-area">
      <header class="app-toolbar">
        <div class="breadcrumb">
          <span>{{ outsideWorkspace ? '工作区外文件' : workspace?.name || 'SlipsMD' }}</span><Icon
            v-if="mainDoc"
            name="chevron"
            :size="13"
          /><span v-if="mainDoc">{{ basename(mainDoc.path) }}</span>
        </div>
        <div class="toolbar-actions">
          <button
            v-if="mainDoc"
            class="icon-button"
            :class="{ 'is-pinned': pinnedFile }"
            :title="pinnedFile ? '取消固定当前笔记' : '固定当前笔记'"
            :aria-label="pinnedFile ? '取消固定当前笔记' : '固定当前笔记'"
            :disabled="busy"
            @click="pinnedFile ? removePin(pinnedFile.id) : pinLocation('file', mainDoc.path)"
          >
            <Icon name="pin" />
          </button>
          <button
            class="icon-button"
            title="打开 Markdown 文件 · Ctrl+O"
            aria-label="打开 Markdown 文件"
            @click="openFile"
          >
            <Icon name="file" /></button
          ><button
            class="icon-button"
            title="保存 · Ctrl+S"
            aria-label="保存"
            :disabled="!mainDoc"
            @click="flushAll"
          >
            <Icon name="save" /></button
          ><button
            class="icon-button"
            title="新建独立窗口 · Ctrl+Shift+N"
            aria-label="新建独立窗口"
            @click="run(() => api.openWindow())"
          >
            <Icon name="window" /></button
          ><button
            class="icon-button"
            title="亮色 / 暗色 / 跟随系统"
            aria-label="切换主题"
            @click="
              updateSettings({
                theme:
                  settings.theme === 'light'
                    ? 'dark'
                    : settings.theme === 'dark'
                      ? 'system'
                      : 'light',
              })
            "
          >
            <Icon
              :name="
                settings.theme === 'system' ? 'monitor' : settings.theme === 'dark' ? 'moon' : 'sun'
              "
            />
          </button>
        </div>
      </header>
      <div v-if="notice" class="notice" :class="noticeKind" role="status">
        <span>{{ notice }}</span><button
          class="icon-button"
          aria-label="关闭提示"
          @click="notice = ''"
        >
          <Icon name="close" :size="14" />
        </button>
      </div>
      <div class="content-area">
        <div v-if="!mainDoc" class="welcome">
          <Icon name="ink" :size="44" />
          <h1>给想法一个落脚点。</h1>
          <p>打开一份笔记，或先记下此刻的想法。<br />文件留在本地，整理可以慢慢来。</p>
          <div class="welcome-actions">
            <button class="primary" @click="openFolder"><Icon name="folder" />打开文件夹</button
            ><button @click="openFile"><Icon name="file" />打开 Markdown</button>
          </div>
          <div class="welcome-shortcuts">
            <span><kbd>Ctrl O</kbd> 打开文件</span><span><kbd>Ctrl Shift N</kbd> 独立窗口</span>
          </div>
        </div>
        <div v-else class="document-layout" :class="{ 'with-related': rightDoc }">
          <div class="primary-document">
            <EditorPane
              :key="mainDoc.path"
              ref="mainPane"
              :document="mainDoc"
              :positions="mainPositions"
              :blocked="relocating"
              :files="allFiles"
              @change="changed"
              @saved="saved"
              @link="follow"
              @relocate="showMove"
            />
            <div class="connections">
              <details :open="linkInfo.backlinks.length > 0 || undefined">
                <summary>
                  <Icon name="link" :size="15" />反向链接
                  <span>{{ linkInfo.backlinks.length }}</span>
                </summary>
                <p v-if="!linkInfo.backlinks.length">还没有其他笔记链接到这里。</p>
                <button
                  v-for="link in linkInfo.backlinks"
                  :key="link.source + link.line"
                  @click="run(() => openRight(link.source))"
                >
                  <strong>{{ basename(link.source) }}</strong><span>{{ link.context }}</span>
                </button>
              </details>
              <details>
                <summary>
                  当前笔记链接 <span>{{ linkInfo.outgoing.length }}</span>
                </summary>
                <button
                  v-for="link in linkInfo.outgoing"
                  :key="link.href + link.line"
                  @click="follow(mainDoc!.path, link.href, $event.ctrlKey || $event.metaKey)"
                >
                  {{ link.label || basename(link.target) }}<Icon name="arrow" :size="14" />
                </button>
              </details>
            </div>
          </div>
          <aside v-if="rightDoc" class="related-pane">
            <div class="related-toolbar">
              <span>关联笔记</span
              ><button
                class="icon-button"
                aria-label="上一份关联笔记"
                :disabled="historyIndex <= 0"
                @click="travel(-1)"
              >
                <Icon name="back" :size="16" /></button
              ><button
                class="icon-button"
                aria-label="下一份关联笔记"
                :disabled="historyIndex >= history.length - 1"
                @click="travel(1)"
              >
                <Icon name="arrow" :size="16" /></button
              ><button
                class="icon-button"
                aria-label="在独立窗口打开关联笔记"
                @click="
                  run(async () => {
                    if (await flushAll()) {
                      const file = rightDoc!.path
                      await closeRightInternal()
                      await api.openWindow(file)
                    }
                  })
                "
              >
                <Icon name="window" :size="16" /></button
              ><button class="icon-button" aria-label="关闭关联笔记" @click="closeRight">
                <Icon name="close" :size="16" />
              </button>
            </div>
            <EditorPane
              :key="rightDoc.path"
              ref="rightPane"
              :document="rightDoc"
              :positions="rightPositions"
              :blocked="relocating"
              :files="allFiles"
              @change="changed"
              @saved="saved"
              @link="follow"
              @relocate="showMove"
            />
          </aside>
        </div>
        <aside v-if="showChat" class="capture-pane">
          <header>
            <div>
              <h2>收集箱</h2>
              <p>先记录，稍后整理。</p>
            </div>
            <button class="icon-button" aria-label="关闭收集箱" @click="showChat = false">
              <Icon name="close" />
            </button>
          </header>
          <form @submit.prevent="capture">
            <textarea
              v-model="chatText"
              aria-label="记录想法"
              placeholder="此刻有什么想法？"
              @keydown.ctrl.enter.prevent="capture"
            />
            <div class="capture-submit">
              <span>保存到 Chat.md</span
              ><button class="primary" :disabled="!chatText.trim() || busy" type="submit">
                记下来<Icon name="arrow" :size="16" />
              </button>
            </div>
          </form>
          <div class="captures">
            <p v-if="!captures.length" class="muted">还没有待整理的想法。</p>
            <article v-for="item in captures" :key="item.id">
              <time>{{
                new Date(item.time).toLocaleString('zh-CN', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              }}</time>
              <p>{{ item.text }}</p>
              <button :disabled="!mainDoc || busy" @click="archive(item.id)">
                整理到当前笔记<Icon name="arrow" :size="14" />
              </button>
            </article>
          </div>
        </aside>
      </div>
      <footer class="statusbar">
        <span>{{ mainDoc ? relative(mainDoc.path) : '本地文件 · 无需账号' }}</span><span
          >{{ mainDoc ? wordCount + ' 字符' : fileCount + ' 份笔记'
          }}<span class="version">v{{ version }}</span></span
        >
      </footer>
    </main>
    <section v-if="showSettings" class="settings-panel" aria-label="设置">
      <header>
        <h2>设置</h2>
        <button class="icon-button" aria-label="关闭设置" @click="showSettings = false">
          <Icon name="close" />
        </button>
      </header>
      <label
        >外观<select
          :value="settings.theme"
          @change="
            updateSettings({
              theme: ($event.target as HTMLSelectElement).value as Settings['theme'],
            })
          "
        >
          <option value="light">亮色</option>
          <option value="dark">暗色</option>
          <option value="system">跟随系统</option>
        </select></label
      ><label
        >粘贴图片<select
          :value="settings.imageMode"
          @change="
            updateSettings({
              imageMode: ($event.target as HTMLSelectElement).value as Settings['imageMode'],
            })
          "
        >
          <option value="local">保存到笔记旁的 assets 文件夹</option>
          <option value="picgo">通过 PicGo 自动上传</option>
        </select></label
      ><template v-if="settings.imageMode === 'picgo'"
        ><label
          >PicGo 本地服务地址<input
            :value="settings.picgoUrl"
            @change="updateSettings({ picgoUrl: ($event.target as HTMLInputElement).value })"
        /></label>
        <p class="muted">
          请在 PicGo 中启用服务并配置图床。SlipsMD 只接收上传后的图片链接。
        </p></template
      >
      <p class="muted settings-footnote">
        Ctrl+点击笔记或内部链接，在独立窗口打开。点击渲染后的图片、公式或表格可编辑源码。
      </p>
    </section>
    <dialog
      ref="moveDialog"
      class="move-note-dialog"
      aria-labelledby="move-title"
      @cancel="relocating && $event.preventDefault()"
    >
      <form @submit.prevent="moveDocument">
        <h2 id="move-title">重命名或移动笔记</h2>
        <p class="muted move-source">{{ moveSource }}</p>
        <label for="move-destination">{{
          moveInWorkspace ? '新路径（相对工作区）' : '新文件名'
        }}</label>
        <input
          id="move-destination"
          ref="moveInput"
          v-model="moveDestination"
          :disabled="relocating"
          :aria-invalid="!!moveError"
          aria-describedby="move-help move-error"
          autocomplete="off"
          spellcheck="false"
        />
        <p id="move-help" class="muted">
          {{
            moveInWorkspace
              ? '可填 文件夹/笔记.md，目标文件夹需已存在。'
              : '单文件模式只支持同目录重命名。'
          }}自动补上 .md，已有文件不会被覆盖。原有链接与相对图片路径不会自动修改。
        </p>
        <p id="move-error" class="move-error" role="alert">{{ moveError }}</p>
        <div class="dialog-actions">
          <button type="button" :disabled="relocating" @click="moveDialog?.close()">取消</button>
          <button class="primary" :disabled="!moveDestination.trim() || busy" type="submit">
            {{ relocating ? '正在移动…' : '保存并移动' }}
          </button>
        </div>
      </form>
    </dialog>
    <div v-if="showNew" class="dialog-backdrop" @click.self="showNew = false">
      <form class="new-note-dialog" @submit.prevent="createFile">
        <h2>新建笔记</h2>
        <label
          >文件名<input
            v-model="newName"
            autofocus
            placeholder="例如：今天的思考"
            aria-label="新笔记文件名"
        /></label>
        <p class="muted">保存到当前工作区，自动补上 .md。</p>
        <div>
          <button type="button" @click="showNew = false">取消</button
          ><button class="primary" :disabled="!newName.trim() || busy">创建</button>
        </div>
      </form>
    </div>
  </div>
</template>
