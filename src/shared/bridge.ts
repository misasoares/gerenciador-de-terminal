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
  notify(o: { paneId: string; title: string; body: string }): void
  setBadge(text: string): void
  onReveal(cb: (paneId: string) => void): () => void
  pathForFile(file: File): string
  /** process.platform do Electron ('darwin', 'linux'…) */
  platform: string
  /** atalhos resolvidos: o processo principal reconstrói o menu */
  setKeybindings(b: Record<string, string | null>): void
  /** abre as janelas destes espaços (a tela de reabrir fecha em seguida) */
  openWorkspaces(ids: string[]): Promise<void>
  /** cria um espaço com este nome e abre a janela dele */
  createWorkspace(name: string): Promise<void>
  /** vai para a janela do espaço (trocando de mesa) e, com paneId, abre a aba e foca o terminal */
  revealIn(workspaceId: string, paneId: string | null): Promise<void>
  /** traz a janela flutuante do painel para a frente; false se ele não flutua */
  focusFloat(paneId: string): Promise<boolean>
}
