import fs from 'node:fs'
import type { GitStatus } from '../../shared/types'
import { parseStatus } from './parse'
import { git } from './run'

export class GitMonitor {
  private status = new Map<string, GitStatus>()
  private fetchErrors = new Map<string, string | null>()
  private debounce = new Map<string, NodeJS.Timeout>()
  private watchers = new Map<string, fs.FSWatcher>()
  private tracked = new Set<string>()
  private pollTimer: NodeJS.Timeout | null = null
  private fetchTimer: NodeJS.Timeout | null = null

  constructor(
    private onChange: (path?: string) => void,
    private opts: { pollMs: number; debounceMs: number } = { pollMs: 10_000, debounceMs: 300 },
  ) {}

  get(worktreePath: string): GitStatus | null {
    return this.status.get(worktreePath) ?? null
  }

  fetchError(projectPath: string): string | null {
    return this.fetchErrors.get(projectPath) ?? null
  }

  track(paths: string[]): void {
    const next = new Set(paths)
    for (const p of [...this.tracked]) {
      if (next.has(p)) continue
      this.tracked.delete(p)
      this.watchers.get(p)?.close()
      this.watchers.delete(p)
      clearTimeout(this.debounce.get(p))
      this.debounce.delete(p)
      this.status.delete(p)
    }
    for (const p of next) {
      if (this.tracked.has(p)) continue
      this.tracked.add(p)
      void this.watch(p)
      this.refresh(p)
    }
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        for (const p of this.tracked) this.refresh(p)
      }, this.opts.pollMs)
    }
  }

  refresh(p: string): void {
    if (!this.tracked.has(p)) return
    clearTimeout(this.debounce.get(p))
    this.debounce.set(
      p,
      setTimeout(() => {
        this.debounce.delete(p)
        void this.refreshNow(p)
      }, this.opts.debounceMs),
    )
  }

  async refreshNow(p: string): Promise<void> {
    const r = await git(p, ['status', '--porcelain=v2', '--branch'])
    if (!this.tracked.has(p)) return
    const prev = this.status.get(p)
    const next: GitStatus = r.ok
      ? { ...parseStatus(r.stdout), error: null }
      : {
          branch: prev?.branch ?? null,
          upstream: prev?.upstream ?? null,
          ahead: prev?.ahead ?? 0,
          behind: prev?.behind ?? 0,
          changed: prev?.changed ?? 0,
          error: r.stderr.trim().split('\n')[0] || 'git status falhou',
        }
    if (JSON.stringify(prev) === JSON.stringify(next)) return
    this.status.set(p, next)
    this.onChange(p)
  }

  startFetch(projects: () => string[], intervalMs: number): void {
    const run = async (): Promise<void> => {
      for (const pp of projects()) {
        const r = await git(pp, ['fetch', '--all', '--prune', '--quiet'], 60_000)
        const err = r.ok ? null : r.stderr.trim().split('\n')[0] || 'git fetch falhou'
        if ((this.fetchErrors.get(pp) ?? null) !== err) {
          this.fetchErrors.set(pp, err)
          this.onChange()
        }
      }
    }
    this.fetchTimer = setInterval(() => void run(), intervalMs)
    void run()
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.fetchTimer) clearInterval(this.fetchTimer)
    for (const t of this.debounce.values()) clearTimeout(t)
    for (const w of this.watchers.values()) w.close()
    this.pollTimer = null
    this.fetchTimer = null
    this.debounce.clear()
    this.watchers.clear()
    this.tracked.clear()
  }

  private async watch(p: string): Promise<void> {
    const r = await git(p, ['rev-parse', '--absolute-git-dir'])
    if (!r.ok || !this.tracked.has(p)) return
    try {
      // não recursivo: pega HEAD, index e FETCH_HEAD daquela worktree
      const w = fs.watch(r.stdout.trim(), () => this.refresh(p))
      w.on('error', () => {})
      this.watchers.set(p, w)
    } catch {
      // sem watcher: o polling cobre
    }
  }
}
