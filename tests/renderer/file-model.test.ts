import { describe, expect, it } from 'vitest'
import { baseName, findFilePane, insertFileLeaf, isFilePane, languageFor, lineSeparator, pickerRoot, relativeTo } from '../../src/renderer/src/file-model'
import type { Layout, PaneView, ProjectView, Tab } from '../../src/shared/types'

const leaf = (paneId: string) => ({ type: 'leaf' as const, paneId })
const tab = (id: string, root: Layout['tabs'][number]['root']): Tab => ({ id, name: id, root })

describe('file-model', () => {
  it('isFilePane, languageFor, lineSeparator, nomes', () => {
    expect(isFilePane('file:1')).toBe(true)
    expect(isFilePane('abc')).toBe(false)
    expect(['a.md', 'x.json', 'c.yml', 'k.yaml', 's.ts', 'w.tsx', 'j.mjs', '.env', '.env.local', 'Makefile'].map(languageFor)).toEqual(['markdown', 'json', 'yaml', 'yaml', 'typescript', 'typescript', 'javascript', 'env', 'env', 'text'])
    expect(lineSeparator('A=1\r\nB=2\r\n')).toBe('\r\n')
    expect(lineSeparator('A=1\nB=2')).toBe('\n')
    expect(baseName('/r/api/.env')).toBe('.env')
    expect(relativeTo('/r/api', '/r/api/docs/a.md')).toBe('docs/a.md')
    expect(relativeTo('/r/api', '/outro/a.md')).toBe('/outro/a.md')
    expect(relativeTo(null, '/outro/a.md')).toBe('/outro/a.md')
  })

  it('insertFileLeaf: ao lado do painel pedido, na aba ativa, ou numa aba nova', () => {
    const l: Layout = { tabs: [tab('t1', leaf('a')), tab('t2', leaf('b'))], activeTabId: 't1' }
    const beside = insertFileLeaf(l, 'file:x', 'b', tab('nova', null))
    expect(beside.activeTabId).toBe('t2')
    expect(beside.tabs[1].root).toEqual({ type: 'split', dir: 'row', sizes: [], children: [leaf('b'), leaf('file:x')] })
    const active = insertFileLeaf(l, 'file:x', null, tab('nova', null))
    expect(active.tabs[0].root).toEqual({ type: 'split', dir: 'row', sizes: [], children: [leaf('a'), leaf('file:x')] })
    const empty: Layout = { tabs: [tab('t1', null)], activeTabId: 't1' }
    expect(insertFileLeaf(empty, 'file:x', null, tab('nova', null)).tabs[0].root).toEqual(leaf('file:x'))
    const none: Layout = { tabs: [], activeTabId: null }
    const created = insertFileLeaf(none, 'file:x', null, tab('nova', null))
    expect(created.tabs).toEqual([tab('nova', leaf('file:x'))])
    expect(created.activeTabId).toBe('nova')
  })

  it('findFilePane acha painel aberto do mesmo arquivo (só se ainda estiver no layout)', () => {
    const l: Layout = { tabs: [tab('t1', leaf('file:1'))], activeTabId: 't1' }
    const fp = { 'file:1': { path: '/r/a.md', mode: 'view' as const }, 'file:2': { path: '/r/b.md', mode: 'edit' as const } }
    expect(findFilePane(fp, l, '/r/a.md')).toBe('file:1')
    expect(findFilePane(fp, l, '/r/b.md')).toBeNull()
  })

  it('pickerRoot: worktree do painel em foco; arquivo em foco usa a worktree que o contém', () => {
    const project = { path: '/r/api', name: 'api', defaultAccountId: null, error: null, fetchError: null, conflicts: null, worktrees: [{ path: '/r/api', head: null, branch: 'main', isMain: true, locked: false, prunable: false, git: null }, { path: '/r/api/wt/x', head: null, branch: 'x', isMain: false, locked: false, prunable: false, git: null }] } as ProjectView
    const pane = { id: 'p', cwd: '/r/api/wt/x/src', worktreePath: '/r/api/wt/x', projectPath: '/r/api' } as PaneView
    const app = { panes: [pane], projects: [project], layout: { tabs: [], activeTabId: null }, filePanes: { 'file:1': { path: '/r/api/docs/a.md', mode: 'view' as const } }, userHome: '/u' }
    expect(pickerRoot(app, 'p')).toBe('/r/api/wt/x')
    expect(pickerRoot(app, 'file:1')).toBe('/r/api')
    expect(pickerRoot(app, null)).toBe('/r/api')
    expect(pickerRoot({ ...app, projects: [] }, null)).toBe('/u')
  })
})
