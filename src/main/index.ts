import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ClientRequest } from '../shared/protocol'
import type { ConfirmOptions, MenuItemSpec, WorkspaceCommand } from '../shared/bridge'
import type { WorkspaceSummary } from '../shared/types'
import { DaemonLink } from './daemon-link'
import { buildMenu } from './menu'
import { dockTemplate } from './menu-template'
import { platformOf, resolveBindings, type Bindings } from '../shared/keybindings'
import { NotifyKeeper } from './notify-keeper'
import { WindowManager } from './windows'
import { handleMediaProtocol, registerMediaScheme } from './media-protocol'
import { readWindowBg, readWindowDesktop, writeWindowBg, writeWindowDesktop } from './window-bg'
import { fitWidth, listBackgrounds, removeBackground, userBgName } from './backgrounds'
import { badgeTotal, busySessions, decideStartup, openAfterUpdate } from './workspaces-model'
import { Updater } from './updater/updater'
import { canWriteTarget, createInstallTrigger, installTarget, runInstall, waitSocketGone } from './updater/install'
import { clearAfterUpdate, markStarted, openThenConfirm, readAfterUpdate } from './updater/after-update'

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
/** fundo do último tema: a primeira janela da abertura já nasce na cor certa (sem retângulo escuro no Claro) */
const windowBgFile = path.join(home, 'window-bg')
manager.background = readWindowBg(windowBgFile)
const windowDesktopFile = path.join(home, 'window-desktop')
manager.desktop = readWindowDesktop(windowDesktopFile)

const updatesDir = path.join(home, 'updates')
const updateTarget = installTarget(process.platform, process.execPath, process.env.APPIMAGE)
const updater = new Updater({
  current: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  appImage: !!process.env.APPIMAGE,
  updatesDir,
  apiUrl: process.env.GT_UPDATE_URL ?? 'https://api.github.com/repos/misasoares/gerenciador-de-terminal/releases/latest',
  fetch: (url, init) => fetch(url, init),
  canWrite: () => !!updateTarget && canWriteTarget(updateTarget),
  onStatus: (s) => manager.broadcast('gt:update', s),
})
/** janela do último clique em "Atualizar": o diálogo de confirmação abre nela */
let updateClickWin: BrowserWindow | undefined

/** botão "Atualizar": confirma se há sessões trabalhando; o daemon salva as sessões e o script troca a versão */
const installUpdate = createInstallTrigger({
  ready: () => (updateTarget ? updater.ready : null),
  busy: () => busySessions(manager.summary),
  confirm: async (busy, version) => {
    const w = updateClickWin
    const opts = {
      type: 'question' as const,
      message: `Atualizar para ${version}?`,
      detail: `${busy === 1 ? '1 sessão está trabalhando' : `${busy} sessões estão trabalhando`}. Elas param agora e são retomadas na nova versão.`,
      buttons: ['Atualizar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
    }
    const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts)
    return r.response === 0
  },
  run: (ready) =>
    runInstall({
      updatesDir,
      stateFile: path.join(home, 'state.json'),
      helperSource: path.join(process.resourcesPath, 'update-helper.sh'),
      from: app.getVersion(),
      ready,
      target: updateTarget!,
      appPid: process.pid,
      env: process.env,
      // como no "Encerrar tudo": as janelas soltam o daemon antes (senão reconectariam e subiriam outro)
      stopDaemon: async () => {
        manager.quitting = true
        manager.detachAll()
        await service.shutdownDaemon(false)
        if (!(await waitSocketGone(socketPath, 10_000))) console.error('atualização: o daemon não encerrou em 10 s; seguindo')
      },
      spawnDetached: (cmd, args, env) => spawn(cmd, args, { detached: true, stdio: 'ignore', env }).unref(),
      quit: () => app.quit(),
    }),
})

/** renderers das janelas de espaço que já carregaram o estado (gt:rendererReady) */
const readyRenderers = new Set<number>()
let renderWaiters: (() => void)[] = []
function renderersReady(): Promise<void> {
  return new Promise((resolve) => {
    const check = (): void => {
      if (manager.workspaceContentIds().every((id) => readyRenderers.has(id))) resolve()
      else renderWaiters.push(check)
    }
    check()
  })
}

/** primeira abertura na versão nova: reabre os espaços abertos direto e cada janela retoma as sessões */
async function startupAfterUpdate(version: string): Promise<void> {
  const list = await service.request<WorkspaceSummary[]>({ t: 'workspace.list' })
  manager.summary = list
  manager.afterUpdate = version
  try {
    await openThenConfirm({ ids: openAfterUpdate(list), open: (id) => manager.open(id), rendered: renderersReady, confirm: () => markStarted(updatesDir, version) })
  } finally {
    manager.afterUpdate = null
  }
}

function onSummary(list: WorkspaceSummary[], askOnClose: boolean): void {
  manager.summary = list
  manager.syncFloats(list)
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
ipcMain.handle('gt:focusFloat', (_e, paneId: string) => manager.focusFloat(paneId))
// tema do app: elementos nativos (rolagem, players, pdf, vidro) no mesmo esquema; janelas novas com o fundo do tema
ipcMain.on('gt:appearance', (_e, o: { scheme: 'light' | 'dark'; follow: boolean; bg: string; desktop: boolean }) => {
  // modo mesa vale para janelas novas; as abertas só mudam ao reabrir
  if (typeof o.desktop === 'boolean' && o.desktop !== manager.desktop) {
    manager.desktop = o.desktop
    writeWindowDesktop(windowDesktopFile, o.desktop)
  }
  nativeTheme.themeSource = o.follow ? 'system' : o.scheme
  if (/^#[0-9a-f]{6}$/i.test(o.bg) && o.bg !== manager.background) {
    manager.background = o.bg
    writeWindowBg(windowBgFile, o.bg)
  }
})
ipcMain.handle('gt:reopenWindows', () => manager.reopenAll())
ipcMain.handle('gt:backgrounds', () => listBackgrounds(path.join(home, 'fundos')))
// fundo do usuário: copia e reduz para GT_HOME/fundos (o original pode sumir sem afetar o app)
ipcMain.handle('gt:importBackground', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const opts = { properties: ['openFile' as const], filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'heic'] }] }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (r.canceled || !r.filePaths[0]) return null
  const img = nativeImage.createFromPath(r.filePaths[0])
  if (img.isEmpty()) throw new Error('Não foi possível ler essa imagem.')
  const { width, height } = img.getSize()
  const jpeg = img.resize(fitWidth(width, height)).toJPEG(85)
  const dir = path.join(home, 'fundos')
  fs.mkdirSync(dir, { recursive: true })
  const name = userBgName(jpeg)
  fs.writeFileSync(path.join(dir, name), jpeg)
  return name
})
ipcMain.handle('gt:removeBackground', (_e, name: string) => void removeBackground(path.join(home, 'fundos'), name))
ipcMain.handle('gt:updateStatus', () => updater.status)
ipcMain.handle('gt:installUpdate', (e) => {
  updateClickWin = winOf(e)
  return installUpdate()
})
ipcMain.on('gt:rendererReady', (e) => {
  readyRenderers.add(e.sender.id)
  const w = renderWaiters
  renderWaiters = []
  for (const f of w) f()
})
ipcMain.handle('gt:toWorkspace', (e, cmd: WorkspaceCommand) => manager.toWorkspace(e, cmd))
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

// mídia no painel de arquivo (imagem, vídeo, áudio, pdf): o esquema tem de existir antes do app ficar pronto
registerMediaScheme()

app.whenReady().then(async () => {
  handleMediaProtocol()
  const after = readAfterUpdate(updatesDir, app.getVersion())
  try {
    await service.start()
    applyMenu()
    if (after.kind === 'updated') await startupAfterUpdate(after.to)
    else await startup()
  } catch (e) {
    dialog.showErrorBox('Gerenciador de Terminal', `Não foi possível iniciar o daemon.\n\n${String(e)}\n\nVeja ${path.join(home, 'daemon.log')}`)
    app.quit()
    return
  }
  if (after.kind === 'failed') updater.setFailed(after.to, after.current)
  if (after.kind !== 'none') clearAfterUpdate(updatesDir)
  // só o app empacotado se atualiza (no dev o "bundle" seria o Electron do node_modules)
  if (app.isPackaged) {
    setTimeout(() => void updater.check(), 10_000)
    setInterval(() => void updater.check(), 6 * 60 * 60 * 1000)
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
