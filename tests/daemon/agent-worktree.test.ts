import { describe, expect, it } from 'vitest'
import { EMPTY_INFERENCE, nextInference, worktreeOf, writtenPaths } from '../../src/daemon/agent-worktree'
import type { HookPayload } from '../../src/shared/types'

const pre = (tool_name: string, tool_input: Record<string, unknown>): HookPayload => ({ hook_event_name: 'PreToolUse', session_id: 's', cwd: '/r/api', tool_name, tool_input })
const W = (p: HookPayload) => writtenPaths(p, '/r/api', '/Users/u')

describe('writtenPaths', () => {
  it('Edit/Write/MultiEdit/NotebookEdit', () => {
    expect(W(pre('Edit', { file_path: '/r/wt/a.ts' }))).toEqual(['/r/wt/a.ts'])
    expect(W(pre('Write', { file_path: 'src/b.ts' }))).toEqual(['/r/api/src/b.ts'])
    expect(W(pre('MultiEdit', { file_path: '~/x/c.md' }))).toEqual(['/Users/u/x/c.md'])
    expect(W(pre('NotebookEdit', { notebook_path: '/r/wt/n.ipynb' }))).toEqual(['/r/wt/n.ipynb'])
  })

  it('Bash: git -C, cd relativo, redirecionamento e variáveis do próprio comando', () => {
    const real = 'W=/Users/misael/Documents/weboption/.worktrees/tcheerp/dev2; git -C $W status --short | head -3; git -C $W fetch origin && git -C $W switch -c fix/434 origin/develop 2>&1 | tail -1'
    expect(W(pre('Bash', { command: real }))).toEqual(['/Users/misael/Documents/weboption/.worktrees/tcheerp/dev2'])
    expect(W(pre('Bash', { command: 'cd ../dev2 && npm test' }))).toEqual(['/r/dev2'])
    expect(W(pre('Bash', { command: 'echo x > /r/wt/out.txt; echo y >> "/r/wt/b c.txt"' }))).toEqual(['/r/wt/out.txt', '/r/wt/b c.txt'])
    expect(W(pre('Bash', { command: 'D="/r/wt"; git -C "${D}" add -A' }))).toEqual(['/r/wt'])
  })

  it('não conta leituras nem variáveis indefinidas; só PreToolUse', () => {
    expect(W(pre('Read', { file_path: '/r/wt/a.ts' }))).toEqual([])
    expect(W(pre('Grep', { path: '/r/wt' }))).toEqual([])
    expect(W(pre('Bash', { command: 'cat /r/wt/a.ts | head' }))).toEqual([])
    expect(W(pre('Bash', { command: 'git -C $NAO_DEFINIDA status' }))).toEqual([])
    expect(W({ ...pre('Edit', { file_path: '/r/wt/a.ts' }), hook_event_name: 'PostToolUse' })).toEqual([])
  })

  it('ferramenta desconhecida (Codex) com file_path/path conta; ../ é normalizado', () => {
    expect(W(pre('apply_patch', { path: '/r/wt/x/../y.ts' }))).toEqual(['/r/wt/y.ts'])
  })
})

describe('worktreeOf', () => {
  const wts = ['/r/api', '/r/api/.claude/worktrees/x', '/r/api2']
  it('maior prefixo com fronteira /', () => {
    expect(worktreeOf('/r/api/src/a.ts', wts)).toBe('/r/api')
    expect(worktreeOf('/r/api/.claude/worktrees/x/a.ts', wts)).toBe('/r/api/.claude/worktrees/x')
    expect(worktreeOf('/r/api2/a.ts', wts)).toBe('/r/api2')
    expect(worktreeOf('/r/api', wts)).toBe('/r/api')
    expect(worktreeOf('/outro/a.ts', wts)).toBeNull()
  })
})

describe('nextInference', () => {
  it('1 escrita não troca; 2 seguidas trocam; intercalada zera; voltar 2x para a do shell desfaz', () => {
    let s = nextInference(EMPTY_INFERENCE, '/wt/dev2', '/main')
    expect(s).toEqual({ inferred: null, candidate: { path: '/wt/dev2', count: 1 } })
    s = nextInference(s, '/wt/dev2', '/main')
    expect(s).toEqual({ inferred: '/wt/dev2', candidate: null })
    s = nextInference(s, '/wt/dev2', '/main')
    expect(s).toEqual({ inferred: '/wt/dev2', candidate: null })
    s = nextInference(s, '/main', '/main')
    expect(s.inferred).toBe('/wt/dev2')
    s = nextInference(s, '/wt/dev1', '/main')
    expect(s).toEqual({ inferred: '/wt/dev2', candidate: { path: '/wt/dev1', count: 1 } })
    s = nextInference(nextInference(s, '/main', '/main'), '/main', '/main')
    expect(s).toEqual({ inferred: null, candidate: null })
  })
  it('escrita na efetiva zera o candidato', () => {
    const s = nextInference({ inferred: null, candidate: { path: '/wt/dev2', count: 1 } }, '/main', '/main')
    expect(s).toEqual({ inferred: null, candidate: null })
  })
})
