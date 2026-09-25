import fs from 'node:fs'
import path from 'node:path'
import type { Account, Layout, ProjectConfig, ResumeEntry } from '../shared/types'
import { DEFAULT_ACCOUNTS } from './accounts'

export interface PersistedPane {
  id: string
  cwd: string
  accountId: string | null
  sessionId: string | null
}

export interface Persisted {
  version: 1
  projects: ProjectConfig[]
  layout: Layout
  accounts: Account[]
  panes: PersistedPane[]
  resumable: ResumeEntry[]
  fetchIntervalMin: number
}

export function defaultPersisted(): Persisted {
  return {
    version: 1,
    projects: [],
    layout: { tabs: [], activeTabId: null },
    accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a, configDirMatch: [...a.configDirMatch] })),
    panes: [],
    resumable: [],
    fetchIntervalMin: 5,
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
      accounts: parsed.accounts?.length ? parsed.accounts : base.accounts,
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
