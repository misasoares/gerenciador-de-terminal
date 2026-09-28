import { describe, expect, it } from 'vitest'
import { lookingAt, shouldFocusTerminal } from '../../src/renderer/src/focus'
import { acceptData } from '../../src/renderer/src/seq'
import { throttleNotices } from '../../src/renderer/src/attention'
import type { Layout, PaneView } from '../../src/shared/types'

const pane = (id: string, status: 'your-turn' | 'working'): PaneView => ({
  id, seq: 1, cwd: '/p', alive: true, exitCode: null, name: null, color: null, agentHooksMissing: false, accountId: null, projectPath: null, worktreePath: null,
  claude: { sessionId: id, agent: 'claude' as const, status, statusSince: 0, title: null, transcriptPath: null },
})
const layout: Layout = { tabs: [{ id: 't1', name: 'A', root: { type: 'leaf', paneId: 'a' } }, { id: 't2', name: 'B', root: { type: 'leaf', paneId: 'b' } }], activeTabId: 't2' }

describe('C1: só marca visto o painel que está na aba ativa', () => {
  it('painel em foco numa aba escondida não conta como visto', () => {
    const app = { layout, panes: [pane('a', 'your-turn'), pane('b', 'your-turn')] }
    expect(lookingAt(app, 'a', true)).toBeNull()
    expect(lookingAt(app, 'b', true)).toBe('b')
    expect(lookingAt(app, 'b', false)).toBeNull()
    expect(lookingAt({ ...app, panes: [pane('b', 'working')] }, 'b', true)).toBeNull()
  })
})

describe('I2: dados sem seq (daemon da fase 1) continuam aparecendo', () => {
  it('aceita seq ausente; descarta seq diferente', () => {
    expect(acceptData(3, undefined)).toBe(true)
    expect(acceptData(3, 3)).toBe(true)
    expect(acceptData(3, 2)).toBe(false)
  })
})

describe('I5: renomear não devolve o foco ao terminal', () => {
  it('não foca o terminal do painel que está sendo renomeado', () => {
    expect(shouldFocusTerminal({ renamingPaneId: 'a' }, 'a')).toBe(false)
    expect(shouldFocusTerminal({ renamingPaneId: null }, 'a')).toBe(true)
  })
})

describe('I8: sessão que alterna rápido não enche de notificação', () => {
  it('no máximo uma por painel e tipo a cada 30 s', () => {
    const sent = new Map<string, number>()
    const n = [{ paneId: 'a', kind: 'your-turn' as const }]
    expect(throttleNotices(n, sent, 1000)).toHaveLength(1)
    expect(throttleNotices(n, sent, 5000)).toHaveLength(0)
    expect(throttleNotices([{ paneId: 'a', kind: 'needs-you' }], sent, 5000)).toHaveLength(1)
    expect(throttleNotices(n, sent, 31_001)).toHaveLength(1)
  })
})
