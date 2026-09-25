import type { WorktreeInfo } from '../shared/types'
import { git } from './git/run'
import { parseWorktreeList } from './git/parse'

export interface Location {
  projectPath: string
  worktreePath: string
}

export function findWorktree(projects: { path: string; worktrees: WorktreeInfo[] }[], toplevel: string): Location | null {
  for (const p of projects) {
    for (const w of p.worktrees) if (w.path === toplevel) return { projectPath: p.path, worktreePath: w.path }
  }
  return null
}

export async function gitToplevel(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['rev-parse', '--show-toplevel'])
  return r.ok ? r.stdout.trim() || null : null
}

export async function listWorktrees(
  dir: string,
): Promise<{ ok: true; worktrees: WorktreeInfo[] } | { ok: false; error: string }> {
  const r = await git(dir, ['worktree', 'list', '--porcelain', '-z'])
  if (!r.ok) return { ok: false, error: r.stderr.trim().split('\n')[0] || 'git worktree list falhou' }
  const worktrees = parseWorktreeList(r.stdout)
  if (worktrees.length === 0) return { ok: false, error: 'nenhuma worktree encontrada' }
  return { ok: true, worktrees }
}
