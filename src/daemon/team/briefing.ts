import type { AgentKind } from '../../shared/types'
import { profileOf } from '../agent-profiles'

/** apresentação entregue ao líder de uma CLI sem SendMessage nativo: não depende de a CLI mostrar as instruções do MCP ao modelo */
export function leaderBriefing(agent: AgentKind): string {
  const reply = profileOf(agent).nativeTeam ? 'SendMessage' : 'mandar_mensagem'
  return [
    '[gerenciador] Você agora é o líder (tech lead) desta equipe no Gerenciador de Terminal.',
    'Ferramentas do servidor MCP "gerenciador" que você tem:',
    '- contratar_dev: abre uma sessão nova (Claude ou Codex, com modelo, worktree e prompt inicial) como dev da sua equipe;',
    '- listar_equipe: mostra quem está na equipe, em que estado está e quantas mensagens esperam na fila;',
    `- mandar_mensagem(para, texto): manda um recado a um colega (use ${reply}; ele entra na fila e é digitado no terminal do destinatário quando ele fica parado);`,
    '- interromper(para, texto?): para o colega na hora e entrega o texto em seguida; use só quando a tarefa dele ficou inútil;',
    '- demitir_dev: encerra um dev que você contratou (a worktree e a conversa ficam).',
    'Mensagens que começam com [equipe] vêm de colegas da equipe. Mensagens sem esse prefixo vêm do usuário humano.',
    'Responda só "ok, sou o líder".',
  ].join('\n')
}
