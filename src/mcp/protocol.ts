/** MCP mínimo (stdio, uma mensagem JSON por linha): initialize, ping, tools/list, tools/call */
export type CallDaemon = (tool: string, args: Record<string, unknown>) => Promise<unknown>

const str = (description: string) => ({ type: 'string', description })

export const TOOLS = [
  {
    name: 'criar_sessao',
    description:
      'Abre uma nova sessão do Claude no Gerenciador de Terminal, na aba desta sessão, como se o usuário tivesse aberto: com nome (o SendMessage acha por ele), conta, worktree git própria e prompt inicial. Só funciona se o usuário marcou esta sessão como líder.',
    inputSchema: {
      type: 'object',
      properties: {
        nome: str('nome da sessão, ex.: dev-1 (letras, números, ponto, hífen, sublinhado)'),
        prompt: str('primeira mensagem enviada à sessão'),
        conta: str('conta do agente (id ou rótulo); padrão: a desta sessão'),
        worktree: { type: 'boolean', description: 'criar worktree git nova em .claude/worktrees/<nome> (padrão true)' },
        base: str('branch de partida da worktree; padrão: a branch atual desta sessão'),
        onde: { type: 'string', enum: ['aba-do-lider'], description: 'onde a sessão aparece (padrão aba-do-lider)' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'listar_sessoes',
    description: 'Lista as sessões do espaço de trabalho desta sessão: nome, status (trabalhando, pedindo-permissao, sua-vez, ocioso, terminal), conta, pasta, branch e se foi criada por esta sessão.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'renomear_sessao',
    description: 'Renomeia uma sessão do espaço desta sessão.',
    inputSchema: { type: 'object', properties: { nome: str('nome atual'), novo_nome: str('novo nome') }, required: ['nome', 'novo_nome'] },
  },
  {
    name: 'encerrar_sessao',
    description: 'Encerra uma sessão criada por esta sessão. A worktree fica (o usuário remove pela sidebar).',
    inputSchema: { type: 'object', properties: { nome: str('nome da sessão') }, required: ['nome'] },
  },
]

interface Msg {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
}

export async function handleMessage(raw: unknown, call: CallDaemon): Promise<object | null> {
  const msg = (raw ?? {}) as Msg
  if (msg.id === undefined || msg.id === null) return null // notificação
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result })
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'gerenciador-terminal', version: '1.0.0' },
      })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: TOOLS })
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
      try {
        const r = await call(name, args)
        return reply({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] })
      } catch (e) {
        return reply({ content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true })
      }
    }
    default:
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `método desconhecido: ${msg.method}` } }
  }
}

export function serveLines(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, call: CallDaemon): void {
  let buf = ''
  input.setEncoding?.('utf8')
  input.on('data', (chunk: string | Buffer) => {
    buf += String(chunk)
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }) + '\n')
        continue
      }
      void handleMessage(parsed, call).then((r) => {
        if (r) output.write(JSON.stringify(r) + '\n')
      })
    }
  })
}
