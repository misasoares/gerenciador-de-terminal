import type { AgentKind } from '../shared/types'
import { shq } from './shell-quote'

export interface McpServerSpec {
  /** arquivo mcp.json do Claude */
  configPath: string
  /** binário e argumentos que sobem o gt-mcp (usados pelo Codex, que não lê o arquivo) */
  command: string
  args: string[]
}

/** o que muda entre uma CLI e outra na hora de montar e conduzir a sessão */
export interface AgentProfile {
  kind: AgentKind
  label: string
  /** true só no Claude: fala SendMessage nativo */
  nativeTeam: boolean
  interruptKey: string
  /** opções de linha de comando que dão o MCP a esta sessão */
  mcpArgs(mcp: McpServerSpec, paneId: string, socketPath: string): string
  modelArgs(model: string): string
}

/** string TOML: aspas duplas com escape JSON */
const toml = (s: string): string => JSON.stringify(s)

const claude: AgentProfile = {
  kind: 'claude',
  label: 'Claude',
  nativeTeam: true,
  interruptKey: '\x1b',
  mcpArgs: (mcp) => `--mcp-config ${shq(mcp.configPath)}`,
  modelArgs: (model) => `--model ${shq(model)}`,
}

const codex: AgentProfile = {
  kind: 'codex',
  label: 'Codex',
  nativeTeam: false,
  interruptKey: '\x1b',
  // o Codex não repassa o ambiente do painel ao servidor MCP: GT_PANE_ID e GT_SOCKET vão literais no env do servidor
  mcpArgs: (mcp, paneId, socketPath) => {
    const env = `{ELECTRON_RUN_AS_NODE="1",GT_PANE_ID=${toml(paneId)},GT_SOCKET=${toml(socketPath)}}`
    return [
      `-c ${shq(`mcp_servers.gerenciador.command=${toml(mcp.command)}`)}`,
      `-c ${shq(`mcp_servers.gerenciador.args=${JSON.stringify(mcp.args)}`)}`,
      `-c ${shq(`mcp_servers.gerenciador.env=${env}`)}`,
    ].join(' ')
  },
  modelArgs: (model) => `-m ${shq(model)}`,
}

export function profileOf(kind: AgentKind): AgentProfile {
  return kind === 'codex' ? codex : claude
}
