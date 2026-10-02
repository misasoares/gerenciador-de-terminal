import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import type { ClientRequest } from '../shared/protocol'
import type { ConfirmOptions, MenuItemSpec } from '../shared/bridge'
import type { WorkspaceSummary } from '../shared/types'
import { DaemonLink } from './daemon-link'
import { buildMenu } from './menu'
import { dockTemplate } from './menu-template'
import { platformOf, resolveBindings, type Bindings } from '../shared/keybindings'
import { NotifyKeeper } from './notify-keeper'
import { WindowManager } from './windows'
import { badgeTotal, decideStartup } from './workspaces-model'

const notifications = new NotifyKeeper()
const platform = platformOf(process.platform)
/** atalhos em vigor; o renderer manda os resolvidos pelas preferências (gt:keybindings) */
let bindings: Bindings = resolveBindings(platform, {})

const home = process.env.GT_HOME ?? path.join(os.homedir(), '.gerenciador-terminal')
const socketPath = path.join(home, 'daemon.sock')
const daemonScript = path.join(__dirname, 'daemon.js')

/** chave do que aparece nos menus (nome e aberto); sessões mudando não remontam o menu */
let menuKey = ''

// conexão de serviço: sem espaço; lista/cria espaços, atende a tela de reabrir e recebe o resumo de todos
const service = new DaemonLink({
  socketPath,
  daemonScript,
  onEvent: (e) => {
    if (e.t === 'usage.alert') showUsageAlert(e.text)
    else if (e.t === 'state') onSummary(e.state.workspaces, e.state.askOnCloseWindow)
  },
})

const manager = new WindowManager({
  socketPath,
  daemonScript,
  service,
  quitOnLastClose: platform !== 'mac',
  quit: () => app.quit(),
  notifications,
})

function onSummary(list: WorkspaceSummary[], askOnClose: boolean): void {
  manager.summary = list
  manager.askOnClose = askOnClose
  app.dock?.setBadge(badgeTotal(list))
  const key = JSON.stringify(list.map((w) => [w.id, w.name, w.open]))
  if (key !== menuKey) {
    menuKey = key
    applyMenu()
  }
}

function newWorkspace(): void {
  // o nome é pedido num modal do renderer; sem janela nenhuma, a tela de reabrir tem o "Novo espaço"
  if (!manager.sendMenu('new-workspace')) manager.openChooser()
}

function openWorkspace(id: string): void {
  void manager.open(id).catch(showOpenError)
}

function applyMenu(): void {
  Menu.setApplicationMenu(
    buildMenu({
      send: (a) => (a === 'new-workspace' ? newWorkspace() : void manager.sendMenu(a)),
      quitAll: () => void quitAll(),
      platform,
      bindings,
      workspaces: manager.summary,
      openWorkspace,
    }),
  )
  app.dock?.setMenu(Menu.buildFromTemplate(dockTemplate({ workspaces: manager.summary, openWorkspace, newWorkspace })))
}

function showOpenError(e: unknown): void {
  dialog.showErrorBox('Gerenciador de Terminal', `Não foi possível abrir o espaço.\n\n${String(e)}`)
}

function showUsageAlert(text: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: 'Uso do plano', body: text, silent: false })
  notifications.keep(n)
  n.on('click', () => {
    const w = BrowserWindow.getFocusedWindow() ?? manager.windows()[0]
    if (w) {
      w.show()
      w.focus()
    } else void startup().catch(showOpenError)
  })
  n.show()
}

/** 1 espaço abre direto; 2+ mostram a tela de reabrir */
async function startup(): Promise<void> {
  const list = await service.request<WorkspaceSummary[]>({ t: 'workspace.list' })
  manager.summary = list
  const d = decideStartup(list)
  if (d.kind === 'direct') await manager.open(d.id)
  else manager.openChooser()
}

const winOf = (e: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(e.sender) ?? undefined

ipcMain.handle('gt:request', (e, req: ClientRequest) => manager.linkFor(e).request(req))
ipcMain.on('gt:send', (e, req: ClientRequest) => manager.linkFor(e).send(req))
ipcMain.handle('gt:pickFolder', async (e) => {
  const w = winOf(e)
  const r = w ? await dialog.showOpenDialog(w, { properties: ['openDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('gt:confirm', async (e, o: ConfirmOptions) => {
  const opts = {
    type: 'warning' as const,
    message: o.message,
    detail: o.detail,
    buttons: [o.confirmLabel ?? 'Confirmar', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    checkboxLabel: o.checkboxLabel,
  }
  const w = winOf(e)
  const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts)
  return { ok: r.response === 0, checked: r.checkboxChecked }
})
ipcMain.handle('gt:alert', async (e, message: string, detail?: string) => {
  const w = winOf(e)
  if (w) await dialog.showMessageBox(w, { type: 'info', message, detail })
  else await dialog.showMessageBox({ type: 'info', message, detail })
})
ipcMain.handle(
  'gt:contextMenu',
  (e, items: MenuItemSpec[]) =>
    new Promise<string | null>((resolve) => {
      let done = false
      const finish = (v: string | null) => {
        if (!done) {
          done = true
          resolve(v)
        }
      }
      const menu = Menu.buildFromTemplate(
        items.map((i) =>
          i.id === '-' ? { type: 'separator' as const } : { label: i.label, enabled: i.enabled !== false, click: () => finish(i.id) },
        ),
      )
      // o callback de fechamento pode vir antes do click
      menu.popup({ window: winOf(e), callback: () => setTimeout(() => finish(null), 50) })
    }),
)
ipcMain.handle('gt:openPath', async (_e, p: string) => {
  await shell.openPath(p)
})
ipcMain.handle('gt:openExternal', async (_e, url: string) => {
  if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
})
ipcMain.handle('gt:restartDaemon', (e) => manager.linkFor(e).shutdownDaemon(true))
ipcMain.on('gt:notify', (e, o: { paneId: string; title: string; body: string }) => {
  if (!Notification.isSupported()) return
  // o painel é do espaço da janela que avisou: o clique reabre essa janela se ela tiver fechado
  const wsId = manager.entryOf(e)?.id
  if (!wsId) return
  const n = new Notification({ title: o.title, body: o.body, silent: false })
  notifications.keep(n)
  n.on('click', () => void manager.reveal(wsId, o.paneId).catch(showOpenError))
  n.show()
})
ipcMain.on('gt:keybindings', (_e, b: Bindings) => {
  bindings = b
  applyMenu()
})
ipcMain.on('gt:setBadge', () => {
  // o badge vem do resumo de todos os espaços (onSummary), não de uma janela só
})
ipcMain.handle('gt:openWorkspaces', async (e, ids: string[]) => {
  for (const id of ids) await manager.open(id)
  if (manager.isChooser(e)) manager.closeChooser()
})
ipcMain.handle('gt:revealIn', async (_e, workspaceId: string, paneId: string | null) => {
  if (paneId) await manager.reveal(workspaceId, paneId)
  else await manager.open(workspaceId)
})
ipcMain.handle('gt:createWorkspace', async (e, name: string) => {
  const { id } = await service.request<{ id: string }>({ t: 'workspace.create', name })
  await manager.open(id)
  if (manager.isChooser(e)) manager.closeChooser()
})

async function quitAll(): Promise<void> {
  const opts = {
    type: 'warning' as const,
    message: 'Encerrar tudo?',
    detail: 'Todas as sessões e terminais serão finalizados. Eles poderão ser retomados na próxima abertura.',
    buttons: ['Encerrar tudo', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
  }
  const w = BrowserWindow.getFocusedWindow()
  const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts)
  if (r.response !== 0) return
  manager.quitting = true
  manager.detachAll()
  await service.shutdownDaemon(false)
  app.quit()
}

// ⌘Q / Sair: as janelas fecham sem perguntar e os espaços abertos voltam marcados na próxima vez
app.on('before-quit', () => {
  manager.quitting = true
})

app.whenReady().then(async () => {
  try {
    await service.start()
    applyMenu()
    await startup()
  } catch (e) {
    dialog.showErrorBox('Gerenciador de Terminal', `Não foi possível iniciar o daemon.\n\n${String(e)}\n\nVeja ${path.join(home, 'daemon.log')}`)
    app.quit()
    return
  }
  // mac: clique no Dock sem janelas → tela de reabrir (ou direto, com 1 espaço)
  app.on('activate', () => {
    if (manager.windows().length === 0) void startup().catch(showOpenError)
  })
})

app.on('window-all-closed', () => {
  // mac: o app fica no Dock; Linux: encerra a interface como antes (o daemon segue vivo)
  if (platform !== 'mac') app.quit()
})
