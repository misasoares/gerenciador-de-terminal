import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import { findPathCandidates, linkRange } from './file-links'
import { getUi } from './store'

const cache = new Map<string, { abs: string | null; at: number }>()
const TTL = 30_000

async function resolve(cwd: string, bases: string[], paths: string[]): Promise<Map<string, string>> {
  const now = Date.now()
  const out = new Map<string, string>()
  const ask: string[] = []
  const key = (p: string) => `${cwd}\n${bases.join('\n')}\n${p}`
  for (const p of paths) {
    const hit = cache.get(key(p))
    if (hit && now - hit.at < TTL) {
      if (hit.abs) out.set(p, hit.abs)
    } else ask.push(p)
  }
  if (ask.length) {
    const found = await window.gt.request<{ path: string; abs: string }[]>({ t: 'file.exists', cwd, paths: ask, bases }).catch(() => [])
    const map = new Map(found.map((f) => [f.path, f.abs]))
    for (const p of ask) {
      const abs = map.get(p) ?? null
      cache.set(key(p), { abs, at: now })
      if (abs) out.set(p, abs)
    }
  }
  return out
}

/** linha lógica: junta as linhas que o terminal quebrou (isWrapped) em volta da linha y (1-based) */
function logicalLine(term: Terminal, y: number): { text: string; firstRow: number } {
  const buf = term.buffer.active
  let first = y - 1
  while (first > 0 && buf.getLine(first)?.isWrapped) first--
  let last = y - 1
  while (buf.getLine(last + 1)?.isWrapped) last++
  let text = ''
  for (let i = first; i <= last; i++) text += buf.getLine(i)?.translateToString(i === last) ?? ''
  return { text, firstRow: first + 1 }
}

/** caminhos de arquivo que existem viram links; ⌘ (mac) / Ctrl (linux) + clique abre ao lado do terminal */
export function fileLinkProvider(term: Terminal, paneId: string): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const { text, firstRow } = logicalLine(term, y)
      const cands = findPathCandidates(text)
      const pane = getUi().app?.panes.find((p) => p.id === paneId)
      if (!cands.length || !pane) return callback(undefined)
      const bases = [pane.worktreePath, pane.projectPath].filter((b): b is string => !!b && b !== pane.cwd)
      void resolve(pane.cwd, bases, [...new Set(cands.map((c) => c.path))]).then((abs) => {
        const links: ILink[] = cands
          .filter((c) => abs.has(c.path))
          .map((c) => ({ c, range: linkRange(c.start, c.end, firstRow, term.cols) }))
          .filter(({ range }) => range.start.y <= y && range.end.y >= y)
          .map(({ c, range }) => ({
            range,
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
