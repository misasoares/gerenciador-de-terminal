import { describe, expect, it } from 'vitest'
import { focusAfterHide, splitCwd } from '../../src/renderer/src/focus'
import type { Layout, PaneView } from '../../src/shared/types'

const pane = (id: string, cwd: string, worktreePath: string | null = null): PaneView => ({ id, seq: 1, cwd, alive: true, exitCode: null, name: null, color: null, agentHooksMissing: false, accountId: null, claude: null, projectPath: null, worktreePath })
const layout: Layout = {
  tabs: [
    { id: 't1', name: 'A', root: { type: 'split', dir: 'row', sizes: [], children: [{ type: 'leaf', paneId: 'a' }, { type: 'leaf', paneId: 'b' }] } },
    { id: 't2', name: 'B', root: null },
  ],
  activeTabId: 't1',
}
const panes = [pane('a', '/p/src/deep', '/p'), pane('b', '/p/docs', '/p'), pane('x', '/outro')]

describe('pasta do ⌘D / ⇧⌘D', () => {
  it('usa a pasta atual do painel em foco, não a raiz da worktree', () => {
    expect(splitCwd({ layout, panes, userHome: '/Users/u' }, 'a')).toBe('/p/src/deep')
  })
  it('sem foco: usa o último painel da aba ativa', () => {
    expect(splitCwd({ layout, panes, userHome: '/Users/u' }, null)).toBe('/p/docs')
  })
  it('foco apontando para painel que não existe mais: mesma regra', () => {
    expect(splitCwd({ layout, panes, userHome: '/Users/u' }, 'sumiu')).toBe('/p/docs')
  })
  it('aba vazia e sem foco: home', () => {
    expect(splitCwd({ layout: { ...layout, activeTabId: 't2' }, panes, userHome: '/Users/u' }, null)).toBe('/Users/u')
  })
})

describe('foco depois de esconder', () => {
  it('passa para outro painel da mesma aba', () => {
    expect(focusAfterHide(layout, 'b')).toBe('a')
    expect(focusAfterHide(layout, 'a')).toBe('b')
  })
  it('aba ficou vazia: sem foco', () => {
    const one: Layout = { tabs: [{ id: 't1', name: 'A', root: { type: 'leaf', paneId: 'a' } }], activeTabId: 't1' }
    expect(focusAfterHide(one, 'a')).toBeNull()
  })
})
