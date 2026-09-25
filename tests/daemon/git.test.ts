import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { git } from '../../src/daemon/git/run'
import { parseStatus, parseWorktreeList } from '../../src/daemon/git/parse'
import { makeRepo, type TestRepo } from '../helpers/repo'

let repo: TestRepo | null = null
afterEach(() => { repo?.cleanup(); repo = null })

describe('parseStatus', () => {
  it('lê branch, upstream, ahead/behind e conta alterações', () => {
    const out = [
      '# branch.oid abc',
      '# branch.head feat/auth',
      '# branch.upstream origin/feat/auth',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 a b src/a.ts',
      '2 R. N... 100644 100644 100644 a b R100 novo.ts\tvelho.ts',
      'u UU N... 1 2 3 4 a b c conflito.ts',
      '? solto.txt',
      '',
    ].join('\n')
    expect(parseStatus(out)).toEqual({ branch: 'feat/auth', upstream: 'origin/feat/auth', ahead: 2, behind: 1, changed: 4 })
  })

  it('HEAD destacado e sem upstream', () => {
    expect(parseStatus('# branch.oid abc\n# branch.head (detached)\n')).toEqual({ branch: null, upstream: null, ahead: 0, behind: 0, changed: 0 })
  })
})

describe('parseWorktreeList', () => {
  it('lê a saída -z com principal, branch, detached, locked e prunable', () => {
    const out = [
      'worktree /r/meu projeto', 'HEAD aaa', 'branch refs/heads/main', '',
      'worktree /r/meu projeto/.claude/worktrees/auth', 'HEAD bbb', 'branch refs/heads/feat/auth', 'locked', '',
      'worktree /r/solto', 'HEAD ccc', 'detached', 'prunable gitdir file points to non-existent location', '',
    ].join('\0') + '\0'
    expect(parseWorktreeList(out)).toEqual([
      { path: '/r/meu projeto', head: 'aaa', branch: 'main', isMain: true, locked: false, prunable: false },
      { path: '/r/meu projeto/.claude/worktrees/auth', head: 'bbb', branch: 'feat/auth', isMain: false, locked: true, prunable: false },
      { path: '/r/solto', head: 'ccc', branch: null, isMain: false, locked: false, prunable: true },
    ])
  })
})

describe('git real (caminhos com espaço)', () => {
  it('status e worktree list funcionam num repositório de verdade', async () => {
    repo = makeRepo()
    const wt = path.join(repo.root, 'wt auth')
    repo.git('worktree', 'add', '-b', 'feat/auth', wt)
    repo.write('novo.txt', 'x')

    const st = await git(repo.dir, ['status', '--porcelain=v2', '--branch'])
    expect(st.ok).toBe(true)
    expect(parseStatus(st.stdout)).toMatchObject({ branch: 'main', changed: 1 })

    const wl = await git(repo.dir, ['worktree', 'list', '--porcelain', '-z'])
    expect(parseWorktreeList(wl.stdout).map((w) => [w.path, w.branch, w.isMain])).toEqual([
      [repo.dir, 'main', true],
      [wt, 'feat/auth', false],
    ])
  })

  it('falha sem lançar exceção quando a pasta não existe', async () => {
    const r = await git('/nao/existe', ['status'])
    expect(r.ok).toBe(false)
    expect(r.stderr).not.toBe('')
  })
})
