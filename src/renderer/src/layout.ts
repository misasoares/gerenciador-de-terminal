import type { Layout, LayoutNode, Tab } from '../../shared/types'

export type Dir = 'left' | 'right' | 'up' | 'down'

export interface Rect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export function leaves(n: LayoutNode | null): string[] {
  if (!n) return []
  return n.type === 'leaf' ? [n.paneId] : n.children.flatMap(leaves)
}

export function findTab(l: Layout, paneId: string): Tab | undefined {
  return l.tabs.find((t) => leaves(t.root).includes(paneId))
}

export function splitLeaf(root: LayoutNode, target: string, paneId: string, dir: 'row' | 'column'): LayoutNode {
  if (root.type === 'leaf') {
    return root.paneId === target ? { type: 'split', dir, children: [root, { type: 'leaf', paneId }], sizes: [] } : root
  }
  const idx = root.children.findIndex((c) => c.type === 'leaf' && c.paneId === target)
  if (idx >= 0 && root.dir === dir) {
    const children = [...root.children]
    children.splice(idx + 1, 0, { type: 'leaf', paneId })
    return { ...root, children, sizes: [] }
  }
  return { ...root, children: root.children.map((c) => splitLeaf(c, target, paneId, dir)) }
}

export function removeLeaf(root: LayoutNode, paneId: string): LayoutNode | null {
  if (root.type === 'leaf') return root.paneId === paneId ? null : root
  const children = root.children.map((c) => removeLeaf(c, paneId)).filter((c): c is LayoutNode => c !== null)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { ...root, children, sizes: children.length === root.children.length ? root.sizes : [] }
}

/** tira o painel do layout; a aba que fica vazia fecha junto, a não ser que seja a única */
export function removePane(l: Layout, paneId: string): Layout {
  const owner = findTab(l, paneId)
  const tabs = l.tabs.map((t) => ({ ...t, root: t.root ? removeLeaf(t.root, paneId) : null }))
  const idx = owner ? tabs.findIndex((t) => t.id === owner.id) : -1
  if (idx < 0 || tabs[idx].root !== null || tabs.length === 1) return { ...l, tabs }
  const rest = tabs.filter((_, i) => i !== idx)
  const activeTabId = l.activeTabId === owner!.id ? rest[Math.max(0, idx - 1)].id : l.activeTabId
  return { tabs: rest, activeTabId }
}

export function setSizes(root: LayoutNode, path: number[], sizes: number[]): LayoutNode {
  if (root.type === 'leaf') return root
  if (path.length === 0) return { ...root, sizes }
  const [i, ...rest] = path
  return { ...root, children: root.children.map((c, j) => (j === i ? setSizes(c, rest, sizes) : c)) }
}

export function neighbor(rects: Rect[], fromId: string | null, dir: Dir): string | null {
  const src = rects.find((r) => r.id === fromId)
  if (!src) return rects[0]?.id ?? null
  const cx = (r: Rect) => r.x + r.w / 2
  const cy = (r: Rect) => r.y + r.h / 2
  const inDir = (r: Rect) =>
    dir === 'right' ? r.x >= src.x + src.w - 1
    : dir === 'left' ? r.x + r.w <= src.x + 1
    : dir === 'down' ? r.y >= src.y + src.h - 1
    : r.y + r.h <= src.y + 1
  const horizontal = dir === 'left' || dir === 'right'
  const score = (r: Rect) =>
    horizontal
      ? Math.abs(cx(r) - cx(src)) + Math.abs(cy(r) - cy(src)) * 2
      : Math.abs(cy(r) - cy(src)) + Math.abs(cx(r) - cx(src)) * 2
  return rects.filter((r) => r.id !== src.id && inDir(r)).sort((a, b) => score(a) - score(b))[0]?.id ?? null
}

export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center'
export type Side = Exclude<DropZone, 'center'>

/** quadrado central (30%) substitui o painel; fora dele vale a borda mais próxima (triângulos pelas diagonais) */
export function dropZone(relX: number, relY: number): DropZone {
  if (Math.abs(relX - 0.5) < 0.15 && Math.abs(relY - 0.5) < 0.15) return 'center'
  const dists: [Side, number][] = [['left', relX], ['right', 1 - relX], ['top', relY], ['bottom', 1 - relY]]
  return dists.sort((a, b) => a[1] - b[1])[0][0]
}

export function insertBeside(root: LayoutNode, target: string, paneId: string, side: Side): LayoutNode {
  const dir = side === 'left' || side === 'right' ? 'row' : 'column'
  const before = side === 'left' || side === 'top'
  const fresh: LayoutNode = { type: 'leaf', paneId }
  if (root.type === 'leaf') {
    if (root.paneId !== target) return root
    return { type: 'split', dir, sizes: [], children: before ? [fresh, root] : [root, fresh] }
  }
  const idx = root.children.findIndex((c) => c.type === 'leaf' && c.paneId === target)
  if (idx >= 0 && root.dir === dir) {
    const children = [...root.children]
    children.splice(before ? idx : idx + 1, 0, fresh)
    return { ...root, children, sizes: [] }
  }
  return { ...root, children: root.children.map((c) => insertBeside(c, target, paneId, side)) }
}

export function replaceLeaf(root: LayoutNode, target: string, paneId: string): LayoutNode {
  if (root.type === 'leaf') return root.paneId === target ? { type: 'leaf', paneId } : root
  return { ...root, children: root.children.map((c) => replaceLeaf(c, target, paneId)) }
}

/** muda a cor de uma aba; cor inválida não altera nada */
export function withTabColor(layout: Layout, tabId: string, color: string | null): Layout {
  if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) return layout
  return { ...layout, tabs: layout.tabs.map((t) => (t.id === tabId ? { ...t, color } : t)) }
}

/** move a aba para a posição de inserção toIndex (0..n, contada na lista original); sem efeito → mesmo objeto */
export function moveTab(layout: Layout, tabId: string, toIndex: number): Layout {
  const from = layout.tabs.findIndex((t) => t.id === tabId)
  if (from < 0) return layout
  const to = Math.max(0, Math.min(toIndex, layout.tabs.length))
  const dest = to > from ? to - 1 : to
  if (dest === from) return layout
  const tabs = [...layout.tabs]
  const [tab] = tabs.splice(from, 1)
  tabs.splice(dest, 0, tab)
  return { ...layout, tabs }
}

/** posição de inserção (0..n) de uma aba solta em x, dados os meios horizontais das abas */
export function tabInsertIndex(mids: number[], x: number): number {
  return mids.filter((m) => x > m).length
}

/** encosta o painel numa borda da área inteira (abaixo/acima/ao lado de todos) */
export function dockAtRoot(root: LayoutNode | null, paneId: string, side: Side): LayoutNode {
  const fresh: LayoutNode = { type: 'leaf', paneId }
  if (!root) return fresh
  const dir = side === 'left' || side === 'right' ? 'row' : 'column'
  const before = side === 'left' || side === 'top'
  if (root.type === 'split' && root.dir === dir) {
    return { ...root, children: before ? [fresh, ...root.children] : [...root.children, fresh], sizes: [] }
  }
  return { type: 'split', dir, sizes: [], children: before ? [fresh, root] : [root, fresh] }
}

/** tira o painel de onde estiver e encosta na borda da aba; sem efeito → mesmo objeto */
export function dockPane(l: Layout, paneId: string, tabId: string, side: Side): Layout {
  const target = l.tabs.find((t) => t.id === tabId)
  if (!target) return l
  if (leaves(target.root).length === 1 && leaves(target.root)[0] === paneId) return l
  const removed = removePane(l, paneId)
  const tab = removed.tabs.find((t) => t.id === tabId)
  if (!tab) return l
  const root = dockAtRoot(tab.root, paneId, side)
  return { tabs: removed.tabs.map((t) => (t.id === tabId ? { ...t, root } : t)), activeTabId: tabId }
}

/** leva o painel para uma aba nova (no fim) e ativa essa aba */
export function withPaneInNewTab(l: Layout, paneId: string, tab: Tab): Layout {
  const removed = removePane(l, paneId)
  return { tabs: [...removed.tabs, { ...tab, root: { type: 'leaf', paneId } }], activeTabId: tab.id }
}

/** chave de um nó para o React: inclui a direção, porque o Allotment não muda de orientação depois de montado */
export function nodeKey(n: LayoutNode): string {
  return n.type === 'leaf' ? n.paneId : `split:${n.dir}:${leaves(n).join(',')}`
}
