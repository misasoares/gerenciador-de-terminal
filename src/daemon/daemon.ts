import os from 'node:os'
import { PROTOCOL_VERSION, type ClientRequest } from '../shared/protocol'
import type { AppState, ConflictReport } from '../shared/types'
import { analyzeConflicts } from './conflicts'
import { normalizeSettings } from '../shared/settings'
import { suggestAccount } from './accounts'
import { GitMonitor } from './git/monitor'
import { checkProfiles, hookCommand, installHooks, writeHookScript } from './hooks'
import { PaneManager, buildPaneEnv } from './panes'
import { loadPersisted, savePersisted, type Persisted } from './persist'
import { ProjectRegistry } from './projects'
import { startServer, type Conn, type RpcServer } from './server'
import { checkRemove, removeWorktree } from './worktree-remove'

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
  onShutdown?: () => void
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

  private constructor(private o: DaemonOptions) {}

  static async start(o: DaemonOptions): Promise<Daemon> {
    const d = new Daemon(o)
    await d.init()
    return d
  }

  private get hookCmd(): string {
    return hookCommand(this.o.hookScriptPath)
  }

  private async init(): Promise<void> {
    writeHookScript(this.o.hookScriptPath)
    const p = loadPersisted(this.o.stateFile)
    // o que estava vivo no daemon anterior vira retomável (mesmo id → o layout continua valendo)
    const byId = new Map(p.resumable.map((r) => [r.paneId, r]))
    for (const pane of p.panes) byId.set(pane.id, { paneId: pane.id, cwd: pane.cwd, accountId: pane.accountId, sessionId: pane.sessionId })
    p.resumable = [...byId.values()]
    p.panes = []
    this.persisted = p

    this.monitor = new GitMonitor((p) => {
      if (p) this.onWorktreeChanged(p)
      this.changed(false)
    }, { pollMs: this.o.gitPollMs ?? 10_000, debounceMs: 300 })
    this.registry = new ProjectRegistry(p.projects, () => this.changed())
    this.panes = new PaneManager({
      accounts: () => this.persisted.accounts,
      registry: this.registry,
      socketPath: this.o.socketPath,
      shell: this.o.shell,
      shellArgs: this.o.shellArgs,
      baseEnv: buildPaneEnv(this.o.env ?? process.env),
      fallbackCwd: this.o.userHome,
      onData: (id, data) => {
        for (const c of this.server?.conns ?? []) if (c.subscriptions.has(id)) c.send({ t: 'pane.data', paneId: id, data })
      },
      onChange: () => this.changed(),
      onGitHint: (wt) => this.monitor.refresh(wt),
    })
    this.hookWarnings = checkProfiles(this.o.userHome, this.hookCmd)
    this.server = await startServer(this.o.socketPath, (req, conn) => this.handle(req, conn))
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
        const state = this.buildState()
        for (const c of this.server?.conns ?? []) if (c.role === 'app') c.send({ t: 'state', state })
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
    savePersisted(this.o.stateFile, {
      ...this.persisted,
      projects: this.registry.list(),
      panes: this.panes
        .records()
        .filter((r) => r.alive)
        .map((r) => ({ id: r.id, cwd: r.cwd, accountId: r.accountId, sessionId: r.claude?.sessionId ?? null })),
    })
  }

  private buildState(): AppState {
    return {
      protocolVersion: PROTOCOL_VERSION,
      userHome: this.o.userHome,
      projects: this.registry.list().map((c) => ({
        ...c,
        worktrees: this.registry.worktrees(c.path).map((w) => ({ ...w, git: this.monitor.get(w.path) })),
        error: this.registry.error(c.path),
        fetchError: this.monitor.fetchError(c.path),
        conflicts: this.conflicts.get(c.path) ?? null,
      })),
      panes: this.panes.records().map((r) => ({
        id: r.id,
        seq: r.seq,
        cwd: r.cwd,
        alive: r.alive,
        exitCode: r.exitCode,
        accountId: r.accountId,
        claude: r.claude,
        projectPath: r.projectPath,
        worktreePath: r.worktreePath,
        name: this.persisted.paneMeta[r.id]?.name ?? null,
        color: this.persisted.paneMeta[r.id]?.color ?? null,
      })),
      layout: this.persisted.layout,
      accounts: this.persisted.accounts,
      resumable: this.persisted.resumable,
      hookWarnings: this.hookWarnings,
      settings: this.persisted.settings,
    }
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
      hasOpenSession: this.panes.records().some((r) => r.alive && r.worktreePath === p),
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
      const report = await analyzeConflicts(projectPath, this.registry.worktrees(projectPath))
      if (this.stopping) return
      this.conflicts.set(projectPath, { ...report, running: false })
    } catch (e) {
      this.conflicts.set(projectPath, { ...(prev ?? { analyzedAt: Date.now(), comparisons: 0, vsMain: [], pairs: [], cleanPairs: 0 }), running: false, errors: [{ worktreePath: projectPath, message: e instanceof Error ? e.message : String(e) }] })
    }
    this.changed(false)
    if (this.conflictRerun.delete(projectPath)) void this.analyzeConflicts(projectPath)
  }

  private async handle(req: ClientRequest, conn: Conn): Promise<unknown> {
    switch (req.t) {
      case 'hello':
        conn.role = req.role
        if (req.role === 'app') setImmediate(() => conn.send({ t: 'state', state: this.buildState() }))
        return { protocolVersion: PROTOCOL_VERSION }
      case 'state.get':
        return this.buildState()
      case 'hook':
        conn.role = 'hook'
        conn.end() // libera o Claude antes de processar (ler título pode demorar)
        await this.panes.applyHook(req.paneId, req.configDir || null, req.payload)
        return null
      case 'pane.create': {
        const rec = this.panes.create(req)
        this.persisted.resumable = this.persisted.resumable.filter((r) => r.paneId !== rec.id)
        this.changed()
        return { paneId: rec.id }
      }
      case 'pane.attach': {
        if (req.cols && req.rows) this.panes.resize(req.paneId, req.cols, req.rows)
        const snapshot = this.panes.host.serialize(req.paneId)
        conn.subscriptions.add(req.paneId)
        return { snapshot }
      }
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
        return null
      case 'pane.meta': {
        const cur = this.persisted.paneMeta[req.paneId] ?? { name: null, color: null }
        const next = { ...cur }
        if (req.name !== undefined) next.name = req.name === null ? null : req.name.trim().slice(0, 60) || null
        if (req.color !== undefined) {
          if (req.color !== null && !/^#[0-9a-fA-F]{6}$/.test(req.color)) throw new Error(`cor inválida: ${req.color}`)
          next.color = req.color
        }
        this.persisted.paneMeta[req.paneId] = next
        this.changed()
        return null
      }
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
        await this.panes.relocateAll()
        return cfg
      }
      case 'project.remove':
        this.registry.remove(req.path)
        this.conflicts.delete(req.path)
        await this.panes.relocateAll()
        return null
      case 'project.setAccount':
        this.registry.setAccount(req.path, req.accountId)
        return null
      case 'layout.save':
        this.persisted.layout = req.layout
        this.changed()
        return null
      case 'worktree.checkRemove':
        return this.checkRemove(req.path)
      case 'worktree.remove':
        await this.removeWorktree(req.path, req.force, req.deleteBranch)
        return null
      case 'hooks.install':
        for (const f of this.hookWarnings) installHooks(f, this.hookCmd)
        this.hookWarnings = checkProfiles(this.o.userHome, this.hookCmd)
        this.changed(false)
        return null
      case 'resume.dismiss':
        this.persisted.resumable = this.persisted.resumable.filter((r) => r.paneId !== req.paneId)
        delete this.persisted.paneMeta[req.paneId]
        this.changed()
        return null
      case 'daemon.shutdown':
        setImmediate(() => {
          void this.stop(true).then(() => this.o.onShutdown?.())
        })
        return null
    }
  }
}

export const defaultShell = (): string => os.userInfo().shell || process.env.SHELL || '/bin/zsh'
