import { describe, expect, it } from 'vitest'
import { PendingFocus } from '../../src/renderer/src/pending-focus'

describe('PendingFocus', () => {
  it('guarda o pedido quando o terminal ainda não existe e aplica quando fica pronto', () => {
    const ready = new Set<string>()
    const focused: string[] = []
    const tryFocus = (id: string) => (ready.has(id) ? (focused.push(id), true) : false)
    const p = new PendingFocus()
    p.request('a', tryFocus)
    expect(focused).toEqual([])
    ready.add('a')
    p.ready('a', tryFocus)
    expect(focused).toEqual(['a'])
    p.ready('a', tryFocus) // já aplicado: não repete
    expect(focused).toEqual(['a'])
  })
  it('um pedido novo substitui o anterior', () => {
    const ready = new Set(['a', 'b'])
    const focused: string[] = []
    const tryFocus = (id: string) => (ready.has(id) ? (focused.push(id), true) : false)
    const p = new PendingFocus()
    ready.delete('a')
    p.request('a', tryFocus)
    p.request('b', tryFocus) // b existe: foca na hora e descarta o pedido de a
    ready.add('a')
    p.ready('a', tryFocus)
    expect(focused).toEqual(['b'])
  })
  it('clear descarta o pedido do painel descartado', () => {
    const focused: string[] = []
    let ok = false
    const tryFocus = (id: string) => (ok ? (focused.push(id), true) : false)
    const p = new PendingFocus()
    p.request('a', tryFocus)
    p.clear('a')
    ok = true
    p.ready('a', tryFocus)
    expect(focused).toEqual([])
  })
})
