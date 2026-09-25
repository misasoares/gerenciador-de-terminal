import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkRemove, removeWorktree } from '../../src/daemon/worktree-remove'
import { listWorktrees } from '../../src/daemon/resolve'
import { Daemon } from '../../src/daemon/daemon'
import { connectApp } from '../helpers/app-client'
import { makeRepo, type TestRepo } from '../helpers/repo'

let repo: TestRepo | null = null
let daemon: Daemon | null = null
afterEach(async () => { await daemon?.stop(true); daemon = null; repo?.cleanup(); repo = null })

async function setup(name = 'wt x') {
  repo = makeRepo()
  const wtPath = path.join(repo.root, name)
  repo.git('worktree', 'add', '-b', 'feat-x', wtPath)
  const r = await listWorktrees(repo.dir)
  if (!r.ok) throw new Error(r.error)
  return { wt: r.worktrees[1], main: r.worktrees[0] }
}

describe('checkRemove', () => {
  it('worktree limpa e sem commits próprios', async () => {
    const { wt } = await setup()
    const c = await checkRemove({ mainPath: repo!.dir, worktree: wt, mainBranch: 'main', hasOpenSession: false })
    expect(c).toEqual({ path: wt.path, branch: 'feat-x', isMain: false, hasOpenSession: false, dirtyFiles: [], unpushedCommits: [] })
  })

  it('lista arquivos alterados e commits fora do remoto e da main', async () => {
    const { wt } = await setup()
    fs.writeFileSync(path.join(wt.path, 'a.txt'), '1')
    const g = (...a: string[]) => repo!.git('-C', wt.path, ...a)
    g('add', '.')
    g('commit', '-m', 'trabalho da worktree')
    fs.writeFileSync(path.join(wt.path, 'b.txt'), '2')
    const c = await checkRemove({ mainPath: repo!.dir, worktree: wt, mainBranch: 'main', hasOpenSession: true })
    expect(c.dirtyFiles).toEqual(['?? b.txt'])
    expect(c.unpushedCommits).toHaveLength(1)
    expect(c.unpushedCommits[0]).toContain('trabalho da worktree')
    expect(c.hasOpenSession).toBe(true)
  })
})

describe('removeWorktree', () => {
  it('remove a worktree e opcionalmente a branch', async () => {
    const { wt } = await setup()
    await removeWorktree({ mainPath: repo!.dir, worktree: wt, force: false, deleteBranch: true })
    expect(fs.existsSync(wt.path)).toBe(false)
    expect(repo!.git('branch', '--list', 'feat-x').trim()).toBe('')
  })

  it('sem force, git recusa worktree suja', async () => {
    const { wt } = await setup()
    fs.writeFileSync(path.join(wt.path, 'sujo.txt'), 'x')
    await expect(removeWorktree({ mainPath: repo!.dir, worktree: wt, force: false, deleteBranch: false })).rejects.toThrow()
    expect(fs.existsSync(wt.path)).toBe(true)
  })

  it('recusa a principal', async () => {
    const { main } = await setup()
    await expect(removeWorktree({ mainPath: repo!.dir, worktree: main, force: true, deleteBranch: false })).rejects.toThrow('principal')
  })

  it('pasta apagada à mão (prunable) é limpa com prune', async () => {
    const { wt } = await setup()
    fs.rmSync(wt.path, { recursive: true, force: true })
    const r = await listWorktrees(repo!.dir)
    const pr = r.ok ? r.worktrees.find((w) => w.path === wt.path)! : wt
    expect(pr.prunable).toBe(true)
    await removeWorktree({ mainPath: repo!.dir, worktree: pr, force: false, deleteBranch: false })
    const after = await listWorktrees(repo!.dir)
    expect(after.ok && after.worktrees).toHaveLength(1)
  })
})

describe('pelo daemon', () => {
  it('recusa com sessão aberta, recusa perda sem force e remove com force', async () => {
    const { wt } = await setup()
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-r-')))
    const userHome = path.join(home, 'user')
    fs.mkdirSync(userHome)
    daemon = await Daemon.start({
      home, socketPath: path.join(home, 'd.sock'), stateFile: path.join(home, 'state.json'), hookScriptPath: path.join(home, 'bin', 'gt-hook'),
      userHome, shell: '/bin/sh', shellArgs: [], env: { PATH: process.env.PATH, HOME: userHome }, pollMs: 60_000, gitPollMs: 500, fetchIntervalMs: 3_600_000,
    })
    const app = await connectApp(path.join(home, 'd.sock'))
    await app.client.request({ t: 'project.add', path: repo!.dir })

    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: wt.path, accountId: null, cols: 80, rows: 24 })
    await app.waitState((s) => s.panes[0]?.worktreePath === wt.path)
    await expect(app.client.request({ t: 'worktree.remove', path: wt.path, force: true, deleteBranch: false })).rejects.toThrow('sessões abertas')

    app.client.send({ t: 'pane.kill', paneId })
    await app.waitState((s) => s.panes[0]?.alive === false)
    fs.writeFileSync(path.join(wt.path, 'sujo.txt'), 'x')
    const check = await app.client.request<{ dirtyFiles: string[] }>({ t: 'worktree.checkRemove', path: wt.path })
    expect(check.dirtyFiles).toEqual(['?? sujo.txt'])
    await expect(app.client.request({ t: 'worktree.remove', path: wt.path, force: false, deleteBranch: false })).rejects.toThrow('seriam perdidos')

    await app.client.request({ t: 'worktree.remove', path: wt.path, force: true, deleteBranch: true })
    await app.waitState((s) => s.projects[0].worktrees.length === 1)
    app.client.close()
  })
})
