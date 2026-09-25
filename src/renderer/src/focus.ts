import type { AppState, Layout } from '../../shared/types'
import { findTab, leaves } from './layout'

/** pasta onde ⌘D / ⇧⌘D abre: a pasta atual do painel em foco (ou do último painel da aba ativa) */
export function splitCwd(app: Pick<AppState, 'layout' | 'panes' | 'userHome'>, focusedId: string | null): string {
  const focused = app.panes.find((p) => p.id === focusedId)
  const active = app.layout.tabs.find((t) => t.id === app.layout.activeTabId)
  const fallbackId = leaves(active?.root ?? null).at(-1)
  const source = focused ?? app.panes.find((p) => p.id === fallbackId)
  return source?.cwd ?? app.userHome
}

/** ao esconder o painel em foco, o foco vai para outro painel da mesma aba */
export function focusAfterHide(layout: Layout, hiddenId: string): string | null {
  const tab = findTab(layout, hiddenId)
  const rest = leaves(tab?.root ?? null).filter((id) => id !== hiddenId)
  return rest.at(-1) ?? null
}
