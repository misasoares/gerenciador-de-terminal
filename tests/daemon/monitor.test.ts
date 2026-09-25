import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitMonitor } from '../../src/daemon/git/monitor'
import { makeRepo, type TestRepo } from '../helpers/repo'
import { waitFor } from '../helpers/wait'

let repo: TestRepo | null = null
let mon: GitMonitor | null = null
afterEach(() => { mon?.stop(); mon = null; repo?.cleanup(); repo = null })

describe('GitMonitor', () => {
  it('lê o status ao rastrear e atualiza quando arquivos mudam', async () => {
    repo = makeRepo()
    mon = new GitMonitor(() => {}, { pollMs: 200, debounceMs: 20 })
    mon.track([repo.dir])
    await waitFor(() => mon!.get(repo!.dir)?.branch === 'main')
    expect(mon.get(repo.dir)?.changed).toBe(0)
    repo.write('a.txt', 'x')
    await waitFor(() => mon!.get(repo!.dir)?.changed === 1)
  })

  it('deixar de rastrear apaga o status', async () => {
    repo = makeRepo()
    mon = new GitMonitor(() => {}, { pollMs: 200, debounceMs: 20 })
    mon.track([repo.dir])
    await waitFor(() => mon!.get(repo!.dir))
    mon.track([])
    expect(mon.get(repo.dir)).toBeNull()
  })

  it('erro de git vira campo error, sem exceção', async () => {
    repo = makeRepo()
    mon = new GitMonitor(() => {}, { pollMs: 200, debounceMs: 20 })
    const fake = path.join(repo.root, 'nao existe')
    mon.track([fake])
    await waitFor(() => mon!.get(fake)?.error)
  })

  it('fetch sem remoto não gera erro', async () => {
    repo = makeRepo()
    mon = new GitMonitor(() => {}, { pollMs: 200, debounceMs: 20 })
    let calls = 0
    mon.startFetch(() => { calls++; return [repo!.dir] }, 60_000)
    await waitFor(() => calls > 0)
    await new Promise((r) => setTimeout(r, 300))
    expect(mon.fetchError(repo.dir)).toBeNull()
  })
})
