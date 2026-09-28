import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { decideKey, SHIFT_ENTER_SEQUENCE } from './keys'
import { setUi } from './store'
import { DEFAULT_SETTINGS, type TerminalSettings } from '../../shared/settings'
import { THEMES } from './themes'

interface Entry {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
  state: 'idle' | 'attaching' | 'live'
  pending: string[]
  lastSize: string
  /** seq do attach em vigor; dados de attach antigo (ex.: depois de ⌘R) são descartados */
  seq: number
}

let nextSeq = 0

const BASE_OPTIONS = {
  scrollback: 10_000,
  cursorBlink: true,
  macOptionIsMeta: false, // ⌥ digita caracteres do layout (teclas mortas, ç, etc.)
  allowProposedApi: true,
}
let current: TerminalSettings = DEFAULT_SETTINGS

function optionsFor(s: TerminalSettings) {
  return { fontFamily: s.fontFamily, fontSize: s.fontSize, lineHeight: s.lineHeight, theme: THEMES[s.theme].xterm }
}

class TerminalRegistry {
  private entries = new Map<string, Entry>()

  applySettings(s: TerminalSettings): void {
    current = s
    document.documentElement.style.setProperty('--term-bg', THEMES[s.theme].xterm.background ?? '#1e1e1e')
    for (const [id, e] of this.entries) {
      Object.assign(e.term.options, optionsFor(s))
      this.fit(id)
    }
  }

  mount(paneId: string, container: HTMLElement): void {
    const e = this.ensure(paneId)
    container.appendChild(e.el)
    requestAnimationFrame(() => {
      if (e.state === 'idle') void this.attach(paneId)
      else this.fit(paneId)
    })
  }

  unmount(paneId: string, container: HTMLElement): void {
    const e = this.entries.get(paneId)
    if (e && e.el.parentElement === container) container.removeChild(e.el)
  }

  fit(paneId: string): void {
    const e = this.entries.get(paneId)
    if (!e || e.state !== 'live' || !e.el.isConnected || e.el.clientWidth === 0) return
    e.fit.fit()
    const size = `${e.term.cols}x${e.term.rows}`
    if (size === e.lastSize) return
    e.lastSize = size
    window.gt.send({ t: 'pane.resize', paneId, cols: e.term.cols, rows: e.term.rows })
  }

  dispose(paneId: string): void {
    const e = this.entries.get(paneId)
    if (!e) return
    this.entries.delete(paneId)
    window.gt.send({ t: 'pane.detach', paneId })
    e.term.dispose()
    e.el.remove()
  }

  focus(paneId: string): void {
    this.entries.get(paneId)?.term.focus()
  }

  onData(paneId: string, data: string, seq: number): void {
    const e = this.entries.get(paneId)
    if (!e || seq !== e.seq) return
    if (e.state === 'live') e.term.write(data)
    else if (e.state === 'attaching') e.pending.push(data)
  }

  reattachAll(): void {
    for (const id of this.entries.keys()) void this.attach(id)
  }

  private ensure(paneId: string): Entry {
    const found = this.entries.get(paneId)
    if (found) return found
    const el = document.createElement('div')
    el.className = 'term-host'
    const term = new Terminal({ ...BASE_OPTIONS, ...optionsFor(current) })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon((_ev, uri) => void window.gt.openExternal(uri)))
    term.open(el)
    term.attachCustomKeyEventHandler((ev) => {
      const d = decideKey(ev)
      if (d === 'send-shift-enter') window.gt.send({ t: 'pane.input', paneId, data: SHIFT_ENTER_SEQUENCE })
      return d === 'xterm'
    })
    term.onData((data) => window.gt.send({ t: 'pane.input', paneId, data }))
    term.textarea?.addEventListener('focus', () => {
      setUi({ focusedPaneId: paneId })
      void import('./actions').then((a) => a.markSeenIfLooking(paneId))
    })
    const entry: Entry = { term, fit, el, state: 'idle', pending: [], lastSize: '', seq: 0 }
    this.entries.set(paneId, entry)
    return entry
  }

  private async attach(paneId: string): Promise<void> {
    const e = this.entries.get(paneId)
    if (!e) return
    e.state = 'attaching'
    e.pending = []
    const seq = ++nextSeq
    e.seq = seq
    const dims = e.el.isConnected && e.el.clientWidth > 0 ? e.fit.proposeDimensions() : undefined
    try {
      const { snapshot } = await window.gt.request<{ snapshot: string }>({ t: 'pane.attach', paneId, cols: dims?.cols, rows: dims?.rows, seq })
      if (e.seq !== seq) return // outro attach começou depois deste
      e.term.reset()
      if (dims?.cols && dims?.rows) e.term.resize(dims.cols, dims.rows)
      e.term.write(snapshot)
      for (const d of e.pending) e.term.write(d)
      e.pending = []
      e.state = 'live'
      e.lastSize = `${e.term.cols}x${e.term.rows}`
      this.fit(paneId)
    } catch {
      e.state = 'idle' // painel morreu ou daemon caiu; tenta de novo no próximo mount/reconnect
    }
  }
}

export const terminals = new TerminalRegistry()
