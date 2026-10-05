import type { Bounds, FloatSpec, WorkspaceSummary } from '../shared/types'

type Placed = FloatSpec & { wsId: string }
const same = (a: FloatSpec, b: FloatSpec) => a.onTop === b.onTop && a.allDesks === b.allDesks

/** o resumo do daemon manda; só espaços ativados nesta execução mostram flutuantes */
export function syncFloats(summary: WorkspaceSummary[], activeWs: Set<string>, openNow: Map<string, FloatSpec>) {
  const want = new Map<string, Placed>()
  for (const w of summary) if (activeWs.has(w.id)) for (const f of w.floating) want.set(f.paneId, { ...f, wsId: w.id })
  const open: Placed[] = []
  const update: Placed[] = []
  for (const [id, f] of want) {
    const cur = openNow.get(id)
    if (!cur) open.push(f)
    else if (!same(cur, f)) update.push(f)
  }
  const close = [...openNow.keys()].filter((id) => !want.has(id))
  return { open, close, update }
}

const overlap = (a: Bounds, b: Bounds) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) >= 50 && Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) >= 50

export function fitBounds(b: Bounds | null, displays: Bounds[], fallback: Bounds): Bounds {
  return b && displays.some((d) => overlap(b, d)) ? b : fallback
}

export function cascade(base: Bounds, n: number): Bounds {
  return { ...base, x: base.x + 30 * n, y: base.y + 30 * n }
}

export function floatHome(workspaceWin: Bounds | null, screen: Bounds, n: number): Bounds {
  const area = workspaceWin ?? screen
  return cascade({ x: area.x + area.width - 640 - 24, y: area.y + 24, width: 640, height: 400 }, n)
}
