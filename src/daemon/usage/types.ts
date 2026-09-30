import type { AgentKind, UsageWindow } from '../../shared/types'

/** um login = um plano; agentes com o mesmo diretório de config compartilham */
export interface Login {
  key: string
  agent: AgentKind
  /** CLAUDE_CONFIG_DIR ou CODEX_HOME como veio do hook; '' = diretório padrão */
  configDir: string
  accountIds: string[]
}

export type ReadResult =
  | { kind: 'ok'; windows: UsageWindow[]; plan: string | null }
  /** sem login do plano (sem credencial, Keychain negado, arquivo ausente) */
  | { kind: 'no-token' }
  /** Codex ainda sem rollout com rate_limits */
  | { kind: 'no-data' }
  | { kind: 'expired' }
  /** 429, 5xx ou rede: tentar de novo mais tarde */
  | { kind: 'retry'; reason: string }
  /** resposta que não sabemos ler (endpoint mudou) */
  | { kind: 'bad-format'; reason: string }
