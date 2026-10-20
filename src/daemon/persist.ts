import fs from 'node:fs'
import path from 'node:path'
import type { Account, AgentKind, Layout, ProjectConfig, ResumeEntry, FilePaneMeta, FloatPrefs, Workspace } from '../shared/types'
import { migrateAccounts } from './accounts'
import type { TeamMessage } from './team/mailbox'
import type { TeamLogEntry } from './team/log'
import { DEFAULT_SETTINGS, normalizeSettings, type TerminalSettings } from '../shared/settings'

export interface PersistedPane {
  id: string
  cwd: string
  accountId: string | null
  sessionId: string | null
  agent?: AgentKind
  transcriptPath?: string | null
  /** ausente em estado antigo = 'principal' */
  workspaceId?: string
}

export interface PaneMetaEntry {
  name: string | null
  color: string | null
  /** pode contratar sessões pelo MCP (marcado pelo usuário) */
  leader?: boolean
  /** paneId do líder que criou esta sessão pelo MCP */
  createdBy?: string
  /** preferências de janela flutuante (lembradas depois de encaixar/esconder) */
  float?: FloatPrefs
}

export interface Persisted {
  version: 1
  projects: ProjectConfig[]
  /** legado: o daemon usa workspaces[].layout; a raiz recebe o do 'principal' para quem fizer downgrade */
  layout: Layout
  accounts: Account[]
  panes: PersistedPane[]
  resumable: ResumeEntry[]
  fetchIntervalMin: number
  paneMeta: Record<string, PaneMetaEntry>
  settings: TerminalSettings
  /** último CLAUDE_CONFIG_DIR/CODEX_HOME visto por agente ('' = diretório padrão) */
  loginDirs: Record<string, string>
  /** chaves de aviso de uso já disparadas (loginKey|janela|resetsAt|limiar) */
  usageNotified: string[]
  /** CLAUDE_CONFIG_DIR / CODEX_HOME vistos em hooks (perfis onde procurar conversas) */
  claudeProfiles: string[]
  codexHomes: string[]
  /** painéis de arquivo (id file:<uuid>) */
  filePanes: Record<string, FilePaneMeta>
  workspaces: Workspace[]
  /** perguntar ao fechar a janela de um espaço com sessões vivas */
  askOnCloseWindow: boolean
  /** fila de mensagens da equipe (entregues e falhas recentes também) */
  mailbox: TeamMessage[]
  /** eventos e SendMessage do grupo da equipe */
  teamLog: TeamLogEntry[]
}

export function defaultPersisted(): Persisted {
  return {
    version: 1,
    projects: [],
    layout: { tabs: [], activeTabId: null },
    accounts: [],
    panes: [],
    resumable: [],
    fetchIntervalMin: 5,
    paneMeta: {},
    settings: { ...DEFAULT_SETTINGS },
    loginDirs: {},
    usageNotified: [],
    claudeProfiles: [],
    codexHomes: [],
    filePanes: {},
    workspaces: [{ id: 'principal', name: 'Principal', open: true, projectPaths: [], layout: { tabs: [], activeTabId: null }, resumable: [], floating: [] }],
    askOnCloseWindow: true,
    mailbox: [],
    teamLog: [],
  }
}

/** estado sem espaços vira o espaço 'principal' com tudo o que havia (idempotente) */
export function migrateWorkspaces(p: Persisted): Persisted {
  if (Array.isArray(p.workspaces) && p.workspaces.length > 0) return p
  return {
    ...p,
    workspaces: [{ id: 'principal', name: 'Principal', open: true, projectPaths: p.projects.map((c) => c.path), layout: p.layout, resumable: p.resumable, floating: [] }],
  }
}

export function loadPersisted(file: string): Persisted {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return defaultPersisted()
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Persisted>
    const base = defaultPersisted()
    return migrateWorkspaces({
      ...base,
      ...parsed,
      version: 1,
      accounts: Array.isArray(parsed.accounts) ? migrateAccounts(parsed.accounts) : base.accounts,
      paneMeta: parsed.paneMeta ?? {},
      settings: normalizeSettings(parsed.settings),
      loginDirs: parsed.loginDirs && typeof parsed.loginDirs === 'object' ? parsed.loginDirs : {},
      usageNotified: Array.isArray(parsed.usageNotified) ? parsed.usageNotified.filter((k) => typeof k === 'string') : [],
      claudeProfiles: Array.isArray(parsed.claudeProfiles) ? parsed.claudeProfiles.filter((x) => typeof x === 'string') : [],
      codexHomes: Array.isArray(parsed.codexHomes) ? parsed.codexHomes.filter((x) => typeof x === 'string') : [],
      filePanes: parsed.filePanes && typeof parsed.filePanes === 'object' ? parsed.filePanes : {},
      workspaces: (Array.isArray(parsed.workspaces) ? parsed.workspaces : []).map((w) => ({ ...w, floating: Array.isArray(w.floating) ? w.floating.filter((x) => typeof x === 'string') : [] })),
      askOnCloseWindow: parsed.askOnCloseWindow !== false,
      mailbox: Array.isArray(parsed.mailbox)
        ? parsed.mailbox.filter((m) => !!m && typeof m.id === 'string' && typeof m.to === 'string').map((m) => ({ ...m, team: m.team ?? null, body: m.body ?? m.text }))
        : [],
      teamLog: Array.isArray(parsed.teamLog) ? parsed.teamLog.filter((e) => !!e && typeof e.id === 'string' && typeof e.team === 'string') : [],
    })
  } catch {
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`)
    return defaultPersisted()
  }
}

export function savePersisted(file: string, data: Persisted): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}
