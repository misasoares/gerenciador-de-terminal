import type { AppState, Layout, PaneView, SessionStatus } from '../../shared/types'
import { leaves } from './layout'

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
  /** cor do projeto (bloco do projeto) */
  projectColor: string | null
  /** cor da sessão (bloco do nome da sessão) */
  sessionColor: string | null
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
    projectColor: project?.color ?? null,
    sessionColor: pane.color,
  }
}

export interface GitBadges {
  changed: number | null
  ahead: number | null
  behind: number | null
}

/** peças do git no cabeçalho: só aparecem quando dizem algo (> 0) e a preferência está ligada */
export function gitBadges(h: Pick<HeaderView, 'changed' | 'ahead' | 'behind'>, show: boolean): GitBadges {
  const keep = (n: number) => (show && n > 0 ? n : null)
  return { changed: keep(h.changed), ahead: keep(h.ahead), behind: keep(h.behind) }
}

function channel(hex: string, i: number): number {
  const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** cor de texto (preto ou branco) com mais contraste sobre o fundo, pela luminância relativa do WCAG */
export function textOn(bg: string): string {
  const l = 0.2126 * channel(bg, 0) + 0.7152 * channel(bg, 1) + 0.0722 * channel(bg, 2)
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#111111' : '#ffffff'
}

/** a aba do painel tem 2+ painéis, todos no mesmo projeto e worktree: o cabeçalho pode esconder o que se repete */
export function sharesContext(paneId: string, layout: Layout, panes: PaneView[]): boolean {
  const tab = layout.tabs.find((t) => leaves(t.root).includes(paneId))
  const ids = (tab ? leaves(tab.root) : []).filter((id) => !id.startsWith('file:'))
  if (ids.length < 2) return false
  const inTab = ids.map((id) => panes.find((p) => p.id === id)).filter((p): p is PaneView => !!p)
  if (inTab.length !== ids.length) return false
  const [first] = inTab
  return first.projectPath !== null && inTab.every((p) => p.projectPath === first.projectPath && p.worktreePath === first.worktreePath)
}
