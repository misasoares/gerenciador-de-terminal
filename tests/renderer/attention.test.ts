import { describe, expect, it } from 'vitest'
import { attentionQueue, dockBadge, nextInQueue, noticesFor, tabAttention } from '../../src/renderer/src/attention'
import type { Layout, PaneView, SessionStatus } from '../../src/shared/types'

const pane = (id: string, status: SessionStatus | null, since = 0, alive = true): PaneView => ({
  id, seq: 1, cwd: '/p', alive, exitCode: null, name: null, color: null, agentHooksMissing: false, leader: false, createdBy: null, accountId: null, projectPath: null, worktreePath: null,
  claude: status ? { sessionId: id, agent: 'claude' as const, status, statusSince: since, title: null, transcriptPath: null } : null,
})
const layout: Layout = {
  tabs: [
    { id: 't1', name: 'A', root: { type: 'leaf', paneId: 'a' } },
    { id: 't2', name: 'B', root: { type: 'split', dir: 'row', sizes: [], children: [{ type: 'leaf', paneId: 'b' }, { type: 'leaf', paneId: 'c' }] } },
    { id: 't3', name: 'C', root: { type: 'leaf', paneId: 'd' } },
  ],
  activeTabId: 't1',
}

describe('bolinha da aba', () => {
  it('só abas não ativas; 🟡 vence 🔵', () => {
    const panes = [pane('a', 'needs-you'), pane('b', 'your-turn'), pane('c', 'needs-you'), pane('d', 'your-turn')]
    expect(tabAttention(layout, panes)).toEqual({ t2: 'needs-you', t3: 'your-turn' })
  })
  it('trabalhando/ocioso não acende', () => {
    expect(tabAttention(layout, [pane('b', 'working'), pane('d', 'idle')])).toEqual({})
  })
})

describe('fila do ⌘J', () => {
  const panes = [pane('a', 'your-turn', 5), pane('b', 'needs-you', 9), pane('c', 'needs-you', 3), pane('d', 'your-turn', 1), pane('e', 'working', 0), pane('f', 'needs-you', 0, false)]
  it('🟡 antes de 🔵, mais antiga primeiro, ignora mortos', () => {
    expect(attentionQueue(panes)).toEqual(['c', 'b', 'd', 'a'])
  })
  it('próxima a partir da atual, com volta ao início', () => {
    const q = ['c', 'b', 'd', 'a']
    expect(nextInQueue(q, null)).toBe('c')
    expect(nextInQueue(q, 'b')).toBe('d')
    expect(nextInQueue(q, 'a')).toBe('c')
    expect(nextInQueue(q, 'zzz')).toBe('c')
    expect(nextInQueue([], 'a')).toBeNull()
  })
})

describe('Dock', () => {
  it('conta 🟡 e 🔵 vivos; vazio quando zero', () => {
    expect(dockBadge([pane('a', 'needs-you'), pane('b', 'your-turn'), pane('c', 'working'), pane('d', 'needs-you', 0, false)])).toBe('2')
    expect(dockBadge([pane('a', 'idle')])).toBe('')
  })
})

describe('notificações', () => {
  const ctx = (windowFocused: boolean, visible: string[]) => ({ windowFocused, visible: new Set(visible) })
  it('só na transição para 🟡/🔵', () => {
    expect(noticesFor([pane('a', 'working')], [pane('a', 'your-turn')], ctx(false, []))).toEqual([{ paneId: 'a', kind: 'your-turn' }])
    expect(noticesFor([pane('a', 'your-turn')], [pane('a', 'your-turn')], ctx(false, []))).toEqual([])
    expect(noticesFor([pane('a', 'your-turn')], [pane('a', 'needs-you')], ctx(false, []))).toEqual([{ paneId: 'a', kind: 'needs-you' }])
  })
  it('não notifica se a janela está focada e o painel visível', () => {
    expect(noticesFor([pane('a', 'working')], [pane('a', 'needs-you')], ctx(true, ['a']))).toEqual([])
    expect(noticesFor([pane('a', 'working')], [pane('a', 'needs-you')], ctx(true, ['b']))).toEqual([{ paneId: 'a', kind: 'needs-you' }])
    expect(noticesFor([pane('a', 'working')], [pane('a', 'needs-you')], ctx(false, ['a']))).toEqual([{ paneId: 'a', kind: 'needs-you' }])
  })
  it('primeiro estado depois de conectar e painel novo não notificam', () => {
    expect(noticesFor(null, [pane('a', 'needs-you')], ctx(false, []))).toEqual([])
    expect(noticesFor([], [pane('a', 'needs-you')], ctx(false, []))).toEqual([])
  })
})
