import type { AgentKind, SessionStatus } from '../shared/types'
import { descendants, type Proc } from './platform/procs'

/** sessão cujo agente foi encerrado para liberar memória; o shell do painel continua vivo */
export interface Hibernation {
  sessionId: string
  agent: AgentKind
  accountId: string | null
  transcriptPath: string | null
  /** epoch ms em que hibernou */
  since: number
}

export interface Candidate {
  status: SessionStatus | null
  statusSince: number
  focused: boolean
  leader: boolean
  hired: boolean
  /** há shell entre os descendentes do agente (comando do Bash/Monitor rodando) */
  shellBusy: boolean
  hibernated: boolean
  waking: boolean
  cooldownUntil: number
}

export function shouldHibernate(c: Candidate, now: number, thresholdMs: number): boolean {
  if (c.status !== 'idle' && c.status !== 'your-turn') return false
  if (now - c.statusSince < thresholdMs) return false
  // líder e devs contratados conversam pelo SendMessage nativo, que só alcança sessões vivas
  if (c.focused || c.leader || c.hired || c.shellBusy || c.hibernated || c.waking) return false
  return now >= c.cooldownUntil
}

// 1º token do comando: sh, bash, zsh, fish ou dash (com caminho ou "-" de shell de login)
const SHELL_RE = /^(\S*\/)?-?(sh|bash|zsh|fish|dash)(\s|$)/

/** a ferramenta Bash do Claude (e os comandos do Codex) sempre rodam dentro de um shell */
export function hasShellDescendant(procs: Proc[], pid: number): boolean {
  return descendants(procs, pid).some((p) => SHELL_RE.test(p.args))
}
