import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import type { Account, AgentKind, ClaudeSession, HookPayload } from '../shared/types'
import { buildCommand, detectAccount, resumeAccount } from './accounts'
import type { McpServerSpec } from './agent-profiles'
import { cwdOf, findAgent, foregroundOf, snapshotProcs } from './platform/procs'
import type { ProjectRegistry } from './projects'
import { PtyHost } from './pty-host'
import { markSeen, reduceSession } from './session'
import { EMPTY_INFERENCE, nextInference, worktreeOf, writtenPaths, type InferenceState } from './agent-worktree'
import { createTitleReader } from './title'
import type { Hibernation } from './hibernator'

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
  /** dedução da worktree em que o agente escreve (quando difere da do shell) */
  inference: InferenceState
  /** projeto da worktree deduzida */
  inferredProjectPath: string | null
  /** quando o poller viu o processo codex pela 1ª vez (null = sem codex) */
  agentProcSince: number | null
  lastHookAt: number
  agentHooksMissing: boolean
  /** espaço de trabalho dono da sessão */
  workspaceId: string
  /** agente encerrado por ociosidade; o shell segue vivo (null = não hibernada) */
  hibernated: Hibernation | null
  /** comando de retomada digitado, esperando o SessionStart */
  waking: { since: number } | null
  /** não tenta hibernar antes disso (falha anterior) */
  hibernateCooldownUntil: number
}

export interface CreatePane {
  paneId?: string
  workspaceId?: string
  cwd: string
  accountId: string | null
  resumeSessionId?: string
  resumeAgent?: AgentKind
  /** -n do Claude (sessão criada pelo líder) */
  agentName?: string
  /** prompt inicial (arquivo) */
  promptFile?: string
  /** modelo da sessão (opção de modelo da CLI) */
  model?: string
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
  codexHookGraceMs: number
  /** MCP que toda sessão recebe (null = sem MCP) */
  mcp: McpServerSpec | null
}

// o daemon pode ter nascido dentro de uma sessão do Claude, do VS Code ou do npm: nada disso vai para os terminais
const DROP_ENV = new Set(['AI_AGENT', 'GIT_EDITOR', 'PAGER', 'NODE_OPTIONS'])
const DROP_PREFIXES = ['CLAUDE', 'GT_', 'ELECTRON_', 'VSCODE_', 'npm_']

export function buildPaneEnv(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || DROP_ENV.has(k) || DROP_PREFIXES.some((p) => k.startsWith(p))) continue
    env[k] = v
  }
  if (!env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = 'en_US.UTF-8'
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'gerenciador-terminal'
  return env
}

/** leituras seguidas sem o processo claude; snapshot vazio (ps falhou) não conta */
export function nextMissingPolls(prev: number, o: { found: boolean; snapshotEmpty: boolean }): number {
  if (o.snapshotEmpty) return prev
  return o.found ? 0 : prev + 1
}

const GIT_HINT_EVENTS = new Set(['PostToolUse', 'Stop', 'CwdChanged'])
const TITLE_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop'])

export class PaneManager {
  readonly host: PtyHost
  private recs = new Map<string, PaneRecord>()
  private seq = 0
  private readTitle = createTitleReader()
  private pendingCommands = new Map<string, { command: string; quiet: NodeJS.Timeout | null; max: NodeJS.Timeout }>()

  constructor(private d: PaneManagerDeps) {
    this.host = new PtyHost({
      data: (id, data) => {
        this.onPtyOutput(id)
        d.onData(id, data)
      },
      exit: (id, code) => {
        this.dropPending(id)
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
    if (!account && o.resumeSessionId) account = resumeAccount(accounts, o.resumeAgent ?? 'claude')
    const command = account ? buildCommand(account, o.resumeSessionId, { mcp: this.d.mcp, paneId: id, socketPath: this.d.socketPath, model: o.model, name: o.agentName, promptFile: o.promptFile }) : null
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
      agentProcSince: null,
      lastHookAt: 0,
      agentHooksMissing: false,
      projectPath: null,
      worktreePath: null,
      inference: EMPTY_INFERENCE,
      inferredProjectPath: null,
      workspaceId: o.workspaceId ?? existing?.workspaceId ?? 'principal',
      hibernated: null,
      waking: null,
      hibernateCooldownUntil: 0,
    }
    this.recs.set(id, rec)
    if (command) {
      // espera o shell mostrar o prompt (primeira saída + 300ms de silêncio), no máximo 5s
      this.pendingCommands.set(id, { command, quiet: null, max: setTimeout(() => this.flushCommand(id), 5000) })
    }
    void this.relocate(rec)
    this.d.onChange()
    return rec
  }

  write(id: string, data: string): void {
    // o usuário começou a digitar antes do prompt: manda o comando da conta primeiro, para não grudar
    if (this.pendingCommands.has(id)) this.flushCommand(id)
    this.host.write(id, data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.host.resize(id, cols, rows)
  }

  kill(id: string): void {
    this.host.kill(id)
  }

  /** comando da conta da sessão hibernada com --resume (mesmo MCP das sessões novas) */
  resumeCommand(paneId: string, h: Hibernation): string {
    const accounts = this.d.accounts()
    const account = (h.accountId ? accounts.find((a) => a.id === h.accountId) : undefined) ?? resumeAccount(accounts, h.agent)
    return buildCommand(account, h.sessionId, { mcp: this.d.mcp, paneId, socketPath: this.d.socketPath })
  }

  private onPtyOutput(id: string): void {
    const p = this.pendingCommands.get(id)
    if (!p) return
    if (p.quiet) clearTimeout(p.quiet)
    p.quiet = setTimeout(() => this.flushCommand(id), 300)
  }

  private flushCommand(id: string): void {
    const p = this.pendingCommands.get(id)
    if (!p) return
    this.dropPending(id)
    this.host.write(id, p.command + '\r')
  }

  private dropPending(id: string): void {
    const p = this.pendingCommands.get(id)
    if (!p) return
    this.pendingCommands.delete(id)
    if (p.quiet) clearTimeout(p.quiet)
    clearTimeout(p.max)
  }

  forget(id: string): void {
    this.dropPending(id)
    const r = this.recs.get(id)
    if (!r) return
    if (r.alive) this.host.kill(id)
    this.recs.delete(id)
    this.d.onChange()
  }

  markSeen(id: string): void {
    const r = this.recs.get(id)
    if (!r) return
    const next = markSeen(r.claude)
    if (next === r.claude) return
    r.claude = next
    this.d.onChange()
  }

  async applyHook(paneId: string, configDir: string | null, p: HookPayload, agent: AgentKind = 'claude'): Promise<void> {
    const rec = this.recs.get(paneId)
    if (!rec || !rec.alive) return
    if (agent === 'codex') rec.lastHookAt = Date.now()
    if (rec.agentHooksMissing) rec.agentHooksMissing = false
    const hadSession = rec.claude !== null
    rec.configDir = configDir
    rec.claude = reduceSession(rec.claude, p, Date.now(), agent)
    // agente subiu (retomada ou digitado na mão) ou saiu: não está mais hibernada nem acordando
    if (p.hook_event_name === 'SessionStart' || p.hook_event_name === 'SessionEnd') rec.waking = null
    if (p.hook_event_name === 'SessionStart') rec.hibernated = null
    if (p.hook_event_name === 'SessionStart' || p.hook_event_name === 'SessionEnd') this.resetInference(rec)
    rec.missingPolls = 0
    if (!rec.claude) {
      rec.launchedAccountId = null
      rec.accountId = null
    } else if (!hadSession && !rec.launchedAccountId) {
      rec.accountId = detectAccount(this.d.accounts(), agent, configDir, rec.claudeArgv)
    }
    this.d.onChange()

    // hooks de subagente (agent_id) trazem o cwd do subagente, que pode estar em outra worktree
    if (p.cwd && p.cwd !== rec.cwd && !p.agent_id) {
      rec.cwd = p.cwd
      this.resetInference(rec)
      await this.relocate(rec)
    }
    if (this.inferFromHook(rec, p)) this.d.onChange()
    const ev = p.hook_event_name
    const eff = this.effectiveWorktree(rec)
    if (eff && GIT_HINT_EVENTS.has(ev)) this.d.onGitHint(eff)
    if (agent === 'claude' && rec.claude?.transcriptPath && TITLE_EVENTS.has(ev)) {
      const sessionId = rec.claude.sessionId
      const title = await this.readTitle(rec.claude.transcriptPath)
      if (rec.claude && rec.claude.sessionId === sessionId && title !== rec.claude.title) {
        rec.claude = { ...rec.claude, title }
        this.d.onChange()
      }
    }
  }

  async poll(): Promise<void> {
    const live = this.records().filter((r) => r.alive)
    if (live.length === 0) return
    const snapAt = Date.now()
    const procs = await snapshotProcs()
    if (procs.length === 0) return // ps falhou: não dá para concluir nada
    const want = new Map<number, PaneRecord>()
    let changed = false
    for (const rec of live) {
      const pid = this.host.pid(rec.id)
      if (!pid) continue
      const found = findAgent(procs, pid)
      const claudeProc = found?.proc ?? null
      if (found?.agent === 'codex') {
        if (rec.agentProcSince === null) rec.agentProcSince = Date.now()
        // hook do Codex pode chegar antes do 1º poll que vê o processo: vale qualquer hook desde que ele sumiu
        const missing = rec.lastHookAt === 0 && Date.now() - rec.agentProcSince > this.d.codexHookGraceMs
        if (missing !== rec.agentHooksMissing) {
          rec.agentHooksMissing = missing
          changed = true
        }
      } else {
        if (rec.lastHookAt < snapAt) rec.lastHookAt = 0
      }
      if (found?.agent !== 'codex' && (rec.agentProcSince !== null || rec.agentHooksMissing)) {
        rec.agentProcSince = null
        if (rec.agentHooksMissing) {
          rec.agentHooksMissing = false
          changed = true
        }
      }
      const argv = claudeProc?.args ?? null
      if (argv !== rec.claudeArgv) {
        rec.claudeArgv = argv
        if (rec.claude && argv && !rec.launchedAccountId) {
          rec.accountId = detectAccount(this.d.accounts(), found?.agent ?? 'claude', rec.configDir, argv)
          changed = true
        }
      }
      rec.missingPolls = nextMissingPolls(rec.missingPolls, { found: claudeProc !== null, snapshotEmpty: false })
      if (rec.claude && !claudeProc) {
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
        this.resetInference(rec)
        await this.relocate(rec)
      }
    }
  }

  async relocateAll(): Promise<void> {
    await Promise.all(this.records().map((r) => this.relocate(r)))
  }

  effectiveWorktree(r: PaneRecord): string | null {
    return r.inference.inferred ?? r.worktreePath
  }

  effectiveProject(r: PaneRecord): string | null {
    return r.inference.inferred ? r.inferredProjectPath : r.projectPath
  }

  private resetInference(rec: PaneRecord): boolean {
    const had = rec.inference.inferred !== null || rec.inference.candidate !== null
    rec.inference = EMPTY_INFERENCE
    rec.inferredProjectPath = null
    return had
  }

  private allWorktrees(): { path: string; project: string }[] {
    return this.d.registry.list().flatMap((c) => this.d.registry.worktrees(c.path).filter((w) => !w.prunable).map((w) => ({ path: w.path, project: c.path })))
  }

  /** escritas do agente (PreToolUse) em outra worktree: 2 seguidas mudam a worktree efetiva */
  private inferFromHook(rec: PaneRecord, p: HookPayload): boolean {
    const paths = writtenPaths(p, rec.cwd, os.homedir())
    if (paths.length === 0) return false
    const wts = this.allWorktrees()
    const before = rec.inference.inferred
    for (const target of paths) {
      const hit = worktreeOf(target, wts.map((w) => w.path))
      if (hit) rec.inference = nextInference(rec.inference, hit, rec.worktreePath)
    }
    if (rec.inference.inferred === before) return false
    rec.inferredProjectPath = wts.find((w) => w.path === rec.inference.inferred)?.project ?? null
    return true
  }

  private async relocate(rec: PaneRecord): Promise<void> {
    // a worktree deduzida sumiu do cadastro (removida): volta para a do shell
    if (rec.inference.inferred && !this.allWorktrees().some((w) => w.path === rec.inference.inferred)) {
      this.resetInference(rec)
      this.d.onChange()
    }
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
