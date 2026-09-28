import type { ConflictReport } from '../../shared/types'

/** com quem esta worktree conflita: 'main' primeiro, depois as outras worktrees */
export function conflictPartners(report: ConflictReport | null, worktreePath: string, labelOf: (path: string) => string): string[] {
  if (!report) return []
  const out: string[] = []
  if (report.vsMain.some((v) => v.worktreePath === worktreePath && v.files.length > 0)) out.push('main')
  for (const p of report.pairs) {
    if (p.a === worktreePath) out.push(labelOf(p.b))
    else if (p.b === worktreePath) out.push(labelOf(p.a))
  }
  return out
}
