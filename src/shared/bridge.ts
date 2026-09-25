import type { BridgeEvent, ClientRequest } from './protocol'

export interface ConfirmOptions {
  message: string
  detail?: string
  confirmLabel?: string
  checkboxLabel?: string
}

/** id "-" vira separador */
export interface MenuItemSpec {
  id: string
  label: string
  enabled?: boolean
}

export interface GtApi {
  request<T = unknown>(req: ClientRequest): Promise<T>
  send(req: ClientRequest): void
  onEvent(cb: (e: BridgeEvent) => void): () => void
  onMenu(cb: (action: string) => void): () => void
  pickFolder(): Promise<string | null>
  confirm(o: ConfirmOptions): Promise<{ ok: boolean; checked: boolean }>
  alert(message: string, detail?: string): Promise<void>
  contextMenu(items: MenuItemSpec[]): Promise<string | null>
  openPath(p: string): Promise<void>
  openExternal(url: string): Promise<void>
  restartDaemon(): Promise<void>
  pathForFile(file: File): string
}
