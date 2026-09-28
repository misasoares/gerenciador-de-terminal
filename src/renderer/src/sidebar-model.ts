import type { AppState, GitStatus, PaneView, SessionStatus } from '../../shared/types'
import { worktreeLabel } from './header'
import { leaves } from './layout'

export interface SessionItem {
  paneId: string
  label: string
  status: SessionStatus | 'shell'
  alive: boolean
  cwd: string
  /** número (1-based) da aba em que o painel aparece; null = fora da tela */
  tab: number | null
  /** vivo mas fora de qualquer aba */
  hidden: boolean
  color: string | null
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
  summary: { working: number; needsYou: number; yourTurn: number; idle: number }
  worst: SessionStatus | null
}

export function sessionLabel(p: PaneView): string {
  if (!p.alive) return `encerrado ${p.seq}`
  if (p.name) return p.name
  if (p.claude) return p.claude.title ?? `sessão ${p.seq}`
  return `terminal ${p.seq}`
}


export function buildSidebar(app: AppState): { projects: ProjectItem[]; outside: SessionItem[] } {
  const tabOf = new Map<string, number>()
  app.layout.tabs.forEach((t, i) => leaves(t.root).forEach((id) => tabOf.set(id, i + 1)))
  const toItem = (p: PaneView): SessionItem => {
    const tab = tabOf.get(p.id) ?? null
    return { paneId: p.id, label: sessionLabel(p), status: p.claude?.status ?? 'shell', alive: p.alive, cwd: p.cwd, tab, hidden: p.alive && tab === null, color: p.color }
  }
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
      summary: { working: count('working'), needsYou: count('needs-you'), yourTurn: count('your-turn'), idle: count('idle') },
      worst: count('needs-you') ? 'needs-you' : count('your-turn') ? 'your-turn' : count('working') ? 'working' : count('idle') ? 'idle' : null,
    }
  })
  const outside = app.panes.filter((x) => !used.has(x.id)).map(toItem)
  return { projects, outside }
}

/** projetos sem foco recolhem sozinhos (com poucos projetos, todos abertos); o clique do usuário vence */
export function isExpanded(projectPath: string, focusedProjectPath: string | null, overrides: Record<string, boolean>, projectCount: number): boolean {
  if (projectPath in overrides) return overrides[projectPath]
  return projectCount <= 2 || projectPath === focusedProjectPath
}

export function railLabel(name: string): string {
  return (name.length <= 4 ? name : name.slice(0, 3)).toUpperCase()
}

/** o settings.json principal vale para todos os perfis (symlinks); um perfil com arquivo próprio afeta só a sua conta */
export function accountsWithoutHooks(app: Pick<AppState, 'hookWarnings' | 'accounts' | 'userHome'>): Set<string> {
  const out = new Set<string>()
  for (const w of app.hookWarnings) {
    if (w === `${app.userHome}/.claude/settings.json`) app.accounts.forEach((a) => out.add(a.id))
    else app.accounts.filter((a) => a.configDirMatch.some((m) => w.includes(m))).forEach((a) => out.add(a.id))
  }
  return out
}
