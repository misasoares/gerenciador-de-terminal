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

/** o que entra no grupo da equipe além das mensagens */
export type TeamEventKind = 'contratou' | 'demitiu' | 'terminou' | 'permissao' | 'pergunta' | 'travou' | 'saiu' | 'interrompeu'

export type TeamFeedItem =
  | {
      kind: 'msg'
      id: string
      at: number
      fromName: string
      toId: string
      toName: string
      body: string
      interrupt: boolean
      byUser: boolean
      via: 'app' | 'nativo'
      /** null em via 'nativo' (o Claude entrega sozinho) */
      state: 'na-fila' | 'entregue' | 'falhou' | null
      error: string | null
    }
  | {
      kind: 'event'
      id: string
      at: number
      paneId: string | null
      name: string
      event: TeamEventKind
      /** contratou: CLI do contratado; interrompeu: quem interrompeu; travou: motivo, se houver */
      detail: string | null
      /** permissao/pergunta: o membro ainda está nesse mesmo needs-you */
      open: boolean
    }

export interface TeamMember {
  id: string
  name: string
  cli: string
  status: SessionStatus | null
  leader: boolean
}

export interface TeamFeedView {
  leaderId: string
  leaderName: string
  /** líder vivo e ainda marcado como líder: dá para escrever */
  active: boolean
  members: TeamMember[]
  items: TeamFeedItem[]
}

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
  /** worktree da pasta do shell (worktreePath é a efetiva: a deduzida pela escrita do agente, se houver) */
  shellWorktreePath?: string | null
  /** worktreePath veio da dedução pelas escritas do agente */
  worktreeInferred?: boolean
  name: string | null
  color: string | null
  /** pode contratar sessões (👑) */
  leader: boolean
  /** líder que criou esta sessão pelo MCP */
  createdBy: string | null
  /** processo Codex rodando há um tempo sem mandar hooks (não aprovados no /hooks) */
  agentHooksMissing: boolean
  /** agente encerrado por ociosidade (💤); ausente/null = não */
  hibernated?: { since: number; title: string | null } | null
  /** comando de retomada digitado, esperando o agente subir */
  waking?: boolean
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
  /** espaço de trabalho de origem (só informativo) */
  workspaceId?: string
}

/** espaço de trabalho: uma janela com seus próprios projetos, abas e sessões */
export interface Workspace {
  id: string
  name: string
  /** estava aberto quando o app fechou */
  open: boolean
  /** ordem da sidebar; o cadastro (cor, conta) fica em projects da raiz */
  projectPaths: string[]
  layout: Layout
  resumable: ResumeEntry[]
  /** painéis flutuando agora (janela própria) */
  floating: string[]
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** preferências de janela flutuante, lembradas por painel */
export interface FloatPrefs {
  bounds: Bounds | null
  /** por cima de tudo (📌) */
  onTop: boolean
  /** em todas as mesas (🌐) */
  allDesks: boolean
  /** opacidade do fundo (◐), de 0 a 1: no mac sobre o vidro (o texto fica inteiro); no linux, da janela */
  opacity: number
}

export type FloatSpec = { paneId: string } & FloatPrefs

export const DEFAULT_FLOAT: FloatPrefs = { bounds: null, onTop: true, allDesks: false, opacity: 1 }


export interface WorkspaceSummary {
  id: string
  name: string
  open: boolean
  /** sessões vivas */
  sessions: number
  /** sessões vivas esperando você (🟡/🔵): o badge do Dock soma todos os espaços */
  attention: number
  /** abas com sessões vivas, na ordem do layout (navegar para outra janela direto na sessão) */
  tabs: { id: string; name: string; panes: WorkspacePane[] }[]
  /** sessões vivas fora de qualquer aba */
  hidden: WorkspacePane[]
  /** flutuantes do espaço, com as preferências (o processo principal sincroniza as janelas por aqui) */
  floating: FloatSpec[]
}

/** sessão no resumo de um espaço; status null = terminal sem agente */
export interface WorkspacePane {
  id: string
  label: string
  status: SessionStatus | null
}

export interface AppState {
  protocolVersion: number
  /** espaço desta conexão */
  workspaceId: string
  workspaces: WorkspaceSummary[]
  /** painéis flutuando neste espaço */
  floating: string[]
  /** perguntar ao fechar a janela com sessões vivas */
  askOnCloseWindow: boolean
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
  /** painéis de arquivo abertos (id file:<uuid> → caminho e modo) */
  filePanes: Record<string, FilePaneMeta>
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

export interface FilePaneMeta {
  path: string
  mode: 'view' | 'edit'
}

export type MachineLevel = 'ok' | 'warn' | 'bad'
/** pressão de memória do sistema; null = indisponível (Linux sem PSI) */
export type MemPressure = 'normal' | 'alerta' | 'critica' | null

/** leitura da máquina mandada às janelas pela mensagem 'machine' (fora do AppState) */
export interface MachineView {
  /** 0–100, leitura atual */
  cpu: number
  /** média do último minuto (usada no nível) */
  cpu1m: number
  /** bytes */
  ram: { used: number; total: number }
  /** bytes; total 0 = sem swap */
  swap: { used: number; total: number }
  pressure: MemPressure
  level: MachineLevel
  /** critérios que dispararam, ex.: ['swap 18,2 GB', 'pressão crítica'] */
  reasons: string[]
  /** ms epoch da última leitura boa */
  at: number
  /** a última leitura falhou */
  stale: boolean
}

export interface MachineGroup {
  key: 'sessoes' | 'colima' | 'emulador' | 'navegadores'
  label: string
  count: number
  rss: number
  cpu: number
  paneIds?: string[]
}

export interface MachineProc {
  pid: number
  name: string
  rss: number
  cpu: number
  etime: string
}

export interface MachineDetail {
  groups: MachineGroup[]
  top: MachineProc[]
  perPane: Record<string, { rss: number; cpu: number }>
}
