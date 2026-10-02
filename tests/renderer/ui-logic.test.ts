import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import { describe, expect, it } from 'vitest'
import { dropZone, insertBeside, replaceLeaf } from '../../src/renderer/src/layout'
import { accountsWithoutHooks, buildSidebar, isExpanded, railLabel } from '../../src/renderer/src/sidebar-model'
import { DEFAULT_ACCOUNTS } from '../../src/daemon/accounts'
import type { AppState, LayoutNode, PaneView } from '../../src/shared/types'

const leaf = (paneId: string): LayoutNode => ({ type: 'leaf', paneId })

describe('zonas de soltar', () => {
  it('bordas viram split, centro substitui', () => {
    expect(dropZone(0.05, 0.5)).toBe('left')
    expect(dropZone(0.95, 0.5)).toBe('right')
    expect(dropZone(0.5, 0.1)).toBe('top')
    expect(dropZone(0.5, 0.9)).toBe('bottom')
    expect(dropZone(0.5, 0.5)).toBe('center')
  })

  it('fora do quadrado central, vale a borda mais próxima (triângulos pelas diagonais)', () => {
    expect(dropZone(0.5, 0.7)).toBe('bottom') // antes caía no centro e trocava de lugar
    expect(dropZone(0.3, 0.5)).toBe('left')
    expect(dropZone(0.72, 0.4)).toBe('right')
    expect(dropZone(0.45, 0.32)).toBe('top')
    expect(dropZone(0.4, 0.6)).toBe('center')
  })

  it('insertBeside respeita o lado', () => {
    expect(insertBeside(leaf('a'), 'a', 'b', 'left')).toEqual({ type: 'split', dir: 'row', sizes: [], children: [leaf('b'), leaf('a')] })
    expect(insertBeside(leaf('a'), 'a', 'b', 'bottom')).toEqual({ type: 'split', dir: 'column', sizes: [], children: [leaf('a'), leaf('b')] })
    const row: LayoutNode = { type: 'split', dir: 'row', sizes: [1, 1], children: [leaf('a'), leaf('c')] }
    expect(insertBeside(row, 'c', 'b', 'left')).toEqual({ type: 'split', dir: 'row', sizes: [], children: [leaf('a'), leaf('b'), leaf('c')] })
  })

  it('replaceLeaf troca o painel no mesmo lugar', () => {
    const row: LayoutNode = { type: 'split', dir: 'row', sizes: [1, 2], children: [leaf('a'), leaf('c')] }
    expect(replaceLeaf(row, 'c', 'x')).toEqual({ type: 'split', dir: 'row', sizes: [1, 2], children: [leaf('a'), leaf('x')] })
  })
})

const pane = (id: string, over: Partial<PaneView>): PaneView => ({ id, seq: 1, cwd: '/r/api', alive: true, exitCode: null, name: null, color: null, agentHooksMissing: false, accountId: null, claude: null, projectPath: '/r/api', worktreePath: '/r/api', ...over })
const claude = (status: 'working' | 'needs-you' | 'idle') => ({ sessionId: 's', agent: 'claude' as const, status, statusSince: 0, title: null, transcriptPath: null })

const app = (over: Partial<AppState> = {}): AppState => ({
  protocolVersion: 1, workspaceId: 'principal', workspaces: [], askOnCloseWindow: true, userHome: '/Users/u', accounts: DEFAULT_ACCOUNTS, resumable: [], hookWarnings: [], settings: DEFAULT_SETTINGS, usage: [], usageHints: {}, filePanes: {},
  layout: { tabs: [{ id: 't1', name: 'A', root: leaf('p1') }, { id: 't2', name: 'B', root: leaf('p2') }], activeTabId: 't1' },
  projects: [{ path: '/r/api', name: 'api', defaultAccountId: null, error: null, fetchError: null, conflicts: null, worktrees: [{ path: '/r/api', head: null, branch: 'main', isMain: true, locked: false, prunable: false, git: null }] }],
  panes: [pane('p1', { claude: claude('working') }), pane('p2', { claude: claude('needs-you') }), pane('p3', { claude: claude('idle') })],
  ...over,
})

describe('sidebar', () => {
  it('sessão sabe a aba em que está ou se está oculta; projeto tem o pior estado', () => {
    const m = buildSidebar(app())
    expect(m.projects[0].worktrees[0].sessions.map((s) => [s.paneId, s.tab, s.hidden])).toEqual([
      ['p1', 1, false], ['p2', 2, false], ['p3', null, true],
    ])
    expect(m.projects[0].worst).toBe('needs-you')
  })

  it('auto-recolher: abre o projeto em foco; poucos projetos ficam abertos; clique do usuário vence', () => {
    expect(isExpanded('/a', '/a', {}, 5)).toBe(true)
    expect(isExpanded('/b', '/a', {}, 5)).toBe(false)
    expect(isExpanded('/b', '/a', {}, 2)).toBe(true)
    expect(isExpanded('/b', '/a', { '/b': true }, 5)).toBe(true)
    expect(isExpanded('/a', '/a', { '/a': false }, 5)).toBe(false)
  })

  it('rótulo do trilho', () => {
    expect(railLabel('api')).toBe('API')
    expect(railLabel('site')).toBe('SITE')
    expect(railLabel('infra')).toBe('INF')
  })
})

describe('contas sem hooks', () => {
  it('hooks.json do Codex sem hooks marca os agentes Codex', () => {
    const accounts = [{ ...DEFAULT_ACCOUNTS[0] }, { id: 'codex', label: 'Codex', command: 'codex --yolo', color: '#10a37f', agent: 'codex' as const, configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null }]
    expect(accountsWithoutHooks({ userHome: '/Users/u', accounts, hookWarnings: ['/Users/u/.codex/hooks.json'] })).toEqual(new Set(['codex']))
  })
  it('settings principal sem hooks afeta todas; perfil próprio afeta só a conta dele', () => {
    expect(accountsWithoutHooks(app({ hookWarnings: ['/Users/u/.claude/settings.json'] }))).toEqual(new Set(DEFAULT_ACCOUNTS.map((a) => a.id)))
    expect(accountsWithoutHooks(app({ hookWarnings: ['/Users/u/.claude-swap-backup/sessions/3-misael_mslabs-dev.com/settings.json'] }))).toEqual(new Set(['mslabs']))
    expect(accountsWithoutHooks(app())).toEqual(new Set())
  })
})
