import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import type { ClientRequest } from '../shared/protocol'
import type { ConfirmOptions, MenuItemSpec } from '../shared/bridge'
import { DaemonLink } from './daemon-link'
import { buildMenu } from './menu'
import { platformOf, resolveBindings, type Bindings } from '../shared/keybindings'
import { NotifyKeeper } from './notify-keeper'

const notifications = new NotifyKeeper()
const platform = platformOf(process.platform)
/** atalhos em vigor; o renderer manda os resolvidos pelas preferências (gt:keybindings) */
let bindings: Bindings = resolveBindings(platform, {})

function applyMenu(): void {
  Menu.setApplicationMenu(buildMenu({ send: (a) => win?.webContents.send('gt:menu', a), quitAll: () => void quitAll(), platform, bindings }))
}

let win: BrowserWindow | null = null
const home = process.env.GT_HOME ?? path.join(os.homedir(), '.gerenciador-terminal')

const link = new DaemonLink({
  socketPath: path.join(home, 'daemon.sock'),
  daemonScript: path.join(__dirname, 'daemon.js'),
  onEvent: (e) => {
    // o aviso de uso sai daqui: a janela pode estar carregando ou fechada
    if (e.t === 'usage.alert') showUsageAlert(e.text)
    else win?.webContents.send('gt:event', e)
  },
})

function showUsageAlert(text: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: 'Uso do plano', body: text, silent: false })
  notifications.keep(n)
  n.on('click', () => {
    if (!win) createWindow()
    win?.show()
    win?.focus()
  })
  n.show()
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#1e1e1e',
    title: 'Gerenciador de Terminal',
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: false },
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  win.webContents.on('did-finish-load', () => notifications.loaded((id) => win?.webContents.send('gt:reveal', id)))
  win.on('closed', () => {
    win = null
  })
}

ipcMain.handle('gt:request', (_e, req: ClientRequest) => link.request(req))
ipcMain.on('gt:send', (_e, req: ClientRequest) => link.send(req))
ipcMain.handle('gt:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('gt:confirm', async (_e, o: ConfirmOptions) => {
  const r = await dialog.showMessageBox(win!, {
    type: 'warning',
    message: o.message,
    detail: o.detail,
    buttons: [o.confirmLabel ?? 'Confirmar', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    checkboxLabel: o.checkboxLabel,
  })
  return { ok: r.response === 0, checked: r.checkboxChecked }
})
ipcMain.handle('gt:alert', async (_e, message: string, detail?: string) => {
  await dialog.showMessageBox(win!, { type: 'info', message, detail })
})
ipcMain.handle(
  'gt:contextMenu',
  (_e, items: MenuItemSpec[]) =>
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
      menu.popup({ window: win ?? undefined, callback: () => setTimeout(() => finish(null), 50) })
    }),
)
ipcMain.handle('gt:openPath', async (_e, p: string) => {
  await shell.openPath(p)
})
ipcMain.handle('gt:openExternal', async (_e, url: string) => {
  if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
})
ipcMain.handle('gt:restartDaemon', () => link.shutdownDaemon(true))
ipcMain.on('gt:notify', (_e, o: { paneId: string; title: string; body: string }) => {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: o.title, body: o.body, silent: false })
  notifications.keep(n)
  n.on('click', () => {
    const existed = !!win
    if (!win) createWindow()
    win?.show()
    win?.focus()
    const ready = existed && !!win && !win.webContents.isLoading()
    notifications.reveal(o.paneId, ready, (id) => win?.webContents.send('gt:reveal', id))
  })
  n.show()
})
ipcMain.on('gt:keybindings', (_e, b: Bindings) => {
  bindings = b
  applyMenu()
})
ipcMain.on('gt:setBadge', (_e, text: string) => {
  app.dock?.setBadge(text)
})

async function quitAll(): Promise<void> {
  const r = await dialog.showMessageBox(win!, {
    type: 'warning',
    message: 'Encerrar tudo?',
    detail: 'Todas as sessões e terminais serão finalizados. Eles poderão ser retomados na próxima abertura.',
    buttons: ['Encerrar tudo', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
  })
  if (r.response !== 0) return
  await link.shutdownDaemon(false)
  app.quit()
}

app.whenReady().then(async () => {
  try {
    await link.start()
  } catch (e) {
    dialog.showErrorBox('Gerenciador de Terminal', `Não foi possível iniciar o daemon.\n\n${String(e)}\n\nVeja ${path.join(home, 'daemon.log')}`)
    app.quit()
    return
  }
  applyMenu()
  createWindow()
  app.on('activate', () => {
    if (!win) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())
