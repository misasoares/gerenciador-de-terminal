import { describe, expect, it } from 'vitest'
import { findTab, leaves, neighbor, removeLeaf, setSizes, splitLeaf } from '../../src/renderer/src/layout'
import type { LayoutNode } from '../../src/shared/types'

const leaf = (paneId: string): LayoutNode => ({ type: 'leaf', paneId })

describe('layout', () => {
  it('split de folha cria nó; mesma direção insere ao lado', () => {
    const a = splitLeaf(leaf('a'), 'a', 'b', 'row')
    expect(a).toEqual({ type: 'split', dir: 'row', children: [leaf('a'), leaf('b')], sizes: [] })
    const b = splitLeaf(a, 'a', 'c', 'row')
    expect(leaves(b)).toEqual(['a', 'c', 'b'])
    const c = splitLeaf(b, 'c', 'd', 'column')
    expect(c).toEqual({ type: 'split', dir: 'row', sizes: [], children: [leaf('a'), { type: 'split', dir: 'column', sizes: [], children: [leaf('c'), leaf('d')] }, leaf('b')] })
  })

  it('remover folha colapsa splits de um filho só', () => {
    const t: LayoutNode = { type: 'split', dir: 'row', sizes: [1, 1], children: [leaf('a'), { type: 'split', dir: 'column', sizes: [1, 1], children: [leaf('b'), leaf('c')] }] }
    expect(removeLeaf(t, 'b')).toEqual({ type: 'split', dir: 'row', sizes: [1, 1], children: [leaf('a'), leaf('c')] })
    expect(removeLeaf(leaf('a'), 'a')).toBeNull()
    expect(removeLeaf(removeLeaf(t, 'b')!, 'a')).toEqual(leaf('c'))
  })

  it('setSizes pelo caminho e findTab', () => {
    const t: LayoutNode = { type: 'split', dir: 'row', sizes: [], children: [leaf('a'), { type: 'split', dir: 'column', sizes: [], children: [leaf('b'), leaf('c')] }] }
    const s = setSizes(t, [1], [30, 70])
    expect(s.type === 'split' && s.children[1].type === 'split' && s.children[1].sizes).toEqual([30, 70])
    expect(findTab({ tabs: [{ id: 't1', name: 'A', root: t }], activeTabId: 't1' }, 'c')?.id).toBe('t1')
  })

  it('vizinho na direção pedida', () => {
    const rects = [
      { id: 'a', x: 0, y: 0, w: 100, h: 200 },
      { id: 'b', x: 100, y: 0, w: 100, h: 100 },
      { id: 'c', x: 100, y: 100, w: 100, h: 100 },
    ]
    expect(neighbor(rects, 'a', 'right')).toBe('b')
    expect(neighbor(rects, 'c', 'left')).toBe('a')
    expect(neighbor(rects, 'b', 'down')).toBe('c')
    expect(neighbor(rects, 'b', 'up')).toBeNull()
    expect(neighbor(rects, null, 'up')).toBe('a')
  })
})
