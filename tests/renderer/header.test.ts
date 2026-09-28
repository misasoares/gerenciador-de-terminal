import { describe, expect, it } from 'vitest'
import { headerView, tildify } from '../../src/renderer/src/header'
import { DEFAULT_ACCOUNTS } from '../../src/daemon/accounts'
import type { PaneView, ProjectView } from '../../src/shared/types'

const project: ProjectView = {
  path: '/r/api', name: 'api', defaultAccountId: null, error: null, fetchError: null, conflicts: null,
  worktrees: [
    { path: '/r/api', head: 'a', branch: 'main', isMain: true, locked: false, prunable: false, git: { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 3, changed: 0, error: null } },
    { path: '/r/api/.claude/worktrees/auth', head: 'b', branch: 'feat/auth', isMain: false, locked: false, prunable: false, git: { branch: 'feat/auth', upstream: null, ahead: 2, behind: 0, changed: 5, error: null } },
  ],
}
const pane = (over: Partial<PaneView>): PaneView => ({ id: 'p', seq: 1, cwd: '/r/api', alive: true, exitCode: null, name: null, color: null, accountId: null, claude: null, projectPath: '/r/api', worktreePath: '/r/api', ...over })
const app = { projects: [project], accounts: DEFAULT_ACCOUNTS, userHome: '/Users/u' }

describe('headerView', () => {
  it('worktree secundária com sessão e conta', () => {
    const h = headerView(pane({ worktreePath: '/r/api/.claude/worktrees/auth', accountId: 'mslabs', claude: { sessionId: 's', status: 'needs-you', statusSince: 0, title: null, transcriptPath: null } }), app)
    expect(h).toEqual({
      project: 'api', worktree: 'auth', isMainWorktree: false, branch: 'feat/auth', changed: 5, ahead: 2, behind: 0,
      hasUpstream: false, status: 'needs-you', account: { label: 'mslabs', color: '#c586c0' }, warning: null, label: 'sessão 1',
    })
  })

  it('principal, terminal comum, aviso de fetch', () => {
    const h = headerView(pane({}), { ...app, projects: [{ ...project, fetchError: 'Permission denied' }] })
    expect(h).toMatchObject({ worktree: 'principal', isMainWorktree: true, behind: 3, status: 'shell', account: null, warning: 'Permission denied' })
  })

  it('fora de projeto mostra o cwd com ~', () => {
    const h = headerView(pane({ projectPath: null, worktreePath: null, cwd: '/Users/u/Downloads' }), app)
    expect(h).toMatchObject({ project: 'fora de projeto', worktree: '~/Downloads', branch: null })
    expect(tildify('/Users/u', '/Users/u')).toBe('~')
    expect(tildify('/Users/uu', '/Users/u')).toBe('/Users/uu')
  })
  it('nome vence o título, que vence o rótulo padrão', () => {
    const base = pane({ claude: { sessionId: 's', status: 'idle', statusSince: 0, title: 'Refatorar auth', transcriptPath: null } })
    expect(headerView(base, app).label).toBe('Refatorar auth')
    expect(headerView({ ...base, name: 'backend' }, app).label).toBe('backend')
    expect(headerView(pane({}), app).label).toBe('terminal 1')
  })
})
