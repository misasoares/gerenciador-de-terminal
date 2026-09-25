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

describe('I5: DaemonLink reconecta com um cliente só', () => {
  it('conexão que cai durante o hello não cria dois loops nem dois clientes', async () => {
    const { DaemonLink } = await import('../../src/main/daemon-link')
    const p = sock()
    server = await startServer(p, (req, conn) => {
      if (req.t === 'hello') conn.role = 'app'
      return { protocolVersion: 1 }
    })
    const events: string[] = []
    const link = new DaemonLink({ socketPath: p, daemonScript: '/nao/usado', onEvent: (e) => events.push(e.t), spawnDaemon: () => {} })
    await link.start()

    // "daemon reinicia": o novo derruba a primeira tentativa de hello
    await server.close()
    let first = true
    server = await startServer(p, (req, conn) => {
      if (req.t === 'hello') {
        if (first) {
          first = false
          conn.end()
          return new Promise(() => {})
        }
        conn.role = 'app'
      }
      return { protocolVersion: 1 }
    })
    await new Promise((r) => setTimeout(r, 3500))
    const apps = [...server.conns].filter((c) => c.role === 'app')
    expect(apps).toHaveLength(1)
    expect(events.filter((e) => e === 'reconnected')).toHaveLength(1)
    await expect(link.request({ t: 'state.get' })).resolves.toEqual({ protocolVersion: 1 })
    await link.shutdownDaemon(false)
  })
})
