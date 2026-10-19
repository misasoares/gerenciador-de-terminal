import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { NO_ACK_RULE } from '../../src/shared/team-text'
import { handleMessage, serveLines, TOOLS } from '../../src/mcp/protocol'

const noCall = async () => {
  throw new Error('não deveria chamar')
}

describe('gt-mcp: protocolo', () => {
  it('initialize ecoa a versão pedida e se apresenta', async () => {
    const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, noCall)
    expect(r).toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'gerenciador-terminal', version: '1.0.0' } } })
  })
  it('initialize manda instruções: "contratar devs" é contratar_dev, não subagente', async () => {
    const r = (await handleMessage({ jsonrpc: '2.0', id: 9, method: 'initialize', params: {} }, noCall)) as { result: { instructions: string } }
    for (const k of ['contratar_dev', 'demitir_dev', 'listar_equipe', 'contratar', 'demitir', 'devs', 'subagente', 'SendMessage', 'líder']) expect(r.result.instructions).toContain(k)
  })
  it('notificação não tem resposta; método desconhecido dá -32601', async () => {
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, noCall)).toBeNull()
    expect(await handleMessage({ jsonrpc: '2.0', id: 2, method: 'x/y' }, noCall)).toMatchObject({ id: 2, error: { code: -32601 } })
  })
  it('tools/list traz as 7 ferramentas; contratar aceita forcar', async () => {
    const r = (await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, noCall)) as { result: { tools: { name: string }[] } }
    expect(r.result.tools.map((t) => t.name)).toEqual(['contratar_dev', 'listar_equipe', 'mandar_mensagem', 'interromper', 'renomear_dev', 'demitir_dev', 'uso_da_maquina'])
    expect(TOOLS[0].inputSchema).toMatchObject({ type: 'object', required: ['nome'], properties: { forcar: { type: 'boolean' } } })
  })
  it('mandar_mensagem e interromper: parâmetros e instruções da equipe', async () => {
    const tool = (n: string) => TOOLS.find((t) => t.name === n)!.inputSchema as { required: string[]; properties: Record<string, unknown> }
    expect(tool('mandar_mensagem').required).toEqual(['para', 'texto'])
    expect(tool('interromper').required).toEqual(['para'])
    expect(Object.keys(tool('interromper').properties)).toEqual(['para', 'texto'])
    const r = (await handleMessage({ jsonrpc: '2.0', id: 9, method: 'initialize', params: {} }, noCall)) as { result: { instructions: string } }
    for (const k of ['[equipe]', 'mandar_mensagem', 'interromper', 'Claude → Claude: SendMessage; para outra CLI: mandar_mensagem', NO_ACK_RULE]) expect(r.result.instructions).toContain(k)
  })
  it('instruções mandam consultar uso_da_maquina e só forçar com autorização', async () => {
    const r = (await handleMessage({ jsonrpc: '2.0', id: 9, method: 'initialize', params: {} }, noCall)) as { result: { instructions: string } }
    for (const k of ['uso_da_maquina', 'forcar: true', 'autorizar']) expect(r.result.instructions).toContain(k)
  })
  it('tools/call repassa e devolve texto; erro vira isError', async () => {
    const seen: unknown[] = []
    const ok = await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'listar_equipe', arguments: {} } }, async (tool, args) => {
      seen.push([tool, args])
      return [{ nome: 'dev-1' }]
    })
    expect(seen).toEqual([['listar_equipe', {}]])
    expect(ok).toEqual({ jsonrpc: '2.0', id: 4, result: { content: [{ type: 'text', text: JSON.stringify([{ nome: 'dev-1' }], null, 2) }] } })
    const bad = await handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'contratar_dev', arguments: { nome: 'x' } } }, async () => {
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
    expect(JSON.parse(lines[0]).result.tools).toHaveLength(7)
  })
  it('stdio: quando a entrada fecha (o Claude saiu), avisa para o processo encerrar', async () => {
    const input = new PassThrough()
    let ended = false
    serveLines(input, new PassThrough(), noCall, () => {
      ended = true
    })
    input.end()
    await new Promise((r) => setTimeout(r, 20))
    expect(ended).toBe(true)
  })
})
