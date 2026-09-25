import path from 'node:path'
import type { ProjectConfig, WorktreeInfo } from '../shared/types'
import { findWorktree, gitToplevel, listWorktrees, type Location } from './resolve'

export class ProjectRegistry {
  private wts = new Map<string, WorktreeInfo[]>()
  private errors = new Map<string, string | null>()

  constructor(private configs: ProjectConfig[], private onChange: () => void) {}

  list(): ProjectConfig[] {
    return this.configs
  }

  get(p: string): ProjectConfig | undefined {
    return this.configs.find((c) => c.path === p)
  }

  worktrees(p: string): WorktreeInfo[] {
    return this.wts.get(p) ?? []
  }

  error(p: string): string | null {
    return this.errors.get(p) ?? null
  }

  allWorktreePaths(): string[] {
    return this.configs.flatMap((c) => this.worktrees(c.path).filter((w) => !w.prunable).map((w) => w.path))
  }

  async add(dir: string, defaultAccountId: string | null): Promise<ProjectConfig> {
    const r = await listWorktrees(dir)
    if (!r.ok) throw new Error(`não é um repositório git: ${dir}`)
    const main = r.worktrees[0].path
    const existing = this.get(main)
    if (existing) return existing
    const cfg: ProjectConfig = { path: main, name: path.basename(main), defaultAccountId }
    this.configs.push(cfg)
    this.wts.set(main, r.worktrees)
    this.errors.set(main, null)
    this.onChange()
    return cfg
  }

  remove(p: string): void {
    this.configs = this.configs.filter((c) => c.path !== p)
    this.wts.delete(p)
    this.errors.delete(p)
    this.onChange()
  }

  setAccount(p: string, accountId: string | null): void {
    const c = this.get(p)
    if (!c) throw new Error(`projeto não encontrado: ${p}`)
    c.defaultAccountId = accountId
    this.onChange()
  }

  async refresh(p: string): Promise<void> {
    const r = await listWorktrees(p)
    if (r.ok) {
      this.wts.set(p, r.worktrees)
      this.errors.set(p, null)
    } else {
      this.errors.set(p, r.error)
    }
    this.onChange()
  }

  async refreshAll(): Promise<void> {
    await Promise.all(this.configs.map((c) => this.refresh(c.path)))
  }

  async locate(cwd: string): Promise<Location | null> {
    const top = await gitToplevel(cwd)
    if (!top) return null
    const hit = findWorktree(this.view(), top)
    if (hit) return hit
    // worktree nova (o Claude acabou de criar): a lista em cache está velha
    const r = await listWorktrees(top)
    if (!r.ok) return null
    const main = r.worktrees[0].path
    if (!this.get(main)) return null
    this.wts.set(main, r.worktrees)
    this.onChange()
    return findWorktree(this.view(), top)
  }

  private view(): { path: string; worktrees: WorktreeInfo[] }[] {
    return this.configs.map((c) => ({ path: c.path, worktrees: this.worktrees(c.path) }))
  }
}
