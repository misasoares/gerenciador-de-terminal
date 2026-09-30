import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRegistry } from '../../src/daemon/projects'
import { makeRepo, type TestRepo } from '../helpers/repo'

let repo: TestRepo | null = null
afterEach(() => { repo?.cleanup(); repo = null })

describe('ProjectRegistry', () => {
  it('adicionar a partir de uma worktree ou subpasta cadastra o repositório principal, sem duplicar', async () => {
    repo = makeRepo()
    const wt = path.join(repo.root, 'wt a')
    repo.git('worktree', 'add', '-b', 'a', wt)
    let changes = 0
    const reg = new ProjectRegistry([], () => { changes++ })
    const p = await reg.add(wt, 'mslabs')
    expect(p).toEqual({ path: repo.dir, name: 'meu projeto', defaultAccountId: 'mslabs' })
    fs.mkdirSync(path.join(repo.dir, 'sub'))
    await reg.add(path.join(repo.dir, 'sub'), null)
    expect(reg.list()).toHaveLength(1)
    expect(reg.worktrees(repo.dir).map((w) => w.path)).toEqual([repo.dir, wt])
    expect(changes).toBeGreaterThan(0)
  })

  it('recusa pasta que não é git', async () => {
    const reg = new ProjectRegistry([], () => {})
    await expect(reg.add('/', null)).rejects.toThrow('não é um repositório git')
  })

  it('locate acha worktree criada depois do cadastro (cache velho)', async () => {
    repo = makeRepo()
    const reg = new ProjectRegistry([], () => {})
    await reg.add(repo.dir, null)
    const nova = path.join(repo.dir, '.claude', 'worktrees', 'feat x')
    repo.git('worktree', 'add', '-b', 'feat-x', nova)
    fs.mkdirSync(path.join(nova, 'src'))
    expect(await reg.locate(path.join(nova, 'src'))).toEqual({ projectPath: repo.dir, worktreePath: nova })
    expect(reg.worktrees(repo.dir).map((w) => w.path)).toContain(nova)
  })

  it('locate devolve null fora de projeto cadastrado', async () => {
    repo = makeRepo()
    const reg = new ProjectRegistry([], () => {})
    expect(await reg.locate(repo.dir)).toBeNull()
    expect(await reg.locate('/')).toBeNull()
  })

  it('refresh registra erro quando a pasta some', async () => {
    repo = makeRepo()
    const reg = new ProjectRegistry([{ path: path.join(repo.root, 'sumiu'), name: 'sumiu', defaultAccountId: null }], () => {})
    await reg.refreshAll()
    expect(reg.error(path.join(repo.root, 'sumiu'))).not.toBeNull()
  })

  it('cor do projeto: define, limpa e recusa cor inválida', async () => {
    repo = makeRepo()
    let changes = 0
    const reg = new ProjectRegistry([], () => { changes++ })
    await reg.add(repo.dir, null)
    const before = changes
    reg.setColor(repo.dir, '#22c55e')
    expect(reg.get(repo.dir)?.color).toBe('#22c55e')
    expect(changes).toBe(before + 1)
    reg.setColor(repo.dir, null)
    expect(reg.get(repo.dir)?.color).toBeNull()
    expect(() => reg.setColor(repo!.dir, 'verde')).toThrow('cor inválida')
    expect(() => reg.setColor('/nao/existe', '#22c55e')).toThrow('projeto não encontrado')
  })
})
