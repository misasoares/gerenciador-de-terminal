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
  'Antes de contratar mais de um dev, consulte uso_da_maquina e ajuste quantos contratar. Se contratar_dev recusar por máquina sobrecarregada, mostre o motivo ao usuário e só use forcar: true se ele autorizar.',
  'Só a sessão marcada pelo usuário como líder (👑) pode usar contratar_dev, demitir_dev e renomear_dev; se vier "esta sessão não é líder", explique ao usuário como marcar (menu da sessão na sidebar → Pode contratar sessões).',
  'Hierarquia: o líder (tech lead) e os devs que ele contratou formam uma equipe. Mensagem que começa com [equipe] vem de um colega da equipe; mensagem sem esse prefixo vem do usuário humano.',
  'Falar com um colega: Claude → Claude: SendMessage; para outra CLI: mandar_mensagem(para, texto). Quem não é Claude sempre usa mandar_mensagem. A mensagem entra na fila e é digitada no terminal do destinatário quando ele fica parado; a resposta chega no seu terminal com o prefixo [equipe].',
  'Use interromper(para, texto?) só quando a tarefa atual do dev ficou inútil: ele para na hora e recebe o texto em seguida.',
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
        forcar: { type: 'boolean', description: 'contratar mesmo com a máquina sobrecarregada; só com autorização explícita do usuário' },
        onde: { type: 'string', enum: ['aba-do-lider', 'flutuante'], description: 'onde a sessão aparece: aba-do-lider (padrão, divide a aba) ou flutuante (janela própria por cima de tudo)' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'listar_equipe',
    description:
      'Lista a equipe (o líder e os devs que ele contratou): nome, CLI, status (trabalhando, pedindo-permissao, sua-vez, ocioso, terminal), há quantos segundos está nele, mensagens esperando na fila, se a entrega está atrasada, conta, pasta, branch e se foi criada por esta sessão. Qualquer membro da equipe pode chamar.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mandar_mensagem',
    description:
      'Manda uma mensagem a outro membro da sua equipe (líder ↔ devs, ou entre devs do mesmo líder). Vai para a fila e o Gerenciador a digita no terminal do destinatário quando ele estiver parado, nunca durante um pedido de permissão. O cabeçalho [equipe] é montado pelo app. Entre dois Claudes prefira o SendMessage nativo.',
    inputSchema: { type: 'object', properties: { para: str('nome do destinatário, como aparece em listar_equipe'), texto: str('a mensagem') }, required: ['para', 'texto'] },
  },
  {
    name: 'interromper',
    description:
      'Interrompe um membro da sua equipe agora (tecla Esc no terminal dele) e, se houver texto, entrega a mensagem em seguida. Use só quando a tarefa atual dele ficou inútil; para um recado comum use mandar_mensagem.',
    inputSchema: { type: 'object', properties: { para: str('nome do destinatário'), texto: str('o que ele deve fazer em vez disso (opcional)') }, required: ['para'] },
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
  {
    name: 'uso_da_maquina',
    description:
      'Uso atual de CPU, RAM, swap e pressão de memória da máquina, os maiores consumidores (sessões do app, Colima/Docker, emulador, navegadores, top 5 processos), a RAM média por sessão do Claude e quantas sessões ainda cabem. Consulte antes de contratar devs.',
    inputSchema: { type: 'object', properties: {} },
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

/** onEnd: a entrada fechou (o Claude saiu) — o processo deve encerrar para não ficar órfão */
export function serveLines(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, call: CallDaemon, onEnd: () => void = () => {}): void {
  let buf = ''
  input.setEncoding?.('utf8')
  input.on('end', onEnd)
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
