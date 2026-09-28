import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ConflictReport, WorktreeInfo } from '../shared/types'
import { git } from './git/run'

const WIP_ENV = {
  GIT_AUTHOR_NAME: 'gerenciador-terminal',
  GIT_AUTHOR_EMAIL: 'gt@localhost',
  GIT_COMMITTER_NAME: 'gerenciador-terminal',
  GIT_COMMITTER_EMAIL: 'gt@localhost',
}
const TIMEOUT = 30_000
let counter = 0

export interface Tip {
  worktreePath: string
  tip: string
  dirty: boolean
}

const firstLine = (s: string) => s.trim().split('\n')[0] ?? ''

/**
 * Retrato da worktree: HEAD se limpa; senão um commit solto com tudo (inclui arquivos novos, respeita .gitignore),
 * montado num índice temporário — o índice real, o stash e as refs não são tocados.
 */
export async function snapshotTip(worktreePath: string): Promise<Tip> {
  const head = await git(worktreePath, ['rev-parse', 'HEAD'])
  if (!head.ok) throw new Error(firstLine(head.stderr) || 'git rev-parse falhou')
  const headSha = head.stdout.trim()
  const st = await git(worktreePath, ['status', '--porcelain'])
  if (!st.ok) throw new Error(firstLine(st.stderr) || 'git status falhou')
  if (!st.stdout.trim()) return { worktreePath, tip: headSha, dirty: false }

  const idx = path.join(os.tmpdir(), `gt-idx-${process.pid}-${++counter}`)
  const env = { ...WIP_ENV, GIT_INDEX_FILE: idx }
  try {
    for (const args of [['read-tree', 'HEAD'], ['add', '-A']]) {
      const r = await git(worktreePath, args, TIMEOUT, env)
      if (!r.ok) throw new Error(`git ${args[0]}: ${firstLine(r.stderr)}`)
    }
    const tree = await git(worktreePath, ['write-tree'], TIMEOUT, env)
    if (!tree.ok) throw new Error(`git write-tree: ${firstLine(tree.stderr)}`)
    const commit = await git(worktreePath, ['commit-tree', tree.stdout.trim(), '-p', headSha, '-m', 'gerenciador-terminal: alterações locais'], TIMEOUT, env)
    if (!commit.ok) throw new Error(`git commit-tree: ${firstLine(commit.stderr)}`)
    return { worktreePath, tip: commit.stdout.trim(), dirty: true }
  } finally {
    fs.rmSync(idx, { force: true })
    fs.rmSync(`${idx}.lock`, { force: true })
  }
}

/** saída de `git merge-tree --write-tree --name-only --no-messages`: 1ª linha = tree; demais = arquivos em conflito */
export function parseMergeTree(code: number | null, stdout: string): { conflict: boolean; files: string[] } | { error: true } {
  if (code === 0) return { conflict: false, files: [] }
  if (code !== 1) return { error: true }
  const files = [...new Set(stdout.split('\n').slice(1).map((l) => l.trim()).filter(Boolean))]
  return { conflict: true, files }
}

async function mergeTree(cwd: string, a: string, b: string): Promise<string[]> {
  const r = await git(cwd, ['merge-tree', '--write-tree', '--name-only', '--no-messages', a, b], TIMEOUT)
  const p = parseMergeTree(r.code, r.stdout)
  if ('error' in p) throw new Error(firstLine(r.stderr) || `git merge-tree saiu com ${r.code}`)
  return p.files
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  })
  await Promise.all(workers)
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function analyzeConflicts(mainPath: string, worktrees: WorktreeInfo[], concurrency = 4): Promise<Omit<ConflictReport, 'running'>> {
  const live = worktrees.filter((w) => !w.prunable)
  const errors: ConflictReport['errors'] = []
  const tips = new Map<string, Tip>()
  await pool(live, concurrency, async (w) => {
    try {
      tips.set(w.path, await snapshotTip(w.path))
    } catch (e) {
      errors.push({ worktreePath: w.path, message: message(e) })
    }
  })

  const main = live.find((w) => w.isMain)
  const base = main ? tips.get(main.path) : undefined
  if (!base) {
    return { analyzedAt: Date.now(), comparisons: 0, vsMain: [], pairs: [], cleanPairs: 0, errors: errors.length ? errors : [{ worktreePath: mainPath, message: 'worktree principal não analisada' }] }
  }

  const others = live.filter((w) => !w.isMain && tips.has(w.path)).map((w) => tips.get(w.path)!)
  const vsMain = others.map((t) => ({ worktreePath: t.worktreePath, files: [] as string[], dirty: t.dirty || base.dirty }))
  // igual à main não conflita com nada que a própria main não conflitaria: fica fora dos pares
  const changed = others.filter((t) => t.tip !== base.tip)
  type Job = { kind: 'main'; t: Tip } | { kind: 'pair'; x: Tip; y: Tip }
  const jobs: Job[] = changed.map((t) => ({ kind: 'main', t }))
  let totalPairs = 0
  for (let i = 0; i < changed.length; i++) {
    for (let j = i + 1; j < changed.length; j++) {
      totalPairs++
      if (changed[i].tip !== changed[j].tip) jobs.push({ kind: 'pair', x: changed[i], y: changed[j] })
    }
  }

  const pairs: ConflictReport['pairs'] = []
  let comparisons = 0
  await pool(jobs, concurrency, async (job) => {
    comparisons++
    try {
      if (job.kind === 'main') {
        const files = await mergeTree(mainPath, base.tip, job.t.tip)
        vsMain.find((v) => v.worktreePath === job.t.worktreePath)!.files = files
      } else {
        const files = await mergeTree(mainPath, job.x.tip, job.y.tip)
        if (files.length) pairs.push({ a: job.x.worktreePath, b: job.y.worktreePath, files, dirty: job.x.dirty || job.y.dirty })
      }
    } catch (e) {
      const who = job.kind === 'main' ? job.t.worktreePath : `${job.x.worktreePath} ↔ ${job.y.worktreePath}`
      errors.push({ worktreePath: who, message: message(e) })
    }
  })

  return { analyzedAt: Date.now(), comparisons, vsMain, pairs, cleanPairs: totalPairs - pairs.length, errors }
}
