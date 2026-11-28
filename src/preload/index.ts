import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopAPI, AppEvent } from '../shared/types'
const invoke = async <T>(method: string, ...args: unknown[]): Promise<T> => {
  const result = await ipcRenderer.invoke('slipsmd:' + method, ...args)
  if (!result.ok) throw new Error(result.error)
  return result.value
}
const api: DesktopAPI = {
  closeWindow: async () => {
    ipcRenderer.send('slipsmd:close-ready')
  },
  bootstrap: () => invoke('bootstrap'),
  openFolder: () => invoke('openFolder'),
  openFile: () => invoke('openFile'),
  refreshWorkspace: () => invoke('refreshWorkspace'),
  createFile: (name) => invoke('createFile', name),
  createFolder: (path) => invoke('createFolder', path),
  moveDocument: (path, destination) => invoke('moveDocument', path, destination),
  readDocument: (path) => invoke('readDocument', path),
  stageDocument: (path, text, revision) => invoke('stageDocument', path, text, revision),
  saveDocument: (path) => invoke('saveDocument', path),
  releaseDocument: (path) => invoke('releaseDocument', path),
  reloadDocument: (path) => invoke('reloadDocument', path),
  saveCopy: (path) => invoke('saveCopy', path),
  openWindow: (path) => invoke('openWindow', path),
  pinLocation: (kind, path) => invoke('pinLocation', kind, path),
  removePin: (id) => invoke('removePin', id),
  openPin: (id, newWindow) => invoke('openPin', id, newWindow),
  resolveLink: (source, href) => invoke('resolveLink', source, href),
  links: (path) => invoke('links', path),
  chat: () => invoke('chat'),
  capture: (text) => invoke('capture', text),
  archiveCapture: (id, target) => invoke('archiveCapture', id, target),
  image: (path, src) => invoke('image', path, src),
  uploadImage: (path, data) => invoke('uploadImage', path, data),
  updateSettings: (patch) => invoke('updateSettings', patch),
  external: (url) => invoke('external', url),
  onEvent: (callback) => {
    const listener = (_: unknown, event: AppEvent) => callback(event)
    ipcRenderer.on('slipsmd:event', listener)
    return () => ipcRenderer.removeListener('slipsmd:event', listener)
  },
}
contextBridge.exposeInMainWorld('slipsmd', api)
