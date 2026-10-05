import { BrowserWindow, dialog, Notification, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import type { WorkspaceCommand } from '../shared/bridge'
import type { FloatSpec, WorkspaceSummary } from '../shared/types'
import { fitBounds, floatHome, floatWindowOptions, syncFloats, windowOpacity } from './float-model'
import { applyGlass, type GlassLib } from './glass'
import { DaemonLink } from './daemon-link'
import { NotifyKeeper } from './notify-keeper'
import { closeDialogText, closedNoticeText } from './workspaces-model'

interface FloatEntry {
  win: BrowserWindow
  link: DaemonLink
  spec: FloatSpec
  wsId: string
  /** liberada para fechar sem virar "esconder" (sincronização ou encerrando o app) */
  closing: boolean
}

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
  private floats = new Map<string, FloatEntry>()
  /** espaços abertos ao menos uma vez nesta execução: só eles mostram flutuantes */
  private active = new Set<string>()
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
    return [...[...this.entries.values()].map((e) => e.win), ...[...this.floats.values()].map((f) => f.win), ...(this.chooser ? [this.chooser] : [])]
  }

  /** a conexão de quem mandou o IPC; a tela de reabrir usa a de serviço */
  linkFor(e: IpcMainEvent | IpcMainInvokeEvent): DaemonLink {
    const win = BrowserWindow.fromWebContents(e.sender)
    for (const f of this.floats.values()) if (f.win === win) return f.link
    return this.entryOf(e)?.link ?? this.o.service
  }

  /** espaço da janela que mandou o IPC (espaço ou flutuante) */
  wsOf(e: IpcMainEvent | IpcMainInvokeEvent): string | null {
    const win = BrowserWindow.fromWebContents(e.sender)
    for (const f of this.floats.values()) if (f.win === win) return f.wsId
    return this.entryOf(e)?.id ?? null
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
    this.active.add(id)
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
      // ⌘+clique vindo da flutuante: no mac a janela inativa não ativa e, sem isso, o clique se perde
      acceptFirstMouse: true,
      title: `${TITLE} — ${this.nameOf(id)}`,
      webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: false, plugins: true }, // plugins: visualizador de PDF do painel de arquivo
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
    // flutuantes do espaço aparecem junto com a primeira abertura nesta execução (perto da janela dele)
    this.syncFloats(this.summary)
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

  /** a flutuante não tem grade nem modais: arquivos, ⌘P e o menu vão para a janela do espaço dela (que vem para a frente) */
  async toWorkspace(e: IpcMainInvokeEvent, cmd: WorkspaceCommand): Promise<void> {
    const id = this.wsOf(e)
    if (!id) return
    await this.open(id)
    const w = this.entries.get(id)?.win
    if (!w || w.isDestroyed()) return
    if (w.webContents.isLoading()) w.webContents.once('did-finish-load', () => w.webContents.send('gt:wsCommand', cmd))
    else w.webContents.send('gt:wsCommand', cmd)
  }

  /** o resumo do daemon manda: abre as flutuantes que faltam, fecha as que saíram, aplica 📌/🌐/◐ */
  syncFloats(summary: WorkspaceSummary[]): void {
    const r = syncFloats(summary, this.active, new Map([...this.floats].map(([k, v]) => [k, v.spec])))
    for (const id of r.close) {
      const f = this.floats.get(id)
      if (!f) continue
      f.closing = true
      f.win.close()
    }
    for (const f of r.update) {
      const cur = this.floats.get(f.paneId)
      if (!cur) continue
      cur.spec = f
      applyPrefs(cur.win, f)
    }
    const fresh = new Map<string, number>()
    for (const f of r.open) {
      const n = f.bounds ? 0 : (fresh.get(f.wsId) ?? 0)
      if (!f.bounds) fresh.set(f.wsId, n + 1)
      this.openFloat(f, f.wsId, n)
    }
  }

  private openFloat(f: FloatSpec, wsId: string, n: number): void {
    const wsWin = this.entries.get(wsId)?.win
    const home = floatHome(wsWin && !wsWin.isDestroyed() ? wsWin.getBounds() : null, screen.getPrimaryDisplay().workArea, n)
    const bounds = fitBounds(f.bounds, screen.getAllDisplays().map((d) => d.workArea), home)
    const win = new BrowserWindow({
      ...floatWindowOptions(bounds, process.platform === 'darwin'),
      title: `${TITLE} — flutuante`,
      webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: false, plugins: true }, // plugins: visualizador de PDF do painel de arquivo
    })
    applyPrefs(win, f)
    const link = new DaemonLink({
      socketPath: this.o.socketPath,
      daemonScript: this.o.daemonScript,
      workspaceId: wsId,
      onEvent: (e) => {
        if (e.t !== 'usage.alert' && !win.isDestroyed()) win.webContents.send('gt:event', e)
      },
    })
    const entry: FloatEntry = { win, link, spec: f, wsId, closing: false }
    this.floats.set(f.paneId, entry)
    let t: NodeJS.Timeout | null = null
    const save = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => {
        if (!win.isDestroyed()) void link.request({ t: 'float.prefs', paneId: f.paneId, bounds: win.getBounds() }).catch(() => {})
      }, 400)
    }
    win.on('move', save)
    win.on('resize', save)
    win.on('close', (ev) => {
      if (this.quitting || entry.closing) return
      // fechar pelo sistema = esconder (a sessão segue viva)
      ev.preventDefault()
      void link.request({ t: 'float.set', paneId: f.paneId, mode: 'hide' }).catch(() => {})
    })
    win.on('closed', () => {
      if (t) clearTimeout(t)
      link.close()
      if (this.floats.get(f.paneId) === entry) this.floats.delete(f.paneId)
    })
    this.load(win, { view: 'float', ws: wsId, pane: f.paneId })
    // mac: Liquid Glass atrás do conteúdo; se o módulo não carregar, o vidro clássico
    if (process.platform === 'darwin') {
      win.webContents.once('did-finish-load', () => {
        if (win.isDestroyed()) return
        if (!applyGlass(win, () => require('electron-liquid-glass') as GlassLib)) win.setVibrancy('under-window')
      })
    }
    void link.start().catch(() => {})
  }

  /** traz a flutuante para a frente (trocando de mesa); false se o painel não flutua nesta execução */
  focusFloat(paneId: string): boolean {
    const f = this.floats.get(paneId)
    if (!f || f.win.isDestroyed()) return false
    f.win.show()
    f.win.moveTop()
    f.win.focus()
    return true
  }

  /** "Encerrar tudo": solta as conexões das janelas antes de derrubar o daemon (senão elas o religam) */
  detachAll(): void {
    for (const e of this.entries.values()) e.link.close()
    for (const f of this.floats.values()) f.link.close()
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

/** 📌 por cima de tudo; 🌐 em todas as mesas (com nível acima de apps em tela cheia); ◐ opacidade (só linux; no mac é o fundo, no renderer) */
function applyPrefs(win: BrowserWindow, f: FloatSpec): void {
  win.setAlwaysOnTop(f.onTop, f.allDesks ? 'screen-saver' : 'floating')
  win.setVisibleOnAllWorkspaces(f.allDesks, { visibleOnFullScreen: true })
  win.setOpacity(windowOpacity(f.opacity, process.platform === 'darwin'))
}
