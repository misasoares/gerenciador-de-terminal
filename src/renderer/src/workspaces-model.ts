import type { Layout, WorkspaceSummary } from '../../shared/types'
import { leaves } from './layout'

export interface ReopenRow {
  id: string
  name: string
  checked: boolean
  detail: string
}

/** tela "Reabrir espaços de trabalho": vêm marcados os que estavam abertos */
export function reopenRows(list: WorkspaceSummary[]): ReopenRow[] {
  return list.map((w) => ({
    id: w.id,
    name: w.name,
    checked: w.open,
    detail: w.sessions === 0 ? 'sem sessões' : w.sessions === 1 ? '1 sessão rodando' : `${w.sessions} sessões rodando`,
  }))
}

/**
 * O layout é do renderer; o do daemon só vence quando traz uma sessão que acabou de chegar a este espaço
 * ("Mover para espaço"): está nas sessões novas, não estava nas anteriores e o layout local não a tem.
 * Broadcast atrasado com painel que o usuário acabou de esconder não o traz de volta.
 */
export function mergeIncomingLayout(local: Layout, incoming: Layout, prevPaneIds: Set<string>, nextPaneIds: Set<string>): Layout {
  const mine = new Set(local.tabs.flatMap((t) => leaves(t.root)))
  const arrived = (id: string) => !mine.has(id) && nextPaneIds.has(id) && !prevPaneIds.has(id)
  return incoming.tabs.some((t) => leaves(t.root).some(arrived)) ? incoming : local
}
