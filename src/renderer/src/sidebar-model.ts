import type { AppState, GitStatus, PaneView, SessionStatus } from '../../shared/types'
import { worktreeLabel } from './header'

export interface SessionItem {
  paneId: string
  label: string
  status: SessionStatus | 'shell'
  alive: boolean
  cwd: string
}

export interface WorktreeItem {
  path: string
  label: string
  isMain: boolean
  branch: string | null
  git: GitStatus | null
  prunable: boolean
  sessions: SessionItem[]
}

export interface ProjectItem {
  path: string
  name: string
  defaultAccountId: string | null
  error: string | null
  fetchError: string | null
  worktrees: WorktreeItem[]
  summary: { working: number; needsYou: number; idle: number }
}

export function sessionLabel(p: PaneView): string {
  if (!p.alive) return `encerrado ${p.seq}`
  if (p.claude) return p.claude.title ?? `sessão ${p.seq}`
  return `terminal ${p.seq}`
}

const toItem = (p: PaneView): SessionItem => ({
  paneId: p.id,
  label: sessionLabel(p),
  status: p.claude?.status ?? 'shell',
  alive: p.alive,
  cwd: p.cwd,
})

export function buildSidebar(app: AppState): { projects: ProjectItem[]; outside: SessionItem[] } {
  const used = new Set<string>()
  const projects = app.projects.map((p): ProjectItem => {
    const worktrees = p.worktrees.map((w): WorktreeItem => {
      const sessions = app.panes
        .filter((x) => x.projectPath === p.path && x.worktreePath === w.path)
        .map((x) => {
          used.add(x.id)
          return toItem(x)
        })
      return { path: w.path, label: worktreeLabel(w), isMain: w.isMain, branch: w.git?.branch ?? w.branch, git: w.git, prunable: w.prunable, sessions }
    })
    const all = worktrees.flatMap((w) => w.sessions)
    const count = (s: SessionStatus) => all.filter((x) => x.status === s).length
    return {
      path: p.path,
      name: p.name,
      defaultAccountId: p.defaultAccountId,
      error: p.error,
      fetchError: p.fetchError,
      worktrees,
      summary: { working: count('working'), needsYou: count('needs-you'), idle: count('idle') },
    }
  })
  const outside = app.panes.filter((x) => !used.has(x.id)).map(toItem)
  return { projects, outside }
}
