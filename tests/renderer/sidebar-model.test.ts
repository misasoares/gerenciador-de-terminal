import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { describe, expect, it } from 'vitest'
import { buildSidebar, sessionLabel } from '../../src/renderer/src/sidebar-model'
import type { AppState, PaneView } from '../../src/shared/types'

const pane = (id: string, over: Partial<PaneView>): PaneView => ({ id, seq: Number(id.slice(1)), cwd: '/r/api', alive: true, exitCode: null, name: null, color: null, accountId: null, claude: null, projectPath: '/r/api', worktreePath: '/r/api', ...over })
const claude = (status: 'working' | 'needs-you' | 'idle', title: string | null = null) => ({ sessionId: 's', status, statusSince: 0, title, transcriptPath: null })

const app: AppState = {
  protocolVersion: 1, userHome: '/u', accounts: [], resumable: [], hookWarnings: [], settings: DEFAULT_SETTINGS, layout: { tabs: [], activeTabId: null },
  projects: [{
    path: '/r/api', name: 'api', defaultAccountId: null, error: null, fetchError: null, conflicts: null,
    worktrees: [
      { path: '/r/api', head: null, branch: 'main', isMain: true, locked: false, prunable: false, git: null },
      { path: '/r/api/wt/x', head: null, branch: 'x', isMain: false, locked: false, prunable: false, git: null },
    ],
  }],
  panes: [
    pane('p1', { claude: claude('working', 'Refatorar auth') }),
    pane('p2', { claude: claude('needs-you') }),
    pane('p3', {}),
    pane('p4', { projectPath: null, worktreePath: null, cwd: '/tmp' }),
  ],
}

describe('buildSidebar', () => {
  it('agrupa sessões por worktree, resume estados e separa as de fora', () => {
    const m = buildSidebar(app)
    const [main, x] = m.projects[0].worktrees
    expect(main.sessions.map((s) => [s.paneId, s.label, s.status])).toEqual([
      ['p1', 'Refatorar auth', 'working'],
      ['p2', 'sessão 2', 'needs-you'],
      ['p3', 'terminal 3', 'shell'],
    ])
    expect(x).toMatchObject({ label: 'x', sessions: [] })
    expect(m.projects[0].summary).toEqual({ working: 1, needsYou: 1, yourTurn: 0, idle: 0 })
    expect(m.outside.map((s) => s.paneId)).toEqual(['p4'])
  })

  it('rótulo de painel encerrado', () => {
    expect(sessionLabel(pane('p7', { alive: false }))).toBe('encerrado 7')
  })
})
