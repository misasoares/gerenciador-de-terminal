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
