import type { AppState } from '../../shared/types'
import { worktreeLabel } from './header'
import { sessionLabel } from './sidebar-model'
import { teamPaneId } from './team-model'

export interface PaletteItem {
  kind: 'session' | 'team' | 'worktree' | 'project'
  id: string
  label: string
  detail: string
  projectPath: string | null
  worktreePath: string | null
}

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** subsequência; pontuação = início da 1ª letra + buracos entre letras (menor = melhor). Trecho contíguo ganha bônus. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = normalize(query).replace(/\s+/g, '')
  const t = normalize(text)
  if (!q) return 0
  const contiguous = t.indexOf(q)
  if (contiguous >= 0) return contiguous * 0.01
  let ti = 0
  let first = -1
  let gaps = 0
  let last = -1
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    if (first < 0) first = found
    if (last >= 0) gaps += found - last - 1
    last = found
    ti = found + 1
  }
  return 1 + first * 0.01 + gaps
}

export function buildPaletteItems(app: AppState): PaletteItem[] {
  const items: PaletteItem[] = []
  for (const p of app.panes.filter((x) => x.alive)) {
    const project = app.projects.find((x) => x.path === p.projectPath)
    const wt = project?.worktrees.find((w) => w.path === p.worktreePath)
    const account = app.accounts.find((a) => a.id === p.accountId)
    const detail = [project ? project.name.toUpperCase() : 'fora de projeto', wt ? `⎇ ${worktreeLabel(wt)}` : null, account?.label].filter(Boolean).join(' · ')
    items.push({ kind: 'session', id: p.id, label: sessionLabel(p), detail, projectPath: p.projectPath, worktreePath: p.worktreePath })
  }
  for (const p of app.panes.filter((x) => x.alive && x.leader)) {
    items.push({ kind: 'team', id: teamPaneId(p.id), label: `Equipe de ${p.name ?? `sessão ${p.seq}`}`, detail: 'grupo da equipe', projectPath: p.projectPath, worktreePath: p.worktreePath })
  }
  for (const project of app.projects) {
    for (const w of project.worktrees.filter((x) => !x.prunable)) {
      items.push({ kind: 'worktree', id: w.path, label: worktreeLabel(w), detail: project.name.toUpperCase(), projectPath: project.path, worktreePath: w.path })
    }
  }
  for (const project of app.projects) {
    items.push({ kind: 'project', id: project.path, label: project.name.toUpperCase(), detail: project.path, projectPath: project.path, worktreePath: null })
  }
  return items
}

export function searchPalette(items: PaletteItem[], query: string, limit = 30): PaletteItem[] {
  if (!query.trim()) return items.slice(0, limit)
  const scored: { item: PaletteItem; score: number }[] = []
  for (const item of items) {
    const byLabel = fuzzyScore(query, item.label)
    const byDetail = fuzzyScore(query, item.detail)
    const score = byLabel !== null ? byLabel : byDetail !== null ? byDetail + 100 : null
    if (score !== null) scored.push({ item, score })
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((s) => s.item)
}
