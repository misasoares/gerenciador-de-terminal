import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findWorktree, gitToplevel, listWorktrees } from '../../src/daemon/resolve'
import type { WorktreeInfo } from '../../src/shared/types'
import { makeRepo, type TestRepo } from '../helpers/repo'

const wt = (p: string, isMain = false): WorktreeInfo => ({ path: p, head: null, branch: null, isMain, locked: false, prunable: false })
let repo: TestRepo | null = null
afterEach(() => { repo?.cleanup(); repo = null })

describe('findWorktree', () => {
  const projects = [
    { path: '/a', worktrees: [wt('/a', true), wt('/a/.claude/worktrees/x')] },
    { path: '/b', worktrees: [wt('/b', true)] },
  ]
  it('acha pela raiz exata da worktree', () => {
    expect(findWorktree(projects, '/a/.claude/worktrees/x')).toEqual({ projectPath: '/a', worktreePath: '/a/.claude/worktrees/x' })
    expect(findWorktree(projects, '/b')).toEqual({ projectPath: '/b', worktreePath: '/b' })
  })
  it('não acha o que não está cadastrado', () => {
    expect(findWorktree(projects, '/c')).toBeNull()
  })
})

describe('gitToplevel / listWorktrees', () => {
  it('resolve subpasta para a raiz e lista worktrees', async () => {
    repo = makeRepo()
    fs.mkdirSync(path.join(repo.dir, 'sub pasta'))
    expect(await gitToplevel(path.join(repo.dir, 'sub pasta'))).toBe(repo.dir)
    const other = path.join(repo.root, 'wt x')
    repo.git('worktree', 'add', '-b', 'x', other)
    expect(await gitToplevel(other)).toBe(other)
    const r = await listWorktrees(other)
    expect(r.ok && r.worktrees[0].path).toBe(repo.dir)
  })
  it('fora de repositório devolve null / erro', async () => {
    expect(await gitToplevel('/')).toBeNull()
    expect((await listWorktrees('/')).ok).toBe(false)
  })
})
