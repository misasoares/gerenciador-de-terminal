import { BrowserWindow, dialog, Notification, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import type { WorkspaceSummary } from '../shared/types'
import { DaemonLink } from './daemon-link'
import { NotifyKeeper } from './notify-keeper'
import { closeDialogText, closedNoticeText } from './workspaces-model'

interface Entry {
  id: string
  win: BrowserWindow
  link: DaemonLink
  /** revelação de painel que espera o renderer desta janela carregar */
  keeper: NotifyKeeper
  /** liberado para fechar sem perguntar (já decidido ou encerrando o app) */
  closing: boolean
}

export interface WindowManagerOptions {
  socketPath: string
  daemonScript: string
  /** conexão sem espaço: lista, cria espaços e atende a tela de reabrir */
  service: DaemonLink
  /** no Linux fechar a última janela encerra a interface */
  quitOnLastClose: boolean
  quit(): void
  notifications: NotifyKeeper
}

const TITLE = 'Gerenciador de Terminal'

/** uma janela (e uma conexão com o daemon) por espaço de trabalho aberto */
export class WindowManager {
  private entries = new Map<string, Entry>()
  private chooser: BrowserWindow | null = null
  /** resumo mais recente de todos os espaços (vem da conexão de serviço) */
  summary: WorkspaceSummary[] = []
  askOnClose = true
  /** encerrando o app: as janelas fecham sem perguntar e os espaços continuam "abertos" para a próxima vez */
  quitting = false

  constructor(private o: WindowManagerOptions) {}

  get size(): number {
    return this.entries.size
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  windows(): BrowserWindow[] {
    return [...[...this.entries.values()].map((e) => e.win), ...(this.chooser ? [this.chooser] : [])]
  }

  /** a conexão de quem mandou o IPC; a tela de reabrir usa a de serviço */
  linkFor(e: IpcMainEvent | IpcMainInvokeEvent): DaemonLink {
    return this.entryOf(e)?.link ?? this.o.service
  }

  entryOf(e: IpcMainEvent | IpcMainInvokeEvent): Entry | null {
    const win = BrowserWindow.fromWebContents(e.sender)
    for (const x of this.entries.values()) if (x.win === win) return x
    return null
  }

  isChooser(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return !!this.chooser && BrowserWindow.fromWebContents(e.sender) === this.chooser
  }

  private nameOf(id: string): string {
    return this.summary.find((w) => w.id === id)?.name ?? id
  }

  private load(win: BrowserWindow, query: Record<string, string>): void {
    const qs = new URLSearchParams(query).toString()
    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?${qs}`)
    else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { query })
  }

  /** abre a janela do espaço; se já estiver aberta, só a traz para a frente (nunca duas do mesmo espaço) */
  async open(id: string): Promise<void> {
    const cur = this.entries.get(id)
    if (cur) {
      if (cur.win.isMinimized()) cur.win.restore()
      // mac: mostrar uma janela do app que está em outra mesa leva o usuário até aquela mesa
      cur.win.show()
      cur.win.moveTop()
      cur.win.focus()
      return
    }
    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      backgroundColor: '#1e1e1e',
      title: `${TITLE} — ${this.nameOf(id)}`,
      webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: false },
    })
    win.on('page-title-updated', (ev) => ev.preventDefault())
    const keeper = new NotifyKeeper()
    const link = new DaemonLink({
      socketPath: this.o.socketPath,
      daemonScript: this.o.daemonScript,
      workspaceId: id,
      onEvent: (e) => {
        if (e.t === 'usage.alert') return // o aviso de uso sai uma vez só, pela conexão de serviço
        if (e.t === 'state') {
          const name = e.state.workspaces.find((w) => w.id === id)?.name
          if (name && !win.isDestroyed()) win.setTitle(`${TITLE} — ${name}`)
        }
        if (!win.isDestroyed()) win.webContents.send('gt:event', e)
      },
    })
    const entry: Entry = { id, win, link, keeper, closing: false }
    this.entries.set(id, entry)
    win.webContents.on('did-finish-load', () => keeper.loaded((paneId) => win.webContents.send('gt:reveal', paneId)))
    win.on('close', (ev) => {
      if (this.quitting || entry.closing) return
      ev.preventDefault()
      void this.requestClose(entry)
    })
    win.on('closed', () => {
      link.close()
      if (this.entries.get(id) === entry) this.entries.delete(id)
    })
    this.load(win, { ws: id })
    try {
      await link.start()
    } catch (e) {
      entry.closing = true
      win.destroy()
      throw e
    }
  }

  /** tela "Reabrir espaços de trabalho" */
  openChooser(): void {
    if (this.chooser) {
      this.chooser.show()
      this.chooser.focus()
      return
    }
    const win = new BrowserWindow({
      width: 480,
      height: 420,
      resizable: false,
      backgroundColor: '#1e1e1e',
      title: 'Reabrir espaços de trabalho',
      webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: false },
    })
    win.on('page-title-updated', (ev) => ev.preventDefault())
    win.on('closed', () => {
      if (this.chooser === win) this.chooser = null
      if (!this.quitting && this.o.quitOnLastClose && this.entries.size === 0) this.o.quit()
    })
    this.chooser = win
    this.load(win, { view: 'reopen' })
  }

  closeChooser(): void {
    const c = this.chooser
    this.chooser = null
    c?.close()
  }

  /** fechar a janela: as sessões seguem no daemon; pergunta na primeira vez e avisa por notificação */
  private async requestClose(entry: Entry): Promise<void> {
    const { id, win, link } = entry
    // Linux, última janela: encerra a interface como antes (o espaço continua "aberto" para a próxima vez)
    if (this.o.quitOnLastClose && this.entries.size === 1 && !this.chooser) {
      this.quitting = true
      this.o.quit()
      return
    }
    const list = await link.request<WorkspaceSummary[]>({ t: 'workspace.list' }).catch(() => this.summary)
    const sum = list.find((w) => w.id === id)
    const name = sum?.name ?? id
    // "Encerrar espaço" já marcou fechado (as sessões ainda podem estar morrendo): fecha sem perguntar
    if (sum && !sum.open) {
      entry.closing = true
      win.destroy()
      return
    }
    const sessions = sum?.sessions ?? 0
    let end = false
    if (sessions > 0 && this.askOnClose) {
      const r = await dialog.showMessageBox(win, {
        type: 'question',
        message: closeDialogText(name, sessions),
        buttons: ['Fechar janela', 'Encerrar o espaço também', 'Cancelar'],
        defaultId: 0,
        cancelId: 2,
        checkboxLabel: 'não perguntar de novo',
      })
      if (r.response === 2) return
      if (r.checkboxChecked) await link.request({ t: 'workspace.setAskOnClose', ask: false }).catch(() => {})
      end = r.response === 1
    }
    try {
      if (end) await link.request({ t: 'workspace.end', id })
      else await link.request({ t: 'workspace.setOpen', id, open: false })
    } catch {
      // sem daemon: fecha mesmo assim
    }
    if (!end && sessions > 0) this.notify(name, closedNoticeText(name, sessions), id)
    entry.closing = true
    win.destroy()
  }

  private notify(title: string, body: string, reopenId: string): void {
    if (!Notification.isSupported()) return
    const n = new Notification({ title, body, silent: true })
    this.o.notifications.keep(n)
    n.on('click', () => void this.open(reopenId))
    n.show()
  }

  /** clique na notificação de estado: abre (ou reabre) a janela do espaço e revela o painel */
  async reveal(id: string, paneId: string): Promise<void> {
    const existed = this.entries.has(id)
    await this.open(id)
    const e = this.entries.get(id)
    if (!e) return
    const ready = existed && !e.win.webContents.isLoading()
    e.keeper.reveal(paneId, ready, (p) => e.win.webContents.send('gt:reveal', p))
  }

  /** "Encerrar tudo": solta as conexões das janelas antes de derrubar o daemon (senão elas o religam) */
  detachAll(): void {
    for (const e of this.entries.values()) e.link.close()
  }

  /** manda a ação do menu para a janela em foco (ou a primeira) */
  sendMenu(action: string): boolean {
    const focused = BrowserWindow.getFocusedWindow()
    const target = this.windows().find((w) => w === focused) ?? this.windows()[0]
    if (!target) return false
    target.webContents.send('gt:menu', action)
    return true
  }
}
