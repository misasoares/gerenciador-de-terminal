import type { AppState, PaneView, SessionStatus } from '../../shared/types'

export interface HeaderView {
  project: string
  worktree: string
  isMainWorktree: boolean
  branch: string | null
  changed: number
  ahead: number
  behind: number
  hasUpstream: boolean
  status: SessionStatus | 'shell'
  account: { label: string; color: string } | null
  warning: string | null
  label: string
}

export function worktreeLabel(w: { path: string; isMain: boolean }): string {
  return w.isMain ? 'principal' : (w.path.split('/').pop() ?? w.path)
}

export function tildify(p: string, home: string): string {
  return p === home || p.startsWith(home + '/') ? '~' + p.slice(home.length) : p
}

export function headerView(pane: PaneView, app: Pick<AppState, 'projects' | 'accounts' | 'userHome'>): HeaderView {
  const project = app.projects.find((p) => p.path === pane.projectPath)
  const wt = project?.worktrees.find((w) => w.path === pane.worktreePath)
  const account = app.accounts.find((a) => a.id === pane.accountId)
  const git = wt?.git ?? null
  return {
    project: project?.name ?? 'fora de projeto',
    worktree: wt ? worktreeLabel(wt) : tildify(pane.cwd, app.userHome),
    isMainWorktree: wt?.isMain ?? true,
    branch: git?.branch ?? wt?.branch ?? null,
    changed: git?.changed ?? 0,
    ahead: git?.ahead ?? 0,
    behind: git?.behind ?? 0,
    hasUpstream: Boolean(git?.upstream),
    status: pane.claude?.status ?? 'shell',
    account: account ? { label: account.label, color: account.color } : null,
    warning: git?.error ?? project?.fetchError ?? null,
    label: pane.name ?? pane.claude?.title ?? (pane.claude ? `sessão ${pane.seq}` : `terminal ${pane.seq}`),
  }
}
