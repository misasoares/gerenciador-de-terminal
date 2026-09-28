import type { TerminalSettings } from './settings'
export type { TerminalSettings } from './settings'

export type SessionStatus = 'working' | 'needs-you' | 'your-turn' | 'idle'

export interface ClaudeSession {
  sessionId: string
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
}

export type LayoutNode =
  | { type: 'leaf'; paneId: string }
  | { type: 'split'; dir: 'row' | 'column'; children: LayoutNode[]; sizes: number[] }

export interface Tab {
  id: string
  name: string
  root: LayoutNode | null
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
