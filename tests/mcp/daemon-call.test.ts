import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeDaemonCall } from '../../src/mcp/daemon-call'
import { startServer, type RpcServer } from '../../src/daemon/server'

let server: RpcServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})
const sock = () => path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-mcp-'))), 'd.sock')

describe('gt-mcp: ligação com o daemon', () => {
  it('repassa com o GT_PANE_ID de quem chamou', async () => {
    const p = sock()
    const got: unknown[] = []
    server = await startServer(p, (req) => {
      got.push(req)
      return { ok: true }
    })
    const call = makeDaemonCall({ GT_SOCKET: p, GT_PANE_ID: 'pane-1' })
    await expect(call('listar_sessoes', { a: 1 })).resolves.toEqual({ ok: true })
    expect(got).toEqual([{ t: 'mcp.call', callerPaneId: 'pane-1', tool: 'listar_sessoes', args: { a: 1 } }])
  })
  it('fora do app e sem daemon: erros claros', async () => {
    await expect(makeDaemonCall({})('listar_sessoes', {})).rejects.toThrow('fora do Gerenciador de Terminal')
    await expect(makeDaemonCall({ GT_SOCKET: sock(), GT_PANE_ID: 'p' })('listar_sessoes', {})).rejects.toThrow('Gerenciador de Terminal não está rodando')
  })
})
