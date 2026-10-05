/** MCP mínimo (stdio, uma mensagem JSON por linha): initialize, ping, tools/list, tools/call */
export type CallDaemon = (tool: string, args: Record<string, unknown>) => Promise<unknown>

const str = (description: string) => ({ type: 'string', description })

/**
 * Vai no prompt de sistema do Claude (MCP Server Instructions), sempre visível: com muitos MCPs as ferramentas
 * ficam "adiadas" e só o nome aparece, então sem isto "contrata 3 devs" vira subagente.
 */
export const INSTRUCTIONS = [
  'Gerenciador de Terminal: o usuário roda várias sessões do Claude Code em terminais desse app; uma sessão líder (👑) monta e comanda uma equipe de devs.',
  'Quando o usuário pedir para contratar, chamar, abrir ou criar devs, ajudantes, agentes, sessões ou terminais (ex.: "contrata 3 devs", "abre 2 sessões para X"), use contratar_dev uma vez por dev: abre um terminal novo de verdade, ao lado desta sessão, com nome, conta, worktree git própria e o prompt inicial. Isso NÃO é subagente nem Agent/Task: são sessões independentes que o usuário vê e usa.',
  'Dê nomes curtos (dev-1, dev-2…) e mande no prompt a tarefa completa de cada um. Coordene pelo SendMessage nativo, endereçando pelo nome; use listar_equipe para ver quem está trabalhando, pedindo permissão ou esperando (sua-vez).',
  'Quando pedirem para demitir, dispensar, encerrar ou fechar devs, use demitir_dev: o terminal some da tela, mas a worktree, a branch e a conversa ficam. Antes de demitir quem está no meio de algo, peça pelo SendMessage que commite e avise.',
  'Só a sessão marcada pelo usuário como líder (👑) pode usar estas ferramentas; se vier "esta sessão não é líder", explique ao usuário como marcar (menu da sessão na sidebar → Pode contratar sessões).',
].join('\n')

export const TOOLS = [
  {
    name: 'contratar_dev',
    description:
      'Contratar um dev / abrir uma sessão nova: abre um terminal novo do Claude Code no Gerenciador de Terminal, ao lado desta sessão, como se o usuário tivesse aberto, com nome (o SendMessage acha por ele), conta, worktree git própria e prompt inicial. Use para "contrata N devs", "abre sessões para X" (não é subagente). Só funciona se o usuário marcou esta sessão como líder.',
    inputSchema: {
      type: 'object',
      properties: {
        nome: str('nome da sessão, ex.: dev-1 (letras, números, ponto, hífen, sublinhado)'),
        prompt: str('primeira mensagem enviada à sessão'),
        conta: str('conta do agente (id ou rótulo); padrão: a desta sessão'),
        worktree: { type: 'boolean', description: 'criar worktree git nova em .claude/worktrees/<nome> (padrão true)' },
        base: str('branch de partida da worktree; padrão: a branch atual desta sessão'),
        onde: { type: 'string', enum: ['aba-do-lider', 'flutuante'], description: 'onde a sessão aparece: aba-do-lider (padrão, divide a aba) ou flutuante (janela própria por cima de tudo)' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'listar_equipe',
    description: 'Lista a equipe: as sessões do espaço de trabalho desta sessão: nome, status (trabalhando, pedindo-permissao, sua-vez, ocioso, terminal), conta, pasta, branch e se foi criada por esta sessão.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'renomear_dev',
    description: 'Renomeia um dev (sessão) do espaço desta sessão.',
    inputSchema: { type: 'object', properties: { nome: str('nome atual'), novo_nome: str('novo nome') }, required: ['nome', 'novo_nome'] },
  },
  {
    name: 'demitir_dev',
    description: 'Demitir / dispensar um dev: encerra uma sessão criada por esta sessão e tira o terminal da tela. A worktree, a branch e a conversa ficam (o usuário remove a worktree pela sidebar).',
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
        instructions: INSTRUCTIONS,
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
