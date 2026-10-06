import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BridgeEvent, ClientRequest } from '../shared/protocol'
import type { ConfirmOptions, GtApi, MenuItemSpec, WorkspaceCommand } from '../shared/bridge'

const api: GtApi = {
  request: (req: ClientRequest) => ipcRenderer.invoke('gt:request', req),
  send: (req: ClientRequest) => ipcRenderer.send('gt:send', req),
  onEvent: (cb) => {
    const l = (_e: unknown, m: BridgeEvent) => cb(m)
    ipcRenderer.on('gt:event', l)
    return () => ipcRenderer.removeListener('gt:event', l)
  },
  onMenu: (cb) => {
    const l = (_e: unknown, a: string) => cb(a)
    ipcRenderer.on('gt:menu', l)
    return () => ipcRenderer.removeListener('gt:menu', l)
  },
  pickFolder: () => ipcRenderer.invoke('gt:pickFolder'),
  confirm: (o: ConfirmOptions) => ipcRenderer.invoke('gt:confirm', o),
  alert: (message: string, detail?: string) => ipcRenderer.invoke('gt:alert', message, detail),
  contextMenu: (items: MenuItemSpec[]) => ipcRenderer.invoke('gt:contextMenu', items),
  openPath: (p: string) => ipcRenderer.invoke('gt:openPath', p),
  openExternal: (url: string) => ipcRenderer.invoke('gt:openExternal', url),
  restartDaemon: () => ipcRenderer.invoke('gt:restartDaemon'),
  notify: (o) => ipcRenderer.send('gt:notify', o),
  setBadge: (text: string) => ipcRenderer.send('gt:setBadge', text),
  onReveal: (cb) => {
    const l = (_e: unknown, id: string) => cb(id)
    ipcRenderer.on('gt:reveal', l)
    return () => ipcRenderer.removeListener('gt:reveal', l)
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  platform: process.platform,
  setKeybindings: (b) => ipcRenderer.send('gt:keybindings', b),
  openWorkspaces: (ids: string[]) => ipcRenderer.invoke('gt:openWorkspaces', ids),
  createWorkspace: (name: string) => ipcRenderer.invoke('gt:createWorkspace', name),
  revealIn: (workspaceId: string, paneId: string | null) => ipcRenderer.invoke('gt:revealIn', workspaceId, paneId),
  focusFloat: (paneId: string) => ipcRenderer.invoke('gt:focusFloat', paneId),
  setAppearance: (o) => ipcRenderer.send('gt:appearance', o),
  backgrounds: () => ipcRenderer.invoke('gt:backgrounds'),
  importBackground: () => ipcRenderer.invoke('gt:importBackground'),
  removeBackground: (name: string) => ipcRenderer.invoke('gt:removeBackground', name),
  reopenWindows: () => ipcRenderer.invoke('gt:reopenWindows'),
  toWorkspace: (cmd: WorkspaceCommand) => ipcRenderer.invoke('gt:toWorkspace', cmd),
  onWorkspaceCommand: (cb) => {
    const l = (_e: unknown, cmd: WorkspaceCommand) => cb(cmd)
    ipcRenderer.on('gt:wsCommand', l)
    return () => ipcRenderer.removeListener('gt:wsCommand', l)
  },
}

contextBridge.exposeInMainWorld('gt', api)
