<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import type {
  Capture,
  DocumentSnapshot,
  FileNode,
  LinkInfo,
  Settings,
  Workspace,
  AppEvent,
} from '../../shared/types'
import EditorPane from './components/EditorPane.vue'
import FileTree from './components/FileTree.vue'
import Icon from './components/Icon.vue'
type Pane = InstanceType<typeof EditorPane>
const api = window.inkisle
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
})
const version = ref('')
const query = ref('')
const notice = ref('')
const noticeKind = ref('info')
const busy = ref(false)
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
const relative = (file: string) =>
  workspace.value ? file.slice(workspace.value.root.length + 1) : file
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
  if (busy.value) return
  busy.value = true
  try {
    await task()
  } catch (e) {
    notify((e as Error).message, true)
  } finally {
    busy.value = false
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
    if (mainDoc.value?.path === file) {
      mainPane.value?.focus()
      return
    }
    if (rightDoc.value?.path === file) await closeRightInternal()
    const previous = mainDoc.value
    const doc = await api.readDocument(file)
    if (previous) await api.releaseDocument(previous.path)
    mainDoc.value = doc
    document.title = basename(doc.path) + ' — Inkisle'
    await updateLinks()
  })
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
    if (mainDoc.value) await api.releaseDocument(mainDoc.value.path)
    await closeRightInternal()
    mainDoc.value = null
    workspace.value = next
    linkInfo.value = { outgoing: [], backlinks: [] }
    showChat.value = false
    document.title = 'Inkisle'
  })
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
      if (field.value && !dirtyPaths.has(field.value.path))
        field.value = await api.readDocument(field.value.path)
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
  if (name === 'close') {
    if (await flushAll()) await api.closeWindow()
    return
  }
  if (name === 'save') {
    await flushAll()
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
  if (e.type === 'settings') settings.value = e.settings
  if (e.type === 'navigate') void openDocument(e.path)
  if (e.type === 'command') void command(e.command)
  if (e.type === 'filesystem') void refresh()
  if (e.type === 'document' && !dirtyPaths.has(e.document.path)) saved(e.document)
}
function shortcut(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    document.querySelector<HTMLInputElement>('#file-search')?.focus()
  }
  if (e.key === 'Escape') {
    showSettings.value = false
    showNew.value = false
  }
}
onMounted(async () => {
  unsubscribe = api.onEvent(event)
  window.addEventListener('focus', refresh)
  window.addEventListener('keydown', shortcut)
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
  systemTheme.removeEventListener('change', applyTheme)
})
</script>
<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <Icon name="ink" :size="25" /><strong>Inkisle</strong><span>墨屿</span>
      </div>
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
      <div class="workspace-heading">
        <span>{{ workspace?.name || '文件工作区' }}</span><button
          class="icon-button"
          title="刷新文件列表"
          aria-label="刷新文件列表"
          @click="refresh"
        >
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
          <span>{{ workspace?.name || 'Inkisle' }}</span><Icon
            v-if="mainDoc"
            name="chevron"
            :size="13"
          /><span v-if="mainDoc">{{ basename(mainDoc.path) }}</span>
        </div>
        <div class="toolbar-actions">
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
              :files="allFiles"
              @change="changed"
              @saved="saved"
              @link="follow"
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
              :files="allFiles"
              @change="changed"
              @saved="saved"
              @link="follow"
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
          请在 PicGo 中启用服务并配置图床。Inkisle 只接收上传后的图片链接。
        </p></template
      >
      <p class="muted settings-footnote">
        Ctrl+点击笔记或内部链接，在独立窗口打开。点击渲染后的图片、公式或表格可编辑源码。
      </p>
    </section>
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
