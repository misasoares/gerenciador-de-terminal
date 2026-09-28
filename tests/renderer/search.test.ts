import { describe, expect, it } from 'vitest'
import { buildPaletteItems, fuzzyScore, normalize, searchPalette } from '../../src/renderer/src/search'
import { DEFAULT_ACCOUNTS } from '../../src/daemon/accounts'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import type { AppState } from '../../src/shared/types'

const app: AppState = {
  protocolVersion: 2, userHome: '/u', accounts: DEFAULT_ACCOUNTS, resumable: [], hookWarnings: [], settings: DEFAULT_SETTINGS,
  layout: { tabs: [], activeTabId: null },
  projects: [{ path: '/r/tcheerp', name: 'tcheerp', defaultAccountId: null, error: null, fetchError: null, conflicts: null, worktrees: [
    { path: '/r/tcheerp', head: null, branch: 'main', isMain: true, locked: false, prunable: false, git: null },
    { path: '/r/tcheerp/.claude/worktrees/custo-hora', head: null, branch: 'docs/custo', isMain: false, locked: false, prunable: false, git: null },
  ] }],
  panes: [
    { id: 'p1', seq: 1, cwd: '/r/tcheerp', alive: true, exitCode: null, accountId: 'weboption', name: null, color: null, projectPath: '/r/tcheerp', worktreePath: '/r/tcheerp/.claude/worktrees/custo-hora',
      claude: { sessionId: 's', status: 'idle', statusSince: 0, title: 'Revisão da ação de custo', transcriptPath: null } },
    { id: 'p2', seq: 2, cwd: '/r', alive: false, exitCode: 0, accountId: null, name: null, color: null, projectPath: null, worktreePath: null, claude: null },
  ],
}

describe('busca do ⌘K', () => {
  it('ignora acentos e maiúsculas; aceita subsequência', () => {
    expect(normalize('Revisão AÇÃO')).toBe('revisao acao')
    expect(fuzzyScore('acao', 'Revisão da ação')).not.toBeNull()
    expect(fuzzyScore('cstho', 'custo-hora')).not.toBeNull()
    expect(fuzzyScore('xyz', 'custo-hora')).toBeNull()
    expect(fuzzyScore('custo', 'custo-hora')!).toBeLessThan(fuzzyScore('cstho', 'custo-hora')!)
  })

  it('itens: sessões vivas, worktrees e projetos', () => {
    const items = buildPaletteItems(app)
    expect(items.map((i) => [i.kind, i.label])).toEqual([
      ['session', 'Revisão da ação de custo'],
      ['worktree', 'principal'],
      ['worktree', 'custo-hora'],
      ['project', 'TCHEERP'],
    ])
    expect(items[0].detail).toBe('TCHEERP · ⎇ custo-hora · weboption')
  })

  it('ordena por relevância, rótulo antes do detalhe', () => {
    const items = buildPaletteItems(app)
    expect(searchPalette(items, 'custo').map((i) => i.label)).toEqual(['custo-hora', 'Revisão da ação de custo'])
    expect(searchPalette(items, '')).toHaveLength(4)
  })
})
