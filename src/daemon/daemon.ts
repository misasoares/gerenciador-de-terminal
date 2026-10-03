import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { PROTOCOL_VERSION, type ClientRequest } from '../shared/protocol'
import type { AgentKind, AppState, ConflictReport, LayoutNode, Workspace } from '../shared/types'
import { analyzeConflicts } from './conflicts'
import { normalizeSettings } from '../shared/settings'
import { BUILD_ID } from '../shared/build'
import { buildCommand, suggestAccount, validateAccounts } from './accounts'
import { GitMonitor } from './git/monitor'
import { checkTargets, CLAUDE_HOOK_EVENTS, CODEX_HOOK_EVENTS, hookCommand, hookTargets, installHooks, writeHookScript } from './hooks'
import { PaneManager, buildPaneEnv, type PaneRecord } from './panes'
import { loadPersisted, savePersisted, type Persisted } from './persist'
import { ProjectRegistry } from './projects'
import { startServer, type Conn, type RpcServer } from './server'
import { checkRemove, removeWorktree } from './worktree-remove'
import { uniqueName } from './workspaces'
import { checkName, insertBeside, pickAccount, statusName, uniqueDash } from './hire'
import { git } from './git/run'
import { UsageMonitor } from './usage/monitor'
import { ConversationIndex } from './conversations/index'
import { existing, FileWatcher, listFiles, readFile, writeFile } from './files'
import { groupLogins, missingLoginHints } from './usage/logins'
import type { Login, ReadResult } from './usage/types'

export interface DaemonOptions {
  home: string
  socketPath: string
  stateFile: string
  hookScriptPath: string
  userHome: string
  shell: string
  shellArgs: string[]
  env?: Record<string, string | undefined>
  pollMs?: number
  gitPollMs?: number
  fetchIntervalMs?: number
  conflictsDebounceMs?: number
  /** shell usado para detectar claude/codex (testes injetam um falso) */
  detectShell?: string
  /** tempo sem hooks até avisar que o Codex não aprovou o hook (padrão 20 s) */
  codexHookGraceMs?: number
  /** leitor do uso do plano; padrão inerte (testes não tocam Keychain nem rede). O main.ts passa o real */
  usageRead?: (login: Login) => Promise<ReadResult>
  usageIntervalMs?: number
  onShutdown?: () => void
  /** script do gt-mcp (padrão: ao lado do daemon.js) */
  mcpScriptPath?: string
  /** binário que roda o gt-mcp (padrão: o do app, com ELECTRON_RUN_AS_NODE) */
  nodeBinary?: string
}

export class Daemon {
  private persisted!: Persisted
  private registry!: ProjectRegistry
  private monitor!: GitMonitor
  private panes!: PaneManager
  private server: RpcServer | null = null
  private hookWarnings: string[] = []
  private broadcastTimer: NodeJS.Timeout | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private worktreeTimer: NodeJS.Timeout | null = null
  private stopping = false
  private conflicts = new Map<string, ConflictReport>()
  private conflictTimers = new Map<string, NodeJS.Timeout>()
  private conflictRerun = new Set<string>()
  private conflictCache = new Map<string, Map<string, string[]>>()
  private usage!: UsageMonitor
  private conversations!: ConversationIndex
  private fileWatcher!: FileWatcher<Conn>
  private watchedConns = new Set<Conn>()
  private logins: Login[] = []

  private constructor(private o: DaemonOptions) {}

  static async start(o: DaemonOptions): Promise<Daemon> {
    const d = new Daemon(o)
    await d.init()
    return d
  }

  /**
   * O comando registrado no settings.json global aponta SEMPRE para o script canônico do usuário,
   * independente do GT_HOME desta instância: o script é igual e lê o socket do ambiente de cada terminal,
   * então uma instância de teste não reponta os hooks de verdade.
   */
  private get canonicalHookScript(): string {
    return path.join(this.o.userHome, '.gerenciador-terminal', 'bin', 'gt-hook')
  }

  private get mcpConfigPath(): string {
    return path.join(this.o.home, 'mcp.json')
  }

  private get promptsDir(): string {
    return path.join(this.o.home, 'prompts')
  }

  private agentsInUse(): Set<AgentKind> {
    const set = new Set<AgentKind>(this.persisted.accounts.map((a) => a.agent))
    if (set.size === 0) set.add('claude') // sem agentes ainda: continua cuidando do Claude, como antes
    return set
  }

  /** espaço pelo id; desconhecido cai no 'principal' */
  private ws(id: string): Workspace {
    const all = this.persisted.workspaces
    return all.find((w) => w.id === id) ?? all.find((w) => w.id === 'principal') ?? all[0]
  }

  private refreshLogins(): void {
    this.logins = groupLogins(this.persisted.accounts, this.persisted.loginDirs)
    this.usage.setLogins(this.logins)
  }

  /** o hook revela o CLAUDE_CONFIG_DIR/CODEX_HOME do agente; Stop antecipa a leitura do uso */
  private onUsageHook(paneId: string, configDir: string, event: string): void {
    const id = this.panes.records().find((r) => r.id === paneId)?.accountId
    if (!id) return
    if (this.persisted.loginDirs[id] !== configDir) {
      this.persisted.loginDirs[id] = configDir
      this.refreshLogins()
      this.changed()
    }
    if (event === 'Stop') this.usage.poke(id)
  }

  private checkHookTargets(): string[] {
    return checkTargets(hookTargets(this.o.userHome, this.agentsInUse(), this.o.env ?? process.env), (a) => this.hookCmdFor(a))
  }

  private hookCmdFor(agent: AgentKind): string {
    return hookCommand(this.canonicalHookScript, agent)
  }

  private async init(): Promise<void> {
    writeHookScript(this.o.hookScriptPath)
    if (this.canonicalHookScript !== this.o.hookScriptPath) writeHookScript(this.canonicalHookScript)
    // config do MCP regravada a cada início: no AppImage o caminho de montagem muda
    fs.mkdirSync(this.o.home, { recursive: true })
    fs.writeFileSync(
      this.mcpConfigPath,
      JSON.stringify(
        { mcpServers: { 'gerenciador-terminal': { command: this.o.nodeBinary ?? process.execPath, args: [this.o.mcpScriptPath ?? path.join(__dirname, 'gt-mcp.js')], env: { ELECTRON_RUN_AS_NODE: '1' } } } },
        null,
        2,
      ),
    )
    // prompts iniciais de sessões do daemon anterior: nenhuma está viva agora
    fs.rmSync(this.promptsDir, { recursive: true, force: true })
    const p = loadPersisted(this.o.stateFile)
    this.persisted = p
    // o que estava vivo no daemon anterior vira retomável no seu espaço (mesmo id → o layout continua valendo)
    for (const pane of p.panes) {
      const w = this.ws(pane.workspaceId ?? 'principal')
      w.resumable = w.resumable.filter((r) => r.paneId !== pane.id)
      w.resumable.push({ paneId: pane.id, cwd: pane.cwd, accountId: pane.accountId, sessionId: pane.sessionId, agent: pane.agent ?? 'claude', transcriptPath: pane.transcriptPath ?? null })
    }
    p.panes = []
    this.fileWatcher = new FileWatcher<Conn>((path, mtimeMs, subs) => {
      for (const c of subs) c.send({ t: 'file.changed', path, mtimeMs })
    })
    this.conversations = new ConversationIndex({
      userHome: this.o.userHome,
      claudeProfiles: () => this.persisted.claudeProfiles,
      codexHomes: () => this.persisted.codexHomes,
      accounts: () => this.persisted.accounts,
      loginDirs: () => this.persisted.loginDirs,
      openSessions: () => new Map(this.panes.records().filter((r) => r.alive && r.claude).map((r) => [r.claude!.sessionId, r.id])),
      knownPaths: () => this.registry.allWorktreePaths(),
    })
    this.usage = new UsageMonitor({
      read: this.o.usageRead ?? (async () => ({ kind: 'no-token' })),
      onChange: () => this.changed(false),
      onAlert: (text, notified) => {
        const apps = [...(this.server?.conns ?? [])].filter((c) => c.role === 'app')
        for (const c of apps) c.send({ t: 'usage.alert', text })
        if (apps.length === 0) return false
        this.persisted.usageNotified = notified
        this.changed()
        return true
      },
      labelOf: (id) => this.persisted.accounts.find((a) => a.id === id)?.label ?? id,
      notified: p.usageNotified,
      log: (m) => console.error(m),
      intervalMs: this.o.usageIntervalMs,
    })

    this.monitor = new GitMonitor((p) => {
      if (p) this.onWorktreeChanged(p)
      this.changed(false)
    }, { pollMs: this.o.gitPollMs ?? 10_000, debounceMs: 300 })
    // worktrees criadas/removidas: os painéis recalculam onde estão (e desfazem dedução de worktree que sumiu)
    this.registry = new ProjectRegistry(p.projects, () => {
      this.changed()
      void this.panes?.relocateAll()
    })
    this.panes = new PaneManager({
      accounts: () => this.persisted.accounts,
      registry: this.registry,
      socketPath: this.o.socketPath,
      shell: this.o.shell,
      shellArgs: this.o.shellArgs,
      baseEnv: buildPaneEnv(this.o.env ?? process.env),
      fallbackCwd: this.o.userHome,
      onData: (id, data) => {
        for (const c of this.server?.conns ?? []) {
          const seq = c.subscriptions.get(id)
          if (seq !== undefined) c.send({ t: 'pane.data', paneId: id, data, seq })
        }
      },
      onChange: () => this.changed(),
      codexHookGraceMs: this.o.codexHookGraceMs ?? 20_000,
      mcpConfigPath: this.mcpConfigPath,
      onGitHint: (wt) => {
        this.monitor.refresh(wt)
        this.onWorktreeChanged(wt) // pega edição que não muda a contagem de alterados
      },
    })
    this.hookWarnings = this.checkHookTargets()
    this.server = await startServer(this.o.socketPath, (req, conn) => this.handle(req, conn))
    this.refreshLogins()
    await this.registry.refreshAll()
    this.monitor.startFetch(() => this.registry.list().map((c) => c.path), this.o.fetchIntervalMs ?? p.fetchIntervalMin * 60_000)
    // worktrees criadas/removidas por fora (Claude, subagente, git na mão) entram e saem da lista
    this.worktreeTimer = setInterval(() => {
      this.registry.refreshAll().catch((e) => console.error('refresh de worktrees falhou', e))
    }, this.o.gitPollMs ?? 10_000)
    this.pollTimer = setInterval(() => {
      this.panes.poll().catch((e) => console.error('poll falhou', e))
    }, this.o.pollMs ?? 2000)
    this.save()
  }

  async stop(killPtys: boolean): Promise<void> {
    if (this.stopping) return
    this.save() // antes de matar: os painéis vivos viram retomáveis no próximo início
    this.stopping = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.worktreeTimer) clearInterval(this.worktreeTimer)
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer)
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.monitor.stop()
    this.usage.stop()
    this.fileWatcher.stop()
    for (const t of this.conflictTimers.values()) clearTimeout(t)
    if (killPtys) this.panes.host.killAll()
    await this.server?.close()
  }

  private changed(persist = true): void {
    if (this.stopping) return
    this.monitor.track(this.registry.allWorktreePaths())
    if (!this.broadcastTimer) {
      this.broadcastTimer = setTimeout(() => {
        this.broadcastTimer = null
        const cache = new Map<string, AppState>()
        for (const c of this.server?.conns ?? []) {
          if (c.role !== 'app') continue
          let state = cache.get(c.workspaceId)
          if (!state) cache.set(c.workspaceId, (state = this.buildState(c.workspaceId)))
          c.send({ t: 'state', state })
        }
      }, 30)
    }
    if (persist && !this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null
        this.save()
      }, 300)
    }
  }

  private save(): void {
    if (this.stopping) return
    const main = this.ws('principal')
    savePersisted(this.o.stateFile, {
      ...this.persisted,
      // raiz = espaço principal, para quem voltar a uma versão sem espaços
      layout: main.layout,
      resumable: main.resumable,
      projects: this.registry.list(),
      panes: this.panes
        .records()
        .filter((r) => r.alive)
        .map((r) => ({ id: r.id, cwd: r.cwd, accountId: r.accountId, sessionId: r.claude?.sessionId ?? null, agent: r.claude?.agent ?? 'claude', transcriptPath: r.claude?.transcriptPath ?? null, workspaceId: r.workspaceId })),
    })
  }

  private buildState(wsId: string): AppState {
    const w = this.ws(wsId)
    const records = this.panes.records()
    return {
      protocolVersion: PROTOCOL_VERSION,
      workspaceId: w.id,
      workspaces: this.persisted.workspaces.map((x) => {
        const live = records.filter((r) => r.alive && r.workspaceId === x.id)
        const attention = live.filter((r) => r.claude?.status === 'needs-you' || r.claude?.status === 'your-turn').length
        // mesmo rótulo da sidebar (sessionLabel): nome dado, título da conversa, "sessão N" ou "terminal N"
        const item = (r: (typeof live)[number]) => ({
          id: r.id,
          label: this.persisted.paneMeta[r.id]?.name ?? (r.claude ? (r.claude.title ?? `sessão ${r.seq}`) : `terminal ${r.seq}`),
          status: r.claude?.status ?? null,
        })
        const byId = new Map(live.map((r) => [r.id, r]))
        const placed = new Set<string>()
        const tabs = x.layout.tabs.flatMap((t) => {
          const panes = leafIds(t.root).flatMap((pid) => {
            const r = byId.get(pid)
            if (!r) return []
            placed.add(pid)
            return [item(r)]
          })
          return panes.length ? [{ id: t.id, name: t.name, panes }] : []
        })
        const hidden = live.filter((r) => !placed.has(r.id)).map(item)
        return { id: x.id, name: x.name, open: x.open, sessions: live.length, attention, tabs, hidden }
      }),
      askOnCloseWindow: this.persisted.askOnCloseWindow,
      userHome: this.o.userHome,
      projects: w.projectPaths.flatMap((p) => this.registry.get(p) ?? []).map((c) => ({
        ...c,
        worktrees: this.registry.worktrees(c.path).map((w) => ({ ...w, git: this.monitor.get(w.path) })),
        error: this.registry.error(c.path),
        fetchError: this.monitor.fetchError(c.path),
        conflicts: this.conflicts.get(c.path) ?? null,
      })),
      panes: records.filter((r) => r.workspaceId === w.id).map((r) => ({
        id: r.id,
        seq: r.seq,
        cwd: r.cwd,
        alive: r.alive,
        exitCode: r.exitCode,
        accountId: r.accountId,
        claude: r.claude,
        projectPath: this.panes.effectiveProject(r),
        worktreePath: this.panes.effectiveWorktree(r),
        shellWorktreePath: r.worktreePath,
        worktreeInferred: r.inference.inferred !== null,
        agentHooksMissing: r.agentHooksMissing,
        name: this.persisted.paneMeta[r.id]?.name ?? null,
        color: this.persisted.paneMeta[r.id]?.color ?? null,
        leader: this.persisted.paneMeta[r.id]?.leader === true,
        createdBy: this.persisted.paneMeta[r.id]?.createdBy ?? null,
      })),
      layout: w.layout,
      accounts: this.persisted.accounts,
      resumable: w.resumable,
      hookWarnings: this.hookWarnings,
      settings: this.persisted.settings,
      usage: this.usage.views(),
      filePanes: this.persisted.filePanes,
      usageHints: { ...missingLoginHints(this.persisted.accounts, this.logins), ...this.usage.hints() },
    }
  }

  /** ferramentas do MCP do líder; o espaço é o do líder */
  private async mcpCall(callerId: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const caller = this.panes.records().find((r) => r.id === callerId && r.alive)
    if (!caller) throw new Error('sessão de origem não encontrada')
    const meta = this.persisted.paneMeta
    const w = this.ws(caller.workspaceId)
    const inWs = () => this.panes.records().filter((r) => r.alive && r.workspaceId === w.id)
    const byName = (n: unknown) => {
      const r = inWs().find((x) => meta[x.id]?.name === String(n ?? ''))
      if (!r) throw new Error(`sessão não encontrada neste espaço: ${String(n ?? '')}`)
      return r
    }
    // todas as ferramentas, inclusive listar, são só do líder
    if (meta[caller.id]?.leader !== true) throw new Error('esta sessão não é líder; peça ao usuário para marcá-la no menu da sessão')
    if (tool === 'listar_sessoes') {
      return inWs().map((r) => {
        const wt = this.panes.effectiveWorktree(r)
        const project = this.panes.effectiveProject(r)
        const branch = project && wt ? (this.registry.worktrees(project).find((x) => x.path === wt)?.branch ?? null) : null
        return { nome: meta[r.id]?.name ?? `sessão ${r.seq}`, status: statusName(r), conta: r.accountId, pasta: r.cwd, branch, criadaPorMim: meta[r.id]?.createdBy === caller.id, eu: r.id === caller.id }
      })
    }
    if (tool === 'renomear_sessao') {
      const r = byName(args.nome)
      const novo = uniqueDash(checkName(String(args.novo_nome ?? '')), inWs().filter((x) => x !== r).map((x) => meta[x.id]?.name ?? ''))
      meta[r.id] = { ...(meta[r.id] ?? { name: null, color: null }), name: novo }
      this.changed()
      return { nome: novo }
    }
    if (tool === 'encerrar_sessao') {
      const r = byName(args.nome)
      if (meta[r.id]?.createdBy !== caller.id) throw new Error('só encerra sessões criadas por esta sessão')
      const name = meta[r.id]?.name
      // demitido some da tela: sai da lista e do layout (worktree, branch e conversa ficam)
      this.panes.forget(r.id)
      delete meta[r.id]
      fs.rmSync(path.join(this.promptsDir, `${r.id}.txt`), { force: true })
      w.layout = { ...w.layout, tabs: w.layout.tabs.map((t) => ({ ...t, root: t.root ? removeLeafFrom(t.root, r.id) : null })) }
      this.changed()
      return { encerrada: name }
    }
    if (tool === 'criar_sessao') return this.hire(caller, w, args)
    throw new Error(`ferramenta desconhecida: ${tool}`)
  }

  private async hire(caller: PaneRecord, w: Workspace, args: Record<string, unknown>) {
    const meta = this.persisted.paneMeta
    const max = this.persisted.settings.maxHiredPerLeader
    const live = this.panes.records().filter((r) => r.alive)
    if (live.filter((r) => meta[r.id]?.createdBy === caller.id).length >= max) throw new Error(`limite de ${max} sessões atingido; encerre alguma ou aumente o limite nas preferências`)
    const name = uniqueDash(checkName(String(args.nome ?? '')), live.filter((r) => r.workspaceId === w.id).map((r) => meta[r.id]?.name ?? ''))
    const account = pickAccount(this.persisted.accounts, args.conta, caller.accountId)
    let cwd = caller.cwd
    let branch: string | null = null
    if (args.worktree !== false) {
      const project = this.panes.effectiveProject(caller)
      if (!project) throw new Error('a sessão líder não está num repositório git conhecido; use worktree: false')
      const wtPath = this.panes.effectiveWorktree(caller)
      const own = this.registry.worktrees(project).find((x) => x.path === wtPath)
      const base = typeof args.base === 'string' && args.base.trim() ? args.base.trim() : own?.branch
      if (!base) throw new Error('a sessão líder está sem branch (HEAD solto); passe base explícita ou use worktree: false')
      const refs = await git(project, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
      branch = uniqueDash(`${base}-${name}`, refs.stdout.split('\n').filter(Boolean))
      const parent = path.join(project, '.claude', 'worktrees')
      const dirName = uniqueDash(name, fs.existsSync(parent) ? fs.readdirSync(parent) : [])
      cwd = path.join(parent, dirName)
      const r = await git(project, ['worktree', 'add', '-b', branch, cwd, base], 60_000)
      if (!r.ok) throw new Error(`git worktree add falhou: ${r.stderr.trim()}`)
      await this.registry.refresh(project)
    }
    const id = randomUUID()
    let promptFile: string | undefined
    if (typeof args.prompt === 'string' && args.prompt) {
      fs.mkdirSync(this.promptsDir, { recursive: true, mode: 0o700 })
      promptFile = path.join(this.promptsDir, `${id}.txt`)
      fs.writeFileSync(promptFile, args.prompt, { mode: 0o600 })
    }
    meta[id] = { name, color: null, createdBy: caller.id }
    this.panes.create({ paneId: id, cwd, accountId: account.id, cols: 120, rows: 30, workspaceId: w.id, agentName: name, promptFile })
    w.layout = insertBeside(w.layout, caller.id, id)
    this.changed()
    return { nome: name, pasta: cwd, branch, conta: account.id, comando: buildCommand(account, undefined, { mcpConfig: this.mcpConfigPath, name, promptFile }) }
  }

  private findWorktree(p: string) {
    for (const project of this.registry.list()) {
      const wts = this.registry.worktrees(project.path)
      const worktree = wts.find((w) => w.path === p)
      if (worktree) return { project, worktree, main: wts[0] }
    }
    throw new Error(`worktree não encontrada: ${p}`)
  }

  private checkRemove(p: string) {
    const { project, worktree, main } = this.findWorktree(p)
    return checkRemove({
      mainPath: project.path,
      worktree,
      mainBranch: main?.branch ?? null,
      hasOpenSession: this.panes.records().some((r) => r.alive && (r.worktreePath === p || this.panes.effectiveWorktree(r) === p)),
    })
  }

  private async removeWorktree(p: string, force: boolean, deleteBranch: boolean): Promise<void> {
    const check = await this.checkRemove(p)
    if (check.isMain) throw new Error('a worktree principal não pode ser removida')
    if (check.hasOpenSession) throw new Error('feche as sessões abertas nesta worktree antes de remover')
    if (!force && (check.dirtyFiles.length > 0 || check.unpushedCommits.length > 0)) {
      throw new Error('a worktree tem alterações ou commits que seriam perdidos')
    }
    const { project, worktree } = this.findWorktree(p)
    await removeWorktree({ mainPath: project.path, worktree, force, deleteBranch })
    await this.registry.refresh(project.path)
  }

  private onWorktreeChanged(worktreePath: string): void {
    const project = this.registry.list().find((c) => this.registry.worktrees(c.path).some((w) => w.path === worktreePath))
    if (!project || !this.conflicts.has(project.path)) return // só reanalisa o que já foi analisado
    clearTimeout(this.conflictTimers.get(project.path))
    this.conflictTimers.set(
      project.path,
      setTimeout(() => {
        this.conflictTimers.delete(project.path)
        void this.analyzeConflicts(project.path)
      }, this.o.conflictsDebounceMs ?? 5000),
    )
  }

  private async analyzeConflicts(projectPath: string): Promise<void> {
    if (!this.registry.get(projectPath)) throw new Error(`projeto não encontrado: ${projectPath}`)
    const prev = this.conflicts.get(projectPath)
    if (prev?.running) {
      this.conflictRerun.add(projectPath)
      return
    }
    this.conflicts.set(projectPath, { ...(prev ?? { analyzedAt: 0, comparisons: 0, vsMain: [], pairs: [], cleanPairs: 0, errors: [] }), running: true })
    this.changed(false)
    try {
      let cache = this.conflictCache.get(projectPath)
      if (!cache) this.conflictCache.set(projectPath, (cache = new Map()))
      const report = await analyzeConflicts(projectPath, this.registry.worktrees(projectPath), 4, cache)
      if (this.stopping) return
      this.conflicts.set(projectPath, { ...report, running: false })
    } catch (e) {
      this.conflicts.set(projectPath, { ...(prev ?? { analyzedAt: Date.now(), comparisons: 0, vsMain: [], pairs: [], cleanPairs: 0 }), running: false, errors: [{ worktreePath: projectPath, message: e instanceof Error ? e.message : String(e) }] })
    }
    this.changed(false)
    if (this.conflictRerun.delete(projectPath)) void this.analyzeConflicts(projectPath)
  }

  private detectAgents(): Promise<{ claude: boolean; codex: boolean }> {
    const shell = this.o.detectShell ?? this.o.shell
    const script = 'command -v claude >/dev/null 2>&1 && echo claude; command -v codex >/dev/null 2>&1 && echo codex; true'
    return new Promise((resolve) => {
      execFile(shell, ['-ilc', script], { timeout: 15_000, env: buildPaneEnv(this.o.env ?? process.env) }, (_err, stdout) => {
        const found = new Set(String(stdout ?? '').split(/\s+/))
        resolve({ claude: found.has('claude'), codex: found.has('codex') })
      })
    })
  }

  private async handle(req: ClientRequest, conn: Conn): Promise<unknown> {
    switch (req.t) {
      case 'hello':
        conn.role = req.role
        if (req.workspaceId && this.persisted.workspaces.some((w) => w.id === req.workspaceId)) {
          conn.workspaceId = req.workspaceId
          // só a janela de um espaço (id explícito) o marca aberto; a conexão de serviço do app não
          if (req.role === 'app' && !this.ws(conn.workspaceId).open) {
            this.ws(conn.workspaceId).open = true
            this.changed()
          }
        }
        if (req.role === 'app') setImmediate(() => conn.send({ t: 'state', state: this.buildState(conn.workspaceId) }))
        return { protocolVersion: PROTOCOL_VERSION, buildId: BUILD_ID }
      case 'state.get':
        return this.buildState(conn.workspaceId)
      case 'hook':
        conn.role = 'hook'
        conn.end() // libera o Claude antes de processar (ler título pode demorar)
        await this.panes.applyHook(req.paneId, req.configDir || null, req.payload, req.agent ?? 'claude')
        if (req.configDir) {
          const list = (req.agent ?? 'claude') === 'codex' ? this.persisted.codexHomes : this.persisted.claudeProfiles
          if (!list.includes(req.configDir)) {
            list.push(req.configDir)
            this.changed()
          }
        }
        this.onUsageHook(req.paneId, req.configDir || '', req.payload.hook_event_name)
        return null
      case 'pane.create': {
        let req2 = req
        if (req.resumeSessionId) {
          const found = await this.conversations.locate(req.resumeAgent ?? 'claude', req.resumeSessionId, req.transcriptPath ?? null)
          if (!found) throw new Error('conversation-missing')
          // o --resume só acha a conversa na pasta onde ela foi gravada
          if (found.startCwd) req2 = { ...req, cwd: found.startCwd }
        }
        const rec = this.panes.create({ ...req2, workspaceId: conn.workspaceId })
        for (const w of this.persisted.workspaces) w.resumable = w.resumable.filter((r) => r.paneId !== rec.id)
        this.changed()
        return { paneId: rec.id }
      }
      case 'pane.attach': {
        if (req.cols && req.rows) this.panes.resize(req.paneId, req.cols, req.rows)
        const snapshot = this.panes.host.serialize(req.paneId)
        conn.subscriptions.set(req.paneId, req.seq ?? 0)
        return { snapshot }
      }
      case 'pane.detach':
        conn.subscriptions.delete(req.paneId)
        return null
      case 'pane.input':
        this.panes.write(req.paneId, req.data)
        return null
      case 'pane.resize':
        this.panes.resize(req.paneId, req.cols, req.rows)
        return null
      case 'pane.kill':
        this.panes.kill(req.paneId)
        return null
      case 'pane.forget':
        this.panes.forget(req.paneId)
        delete this.persisted.paneMeta[req.paneId]
        fs.rmSync(path.join(this.promptsDir, `${req.paneId}.txt`), { force: true })
        return null
      case 'pane.meta': {
        const cur = this.persisted.paneMeta[req.paneId] ?? { name: null, color: null }
        const next = { ...cur }
        if (req.name !== undefined) next.name = req.name === null ? null : Array.from(req.name.trim()).slice(0, 60).join('') || null
        if (req.color !== undefined) {
          if (req.color !== null && !/^#[0-9a-fA-F]{6}$/.test(req.color)) throw new Error(`cor inválida: ${req.color}`)
          next.color = req.color
        }
        this.persisted.paneMeta[req.paneId] = next
        this.changed()
        return null
      }
      case 'mcp.call':
        return this.mcpCall(req.callerPaneId, req.tool, req.args ?? {})
      case 'pane.setLeader': {
        const cur = this.persisted.paneMeta[req.paneId] ?? { name: null, color: null }
        this.persisted.paneMeta[req.paneId] = { ...cur, leader: req.leader || undefined }
        this.changed()
        return null
      }
      case 'accounts.save': {
        const err = validateAccounts(req.accounts)
        if (err) throw new Error(err)
        this.persisted.accounts = req.accounts.map((a) => ({ ...a, configDirMatch: [...a.configDirMatch] }))
        this.hookWarnings = this.checkHookTargets()
        this.refreshLogins()
        this.changed()
        return null
      }
      case 'file.read':
        return readFile(req.path)
      case 'file.write':
        return writeFile(req.path, req.content, req.expectedMtimeMs)
      case 'file.list':
        return listFiles(req.root)
      case 'file.exists':
        return existing(req.cwd, req.paths, req.bases ?? [])
      case 'file.watch':
        if (!this.watchedConns.has(conn)) {
          this.watchedConns.add(conn)
          conn.onClose(() => {
            this.fileWatcher.unwatchAll(conn)
            this.watchedConns.delete(conn)
          })
        }
        this.fileWatcher.watch(req.path, conn)
        return null
      case 'file.unwatch':
        this.fileWatcher.unwatch(req.path, conn)
        return null
      case 'filepane.set':
        if (!req.id.startsWith('file:')) throw new Error(`id inválido: ${req.id}`)
        this.persisted.filePanes[req.id] = { path: req.path, mode: req.mode }
        this.changed()
        return null
      case 'conversations.list':
        return this.conversations.list(req.paths)
      case 'agents.detect':
        return this.detectAgents()
      case 'settings.save':
        this.persisted.settings = normalizeSettings(req.settings)
        this.changed()
        return null
      case 'conflicts.analyze':
        void this.analyzeConflicts(req.projectPath).catch((e) => console.error('análise de conflitos falhou', e))
        return null
      case 'pane.seen':
        this.panes.markSeen(req.paneId)
        return null
      case 'project.add': {
        const cfg = await this.registry.add(req.path, suggestAccount(this.persisted.accounts, req.path, this.o.userHome))
        const w = this.ws(conn.workspaceId)
        if (!w.projectPaths.includes(cfg.path)) w.projectPaths.push(cfg.path)
        this.changed()
        await this.panes.relocateAll()
        return cfg
      }
      case 'project.remove': {
        const w = this.ws(conn.workspaceId)
        w.projectPaths = w.projectPaths.filter((p) => p !== req.path)
        // o cadastro (cor, conta) só sai quando nenhum espaço usa mais o projeto
        if (!this.persisted.workspaces.some((x) => x.projectPaths.includes(req.path))) {
          this.registry.remove(req.path)
          this.conflicts.delete(req.path)
        }
        this.changed()
        await this.panes.relocateAll()
        return null
      }
      case 'project.setAccount':
        this.registry.setAccount(req.path, req.accountId)
        return null
      case 'project.setColor':
        this.registry.setColor(req.path, req.color)
        return null
      case 'layout.save':
        this.ws(conn.workspaceId).layout = req.layout
        {
          // painéis de arquivo são globais: a poda olha o layout de todos os espaços
          const ids = new Set(this.persisted.workspaces.flatMap((w) => w.layout.tabs.flatMap((t) => leafIds(t.root))))
          for (const id of Object.keys(this.persisted.filePanes)) if (!ids.has(id)) delete this.persisted.filePanes[id]
        }
        this.changed()
        return null
      case 'worktree.checkRemove':
        return this.checkRemove(req.path)
      case 'worktree.remove':
        await this.removeWorktree(req.path, req.force, req.deleteBranch)
        return null
      case 'hooks.install': {
        const targets = hookTargets(this.o.userHome, this.agentsInUse(), this.o.env ?? process.env)
        const missing = new Set(this.checkHookTargets())
        for (const t of targets) {
          if (!missing.has(t.file)) continue
          installHooks(t.file, this.hookCmdFor(t.agent), t.agent === 'codex' ? CODEX_HOOK_EVENTS : CLAUDE_HOOK_EVENTS)
        }
        this.hookWarnings = this.checkHookTargets()
        this.changed(false)
        return null
      }
      case 'resume.dismiss': {
        const w = this.ws(conn.workspaceId)
        w.resumable = w.resumable.filter((r) => r.paneId !== req.paneId)
        delete this.persisted.paneMeta[req.paneId]
        this.changed()
        return null
      }
      case 'workspace.create': {
        const name = uniqueName(req.name, this.persisted.workspaces.map((w) => w.name))
        const id = randomUUID()
        this.persisted.workspaces.push({ id, name, open: true, projectPaths: [], layout: { tabs: [], activeTabId: null }, resumable: [] })
        this.changed()
        return { id }
      }
      case 'workspace.rename': {
        const w = this.persisted.workspaces.find((x) => x.id === req.id)
        if (!w) throw new Error(`espaço não encontrado: ${req.id}`)
        w.name = uniqueName(req.name, this.persisted.workspaces.filter((x) => x !== w).map((x) => x.name))
        this.changed()
        return null
      }
      case 'workspace.setOpen': {
        const w = this.persisted.workspaces.find((x) => x.id === req.id)
        if (w) w.open = req.open
        this.changed()
        return null
      }
      case 'workspace.setAskOnClose':
        this.persisted.askOnCloseWindow = req.ask
        this.changed()
        return null
      case 'workspace.list':
        return this.buildState(conn.workspaceId).workspaces
      case 'workspace.end': {
        const w = this.persisted.workspaces.find((x) => x.id === req.id)
        if (!w) throw new Error(`espaço não encontrado: ${req.id}`)
        for (const r of this.panes.records().filter((x) => x.alive && x.workspaceId === w.id)) {
          if (!w.resumable.some((e) => e.paneId === r.id)) w.resumable.push({ paneId: r.id, cwd: r.cwd, accountId: r.accountId, sessionId: r.claude?.sessionId ?? null, agent: r.claude?.agent ?? 'claude', transcriptPath: r.claude?.transcriptPath ?? null })
          this.panes.kill(r.id)
        }
        w.open = false
        this.changed()
        return null
      }
      case 'pane.moveWorkspace': {
        const rec = this.panes.records().find((r) => r.id === req.paneId)
        const to = this.persisted.workspaces.find((x) => x.id === req.to)
        if (!rec || !to) throw new Error('painel ou espaço não encontrado')
        if (!rec.projectPath) await this.panes.relocateAll() // sessão recém-criada: projeto ainda não localizado
        const from = this.ws(rec.workspaceId)
        rec.workspaceId = to.id
        // origem: o renderer já tirou a folha antes de pedir; aqui garante para quem não tirou
        from.layout = { ...from.layout, tabs: from.layout.tabs.map((t) => ({ ...t, root: t.root ? removeLeafFrom(t.root, rec.id) : null })) }
        // destino: entra na aba ativa de lá (ou numa aba nova)
        if (!to.layout.tabs.some((t) => leafIds(t.root).includes(rec.id))) {
          const tab = to.layout.tabs.find((t) => t.id === to.layout.activeTabId) ?? to.layout.tabs[0]
          const leaf: LayoutNode = { type: 'leaf', paneId: rec.id }
          if (tab) tab.root = tab.root ? { type: 'split', dir: 'row', sizes: [], children: [tab.root, leaf] } : leaf
          else to.layout = { tabs: [{ id: randomUUID(), name: 'Aba 1', root: leaf }], activeTabId: null }
          if (!to.layout.activeTabId) to.layout.activeTabId = to.layout.tabs[0].id
        }
        if (rec.projectPath && !to.projectPaths.includes(rec.projectPath)) to.projectPaths.push(rec.projectPath)
        this.changed()
        return null
      }
      case 'daemon.shutdown':
        setImmediate(() => {
          void this.stop(true).then(() => this.o.onShutdown?.())
        })
        return null
    }
  }
}

function leafIds(n: LayoutNode | null): string[] {
  if (!n) return []
  return n.type === 'leaf' ? [n.paneId] : n.children.flatMap(leafIds)
}

/** tira a folha do painel; split que fica com um filho vira o filho */
function removeLeafFrom(n: LayoutNode, id: string): LayoutNode | null {
  if (n.type === 'leaf') return n.paneId === id ? null : n
  const children = n.children.map((c) => removeLeafFrom(c, id)).filter((c): c is LayoutNode => c !== null)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return children.length === n.children.length ? n : { ...n, children, sizes: [] }
}

export const defaultShell = (): string => os.userInfo().shell || process.env.SHELL || '/bin/zsh'
