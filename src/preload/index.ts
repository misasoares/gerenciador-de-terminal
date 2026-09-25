import { contextBridge, ipcRenderer } from 'electron'
import type { BridgeEvent, ClientRequest } from '../shared/protocol'
import type { ConfirmOptions, GtApi, MenuItemSpec } from '../shared/bridge'

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
}

contextBridge.exposeInMainWorld('gt', api)
