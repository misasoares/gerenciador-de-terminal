import type { AppState, Layout, WorkspaceSummary } from '../../shared/types'
import { leaves, removePane } from './layout'

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
 * O layout é do renderer, com duas exceções vindas de fora da janela:
 * - sessão que acabou de chegar a este espaço ("Mover para espaço", contratada pelo líder): está nas sessões novas,
 *   não estava nas anteriores e o layout local não a tem → vale o layout do daemon;
 * - sessão que saiu do espaço (demitida pelo líder, movida por outra janela): estava nas anteriores, não está nas
 *   novas e o daemon também a tirou do layout dele → a folha sai do layout local. (Daemon reiniciado: as sessões
 *   somem da lista mas continuam no layout dele, para retomar → nada sai.)
 * Broadcast atrasado com painel que o usuário acabou de esconder não o traz de volta; painel de arquivo só conta
 * quando é novo (aberto pelo daemon, ex.: abrir_midia), via arrivedFromOutside.
 */
export function mergeIncomingLayout(local: Layout, incoming: Layout, prevPaneIds: Set<string>, nextPaneIds: Set<string>, docked: Set<string> = new Set()): Layout {
  const mine = new Set(local.tabs.flatMap((t) => leaves(t.root)))
  // chegou: sessão nova neste espaço, ou painel que acabou de sair das flutuantes (encaixe)
  const arrived = (id: string) => !mine.has(id) && ((nextPaneIds.has(id) && !prevPaneIds.has(id)) || docked.has(id))
  if (incoming.tabs.some((t) => leaves(t.root).some(arrived))) return incoming
  const theirs = new Set(incoming.tabs.flatMap((t) => leaves(t.root)))
  const departed = [...mine].filter((id) => prevPaneIds.has(id) && !nextPaneIds.has(id) && !theirs.has(id))
  if (departed.length === 0) return local
  return departed.reduce((l, id) => removePane(l, id), local)
}

/** painéis que o daemon pôs no layout por fora: saiu das flutuantes (encaixe) ou painel de arquivo novo (abrir_midia) */
export function arrivedFromOutside(prev: Pick<AppState, 'floating' | 'filePanes'>, next: Pick<AppState, 'floating' | 'filePanes'>): Set<string> {
  return new Set([...prev.floating.filter((id) => !next.floating.includes(id)), ...Object.keys(next.filePanes).filter((id) => !(id in prev.filePanes))])
}

export type OtherWorkspace = Omit<WorkspaceSummary, 'open'>

/** seção "Outros espaços" da sidebar: os abertos, menos o desta janela */
export function otherWorkspaces(list: WorkspaceSummary[], currentId: string): OtherWorkspace[] {
  return list.filter((w) => w.open && w.id !== currentId).map(({ open: _open, ...rest }) => rest)
}
