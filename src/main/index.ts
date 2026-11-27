import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'chokidar'
import writeFileAtomic from 'write-file-atomic'
import { DocumentStore, digest } from './documents'
import { extractLinks, isInside, resolveNote } from './links'
import type { AppEvent, Capture, FileNode, Settings, Workspace } from '../shared/types'

const here = path.dirname(fileURLToPath(import.meta.url))
if (process.env.INKISLE_USER_DATA) app.setPath('userData', process.env.INKISLE_USER_DATA)
interface WindowState {
  win: BrowserWindow
  root: string | null
  allowed: Set<string>
  initial: string | null
  watcher?: FSWatcher
}
const states = new Map<number, WindowState>()
let store: DocumentStore
let settings: Settings = {
  theme: 'light',
  imageMode: 'local',
  picgoUrl: 'http://127.0.0.1:36677/upload',
  recentWorkspaces: [],
}
let settingsQueue = Promise.resolve()
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')
const send = (state: WindowState, event: AppEvent) => {
  if (!state.win.isDestroyed()) state.win.webContents.send('inkisle:event', event)
}
const broadcast = (event: AppEvent) => {
  for (const state of states.values()) send(state, event)
}
const filters = [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
const excluded = new Set(['.git', 'node_modules', '.obsidian', '.inkisle', 'dist'])
function assertText(value: unknown, limit = 32768): asserts value is string {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0'))
    throw new Error('参数无效。')
}
async function tree(root: string, depth = 0, budget = { count: 0 }): Promise<FileNode[]> {
  if (depth > 24) return []
  const entries = await fs.readdir(root, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || excluded.has(entry.name) || entry.isSymbolicLink()) continue
    const file = path.join(root, entry.name)
    if (entry.isDirectory())
      nodes.push({
        name: entry.name,
        path: file,
        directory: true,
        children: await tree(file, depth + 1, budget),
      })
    else if (/\.(md|markdown)$/i.test(entry.name)) {
      budget.count++
      if (budget.count > 10000)
        throw new Error('首版工作区最多支持 10,000 份 Markdown 文件，请选择更小的目录。')
      nodes.push({ name: entry.name, path: file, directory: false })
    }
  }
  return nodes.sort(
    (a, b) =>
      Number(b.directory) - Number(a.directory) ||
      a.name.localeCompare(b.name, 'zh-CN', { numeric: true }),
  )
}
async function workspace(state: WindowState): Promise<Workspace | null> {
  return state.root
    ? { root: state.root, name: path.basename(state.root), tree: await tree(state.root) }
    : null
}
async function grant(state: WindowState, candidate: string, allowMissing = false): Promise<string> {
  assertText(candidate)
  let canonical: string
  try {
    canonical = await fs.realpath(candidate)
  } catch (error) {
    const known = path.resolve(candidate)
    if (
      !allowMissing ||
      (error as NodeJS.ErrnoException).code !== 'ENOENT' ||
      !state.allowed.has(known) ||
      store.getText(known) === undefined
    )
      throw error
    canonical = known
  }
  if (!state.allowed.has(canonical) && !(state.root && isInside(state.root, canonical)))
    throw new Error('请通过打开文件或工作区授权访问此路径。')
  if (!/\.(md|markdown)$/i.test(canonical)) throw new Error('请选择 Markdown 文件。')
  return canonical
}
async function persistSettings() {
  settingsQueue = settingsQueue
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(app.getPath('userData'), { recursive: true })
      await writeFileAtomic(settingsFile(), JSON.stringify(settings, null, 2))
    })
  await settingsQueue
}
async function setWorkspace(state: WindowState, root: string) {
  const canonical = await fs.realpath(root)
  const stat = await fs.stat(canonical)
  if (!stat.isDirectory()) throw new Error('请选择文件夹。')
  await state.watcher?.close()
  state.root = canonical
  let timer: ReturnType<typeof setTimeout>
  state.watcher = watch(canonical, {
    ignoreInitial: true,
    followSymlinks: false,
    depth: 24,
    ignored: (file) =>
      path
        .relative(canonical, file)
        .split(path.sep)
        .some((part) => part.startsWith('.') || excluded.has(part)),
  })
  state.watcher.on('all', () => {
    clearTimeout(timer)
    timer = setTimeout(() => send(state, { type: 'filesystem' }), 300)
  })
  state.watcher.on('error', (error) =>
    console.error('Workspace watcher:', (error as Error).message),
  )
  settings.recentWorkspaces = [
    canonical,
    ...settings.recentWorkspaces.filter((p) => p !== canonical),
  ].slice(0, 8)
  await persistSettings()
}
async function openWindow(file?: string, root?: string | null) {
  if (file) {
    const owner = store.owner(file)
    const existing = owner ? states.get(owner) : undefined
    if (existing) {
      existing.win.show()
      existing.win.focus()
      send(existing, { type: 'navigate', path: file })
      return
    }
  }
  const win = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 760,
    minHeight: 540,
    title: 'Inkisle',
    icon: path.join(here, '../../build/icon.png'),
    backgroundColor: settings.theme === 'dark' ? '#1e2023' : '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const windowId = win.webContents.id
  const state: WindowState = {
    win,
    root: null,
    allowed: new Set(file ? [file] : []),
    initial: file ?? null,
  }
  states.set(win.webContents.id, state)
  if (root) await setWorkspace(state, root)
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  let allowClose = false
  win.on('close', (event) => {
    if (allowClose) return
    event.preventDefault()
    send(state, { type: 'command', command: 'close' })
  })
  win.webContents.on('render-process-gone', () => {
    allowClose = true
    win.close()
  })
  win.on('closed', () => {
    store.abandon(windowId)
    void state.watcher?.close()
    states.delete(windowId)
  })
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await win.loadFile(path.join(here, '../renderer/index.html'))
  // A renderer flushes its pending edits before acknowledging the close command.
  win.webContents.on('ipc-message', (_event, channel) => {
    if (channel === 'inkisle:close-ready' && !store.dirty(win.webContents.id)) {
      allowClose = true
      win.close()
    }
  })
}
function captures(text: string): Capture[] {
  const archived = new Set(
    [...text.matchAll(/<!-- inkisle-archived:([\w-]+) -->/g)].map((m) => m[1]),
  )
  const clean = text.replace(/<!-- inkisle-archived:[\w-]+ -->/g, '')
  const entries = [
    ...clean.matchAll(
      /<!-- inkisle-capture:([\w-]+) ([^ ]+) -->\n([\s\S]*?)(?=<!-- inkisle-capture:|$)/g,
    ),
  ]
  return entries
    .filter((m) => !archived.has(m[1]))
    .map((m) => ({ id: m[1], time: m[2], text: m[3].trim() }))
    .reverse()
}
async function chatPath(state: WindowState) {
  if (!state.root) throw new Error('先打开文件夹，为收集箱选择保存位置。')
  const file = path.join(state.root, 'Chat.md')
  try {
    await fs.writeFile(file, '# Chat\n\n先记录，稍后整理。\n', { flag: 'wx' })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
  return grant(state, file)
}
async function readCaptures(state: WindowState) {
  const file = await chatPath(state)
  return captures(store.getText(file) ?? (await fs.readFile(file, 'utf8')))
}
function handle(name: string, callback: (state: WindowState, ...args: any[]) => unknown) {
  ipcMain.handle('inkisle:' + name, async (event, ...args) => {
    const state = states.get(event.sender.id)
    if (!state || event.senderFrame !== event.sender.mainFrame)
      return { ok: false, error: '无效窗口。' }
    try {
      return { ok: true, value: await callback(state, ...args) }
    } catch (error) {
      console.error(name, (error as Error).message)
      return { ok: false, error: (error as Error).message }
    }
  })
}
function registerHandlers() {
  handle('bootstrap', async (state) => ({
    workspace: await workspace(state),
    document: state.initial,
    settings,
    version: app.getVersion(),
  }))
  handle('openFolder', async (state) => {
    const result = await dialog.showOpenDialog(state.win, { properties: ['openDirectory'] })
    if (result.canceled) return null
    await setWorkspace(state, result.filePaths[0])
    return workspace(state)
  })
  handle('openFile', async (state) => {
    const result = await dialog.showOpenDialog(state.win, { properties: ['openFile'], filters })
    if (result.canceled) return null
    const file = await fs.realpath(result.filePaths[0])
    state.allowed.add(file)
    return file
  })
  handle('refreshWorkspace', workspace)
  handle('createFile', async (state, name) => {
    assertText(name, 200)
    if (!state.root) throw new Error('请先打开文件夹。')
    if (
      !name.trim() ||
      /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
      /[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)
    )
      throw new Error('文件名包含 Windows 不支持的字符或保留名称。')
    const file = path.join(state.root, /\.(md|markdown)$/i.test(name) ? name : name + '.md')
    await fs.writeFile(file, '# ' + path.basename(file).replace(/\.(md|markdown)$/i, '') + '\n\n', {
      flag: 'wx',
    })
    return file
  })
  handle('readDocument', async (state, candidate) => {
    const file = await grant(state, candidate)
    state.allowed.add(file)
    return store.open(file, state.win.webContents.id)
  })
  handle('stageDocument', async (state, candidate, text, revision) => {
    assertText(text, 20 * 1024 * 1024)
    assertText(revision, 100)
    return store.stage(
      await grant(state, candidate, true),
      text,
      state.win.webContents.id,
      revision,
    )
  })
  handle('saveDocument', async (state, candidate) =>
    store.save(await grant(state, candidate, true), state.win.webContents.id),
  )
  handle('releaseDocument', async (state, candidate) =>
    store.release(await grant(state, candidate, true), state.win.webContents.id),
  )
  handle('reloadDocument', async (state, candidate) =>
    store.reload(await grant(state, candidate), state.win.webContents.id),
  )
  handle('saveCopy', async (state, candidate) => {
    const file = await grant(state, candidate, true)
    const text = store.getText(file)
    if (text === undefined) throw new Error('文件未打开。')
    const result = await dialog.showSaveDialog(state.win, {
      defaultPath: file.replace(/\.(md|markdown)$/i, '-copy.md'),
      filters,
    })
    if (result.canceled || !result.filePath) return null
    if (path.resolve(result.filePath) === file) throw new Error('副本必须使用不同的文件名。')
    await fs.writeFile(result.filePath, text, { flag: 'wx' })
    state.allowed.add(await fs.realpath(result.filePath))
    return result.filePath
  })
  handle('openWindow', async (state, candidate) =>
    openWindow(candidate ? await grant(state, candidate) : undefined, state.root),
  )
  handle('resolveLink', async (state, source, href) => {
    const file = await grant(state, source)
    assertText(href)
    const target = resolveNote(file, href, state.root ?? path.dirname(file))
    if (!target) throw new Error('这不是本地 Markdown 链接。')
    return grant(state, target)
  })
  handle('links', async (state, candidate) => {
    const file = await grant(state, candidate)
    const root = state.root ?? path.dirname(file)
    const paths = state.root ? flatten(await tree(root)) : [file]
    const links = (
      await Promise.all(
        paths.map(async (source) => {
          try {
            return extractLinks(
              source,
              store.getText(source) ?? (await fs.readFile(source, 'utf8')),
              root,
            )
          } catch {
            return []
          }
        }),
      )
    ).flat()
    return {
      outgoing: links.filter((l) => l.source === file),
      backlinks: links.filter((l) => l.target === file),
    }
  })
  handle('chat', readCaptures)
  handle('capture', async (state, text) => {
    assertText(text, 100000)
    if (!text.trim()) return readCaptures(state)
    const file = await chatPath(state)
    await store.append(
      file,
      `<!-- inkisle-capture:${randomUUID()} ${new Date().toISOString()} -->\n${text.trim()}`,
    )
    broadcast({ type: 'filesystem' })
    return readCaptures(state)
  })
  handle('archiveCapture', async (state, id, target) => {
    assertText(id, 100)
    const source = await chatPath(state)
    const file = await grant(state, target)
    if (file === source) throw new Error('请选择 Chat.md 以外的笔记。')
    const entry = (await readCaptures(state)).find((c) => c.id === id)
    if (!entry) throw new Error('这条记录已经整理或不存在。')
    const marker = `<!-- inkisle-from:${entry.id} -->`
    const body = store.getText(file) ?? (await fs.readFile(file, 'utf8'))
    if (!body.includes(marker)) await store.append(file, `${marker}\n${entry.text}`)
    await store.append(source, `<!-- inkisle-archived:${entry.id} -->`)
    broadcast({ type: 'filesystem' })
    return readCaptures(state)
  })
  handle('image', async (state, candidate, src) => {
    const doc = await grant(state, candidate)
    assertText(src)
    if (/^https?:\/\//i.test(src)) return new URL(src).href
    const resolved = await fs.realpath(path.resolve(path.dirname(doc), decodeURIComponent(src)))
    if (!isInside(state.root ?? path.dirname(doc), resolved))
      throw new Error('图片不在已授权目录内。')
    const ext = path.extname(resolved).toLowerCase()
    const mime: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    }
    if (!mime[ext]) throw new Error('不支持的本地图片格式。')
    if ((await fs.stat(resolved)).size > 20 * 1024 * 1024) throw new Error('图片超过 20 MB。')
    return `data:${mime[ext]};base64,${(await fs.readFile(resolved)).toString('base64')}`
  })
  handle('uploadImage', async (state, candidate, dataUrl) => {
    const doc = await grant(state, candidate)
    assertText(dataUrl, 30 * 1024 * 1024)
    const match = /^data:image\/(png|jpeg|gif|webp);base64,([a-z\d+/=\r\n]+)$/i.exec(dataUrl)
    if (!match) throw new Error('剪贴板没有受支持的图片。')
    const bytes = Buffer.from(match[2], 'base64')
    if (bytes.length > 20 * 1024 * 1024) throw new Error('图片超过 20 MB。')
    const filename = `${digest(bytes).slice(0, 16)}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`
    if (settings.imageMode === 'local') {
      const dir = path.join(path.dirname(doc), 'assets')
      await fs.mkdir(dir, { recursive: true })
      const realDir = await fs.realpath(dir)
      if (!isInside(state.root ?? path.dirname(doc), realDir))
        throw new Error('附件目录不在已授权范围。')
      const target = path.join(realDir, filename)
      try {
        await fs.writeFile(target, bytes, { flag: 'wx' })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
      return 'assets/' + filename
    }
    const dir = path.join(app.getPath('userData'), 'pending-images')
    await fs.mkdir(dir, { recursive: true })
    const temp = path.join(dir, randomUUID() + '-' + filename)
    await fs.writeFile(temp, bytes)
    const response = await fetch(settings.picgoUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list: [temp] }),
      signal: AbortSignal.timeout(60000),
    })
    const data = (await response.json()) as { success: boolean; result: string[] }
    if (!response.ok || !data.success || !/^https?:\/\//i.test(data.result?.[0] ?? ''))
      throw new Error(
        'PicGo 上传失败。图片已保存在应用 pending-images 目录，可重试粘贴或切换本地保存。',
      )
    await fs.rm(temp, { force: true })
    return new URL(data.result[0]).href
  })
  handle('updateSettings', async (_state, patch) => {
    if (!patch || typeof patch !== 'object') throw new Error('设置无效。')
    if (patch.theme !== undefined) {
      if (!['light', 'dark', 'system'].includes(patch.theme)) throw new Error('主题无效。')
      settings.theme = patch.theme
    }
    if (patch.imageMode !== undefined) {
      if (!['local', 'picgo'].includes(patch.imageMode)) throw new Error('图片设置无效。')
      settings.imageMode = patch.imageMode
    }
    if (patch.picgoUrl !== undefined) {
      assertText(patch.picgoUrl, 1024)
      const url = new URL(patch.picgoUrl)
      if (
        url.protocol !== 'http:' ||
        !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw new Error('PicGo 地址必须是本机 HTTP 服务。')
      settings.picgoUrl = url.href
    }
    await persistSettings()
    broadcast({ type: 'settings', settings })
    return settings
  })
  handle('external', async (_state, url) => {
    assertText(url)
    if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 HTTP/HTTPS 外部链接。')
    await shell.openExternal(new URL(url).href)
  })
  handle('closeWindow', async (state) => {
    if (store.dirty(state.win.webContents.id)) throw new Error('仍有未保存文件。')
    state.win.webContents.send('inkisle:close-confirmed')
    return true
  })
}
function flatten(nodes: FileNode[]): string[] {
  return nodes.flatMap((n) => (n.directory ? flatten(n.children ?? []) : [n.path]))
}
const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.quit()
app.on('second-instance', async (_event, argv) => {
  const candidate = argv.find((arg) => /\.(md|markdown)$/i.test(arg) && !arg.startsWith('-'))
  try {
    if (candidate) await openWindow(await fs.realpath(candidate))
    else {
      const win = BrowserWindow.getAllWindows()[0]
      win?.show()
      win?.focus()
    }
  } catch (error) {
    console.error('Open file:', error)
  }
})
if (hasInstanceLock)
  app
    .whenReady()
    .then(async () => {
      try {
        const saved = JSON.parse(await fs.readFile(settingsFile(), 'utf8'))
        if (['light', 'dark', 'system'].includes(saved.theme)) settings.theme = saved.theme
        if (['local', 'picgo'].includes(saved.imageMode)) settings.imageMode = saved.imageMode
        if (typeof saved.picgoUrl === 'string') {
          const u = new URL(saved.picgoUrl)
          if (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname))
            settings.picgoUrl = u.href
        }
        if (Array.isArray(saved.recentWorkspaces))
          settings.recentWorkspaces = saved.recentWorkspaces
            .filter((p: unknown) => typeof p === 'string')
            .slice(0, 8)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Settings:', error)
      }
      store = new DocumentStore(path.join(app.getPath('userData'), 'drafts'), (document) =>
        broadcast({ type: 'document', document }),
      )
      registerHandlers()
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: '文件',
            submenu: [
              { label: '打开文件', accelerator: 'CmdOrCtrl+O', click: () => command('open-file') },
              {
                label: '打开文件夹',
                accelerator: 'CmdOrCtrl+Shift+O',
                click: () => command('open-folder'),
              },
              { label: '新建笔记', accelerator: 'CmdOrCtrl+N', click: () => command('new-file') },
              {
                label: '新建窗口',
                accelerator: 'CmdOrCtrl+Shift+N',
                click: () => void openWindow(undefined, focused()?.root),
              },
              { type: 'separator' },
              { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => command('save') },
              { label: '关闭窗口', role: 'close' },
              { role: 'quit', label: '退出' },
            ],
          },
          { role: 'editMenu', label: '编辑' },
          {
            label: '视图',
            submenu: [
              { label: '收集箱', accelerator: 'CmdOrCtrl+Enter', click: () => command('chat') },
              { role: 'togglefullscreen', label: '全屏' },
              { role: 'toggleDevTools', label: '开发者工具' },
            ],
          },
        ]),
      )
      let initial = process.env.INKISLE_OPEN_FILE
      const cli = process.argv.find((arg) => /\.(md|markdown)$/i.test(arg) && !arg.startsWith('-'))
      if (!initial && cli) initial = await fs.realpath(cli).catch(() => undefined)
      await openWindow(initial, process.env.INKISLE_WORKSPACE)
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) void openWindow()
      })
    })
    .catch((error) => {
      console.error(error)
      app.quit()
    })
function focused() {
  const win = BrowserWindow.getFocusedWindow()
  return win ? states.get(win.webContents.id) : undefined
}
function command(command: string) {
  const state = focused()
  if (state) send(state, { type: 'command', command })
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
