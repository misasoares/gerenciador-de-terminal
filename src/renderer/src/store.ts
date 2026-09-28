import { useSyncExternalStore } from 'react'
import type { AppState, Layout, RemoveCheck } from '../../shared/types'
import { errorMessage } from './api'

export interface UiState {
  app: AppState | null
  connected: boolean
  versionMismatch: { daemon: number; app: number } | null
  focusedPaneId: string | null
  newSession: { projectPath: string | null; worktreePath: string | null } | null
  error: string | null
  sidebarCollapsed: boolean
  /** painel cujo contorno pisca (foi revelado por clique na sidebar) */
  flashPaneId: string | null
  modal: Modal | null
  renamingPaneId: string | null
}

export type Modal =
  | { kind: 'kill'; paneId: string }
  | { kind: 'remove'; check: RemoveCheck }
  | { kind: 'blocked'; check: RemoveCheck }
  | { kind: 'conflicts'; projectPath: string }
  | { kind: 'preferences' }
  | { kind: 'palette' }

let state: UiState = { app: null, connected: false, versionMismatch: null, focusedPaneId: null, newSession: null, error: null, sidebarCollapsed: false, flashPaneId: null, modal: null, renamingPaneId: null }
const subs = new Set<() => void>()

const subscribe = (cb: () => void) => {
  subs.add(cb)
  return () => subs.delete(cb)
}

export function getUi(): UiState {
  return state
}

export function setUi(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  for (const s of subs) s()
}

export function useUi<T>(sel: (s: UiState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state))
}

/** o renderer é a fonte do layout: aplica local e salva no daemon */
export function updateLayout(fn: (l: Layout) => Layout): void {
  const app = state.app
  if (!app) return
  const layout = fn(app.layout)
  if (layout === app.layout) return
  setUi({ app: { ...app, layout } })
  window.gt.send({ t: 'layout.save', layout })
}

export function showError(e: unknown): void {
  setUi({ error: errorMessage(e) })
}
