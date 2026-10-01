import fs from 'node:fs'
import path from 'node:path'
import type { Account, AgentKind, Layout, ProjectConfig, ResumeEntry, FilePaneMeta } from '../shared/types'
import { migrateAccounts } from './accounts'
import { DEFAULT_SETTINGS, normalizeSettings, type TerminalSettings } from '../shared/settings'

export interface PersistedPane {
  id: string
  cwd: string
  accountId: string | null
  sessionId: string | null
  agent?: AgentKind
  transcriptPath?: string | null
}

export interface Persisted {
  version: 1
  projects: ProjectConfig[]
  layout: Layout
  accounts: Account[]
  panes: PersistedPane[]
  resumable: ResumeEntry[]
  fetchIntervalMin: number
  paneMeta: Record<string, { name: string | null; color: string | null }>
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
    return {
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
    }
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
