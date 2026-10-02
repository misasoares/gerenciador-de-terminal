import { describe, expect, it } from 'vitest'
import { mergeIncomingLayout, reopenRows } from '../../src/renderer/src/workspaces-model'

const leaf = (paneId: string) => ({ type: 'leaf' as const, paneId })

describe('workspaces-model (renderer)', () => {
  it('linhas da tela de reabrir', () => {
    expect(reopenRows([{ id: 'a', name: 'TCHEERP', open: true, sessions: 6, attention: 0 }, { id: 'b', name: 'Pessoal', open: false, sessions: 1, attention: 0 }, { id: 'c', name: 'Vazio', open: false, sessions: 0, attention: 0 }])).toEqual([
      { id: 'a', name: 'TCHEERP', checked: true, detail: '6 sessões rodando' },
      { id: 'b', name: 'Pessoal', checked: false, detail: '1 sessão rodando' },
      { id: 'c', name: 'Vazio', checked: false, detail: 'sem sessões' },
    ])
  })
  it('layout do daemon só vence quando traz painel novo (sessão movida para cá)', () => {
    const local = { tabs: [{ id: 't', name: 'A', root: leaf('a') }], activeTabId: 't' }
    const same = { tabs: [{ id: 't', name: 'velho', root: leaf('a') }], activeTabId: 't' }
    const more = { tabs: [{ id: 't', name: 'A', root: { type: 'split' as const, dir: 'row' as const, sizes: [], children: [leaf('a'), leaf('b')] } }], activeTabId: 't' }
    expect(mergeIncomingLayout(local, same, new Set(['a']), new Set(['a']))).toBe(local)
    // 'b' acabou de chegar a este espaço (não estava nas sessões do estado anterior)
    expect(mergeIncomingLayout(local, more, new Set(['a']), new Set(['a', 'b']))).toBe(more)
  })
  it('broadcast atrasado com painel que o usuário acabou de esconder não o traz de volta', () => {
    const local = { tabs: [{ id: 't', name: 'A', root: leaf('a') }], activeTabId: 't' }
    const stale = { tabs: [{ id: 't', name: 'A', root: { type: 'split' as const, dir: 'row' as const, sizes: [], children: [leaf('a'), leaf('b')] } }], activeTabId: 't' }
    expect(mergeIncomingLayout(local, stale, new Set(['a', 'b']), new Set(['a', 'b']))).toBe(local)
    // painel de arquivo (não é sessão) também não volta
    const staleFile = { tabs: [{ id: 't', name: 'A', root: { type: 'split' as const, dir: 'row' as const, sizes: [], children: [leaf('a'), leaf('file:1')] } }], activeTabId: 't' }
    expect(mergeIncomingLayout(local, staleFile, new Set(['a']), new Set(['a']))).toBe(local)
  })
})
