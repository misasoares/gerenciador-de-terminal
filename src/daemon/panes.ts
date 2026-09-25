import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import type { Account, ClaudeSession, HookPayload } from '../shared/types'
import { buildCommand, detectAccount } from './accounts'
import { cwdOf, findClaude, foregroundOf, snapshotProcs } from './platform/procs'
import type { ProjectRegistry } from './projects'
import { PtyHost } from './pty-host'
import { reduceSession } from './session'
import { readTitle } from './title'

export interface PaneRecord {
  id: string
  seq: number
  cwd: string
  alive: boolean
  exitCode: number | null
  launchedAccountId: string | null
  accountId: string | null
  configDir: string | null
  claudeArgv: string | null
  claude: ClaudeSession | null
  missingPolls: number
  projectPath: string | null
  worktreePath: string | null
}

export interface CreatePane {
  paneId?: string
  cwd: string
  accountId: string | null
  resumeSessionId?: string
  cols: number
  rows: number
}

export interface PaneManagerDeps {
  accounts(): Account[]
  registry: ProjectRegistry
  socketPath: string
  shell: string
  shellArgs: string[]
  baseEnv: Record<string, string>
  fallbackCwd: string
  onData(id: string, data: string): void
  onChange(): void
  onGitHint(worktreePath: string): void
}

const DROP_ENV = new Set(['ELECTRON_RUN_AS_NODE', 'CLAUDECODE', 'CLAUDE_CONFIG_DIR'])

export function buildPaneEnv(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || DROP_ENV.has(k) || k.startsWith('GT_') || k.startsWith('CLAUDE_CODE_')) continue
    env[k] = v
  }
  if (!env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = 'en_US.UTF-8'
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'gerenciador-terminal'
  return env
}

const GIT_HINT_EVENTS = new Set(['PostToolUse', 'Stop', 'CwdChanged'])
const TITLE_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop'])

export class PaneManager {
  readonly host: PtyHost
  private recs = new Map<string, PaneRecord>()
  private seq = 0

  constructor(private d: PaneManagerDeps) {
    this.host = new PtyHost({
      data: (id, data) => d.onData(id, data),
      exit: (id, code) => {
        const r = this.recs.get(id)
        if (!r) return
        r.alive = false
        r.exitCode = code
        r.claude = null
        d.onChange()
      },
    })
  }

  records(): PaneRecord[] {
    return [...this.recs.values()]
  }

  get(id: string): PaneRecord | undefined {
    return this.recs.get(id)
  }

  create(o: CreatePane): PaneRecord {
    const id = o.paneId ?? randomUUID()
    const existing = this.recs.get(id)
    if (existing?.alive) throw new Error(`painel ${id} já está ativo`)
    const accounts = this.d.accounts()
    let account = o.accountId ? accounts.find((a) => a.id === o.accountId) : undefined
    if (o.accountId && !account) throw new Error(`conta desconhecida: ${o.accountId}`)
    if (!account && o.resumeSessionId) account = accounts.find((a) => a.isDefault)
    const command = account ? buildCommand(account, o.resumeSessionId) : null
    const cwd = fs.existsSync(o.cwd) ? o.cwd : this.d.fallbackCwd
    const env = { ...this.d.baseEnv, GT_PANE_ID: id, GT_SOCKET: this.d.socketPath }
    this.host.spawn({ id, shell: this.d.shell, args: this.d.shellArgs, cwd, cols: o.cols, rows: o.rows, env })
    const rec: PaneRecord = {
      id,
      seq: existing?.seq ?? ++this.seq,
      cwd,
      alive: true,
      exitCode: null,
      launchedAccountId: account?.id ?? null,
      accountId: account?.id ?? null,
      configDir: null,
      claudeArgv: null,
      claude: null,
      missingPolls: 0,
      projectPath: null,
      worktreePath: null,
    }
    this.recs.set(id, rec)
    if (command) this.host.write(id, command + '\r')
    void this.relocate(rec)
    this.d.onChange()
    return rec
  }

  write(id: string, data: string): void {
    this.host.write(id, data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.host.resize(id, cols, rows)
  }

  kill(id: string): void {
    this.host.kill(id)
  }

  forget(id: string): void {
    const r = this.recs.get(id)
    if (!r) return
    if (r.alive) this.host.kill(id)
    this.recs.delete(id)
    this.d.onChange()
  }

  async applyHook(paneId: string, configDir: string | null, p: HookPayload): Promise<void> {
    const rec = this.recs.get(paneId)
    if (!rec || !rec.alive) return
    const hadSession = rec.claude !== null
    rec.configDir = configDir
    rec.claude = reduceSession(rec.claude, p)
    rec.missingPolls = 0
    if (!rec.claude) {
      rec.launchedAccountId = null
      rec.accountId = null
    } else if (!hadSession && !rec.launchedAccountId) {
      rec.accountId = detectAccount(this.d.accounts(), configDir, rec.claudeArgv)
    }
    this.d.onChange()

    if (p.cwd && p.cwd !== rec.cwd) {
      rec.cwd = p.cwd
      await this.relocate(rec)
    }
    const ev = p.hook_event_name
    if (rec.worktreePath && GIT_HINT_EVENTS.has(ev)) this.d.onGitHint(rec.worktreePath)
    if (rec.claude?.transcriptPath && TITLE_EVENTS.has(ev)) {
      const sessionId = rec.claude.sessionId
      const title = await readTitle(rec.claude.transcriptPath)
      if (rec.claude && rec.claude.sessionId === sessionId && title !== rec.claude.title) {
        rec.claude = { ...rec.claude, title }
        this.d.onChange()
      }
    }
  }

  async poll(): Promise<void> {
    const live = this.records().filter((r) => r.alive)
    if (live.length === 0) return
    const procs = await snapshotProcs()
    const want = new Map<number, PaneRecord>()
    let changed = false
    for (const rec of live) {
      const pid = this.host.pid(rec.id)
      if (!pid) continue
      const claudeProc = findClaude(procs, pid)
      const argv = claudeProc?.args ?? null
      if (argv !== rec.claudeArgv) {
        rec.claudeArgv = argv
        if (rec.claude && argv && !rec.launchedAccountId) {
          rec.accountId = detectAccount(this.d.accounts(), rec.configDir, argv)
          changed = true
        }
      }
      if (rec.claude && !claudeProc) {
        rec.missingPolls++
        if (rec.missingPolls >= 2) {
          rec.claude = null
          rec.launchedAccountId = null
          rec.accountId = null
          changed = true
        }
      }
      if (!rec.claude) want.set(foregroundOf(procs, pid)?.pid ?? pid, rec)
    }
    if (changed) this.d.onChange()
    if (want.size === 0) return
    const cwds = await cwdOf([...want.keys()])
    for (const [pid, rec] of want) {
      const cwd = cwds.get(pid)
      if (cwd && cwd !== rec.cwd && !rec.claude) {
        rec.cwd = cwd
        await this.relocate(rec)
      }
    }
  }

  async relocateAll(): Promise<void> {
    await Promise.all(this.records().map((r) => this.relocate(r)))
  }

  private async relocate(rec: PaneRecord): Promise<void> {
    const cwd = rec.cwd
    const loc = await this.d.registry.locate(cwd)
    if (rec.cwd !== cwd) return // mudou de novo enquanto resolvia
    const projectPath = loc?.projectPath ?? null
    const worktreePath = loc?.worktreePath ?? null
    if (projectPath === rec.projectPath && worktreePath === rec.worktreePath) return
    rec.projectPath = projectPath
    rec.worktreePath = worktreePath
    this.d.onChange()
  }
}
