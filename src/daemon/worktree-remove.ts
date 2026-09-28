import type { RemoveCheck, WorktreeInfo } from '../shared/types'
import fs from 'node:fs'
import path from 'node:path'
import { git } from './git/run'

const HEAVY = /(^|\/)(node_modules|dist|build|\.next|vendor|\.cache|coverage|\.turbo|target)(\/|$)/

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
  let ignoredFiles: string[] = []
  if (!w.prunable) {
    const ig = await git(w.path, ['status', '--ignored', '--porcelain'])
    if (ig.ok) {
      ignoredFiles = lines(ig.stdout)
        .filter((l) => l.startsWith('!! '))
        .map((l) => l.slice(3))
        .filter((p) => !HEAVY.test(p))
    }
  }
  let unpushedCommits: string[] = []
  const tip = w.branch ?? w.head
  if (tip && !w.isMain) {
    const args = ['log', '--oneline', '--max-count=20', tip, '--not', '--remotes']
    if (o.mainBranch && o.mainBranch !== w.branch) args.push(o.mainBranch)
    args.push('--')
    const r = await git(o.mainPath, args)
    if (!r.ok) throw new Error(`não consegui listar os commits de ${tip}: ${r.stderr.trim()}`)
    unpushedCommits = lines(r.stdout)
  }
  return { path: w.path, branch: w.branch, isMain: w.isMain, hasOpenSession: o.hasOpenSession, dirtyFiles, unpushedCommits, ignoredFiles }
}

export async function removeWorktree(o: { mainPath: string; worktree: WorktreeInfo; force: boolean; deleteBranch: boolean }): Promise<void> {
  const w = o.worktree
  if (w.isMain) throw new Error('a worktree principal não pode ser removida')
  if (w.prunable) {
    // remove só o registro desta worktree (o `git worktree prune` limparia todas as órfãs)
    const common = await git(o.mainPath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    if (!common.ok) throw new Error(common.stderr.trim() || 'git rev-parse falhou')
    const adminRoot = path.join(common.stdout.trim(), 'worktrees')
    const target = path.join(w.path, '.git')
    const admin = fs.existsSync(adminRoot)
      ? fs.readdirSync(adminRoot).find((d) => {
          try {
            return fs.readFileSync(path.join(adminRoot, d, 'gitdir'), 'utf8').trim() === target
          } catch {
            return false
          }
        })
      : undefined
    if (!admin) throw new Error(`registro da worktree não encontrado: ${w.path}`)
    fs.rmSync(path.join(adminRoot, admin), { recursive: true, force: true })
  } else {
    const r = await git(o.mainPath, ['worktree', 'remove', ...(o.force ? ['--force'] : []), w.path], 30_000)
    if (!r.ok) throw new Error(r.stderr.trim() || 'git worktree remove falhou')
  }
  if (o.deleteBranch && w.branch) {
    const r = await git(o.mainPath, ['branch', o.force ? '-D' : '-d', w.branch])
    if (!r.ok) throw new Error(`worktree removida, mas a branch não: ${r.stderr.trim()}`)
  }
}
