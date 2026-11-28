export type Theme = 'light' | 'dark' | 'system'
export type PinKind = 'file' | 'folder'
export interface PinnedLocation {
  id: string
  path: string
  name: string
  kind: PinKind
}
export interface PinNavigation {
  workspace: Workspace | null
  document: string | null
}
export interface Settings {
  theme: Theme
  imageMode: 'local' | 'picgo'
  picgoUrl: string
  recentWorkspaces: string[]
  pins: PinnedLocation[]
}
export interface FileNode {
  name: string
  path: string
  directory: boolean
  children?: FileNode[]
}
export interface Workspace {
  root: string
  name: string
  tree: FileNode[]
}
export interface DocumentSnapshot {
  path: string
  text: string
  revision: string
  readOnly: boolean
  dirty: boolean
  recovered: boolean
}
export interface MoveResult {
  document: DocumentSnapshot
  warning: string | null
}
export interface LinkEntry {
  source: string
  target: string
  label: string
  line: number
  context: string
  href: string
}
export interface LinkInfo {
  outgoing: LinkEntry[]
  backlinks: LinkEntry[]
}
export interface Capture {
  id: string
  time: string
  text: string
}
export interface Bootstrap {
  workspace: Workspace | null
  document: string | null
  settings: Settings
  version: string
}
export type AppEvent =
  | { type: 'navigate'; path: string }
  | { type: 'filesystem' }
  | { type: 'document'; document: DocumentSnapshot }
  | { type: 'settings'; settings: Settings }
  | { type: 'relocated'; previous: string; document: DocumentSnapshot }
  | { type: 'command'; command: string }
export interface DesktopAPI {
  closeWindow(): Promise<void>
  bootstrap(): Promise<Bootstrap>
  openFolder(): Promise<Workspace | null>
  openFile(): Promise<string | null>
  refreshWorkspace(): Promise<Workspace | null>
  createFile(name: string): Promise<string>
  createFolder(path: string): Promise<string>
  moveDocument(path: string, destination: string): Promise<MoveResult>
  readDocument(path: string): Promise<DocumentSnapshot>
  stageDocument(path: string, text: string, revision: string): Promise<void>
  saveDocument(path: string): Promise<DocumentSnapshot>
  releaseDocument(path: string): Promise<void>
  reloadDocument(path: string): Promise<DocumentSnapshot>
  saveCopy(path: string): Promise<string | null>
  openWindow(path?: string): Promise<void>
  pinLocation(kind: PinKind, path?: string): Promise<Settings>
  removePin(id: string): Promise<Settings>
  openPin(id: string, newWindow?: boolean): Promise<PinNavigation | null>
  resolveLink(source: string, href: string): Promise<string>
  links(path: string): Promise<LinkInfo>
  chat(): Promise<Capture[]>
  capture(text: string): Promise<Capture[]>
  archiveCapture(id: string, target: string): Promise<Capture[]>
  image(path: string, src: string): Promise<string>
  uploadImage(path: string, dataUrl: string): Promise<string>
  updateSettings(
    patch: Partial<Pick<Settings, 'theme' | 'imageMode' | 'picgoUrl'>>,
  ): Promise<Settings>
  external(url: string): Promise<void>
  onEvent(callback: (event: AppEvent) => void): () => void
}
declare global {
  interface Window {
    slipsmd: DesktopAPI
  }
}
