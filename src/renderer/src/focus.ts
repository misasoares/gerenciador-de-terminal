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

/** o usuário está olhando para este painel 🔵? janela focada + painel na aba ativa + status your-turn */
export function lookingAt(app: Pick<AppState, 'layout' | 'panes'> | null, paneId: string | null, windowFocused: boolean): string | null {
  if (!app || !paneId || !windowFocused) return null
  const active = app.layout.tabs.find((t) => t.id === app.layout.activeTabId)
  if (!leaves(active?.root ?? null).includes(paneId)) return null
  return app.panes.find((p) => p.id === paneId)?.claude?.status === 'your-turn' ? paneId : null
}

/** o campo de renomear está aberto neste painel: não roubar o foco para o terminal */
export function shouldFocusTerminal(ui: { renamingPaneId: string | null }, paneId: string): boolean {
  return ui.renamingPaneId !== paneId
}

/** shells/agentes que terminaram sem erro (código 0) e não são retomáveis: o painel fecha sozinho */
export function panesToAutoClose(app: Pick<AppState, 'panes' | 'resumable'>): string[] {
  const resumable = new Set(app.resumable.map((r) => r.paneId))
  return app.panes.filter((p) => !p.alive && p.exitCode === 0 && !resumable.has(p.id)).map((p) => p.id)
}
