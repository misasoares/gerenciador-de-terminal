import { describe, expect, it } from 'vitest'
import { findTab, leaves, neighbor, removeLeaf, removePane, moveTab, tabInsertIndex, dockAtRoot, dockPane, withPaneInNewTab, nodeKey, setSizes, splitLeaf, withTabColor } from '../../src/renderer/src/layout'
import type { Layout, LayoutNode } from '../../src/shared/types'

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

describe('removePane', () => {
  const leaf = (paneId: string) => ({ type: 'leaf' as const, paneId })
  const two: Layout = {
    tabs: [
      { id: 't1', name: 'Aba 1', root: leaf('a') },
      { id: 't2', name: 'Aba 2', root: { type: 'split', dir: 'row', children: [leaf('b'), leaf('c')], sizes: [] } },
    ],
    activeTabId: 't1',
  }
  it('aba que fica vazia fecha e a ativa passa para a vizinha', () => {
    const l = removePane(two, 'a')
    expect(l.tabs.map((t) => t.id)).toEqual(['t2'])
    expect(l.activeTabId).toBe('t2')
  })
  it('aba em segundo plano vazia fecha sem mudar a ativa', () => {
    const l = removePane(removePane(two, 'b'), 'c')
    expect(l.tabs.map((t) => t.id)).toEqual(['t1'])
    expect(l.activeTabId).toBe('t1')
  })
  it('a única aba nunca fecha', () => {
    const one: Layout = { tabs: [{ id: 't1', name: 'Aba 1', root: leaf('a') }], activeTabId: 't1' }
    expect(removePane(one, 'a')).toEqual({ tabs: [{ id: 't1', name: 'Aba 1', root: null }], activeTabId: 't1' })
  })
  it('aba que ainda tem painéis continua', () => {
    const l = removePane(two, 'b')
    expect(l.tabs).toHaveLength(2)
    expect(l.tabs[1].root).toEqual(leaf('c'))
  })
  it('painel fora do layout: nada muda além da cópia', () => {
    expect(removePane(two, 'zzz').tabs.map((t) => t.id)).toEqual(['t1', 't2'])
  })

  it('withTabColor pinta só a aba pedida e aceita null', () => {
    const l: Layout = { tabs: [{ id: 'a', name: 'A', root: null }, { id: 'b', name: 'B', root: null, color: '#ef4444' }], activeTabId: 'a' }
    const pintado = withTabColor(l, 'a', '#22c55e')
    expect(pintado.tabs.map((t) => t.color ?? null)).toEqual(['#22c55e', '#ef4444'])
    expect(withTabColor(pintado, 'b', null).tabs[1].color).toBeNull()
    expect(withTabColor(l, 'a', 'verde')).toBe(l) // cor inválida: não muda nada
  })
})

describe('moveTab', () => {
  const l: Layout = { tabs: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id, root: null })), activeTabId: 'b' }
  const ids = (x: Layout) => x.tabs.map((t) => t.id)

  it('move para frente, para trás, para o início e para o fim (índice de inserção na lista original)', () => {
    expect(ids(moveTab(l, 'a', 3))).toEqual(['b', 'c', 'a', 'd'])
    expect(ids(moveTab(l, 'd', 1))).toEqual(['a', 'd', 'b', 'c'])
    expect(ids(moveTab(l, 'c', 0))).toEqual(['c', 'a', 'b', 'd'])
    expect(ids(moveTab(l, 'a', 4))).toEqual(['b', 'c', 'd', 'a'])
  })

  it('soltar no mesmo lugar ou id desconhecido não muda nada', () => {
    expect(moveTab(l, 'b', 1)).toBe(l)
    expect(moveTab(l, 'b', 2)).toBe(l)
    expect(moveTab(l, 'zzz', 0)).toBe(l)
  })

  it('a aba ativa continua a mesma', () => {
    expect(moveTab(l, 'b', 4).activeTabId).toBe('b')
  })
})

describe('tabInsertIndex', () => {
  // abas de 100px lado a lado: meios em 50, 150, 250
  const mids = [50, 150, 250]
  it('antes do meio de uma aba entra antes dela; depois do meio, depois', () => {
    expect(tabInsertIndex(mids, 10)).toBe(0)
    expect(tabInsertIndex(mids, 60)).toBe(1)
    expect(tabInsertIndex(mids, 240)).toBe(2)
  })
  it('espaço vazio depois da última aba (ou o botão +) vai para o fim', () => {
    expect(tabInsertIndex(mids, 260)).toBe(3)
    expect(tabInsertIndex(mids, 900)).toBe(3)
  })
})

describe('encostar na borda da área inteira', () => {
  const L = (id: string): LayoutNode => ({ type: 'leaf', paneId: id })
  const row = (...c: LayoutNode[]): LayoutNode => ({ type: 'split', dir: 'row', children: c, sizes: [] })
  const col = (...c: LayoutNode[]): LayoutNode => ({ type: 'split', dir: 'column', children: c, sizes: [] })

  it('três lado a lado + soltar embaixo de todas → coluna[linha[A|B|C] / X]', () => {
    expect(dockAtRoot(row(L('a'), L('b'), L('c')), 'x', 'bottom')).toEqual(col(row(L('a'), L('b'), L('c')), L('x')))
    expect(dockAtRoot(row(L('a'), L('b')), 'x', 'top')).toEqual(col(L('x'), row(L('a'), L('b'))))
  })

  it('mesma direção da raiz: entra como irmão no começo/fim, sem aninhar', () => {
    expect(dockAtRoot(row(L('a'), L('b')), 'x', 'left')).toEqual(row(L('x'), L('a'), L('b')))
    expect(dockAtRoot(col(L('a'), L('b')), 'x', 'bottom')).toEqual(col(L('a'), L('b'), L('x')))
  })

  it('raiz com um painel só ou vazia', () => {
    expect(dockAtRoot(L('a'), 'x', 'right')).toEqual(row(L('a'), L('x')))
    expect(dockAtRoot(null, 'x', 'bottom')).toEqual(L('x'))
  })

  it('dockPane tira o painel de onde estava (outra aba ou a mesma) e encosta na borda', () => {
    const l: Layout = { tabs: [{ id: 't1', name: '1', root: row(L('a'), L('b'), L('c')) }, { id: 't2', name: '2', root: L('d') }], activeTabId: 't2' }
    const same = dockPane(l, 'c', 't1', 'bottom')
    expect(same.tabs[0].root).toEqual(col(row(L('a'), L('b')), L('c')))
    expect(same.activeTabId).toBe('t1')
    const other = dockPane(l, 'd', 't1', 'bottom')
    expect(other.tabs.map((t) => t.id)).toEqual(['t1']) // a aba que ficou vazia fecha
    expect(other.tabs[0].root).toEqual(col(row(L('a'), L('b'), L('c')), L('d')))
  })

  it('dockPane: painel único da própria aba ou aba desconhecida não muda nada', () => {
    const l: Layout = { tabs: [{ id: 't1', name: '1', root: L('a') }, { id: 't2', name: '2', root: L('b') }], activeTabId: 't1' }
    expect(dockPane(l, 'a', 't1', 'bottom')).toBe(l)
    expect(dockPane(l, 'a', 'zzz', 'bottom')).toBe(l)
  })

  it('withPaneInNewTab leva o painel para uma aba nova no fim e ativa', () => {
    const l: Layout = { tabs: [{ id: 't1', name: '1', root: row(L('a'), L('b')) }], activeTabId: 't1' }
    const n = withPaneInNewTab(l, 'b', { id: 'nova', name: 'Aba 2', root: null })
    expect(n.tabs.map((t) => [t.id, t.root])).toEqual([['t1', L('a')], ['nova', L('b')]])
    expect(n.activeTabId).toBe('nova')
  })
})

describe('nodeKey', () => {
  it('a mesma divisão em outra direção tem outra chave (o Allotment não troca de orientação: precisa recriar)', () => {
    const L = (id: string): LayoutNode => ({ type: 'leaf', paneId: id })
    const row: LayoutNode = { type: 'split', dir: 'row', children: [L('a'), L('b')], sizes: [] }
    const col: LayoutNode = { ...row, dir: 'column' }
    expect(nodeKey(row)).not.toBe(nodeKey(col))
    expect(nodeKey(L('a'))).toBe('a')
  })
})
