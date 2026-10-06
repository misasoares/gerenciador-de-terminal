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

/** pedido da janela flutuante para a janela do espaço dela */
export type WorkspaceCommand =
  | { t: 'menu'; action: string }
  | { t: 'open-file'; path: string; line: number | null }
  | { t: 'pick-file'; root: string }

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
  /** esquema claro/escuro do tema efetivo (follow = automático) e fundo para janelas novas */
  setAppearance(o: { scheme: 'light' | 'dark'; follow: boolean; bg: string; desktop: boolean }): void
  /** imagens de fundo do usuário (pasta e nomes) */
  backgrounds(): Promise<{ dir: string; list: string[] }>
  /** escolhe uma imagem no Finder e a importa como fundo; null = cancelou */
  importBackground(): Promise<string | null>
  removeBackground(name: string): Promise<void>
  /** reabre as janelas de espaço (aplica o fundo mesa do macOS / opaco) */
  reopenWindows(): Promise<void>
  /** (flutuante) manda o pedido para a janela do espaço, trazendo-a para a frente */
  toWorkspace(cmd: WorkspaceCommand): Promise<void>
  /** (janela do espaço) pedidos vindos das flutuantes */
  onWorkspaceCommand(cb: (cmd: WorkspaceCommand) => void): () => void
}
