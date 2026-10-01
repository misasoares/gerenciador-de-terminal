import type { TerminalSettings } from './settings'
export type { TerminalSettings } from './settings'

export type SessionStatus = 'working' | 'needs-you' | 'your-turn' | 'idle'

export interface ClaudeSession {
  sessionId: string
  /** qual CLI gerou esta sessão */
  agent: AgentKind
  status: SessionStatus
  /** epoch ms da última mudança de status */
  statusSince: number
  title: string | null
  transcriptPath: string | null
}

export type AgentKind = 'claude' | 'codex'

export interface Account {
  id: string
  label: string
  /** comando digitado no shell, ex.: "claude-mslabs" */
  command: string
  color: string
  /** qual CLI este agente abre: define hooks, detecção e tipo mostrado na interface */
  agent: AgentKind
  /** trechos de CLAUDE_CONFIG_DIR que identificam a conta */
  configDirMatch: string[]
  /** conta usada quando CLAUDE_CONFIG_DIR não está definido */
  isDefault: boolean
  /** trecho do argumento --settings que desempata contas com o mesmo perfil */
  settingsMatch: string | null
  /** projetos dentro deste prefixo (com ~) sugerem esta conta */
  pathPrefix: string | null
  /** mostra o uso do plano deste agente; ausente = true. false para gateway ou chave de API */
  planUsage?: boolean
}

export interface GitStatus {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  changed: number
  error: string | null
}

export interface WorktreeInfo {
  path: string
  head: string | null
  branch: string | null
  isMain: boolean
  locked: boolean
  prunable: boolean
}

export interface WorktreeView extends WorktreeInfo {
  git: GitStatus | null
}

export interface ProjectConfig {
  /** caminho da worktree principal; também é o id do projeto */
  path: string
  name: string
  defaultAccountId: string | null
  /** cor do projeto (#rrggbb); ausente/null = sem cor */
  color?: string | null
}

export interface ProjectView extends ProjectConfig {
  worktrees: WorktreeView[]
  error: string | null
  fetchError: string | null
  conflicts: ConflictReport | null
}

export interface PaneView {
  id: string
  seq: number
  cwd: string
  alive: boolean
  exitCode: number | null
  accountId: string | null
  claude: ClaudeSession | null
  projectPath: string | null
  worktreePath: string | null
  name: string | null
  color: string | null
  /** processo Codex rodando há um tempo sem mandar hooks (não aprovados no /hooks) */
  agentHooksMissing: boolean
}

export type LayoutNode =
  | { type: 'leaf'; paneId: string }
  | { type: 'split'; dir: 'row' | 'column'; children: LayoutNode[]; sizes: number[] }

export interface Tab {
  id: string
  name: string
  root: LayoutNode | null
  /** cor da aba (#rrggbb); ausente/null = sem cor */
  color?: string | null
}

export interface Layout {
  tabs: Tab[]
  activeTabId: string | null
}

export interface ResumeEntry {
  paneId: string
  cwd: string
  accountId: string | null
  sessionId: string | null
  /** ausente em entradas antigas = claude */
  agent?: AgentKind
  /** caminho do .jsonl visto no hook (Claude); ajuda a localizar a conversa ao retomar */
  transcriptPath?: string | null
}

export interface AppState {
  protocolVersion: number
  userHome: string
  projects: ProjectView[]
  panes: PaneView[]
  layout: Layout
  accounts: Account[]
  resumable: ResumeEntry[]
  /** arquivos settings.json sem os hooks do app */
  hookWarnings: string[]
  settings: TerminalSettings
  usage: UsageView[]
  /** por agente: por que ainda não há uso para mostrar */
  usageHints: Record<string, string>
}

export interface HookPayload {
  hook_event_name: string
  session_id: string
  cwd: string
  transcript_path?: string
  tool_name?: string
  notification_type?: string
  source?: string
  [key: string]: unknown
}

export interface RemoveCheck {
  path: string
  branch: string | null
  isMain: boolean
  hasOpenSession: boolean
  dirtyFiles: string[]
  unpushedCommits: string[]
  /** ignorados pelo git que seriam apagados (sem node_modules/dist/caches) */
  ignoredFiles: string[]
}

export interface ConflictReport {
  analyzedAt: number
  running: boolean
  /** quantos merge-tree foram executados */
  comparisons: number
  /** toda worktree não principal analisada; files vazio = sem conflito com a main */
  vsMain: { worktreePath: string; files: string[]; dirty: boolean }[]
  /** só os pares em conflito */
  pairs: { a: string; b: string; files: string[]; dirty: boolean }[]
  cleanPairs: number
  errors: { worktreePath: string; message: string }[]
}

export interface UsageWindow {
  kind: '5h' | 'week'
  /** 0–100 */
  percent: number
  /** epoch ms; null = desconhecido */
  resetsAt: number | null
}

export type UsageStatus = 'ok' | 'stale' | 'expired' | 'unavailable'

/** uso de um login (agentes com o mesmo CLAUDE_CONFIG_DIR/CODEX_HOME compartilham o plano) */
export interface UsageView {
  loginKey: string
  agent: AgentKind
  /** agentes com planUsage deste login, na ordem da lista */
  accountIds: string[]
  windows: UsageWindow[]
  plan: string | null
  /** última leitura bem-sucedida (epoch ms) */
  readAt: number | null
  status: UsageStatus
}

export interface ConversationInfo {
  agent: AgentKind
  sessionId: string
  /** pasta de onde a conversa é retomada (a pasta em que o arquivo foi gravado) */
  cwd: string
  title: string
  branch: string | null
  lastActivity: number
  messages: number
  /** contas que podem retomar, na ordem da lista de agentes; [] = conta não configurada */
  accountIds: string[]
  /** painel vivo com esta sessão */
  openPaneId: string | null
}
