import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RpcClient } from '../../src/shared/rpc-client'
import { startServer, type RpcServer } from '../../src/daemon/server'
import { waitFor } from '../helpers/wait'

let server: RpcServer | null = null
const sock = () => path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-s-'))), 's.sock')

afterEach(async () => { await server?.close(); server = null })

describe('rpc', () => {
  it('responde requisições e propaga erros', async () => {
    const p = sock()
    server = await startServer(p, (req) => {
      if (req.t === 'project.add') throw new Error('falhou: ' + req.path)
      return { eco: req.t }
    })
    const c = await RpcClient.connect(p)
    await expect(c.request({ t: 'state.get' })).resolves.toEqual({ eco: 'state.get' })
    await expect(c.request({ t: 'project.add', path: '/x' })).rejects.toThrow('falhou: /x')
    c.close()
  })

  it('send não recebe resposta e servidor pode empurrar mensagens', async () => {
    const p = sock()
    const seen: string[] = []
    server = await startServer(p, (req, conn) => {
      seen.push(req.t)
      if (req.t === 'hello') conn.send({ t: 'pane.data', paneId: 'x', data: 'oi' })
      return null
    })
    const c = await RpcClient.connect(p)
    const got: string[] = []
    c.onMessage((m) => { if (m.t === 'pane.data') got.push(m.data) })
    c.send({ t: 'hello', role: 'app', version: 1 })
    await waitFor(() => got.length === 1)
    expect(seen).toEqual(['hello'])
    c.close()
  })

  it('requisições pendentes falham quando a conexão cai', async () => {
    const p = sock()
    server = await startServer(p, () => new Promise(() => {}))
    const c = await RpcClient.connect(p)
    const pending = c.request({ t: 'state.get' })
    await server.close(); server = null
    await expect(pending).rejects.toThrow('conexão com o daemon encerrada')
  })

  it('connect falha rápido quando não há servidor', async () => {
    await expect(RpcClient.connect(sock())).rejects.toThrow()
  })
})
