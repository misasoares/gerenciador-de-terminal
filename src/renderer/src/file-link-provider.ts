import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import { findPathCandidates } from './file-links'
import { getUi } from './store'

const cache = new Map<string, { abs: string | null; at: number }>()
const TTL = 30_000

async function resolve(cwd: string, paths: string[]): Promise<Map<string, string>> {
  const now = Date.now()
  const out = new Map<string, string>()
  const ask: string[] = []
  for (const p of paths) {
    const hit = cache.get(`${cwd}\n${p}`)
    if (hit && now - hit.at < TTL) {
      if (hit.abs) out.set(p, hit.abs)
    } else ask.push(p)
  }
  if (ask.length) {
    const found = await window.gt.request<{ path: string; abs: string }[]>({ t: 'file.exists', cwd, paths: ask }).catch(() => [])
    const map = new Map(found.map((f) => [f.path, f.abs]))
    for (const p of ask) {
      const abs = map.get(p) ?? null
      cache.set(`${cwd}\n${p}`, { abs, at: now })
      if (abs) out.set(p, abs)
    }
  }
  return out
}

/** caminhos de arquivo que existem viram links; ⌘ (mac) / Ctrl (linux) + clique abre ao lado do terminal */
export function fileLinkProvider(term: Terminal, paneId: string): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const text = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? ''
      const cands = findPathCandidates(text)
      const cwd = getUi().app?.panes.find((p) => p.id === paneId)?.cwd
      if (!cands.length || !cwd) return callback(undefined)
      void resolve(cwd, [...new Set(cands.map((c) => c.path))]).then((abs) => {
        const links: ILink[] = cands
          .filter((c) => abs.has(c.path))
          .map((c) => ({
            range: { start: { x: c.start + 1, y }, end: { x: c.end, y } },
            text: c.text,
            decorations: { underline: true, pointerCursor: true },
            activate: (ev: MouseEvent) => {
              if (!(ev.metaKey || ev.ctrlKey)) return
              void import('./actions').then((a) => a.openFile(abs.get(c.path)!, { line: c.line, besideId: paneId }))
            },
          }))
        callback(links.length ? links : undefined)
      })
    },
  }
}
