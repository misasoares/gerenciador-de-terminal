import type { RemoveCheck, WorktreeInfo } from '../shared/types'
import { git } from './git/run'

const lines = (s: string): string[] => s.split('\n').filter(Boolean)

export async function checkRemove(o: {
  mainPath: string
  worktree: WorktreeInfo
  mainBranch: string | null
  hasOpenSession: boolean
}): Promise<RemoveCheck> {
  const w = o.worktree
  let dirtyFiles: string[] = []
  if (!w.prunable) {
    const st = await git(w.path, ['status', '--porcelain'])
    if (!st.ok) throw new Error(`não consegui ler o status de ${w.path}: ${st.stderr.trim()}`)
    dirtyFiles = lines(st.stdout)
  }
  let unpushedCommits: string[] = []
  const tip = w.branch ?? w.head
  if (tip && !w.isMain) {
    const args = ['log', '--oneline', '--max-count=20', tip, '--not', '--remotes']
    if (o.mainBranch && o.mainBranch !== w.branch) args.push(o.mainBranch)
    const r = await git(o.mainPath, args)
    if (!r.ok) throw new Error(`não consegui listar os commits de ${tip}: ${r.stderr.trim()}`)
    unpushedCommits = lines(r.stdout)
  }
  return { path: w.path, branch: w.branch, isMain: w.isMain, hasOpenSession: o.hasOpenSession, dirtyFiles, unpushedCommits }
}

export async function removeWorktree(o: { mainPath: string; worktree: WorktreeInfo; force: boolean; deleteBranch: boolean }): Promise<void> {
  const w = o.worktree
  if (w.isMain) throw new Error('a worktree principal não pode ser removida')
  if (w.prunable) {
    const r = await git(o.mainPath, ['worktree', 'prune'])
    if (!r.ok) throw new Error(r.stderr.trim() || 'git worktree prune falhou')
  } else {
    const r = await git(o.mainPath, ['worktree', 'remove', ...(o.force ? ['--force'] : []), w.path], 30_000)
    if (!r.ok) throw new Error(r.stderr.trim() || 'git worktree remove falhou')
  }
  if (o.deleteBranch && w.branch) {
    const r = await git(o.mainPath, ['branch', o.force ? '-D' : '-d', w.branch])
    if (!r.ok) throw new Error(`worktree removida, mas a branch não: ${r.stderr.trim()}`)
  }
}
