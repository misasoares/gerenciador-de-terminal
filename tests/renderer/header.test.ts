import { describe, expect, it } from 'vitest'
import { displayStatus, gitBadges, headerView, hibernatedLabel, sharesContext, tildify } from '../../src/renderer/src/header'
import { DEFAULT_ACCOUNTS } from '../../src/daemon/accounts'
import { sessionLabel } from '../../src/renderer/src/sidebar-model'
import type { Layout, PaneView, ProjectView } from '../../src/shared/types'

const project: ProjectView = {
  path: '/r/api', name: 'api', defaultAccountId: null, error: null, fetchError: null, conflicts: null,
  worktrees: [
    { path: '/r/api', head: 'a', branch: 'main', isMain: true, locked: false, prunable: false, git: { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 3, changed: 0, error: null } },
    { path: '/r/api/.claude/worktrees/auth', head: 'b', branch: 'feat/auth', isMain: false, locked: false, prunable: false, git: { branch: 'feat/auth', upstream: null, ahead: 2, behind: 0, changed: 5, error: null } },
  ],
}
const pane = (over: Partial<PaneView>): PaneView => ({ id: 'p', seq: 1, cwd: '/r/api', alive: true, exitCode: null, name: null, color: null, agentHooksMissing: false, leader: false, createdBy: null, accountId: null, claude: null, projectPath: '/r/api', worktreePath: '/r/api', ...over })
const app = { projects: [project], accounts: DEFAULT_ACCOUNTS, userHome: '/Users/u' }

describe('headerView', () => {
  it('worktree secundária com sessão e conta', () => {
    const h = headerView(pane({ worktreePath: '/r/api/.claude/worktrees/auth', accountId: 'mslabs', claude: { sessionId: 's', agent: 'claude' as const, status: 'needs-you', statusSince: 0, title: null, transcriptPath: null } }), app)
    expect(h).toEqual({
      project: 'api', worktree: 'auth', isMainWorktree: false, branch: 'feat/auth', changed: 5, ahead: 2, behind: 0,
      hasUpstream: false, status: 'needs-you', hibernatedSince: null, account: { label: 'mslabs', color: '#c586c0' }, warning: null, label: 'sessão 1', projectColor: null, sessionColor: null, worktreeInferred: false, shellWorktree: null,
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
    const base = pane({ claude: { sessionId: 's', agent: 'claude' as const, status: 'idle', statusSince: 0, title: 'Refatorar auth', transcriptPath: null } })
    expect(headerView(base, app).label).toBe('Refatorar auth')
    expect(headerView({ ...base, name: 'backend' }, app).label).toBe('backend')
    expect(headerView(pane({}), app).label).toBe('terminal 1')
  })
  it('worktree deduzida: marca e rótulo da worktree do shell', () => {
    const h = headerView(pane({ worktreePath: '/r/api/.claude/worktrees/auth', shellWorktreePath: '/r/api', worktreeInferred: true }), app)
    expect(h).toMatchObject({ worktree: 'auth', worktreeInferred: true, shellWorktree: 'principal' })
  })
})

describe('texto sobre a cor da sessão', () => {
  it('usa a cor de texto com mais contraste (WCAG): preto nas 8 cores da paleta, branco em cores escuras', async () => {
    const { textOn } = await import('../../src/renderer/src/header')
    const { SESSION_COLORS } = await import('../../src/shared/settings')
    for (const c of SESSION_COLORS) expect(textOn(c.hex), c.label).toBe('#111111')
    expect(textOn('#1e3a8a')).toBe('#ffffff') // azul escuro
    expect(textOn('#000000')).toBe('#ffffff')
    expect(textOn('#ffffff')).toBe('#111111')
  })
})

describe('gitBadges', () => {
  it('zeros somem', () => {
    expect(gitBadges({ changed: 0, ahead: 0, behind: 0 }, true)).toEqual({ changed: null, ahead: null, behind: null })
    expect(gitBadges({ changed: 3, ahead: 0, behind: 2 }, true)).toEqual({ changed: 3, ahead: null, behind: 2 })
  })
  it('preferência desligada esconde tudo', () => {
    expect(gitBadges({ changed: 3, ahead: 1, behind: 2 }, false)).toEqual({ changed: null, ahead: null, behind: null })
  })

  it('cor do projeto e cor da sessão vêm separadas', () => {
    const colored = { ...app, projects: [{ ...project, color: '#f97316' }] }
    const h = headerView(pane({ color: '#3b82f6' }), colored)
    expect(h.projectColor).toBe('#f97316')
    expect(h.sessionColor).toBe('#3b82f6')
    expect(headerView(pane({}), app)).toMatchObject({ projectColor: null, sessionColor: null })
  })
})

describe('sharesContext', () => {
  const leaf = (paneId: string) => ({ type: 'leaf' as const, paneId })
  const layout: Layout = {
    tabs: [
      { id: 't1', name: 'a', root: { type: 'split', dir: 'row', sizes: [], children: [leaf('a'), leaf('b')] } },
      { id: 't2', name: 'b', root: { type: 'split', dir: 'row', sizes: [], children: [leaf('c'), leaf('d')] } },
      { id: 't3', name: 'c', root: leaf('e') },
    ],
    activeTabId: 't1',
  }
  const panes = [
    pane({ id: 'a' }),
    pane({ id: 'b' }),
    pane({ id: 'c' }),
    pane({ id: 'd', projectPath: '/r/outro', worktreePath: '/r/outro' }),
    pane({ id: 'e' }),
  ]
  it('aba com todos os painéis no mesmo projeto e worktree: discreto', () => {
    expect(sharesContext('a', layout, panes)).toBe(true)
  })
  it('aba com projetos diferentes ou painel sozinho: mantém o destaque', () => {
    expect(sharesContext('c', layout, panes)).toBe(false)
    expect(sharesContext('e', layout, panes)).toBe(false)
    expect(sharesContext('zzz', layout, panes)).toBe(false)
  })
  it('painel de arquivo na aba não desfaz o "discreto" dos terminais', () => {
    const l: Layout = { tabs: [{ id: 't', name: 't', root: { type: 'split', dir: 'row', sizes: [], children: [leaf('a'), leaf('b'), leaf('file:1')] } }], activeTabId: 't' }
    expect(sharesContext('a', l, [pane({ id: 'a' }), pane({ id: 'b' })])).toBe(true)
  })
})

describe('líder', () => {
  it('ganha 👑 na sidebar e no cabeçalho', () => {
    const p = pane({ name: 'Techlead', leader: true })
    expect(sessionLabel(p)).toBe('👑 Techlead')
    expect(headerView(p, app).label).toBe('👑 Techlead')
    expect(sessionLabel({ ...p, leader: false })).toBe('Techlead')
    expect(sessionLabel(pane({ leader: true }))).toBe('👑 terminal 1')
  })
})

describe('hibernação no cabeçalho', () => {
  const claude = { sessionId: 's', agent: 'claude' as const, status: 'idle' as const, statusSince: 0, title: null, transcriptPath: null }
  it('status de exibição', () => {
    expect(displayStatus({ claude: null, hibernated: { since: 1, title: null }, waking: false })).toBe('hibernated')
    expect(displayStatus({ claude: null, hibernated: null, waking: true })).toBe('waking')
    expect(displayStatus({ claude, hibernated: null, waking: true })).toBe('idle')
    expect(displayStatus({ claude: null })).toBe('shell')
  })
  it('rótulo do tempo hibernada', () => {
    expect(hibernatedLabel(0, 30_000)).toBe('hibernada agora')
    expect(hibernatedLabel(0, 42 * 60_000)).toBe('hibernada há 42 min')
    expect(hibernatedLabel(0, 130 * 60_000)).toBe('hibernada há 2 h')
  })
})
