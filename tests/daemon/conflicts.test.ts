import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { analyzeConflicts, parseMergeTree, snapshotTip } from '../../src/daemon/conflicts'
import { listWorktrees } from '../../src/daemon/resolve'
import { makeRepo, type TestRepo } from '../helpers/repo'

let repo: TestRepo | null = null
afterEach(() => { repo?.cleanup(); repo = null })

function setup() {
  repo = makeRepo()
  repo.write('f.txt', 'linha 1\nlinha 2\nlinha 3\n')
  repo.git('add', '.')
  repo.git('commit', '-m', 'base')
  const wt = (name: string) => {
    const p = path.join(repo!.root, `wt ${name}`)
    repo!.git('worktree', 'add', '-b', name, p)
    return p
  }
  const g = (p: string, ...args: string[]) => repo!.git('-C', p, ...args)
  const a = wt('a'), b = wt('b'), c = wt('c'), d = wt('d'), e = wt('e')
  fs.writeFileSync(path.join(a, 'f.txt'), 'linha 1\nA mudou\nlinha 3\n'); g(a, 'commit', '-qam', 'a')
  fs.writeFileSync(path.join(b, 'f.txt'), 'linha 1\nB mudou\nlinha 3\n'); g(b, 'commit', '-qam', 'b')
  // c fica igual à main
  fs.writeFileSync(path.join(d, 'novo.txt'), 'da d\n') // só local, não commitado
  fs.writeFileSync(path.join(e, 'novo.txt'), 'da e\n'); g(e, 'add', '.'); g(e, 'commit', '-qm', 'e')
  return { a, b, c, d, e, g }
}

describe('parseMergeTree', () => {
  it('limpo, conflito e erro', () => {
    expect(parseMergeTree(0, 'abc123\n')).toEqual({ conflict: false, files: [] })
    expect(parseMergeTree(1, 'abc123\nsrc/a.ts\nsrc/a.ts\npackage.json\n')).toEqual({ conflict: true, files: ['src/a.ts', 'package.json'] })
    expect(parseMergeTree(128, '')).toEqual({ error: true })
  })
})

describe('snapshotTip', () => {
  it('limpa usa o HEAD; com alterações cria commit solto sem mexer no índice, stash ou refs', async () => {
    const { c, d, g } = setup()
    expect(await snapshotTip(c)).toMatchObject({ dirty: false, tip: g(c, 'rev-parse', 'HEAD').trim() })

    fs.writeFileSync(path.join(d, 'staged.txt'), 's\n')
    g(d, 'add', 'staged.txt') // o usuário tinha algo no índice
    const before = { status: g(d, 'status', '--porcelain'), cached: g(d, 'diff', '--cached', '--name-only'), refs: g(d, 'for-each-ref'), stash: g(d, 'stash', 'list') }
    const tip = await snapshotTip(d)
    expect(tip.dirty).toBe(true)
    expect(g(d, 'cat-file', '-t', tip.tip).trim()).toBe('commit')
    expect(g(d, 'ls-tree', '-r', '--name-only', tip.tip)).toContain('novo.txt')
    expect({ status: g(d, 'status', '--porcelain'), cached: g(d, 'diff', '--cached', '--name-only'), refs: g(d, 'for-each-ref'), stash: g(d, 'stash', 'list') }).toEqual(before)
  })
})

describe('analyzeConflicts', () => {
  it('acha conflito entre worktrees que não conflitam com a main, inclusive por alteração local, e pula as iguais à main', async () => {
    const { a, b, c, d, e } = setup()
    const r = await listWorktrees(repo!.dir)
    if (!r.ok) throw new Error(r.error)
    const rep = await analyzeConflicts(repo!.dir, r.worktrees)
    expect(rep.errors).toEqual([])
    expect(rep.vsMain.every((v) => v.files.length === 0)).toBe(true)
    expect(rep.vsMain.map((v) => v.worktreePath).sort()).toEqual([a, b, c, d, e].sort())
    const pairs = rep.pairs.map((p) => [[p.a, p.b].sort().join(' | '), p.files, p.dirty])
    expect(pairs).toContainEqual([[a, b].sort().join(' | '), ['f.txt'], false])
    expect(pairs).toContainEqual([[d, e].sort().join(' | '), ['novo.txt'], true])
    expect(rep.pairs).toHaveLength(2)
    // 4 contra a main (c é igual) + 6 pares entre a, b, d, e
    expect(rep.comparisons).toBe(10)
    expect(rep.cleanPairs).toBe(4)
  })

  it('worktree com pasta apagada é ignorada; erro de uma não derruba a análise', async () => {
    const { a } = setup()
    fs.rmSync(a, { recursive: true, force: true })
    const r = await listWorktrees(repo!.dir)
    if (!r.ok) throw new Error(r.error)
    const rep = await analyzeConflicts(repo!.dir, r.worktrees)
    expect(rep.vsMain.map((v) => v.worktreePath)).not.toContain(a)
    expect(rep.pairs.length).toBeGreaterThanOrEqual(1)
  })
})

describe('I6: custo da análise', () => {
  it('retrato de worktree com alterações é determinístico (mesmo conteúdo → mesmo sha)', async () => {
    const { d } = setup()
    const one = await snapshotTip(d)
    await new Promise((r) => setTimeout(r, 1100)) // outro segundo: com a hora atual o sha mudaria
    const two = await snapshotTip(d)
    expect(two.tip).toBe(one.tip)
  })

  it('cache por par: reanalisar sem mudança não roda merge-tree de novo', async () => {
    setup()
    const r = await listWorktrees(repo!.dir)
    if (!r.ok) throw new Error(r.error)
    const cache = new Map<string, string[]>()
    const first = await analyzeConflicts(repo!.dir, r.worktrees, 4, cache)
    expect(first.comparisons).toBe(10)
    const second = await analyzeConflicts(repo!.dir, r.worktrees, 4, cache)
    expect(second.comparisons).toBe(0)
    expect(second.pairs.map((p) => p.files)).toEqual(first.pairs.map((p) => p.files))
  })
})
