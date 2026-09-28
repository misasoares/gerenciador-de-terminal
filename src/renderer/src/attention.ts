import type { Layout, PaneView } from '../../shared/types'
import { leaves } from './layout'

export type Attn = 'needs-you' | 'your-turn'

export function attentionOf(p: PaneView): Attn | null {
  if (!p.alive) return null
  const s = p.claude?.status
  return s === 'needs-you' || s === 'your-turn' ? s : null
}

const rank = (a: Attn) => (a === 'needs-you' ? 0 : 1)

/** abas não ativas com algum painel esperando o usuário; 🟡 vence 🔵 */
export function tabAttention(layout: Layout, panes: PaneView[]): Record<string, Attn> {
  const byId = new Map(panes.map((p) => [p.id, p]))
  const out: Record<string, Attn> = {}
  for (const t of layout.tabs) {
    if (t.id === layout.activeTabId) continue
    for (const id of leaves(t.root)) {
      const p = byId.get(id)
      const a = p ? attentionOf(p) : null
      if (a && (!out[t.id] || rank(a) < rank(out[t.id]))) out[t.id] = a
    }
  }
  return out
}

/** ⌘J: 🟡 antes de 🔵, mais antiga primeiro */
export function attentionQueue(panes: PaneView[]): string[] {
  return panes
    .filter((p) => attentionOf(p))
    .sort((x, y) => rank(attentionOf(x)!) - rank(attentionOf(y)!) || x.claude!.statusSince - y.claude!.statusSince)
    .map((p) => p.id)
}

export function nextInQueue(queue: string[], currentId: string | null): string | null {
  if (queue.length === 0) return null
  const i = currentId ? queue.indexOf(currentId) : -1
  return i < 0 ? queue[0] : queue[(i + 1) % queue.length]
}

export function dockBadge(panes: PaneView[]): string {
  const n = panes.filter((p) => attentionOf(p)).length
  return n > 0 ? String(n) : ''
}

export interface Notice {
  paneId: string
  kind: Attn
}

/** transições para 🟡/🔵 que o usuário não está vendo; prev null = primeiro estado depois de conectar */
export function noticesFor(prev: PaneView[] | null, next: PaneView[], ctx: { windowFocused: boolean; visible: Set<string> }): Notice[] {
  if (!prev) return []
  const before = new Map(prev.map((p) => [p.id, attentionOf(p)]))
  const out: Notice[] = []
  for (const p of next) {
    if (!before.has(p.id)) continue
    const now = attentionOf(p)
    if (!now || now === before.get(p.id)) continue
    if (ctx.windowFocused && ctx.visible.has(p.id)) continue
    out.push({ paneId: p.id, kind: now })
  }
  return out
}
