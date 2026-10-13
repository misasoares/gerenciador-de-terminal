// controlador da cópia isolada do app para gravar material real
import fs from 'node:fs'; import net from 'node:net'; import path from 'node:path'; import { spawn } from 'node:child_process'
import { chromium } from '/Users/misael/.claude/skills/video-promo/scripts/node_modules/playwright/index.mjs'
export const SP = process.env.SP ?? '/tmp/claude-501/promo-scratch'
export const REPO = '/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal'
export const HOME = '/private/tmp/claude-501/gtv'
export const DEMO = '/private/tmp/claude-501/dev'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const wt = (p, w) => (w ? path.join(DEMO, p, '.claude/worktrees', w) : path.join(DEMO, p))

export function seed({ theme = 'noite', projects, command = 'claude', fresh = true, settings = {}, planUsage = false }) {
  if (fresh) fs.rmSync(HOME, { recursive: true, force: true })
  fs.mkdirSync(HOME, { recursive: true })
  const accounts = [{ id: 'claude', label: 'Claude', command, color: '#d97757', agent: 'claude', configDirMatch: ['1-misasoaresms2'], isDefault: true, settingsMatch: null, pathPrefix: null, planUsage }]
  const ps = projects.map(([n, c]) => ({ path: path.join(DEMO, n), name: n, defaultAccountId: 'claude', color: c }))
  const appearance = { mode: 'fixed', theme, light: 'claro', dark: theme, backgrounds: { noite: { kind: 'image', image: 'bundled:noite-2' } }, terminals: { noite: { tone: 'auto', glass: true } } }
  fs.writeFileSync(path.join(HOME, 'state.json'), JSON.stringify({ version: 1, projects: ps, accounts, settings: { appearance, terminalTheme: 'match', fontSize: 13, lineHeight: 1.2, showGitStatus: true, maxHiredPerLeader: 10, ...settings }, workspaces: [{ id: 'principal', name: 'Principal', open: true, projectPaths: ps.map((p) => p.path), layout: { tabs: [], activeTabId: null }, resumable: [], floating: [] }] }))
}

export async function launch({ width = 1280, height = 800, dpr = 2, port = 9333 } = {}) {
  const proc = spawn(path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [`--inspect=${port + 1}`, REPO, `--remote-debugging-port=${port}`], { cwd: REPO, env: { ...process.env, GT_HOME: HOME }, stdio: 'ignore' })
  let browser
  for (let i = 0; i < 60 && !browser; i++) { await sleep(500); try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`) } catch {} }
  let win
  for (let i = 0; i < 60 && !win; i++) { win = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('index.html') && !p.url().includes('view=')); if (!win) await sleep(500) }
  const cdp = await win.context().newCDPSession(win)
  // zoom 2× no conteúdo e viewport em pixels de tela: o screencast (que ignora o DPR) sai em alta
  const Z = Number(process.env.ZOOM ?? 1)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: width * Z, height: height * Z, deviceScaleFactor: Z > 1 ? 1 : dpr, mobile: false })
  await win.evaluate(() => { window.__buf = {}; window.gt.onEvent((e) => { if (e.t === 'pane.data') window.__buf[e.paneId] = ((window.__buf[e.paneId] ?? '') + e.data).slice(-30000) }) })
  await sleep(1500)
  const mainWs = await (async () => { for (let i = 0; i < 20; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port + 1}/json/list`)).json(); return l[0].webSocketDebuggerUrl } catch { await sleep(300) } } })()
  let mid = 0
  const mainEval = (expression) => new Promise((res, rej) => { const ws = new WebSocket(mainWs); ws.onopen = () => ws.send(JSON.stringify({ id: ++mid, method: 'Runtime.evaluate', params: { expression, includeCommandLineAPI: true, awaitPromise: true, returnByValue: true } })); ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { ws.close(); d.error || d.result?.exceptionDetails ? rej(new Error(JSON.stringify(d.error ?? d.result.exceptionDetails))) : res(d.result.result.value) } }; ws.onerror = rej })
  // a cópia de teste não manda notificação do macOS para a tela de quem está trabalhando
  await mainEval(`(() => { require('electron').Notification.prototype.show = function () {}; return true })()`)
  if (Z > 1) await mainEval(`(() => { const { BrowserWindow } = require('electron'); for (const w of BrowserWindow.getAllWindows()) w.webContents.setZoomFactor(${Z}); return true })()`)
  const g = {
    proc, browser, win, cdp, mainEval,
    menu(action) { return mainEval(`(() => { const { BrowserWindow } = require('electron'); for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.getURL().includes('view=')) w.webContents.send('gt:menu', ${JSON.stringify(action)}); return true })()`) },
    async create(id, cwd, accountId = 'claude') { await win.evaluate(([id, cwd, a]) => window.gt.request({ t: 'pane.create', paneId: id, cwd, accountId: a, cols: 100, rows: 30 }), [id, cwd, accountId]) },
    // o renderer só adota o layout do daemon quando chegam painéis novos: layout primeiro, painéis depois
    async setup(tabs, active, panes) {
      await win.evaluate(([tabs, active]) => window.gt.send({ t: 'layout.save', layout: { tabs, activeTabId: active ?? tabs[0].id } }), [tabs, active])
      await sleep(300)
      for (const [id, cwd, acc] of panes) await g.create(id, cwd, acc ?? 'claude')
      await sleep(1500)
      const n = await win.locator('.pane-header').count()
      console.log('painéis na tela:', n)
      return n
    },
    async layout(tabs, active) {
      for (let i = 0; i < 10; i++) {
        await win.evaluate(([tabs, active]) => window.gt.send({ t: 'layout.save', layout: { tabs, activeTabId: active ?? tabs[0].id } }), [tabs, active])
        await sleep(900)
        const st = await g.state(); const l = st.layout ?? st.workspaces?.find?.((w) => w.id === 'principal')?.layout
        if (l?.tabs?.length === tabs.length) return true
        console.log('layout não pegou; tentando de novo', JSON.stringify(l)?.slice(0, 200))
      }
      return false
    },
    async state() { return win.evaluate(() => window.gt.request({ t: 'state.get' })) },
    input(id, data) { return win.evaluate(([id, data]) => window.gt.send({ t: 'pane.input', paneId: id, data }), [id, data]) },
    async type(id, text, cps = 18) { for (const ch of text) { await g.input(id, ch); await sleep(1000 / cps) } },
    async meta(id, o) { await win.evaluate(([id, o]) => window.gt.send({ t: 'pane.meta', paneId: id, ...o }), [id, o]) },
    async leader(id) { await win.evaluate((id) => window.gt.send({ t: 'pane.setLeader', paneId: id, leader: true }), id) },
    async text(id) { return win.evaluate((id) => (window.__buf[id] ?? '').replace(/\x1b\[\d*G/g, ' ').replace(/\x1b\[(\d*)C/g, (_, n) => ' '.repeat(Number(n || 1))).replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?>]*[ -\/]*[@-~]/g, '').replace(/\x1b[78>=]/g, ''), id) },
    async waitText(id, re, ms = 30000) { const end = Date.now() + ms; while (Date.now() < end) { if (re.test(await g.text(id))) return true; await sleep(400) } return false },
    async shot(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); await win.screenshot({ path: file }) },
    async close() { await browser.close().catch(() => {}); proc.kill('SIGKILL') },
    // gravação: screencast do CDP, cada quadro com o tempo de chegada
    rec: null,
    async startRec(dir) {
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
      const frames = []; const t0 = Date.now()
      const onFrame = async (f) => { const n = frames.length; const file = path.join(dir, `f${String(n).padStart(5, '0')}.jpg`); fs.writeFileSync(file, Buffer.from(f.data, 'base64')); frames.push({ file: path.basename(file), t: (Date.now() - t0) / 1000 }); cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}) }
      cdp.on('Page.screencastFrame', onFrame)
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: Number(process.env.JPEGQ ?? 90), maxWidth: width * Math.max(Z, dpr), maxHeight: height * Math.max(Z, dpr), everyNthFrame: 1 })
      g.rec = { dir, frames, t0, onFrame, marks: [] }
    },
    mark(label) { if (g.rec) { g.rec.marks.push({ label, t: (Date.now() - g.rec.t0) / 1000 }); console.log('mark', label, ((Date.now() - g.rec.t0) / 1000).toFixed(2)) } },
    async stopRec() { await cdp.send('Page.stopScreencast'); cdp.off('Page.screencastFrame', g.rec.onFrame); const { dir, frames, marks, t0 } = g.rec; fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ duration: (Date.now() - t0) / 1000, frames, marks }, null, 1)); g.rec = null; return frames.length },
  }
  return g
}

export function hook(paneId, ev, cwd, extra = {}) {
  return new Promise((res) => { const s = net.createConnection(path.join(HOME, 'daemon.sock')); s.on('connect', () => { s.write(JSON.stringify({ id: 0, req: { t: 'hook', paneId, configDir: '', payload: { hook_event_name: ev, session_id: 'sess-' + paneId, cwd, ...extra } } }) + '\n'); setTimeout(() => { s.destroy(); res() }, 150) }); s.on('error', res) })
}

// estado direto do daemon (com o app fechado)
export function daemonState() {
  return new Promise((res, rej) => {
    const s = net.createConnection(path.join(HOME, 'daemon.sock')); let buf = ''
    s.on('connect', () => { s.write(JSON.stringify({ id: 1, req: { t: 'hello', role: 'app', version: 2 } }) + '\n'); s.write(JSON.stringify({ id: 2, req: { t: 'state.get' } }) + '\n') })
    s.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); if (m.t === 'reply' && m.id === 2) { s.destroy(); m.ok ? res(m.result) : rej(new Error(m.error)) } } catch {} } })
    s.on('error', rej); setTimeout(() => { s.destroy(); rej(new Error('timeout')) }, 5000)
  })
}
