import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureDaemon } from '../../src/main/daemon-link'
import { startServer, type RpcServer } from '../../src/daemon/server'

let server: RpcServer | null = null
afterEach(async () => { await server?.close(); server = null })
const sock = () => path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-m-'))), 'd.sock')

describe('ensureDaemon', () => {
  it('conecta direto quando o daemon já existe, sem iniciar outro', async () => {
    const p = sock()
    server = await startServer(p, () => 'ok')
    let spawned = 0
    const c = await ensureDaemon(p, () => { spawned++ })
    expect(spawned).toBe(0)
    await expect(c.request({ t: 'state.get' })).resolves.toBe('ok')
    c.close()
  })

  it('inicia o daemon e espera o socket aparecer', async () => {
    const p = sock()
    let spawned = 0
    const c = await ensureDaemon(p, () => {
      spawned++
      setTimeout(() => { void startServer(p, () => 'novo').then((s) => { server = s }) }, 300)
    })
    expect(spawned).toBe(1)
    await expect(c.request({ t: 'state.get' })).resolves.toBe('novo')
    c.close()
  })

  it('desiste depois do tempo limite', async () => {
    await expect(ensureDaemon(sock(), () => {}, 400)).rejects.toThrow('não consegui iniciar o daemon')
  })
})
