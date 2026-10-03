import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { handleMessage, serveLines, TOOLS } from '../../src/mcp/protocol'

const noCall = async () => {
  throw new Error('não deveria chamar')
}

describe('gt-mcp: protocolo', () => {
  it('initialize ecoa a versão pedida e se apresenta', async () => {
    const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, noCall)
    expect(r).toEqual({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'gerenciador-terminal', version: '1.0.0' } } })
  })
  it('notificação não tem resposta; método desconhecido dá -32601', async () => {
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, noCall)).toBeNull()
    expect(await handleMessage({ jsonrpc: '2.0', id: 2, method: 'x/y' }, noCall)).toMatchObject({ id: 2, error: { code: -32601 } })
  })
  it('tools/list traz as 4 ferramentas', async () => {
    const r = (await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, noCall)) as { result: { tools: { name: string }[] } }
    expect(r.result.tools.map((t) => t.name)).toEqual(['criar_sessao', 'listar_sessoes', 'renomear_sessao', 'encerrar_sessao'])
    expect(TOOLS[0].inputSchema).toMatchObject({ type: 'object', required: ['nome'] })
  })
  it('tools/call repassa e devolve texto; erro vira isError', async () => {
    const seen: unknown[] = []
    const ok = await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'listar_sessoes', arguments: {} } }, async (tool, args) => {
      seen.push([tool, args])
      return [{ nome: 'dev-1' }]
    })
    expect(seen).toEqual([['listar_sessoes', {}]])
    expect(ok).toEqual({ jsonrpc: '2.0', id: 4, result: { content: [{ type: 'text', text: JSON.stringify([{ nome: 'dev-1' }], null, 2) }] } })
    const bad = await handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'criar_sessao', arguments: { nome: 'x' } } }, async () => {
      throw new Error('esta sessão não é líder; peça ao usuário para marcá-la no menu da sessão')
    })
    expect(bad).toEqual({ jsonrpc: '2.0', id: 5, result: { content: [{ type: 'text', text: 'esta sessão não é líder; peça ao usuário para marcá-la no menu da sessão' }], isError: true } })
  })
  it('stdio: uma mensagem JSON por linha, resposta por linha', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const lines: string[] = []
    output.on('data', (c) => lines.push(...String(c).split('\n').filter(Boolean)))
    serveLines(input, output, noCall)
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n')
    await new Promise((r) => setTimeout(r, 50))
    expect(JSON.parse(lines[0]).result.tools).toHaveLength(4)
  })
})
