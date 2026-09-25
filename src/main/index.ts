import { app, BrowserWindow } from 'electron'
import path from 'node:path'

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1200, height: 800, webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: false } })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
