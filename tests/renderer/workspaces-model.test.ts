import { describe, expect, it } from 'vitest'
import { mergeIncomingLayout, otherWorkspaces, reopenRows } from '../../src/renderer/src/workspaces-model'

const leaf = (paneId: string) => ({ type: 'leaf' as const, paneId })

describe('workspaces-model (renderer)', () => {
  it('linhas da tela de reabrir', () => {
    expect(reopenRows([{ id: 'a', name: 'TCHEERP', open: true, sessions: 6, attention: 0, tabs: [], hidden: [] }, { id: 'b', name: 'Pessoal', open: false, sessions: 1, attention: 0, tabs: [], hidden: [] }, { id: 'c', name: 'Vazio', open: false, sessions: 0, attention: 0, tabs: [], hidden: [] }])).toEqual([
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
  it('outros espaços: só os abertos, sem o da janela atual, com a atenção', () => {
    const p = (id: string, status: 'needs-you' | 'idle' | null = null) => ({ id, label: id, status })
    const list = [
      { id: 'cur', name: 'Atual', open: true, sessions: 1, attention: 0, tabs: [{ id: 't', name: 'A', panes: [p('x')] }], hidden: [] },
      { id: 'a', name: 'TCHEERP', open: true, sessions: 2, attention: 1, tabs: [{ id: 't1', name: 'Back', panes: [p('a1', 'needs-you'), p('a2', 'idle')] }], hidden: [] },
      { id: 'b', name: 'Fechado', open: false, sessions: 1, attention: 0, tabs: [], hidden: [p('b1')] },
    ]
    expect(otherWorkspaces(list, 'cur')).toEqual([{ id: 'a', name: 'TCHEERP', sessions: 2, attention: 1, tabs: [{ id: 't1', name: 'Back', panes: [p('a1', 'needs-you'), p('a2', 'idle')] }], hidden: [] }])
  })
  it('sessão que saiu do espaço por fora (demitida) sai do layout local', () => {
    const local = { tabs: [{ id: 't', name: 'A', root: { type: 'split' as const, dir: 'row' as const, sizes: [50, 50], children: [leaf('L'), leaf('d1')] } }], activeTabId: 't' }
    const incoming = { tabs: [{ id: 't', name: 'A', root: leaf('L') }], activeTabId: 't' }
    const out = mergeIncomingLayout(local, incoming, new Set(['L', 'd1']), new Set(['L']))
    expect(out.tabs[0].root).toEqual(leaf('L'))
    // painel de arquivo nunca está em panes: não é "saída"
    const withFile = { tabs: [{ id: 't', name: 'A', root: { type: 'split' as const, dir: 'row' as const, sizes: [], children: [leaf('L'), leaf('file:1')] } }], activeTabId: 't' }
    expect(mergeIncomingLayout(withFile, incoming, new Set(['L']), new Set(['L']))).toBe(withFile)
  })
  it('daemon reiniciou (sessões viram retomáveis, layout dele ainda as tem): o layout local fica', () => {
    const local = { tabs: [{ id: 't', name: 'A', root: { type: 'split' as const, dir: 'row' as const, sizes: [], children: [leaf('a'), leaf('b')] } }], activeTabId: 't' }
    expect(mergeIncomingLayout(local, local, new Set(['a', 'b']), new Set())).toBe(local)
  })
})
