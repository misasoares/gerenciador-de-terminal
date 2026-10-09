import { useSyncExternalStore } from 'react'
import type { AppState, Layout, RemoveCheck } from '../../shared/types'
import { errorMessage } from './api'
import type { MotionPersonality } from './motion-presets'
import type { UpdateStatus } from '../../shared/update'

export interface UiState {
  app: AppState | null
  connected: boolean
  versionMismatch: { daemon: string; app: string } | null
  focusedPaneId: string | null
  newSession: { projectPath: string | null; worktreePath: string | null } | null
  error: string | null
  sidebarCollapsed: boolean
  /** painel cujo contorno pisca (foi revelado por clique na sidebar) */
  flashPaneId: string | null
  modal: Modal | null
  renamingPaneId: string | null
  /** painéis cuja conversa salva não foi encontrada ao retomar */
  missingResume: string[]
  /** o fundo efetivo pede outro tipo de janela (mesa do macOS ↔ opaca): reabrir aplica */
  desktopMismatch: boolean
  /** personalidade de movimento do tema efetivo */
  motion: MotionPersonality
  /** atualizador (processo principal) */
  update: UpdateStatus
  /** "Atualizado para X · N sessões retomadas" na primeira abertura da versão nova */
  updateNotice: string | null
}

export type Modal =
  | { kind: 'kill'; paneId: string }
  | { kind: 'remove'; check: RemoveCheck }
  | { kind: 'blocked'; check: RemoveCheck }
  | { kind: 'conflicts'; projectPath: string }
  | { kind: 'preferences' }
  | { kind: 'palette' }
  | { kind: 'setup' }
  | { kind: 'file-picker'; root: string }
  | { kind: 'workspace-name'; mode: 'create' | 'rename' }
  | { kind: 'conversations'; paths: string[]; title: string; accountId?: string | null; replacePaneId?: string; projectPaths?: string[] }
  | { kind: 'release-notes'; version: string; notes: string }

let state: UiState = { app: null, connected: false, versionMismatch: null, focusedPaneId: null, newSession: null, error: null, sidebarCollapsed: false, flashPaneId: null, modal: null, renamingPaneId: null, missingResume: [], desktopMismatch: false, motion: 'subtle', update: { kind: 'idle' }, updateNotice: null }
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

let layoutOwner = true
/** a janela flutuante não é dona do layout do espaço: nunca grava (só a janela do espaço grava) */
export function setLayoutOwner(v: boolean): void {
  layoutOwner = v
}

/** o renderer é a fonte do layout: aplica local e salva no daemon */
export function updateLayout(fn: (l: Layout) => Layout): void {
  const app = state.app
  if (!app || !layoutOwner) return
  const layout = fn(app.layout)
  if (layout === app.layout) return
  setUi({ app: { ...app, layout } })
  window.gt.send({ t: 'layout.save', layout })
}

export function showError(e: unknown): void {
  setUi({ error: errorMessage(e) })
}
