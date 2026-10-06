import type { AgentKind, Layout, Tab } from '../../shared/types'
import { findTab, insertBeside, leaves, neighbor, removeLeaf, removePane, replaceLeaf, setSizes, splitLeaf, type Dir, type DropZone, withTabColor, dockPane, withPaneInNewTab, type Side } from './layout'
import { attentionQueue, nextInQueue } from './attention'
import { focusAfterHide, lookingAt, shouldFocusTerminal, splitCwd } from './focus'
import { getUi, setUi, showError, updateLayout } from './store'
import { revealTarget } from './float-model'
import { FLOAT_PANE, GPU_OK } from './view'
import { animateOut } from './pane-motion'
import { presetsFor } from './motion-presets'
import { terminals } from './terminals'
import { findFilePane, insertFileLeaf, isFilePane, languageFor, pickerRoot } from './file-model'

export const PANE_MIME = 'application/x-gt-pane'

export function activeTab(l: Layout): Tab | undefined {
  return l.tabs.find((t) => t.id === l.activeTabId)
}

const newTab = (n: number, root: Tab['root']): Tab => ({ id: crypto.randomUUID(), name: `Aba ${n}`, root })

/** coloca o painel na aba ativa, ao lado do painel em foco (ou só ativa a aba onde ele já está) */
export function placePane(paneId: string, dir: 'row' | 'column'): void {
  updateLayout((l) => {
    const owner = findTab(l, paneId)
    if (owner) return l.activeTabId === owner.id ? l : { ...l, activeTabId: owner.id }
    const tab = activeTab(l)
    if (!tab) {
      const t = newTab(l.tabs.length + 1, { type: 'leaf', paneId })
      return { tabs: [...l.tabs, t], activeTabId: t.id }
    }
    const inTab = leaves(tab.root)
    const focused = getUi().focusedPaneId
    const target = focused && inTab.includes(focused) ? focused : inTab[inTab.length - 1]
    const root = tab.root && target ? splitLeaf(tab.root, target, paneId, dir) : ({ type: 'leaf', paneId } as const)
    return { ...l, tabs: l.tabs.map((t) => (t.id === tab.id ? { ...t, root } : t)) }
  })
}

export function focusPane(paneId: string): void {
  setUi({ focusedPaneId: paneId })
  markSeenIfLooking(paneId)
  requestAnimationFrame(() => {
    if (shouldFocusTerminal(getUi(), paneId)) terminals.focus(paneId)
  })
}

function flash(paneId: string): void {
  setUi({ flashPaneId: paneId })
  setTimeout(() => {
    if (getUi().flashPaneId === paneId) setUi({ flashPaneId: null })
  }, 700)
}

export async function openNewPane(o: {
  cwd: string
  accountId: string | null
  resumeSessionId?: string
  resumeAgent?: AgentKind
  transcriptPath?: string | null
  paneId?: string
  dir?: 'row' | 'column'
}): Promise<string> {
  const paneId = o.paneId ?? crypto.randomUUID()
  await window.gt.request({ t: 'pane.create', paneId, cwd: o.cwd, accountId: o.accountId, resumeSessionId: o.resumeSessionId, resumeAgent: o.resumeAgent, transcriptPath: o.transcriptPath ?? null, cols: 100, rows: 30 })
  placePane(paneId, o.dir ?? 'row')
  focusPane(paneId)
  return paneId
}

/** clique na sidebar: vai para a aba do painel (ou reabre em split) e pisca o contorno */
export function revealPane(paneId: string): void {
  // flutuante: foca a janela dela (troca de mesa), nunca a põe de volta na grade
  const app = getUi().app
  if (app && revealTarget(app, paneId) === 'float') {
    void window.gt.focusFloat(paneId)
    return
  }
  placePane(paneId, 'row')
  focusPane(paneId)
  flash(paneId)
}

export function hidePane(paneId: string): void {
  const before = getUi().app?.layout
  const next = before && getUi().focusedPaneId === paneId ? focusAfterHide(before, paneId) : undefined
  updateLayout((l) => removePane(l, paneId))
  const after = getUi().app?.layout
  // a aba ativa fechou (ficou vazia): o foco vai para a aba que ficou ativa
  if (before && after?.activeTabId && after.activeTabId !== before.activeTabId) activateTab(after.activeTabId)
  else if (next !== undefined) {
    if (next) focusPane(next)
    else setUi({ focusedPaneId: null })
  }
}

const closing = new Set<string>()
/** fechar pelo usuário (✕, ⌘W): o painel encolhe e esmaece, e só então sai da grade (⌘W repetido no meio não fecha duas vezes) */
export async function hidePaneAnimated(paneId: string): Promise<void> {
  if (closing.has(paneId)) return
  closing.add(paneId)
  try {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const p = presetsFor(getUi().motion, { reduced, gpu: GPU_OK })
    await animateOut(paneId, { opacity: 0, scale: p.reduced ? 1 : 0.98 }, p.exit)
  } finally {
    closing.delete(paneId)
  }
  hidePane(paneId)
}

export function togglePane(paneId: string): void {
  const l = getUi().app?.layout
  if (l && findTab(l, paneId)) hidePane(paneId)
  else revealPane(paneId)
}

/** soltar um painel sobre outro: bordas dividem daquele lado, centro substitui (o alvo fica oculto, vivo) */
export function dropOnPane(dragged: string, target: string, zone: DropZone): void {
  if (dragged === target) return
  updateLayout((l) => {
    const tabs = l.tabs.map((t) => ({ ...t, root: t.root ? removeLeaf(t.root, dragged) : null }))
    const tab = tabs.find((t) => leaves(t.root).includes(target))
    if (!tab || !tab.root) return l
    const root = zone === 'center' ? replaceLeaf(tab.root, target, dragged) : insertBeside(tab.root, target, dragged, zone)
    return { tabs: tabs.map((t) => (t.id === tab.id ? { ...t, root } : t)), activeTabId: tab.id }
  })
  focusPane(dragged)
}

/** encosta o painel numa borda da aba inteira (abaixo/acima/ao lado de todos) */
export function dockPaneAt(paneId: string, tabId: string, side: Side): void {
  updateLayout((l) => dockPane(l, paneId, tabId, side))
  focusPane(paneId)
}

/** leva o painel para uma aba nova */
export function movePaneToNewTab(paneId: string): void {
  updateLayout((l) => withPaneInNewTab(l, paneId, newTab(l.tabs.length + 1, null)))
  focusPane(paneId)
}

export function moveToTab(paneId: string, tabId: string): void {
  updateLayout((l) => {
    const tabs = l.tabs.map((t) => ({ ...t, root: t.root ? removeLeaf(t.root, paneId) : null }))
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return l
    const last = leaves(tab.root).at(-1)
    const root = tab.root && last ? splitLeaf(tab.root, last, paneId, 'row') : ({ type: 'leaf', paneId } as const)
    return { tabs: tabs.map((t) => (t.id === tabId ? { ...t, root } : t)), activeTabId: tabId }
  })
  focusPane(paneId)
}

export function closeDeadPane(paneId: string): void {
  hidePane(paneId)
  terminals.dispose(paneId)
  window.gt.send({ t: 'pane.forget', paneId })
  window.gt.send({ t: 'resume.dismiss', paneId })
}

/** encerrar: pede confirmação só se o Claude estiver trabalhando (🟢) */
export function requestKill(paneId: string): void {
  const pane = getUi().app?.panes.find((p) => p.id === paneId)
  if (pane?.claude?.status === 'working') setUi({ modal: { kind: 'kill', paneId } })
  else window.gt.send({ t: 'pane.kill', paneId })
}

export function splitFocused(dir: 'row' | 'column'): void {
  const ui = getUi()
  if (!ui.app) return
  openNewPane({ cwd: splitCwd(ui.app, ui.focusedPaneId), accountId: null, dir }).catch(showError)
}

export function addTab(): void {
  updateLayout((l) => {
    const t = newTab(l.tabs.length + 1, null)
    return { tabs: [...l.tabs, t], activeTabId: t.id }
  })
}

export function closeTab(tabId: string): void {
  updateLayout((l) => {
    const tabs = l.tabs.filter((t) => t.id !== tabId)
    const activeTabId = l.activeTabId === tabId ? (tabs[tabs.length - 1]?.id ?? null) : l.activeTabId
    return { tabs, activeTabId }
  })
  const active = getUi().app?.layout.activeTabId
  if (active) activateTab(active)
  else setUi({ focusedPaneId: null })
}

export function renameTab(tabId: string, name: string): void {
  const clean = name.trim()
  if (!clean) return
  updateLayout((l) => ({ ...l, tabs: l.tabs.map((t) => (t.id === tabId ? { ...t, name: clean } : t)) }))
}

export function setTabColor(tabId: string, color: string | null): void {
  updateLayout((l) => withTabColor(l, tabId, color))
}

const sizeTimers = new Map<string, ReturnType<typeof setTimeout>>()
export function saveSizes(tabId: string, path: number[], sizes: number[]): void {
  const key = `${tabId}:${path.join('.')}`
  clearTimeout(sizeTimers.get(key))
  sizeTimers.set(
    key,
    setTimeout(() => {
      updateLayout((l) => ({ ...l, tabs: l.tabs.map((t) => (t.id === tabId && t.root ? { ...t, root: setSizes(t.root, path, sizes) } : t)) }))
    }, 400),
  )
}

export function openNewSessionDialog(projectPath?: string, worktreePath?: string): void {
  const ui = getUi()
  const p = ui.app?.panes.find((x) => x.id === ui.focusedPaneId)
  setUi({ newSession: { projectPath: projectPath ?? p?.projectPath ?? null, worktreePath: worktreePath ?? p?.worktreePath ?? null } })
}

export function moveFocus(dir: Dir): void {
  const rects = [...document.querySelectorAll<HTMLElement>('[data-pane-id]')].map((el) => {
    const r = el.getBoundingClientRect()
    return { id: el.dataset.paneId!, x: r.left, y: r.top, w: r.width, h: r.height }
  })
  const next = neighbor(rects, getUi().focusedPaneId, dir)
  if (next) focusPane(next)
}

/** o usuário está olhando para o painel: janela focada e painel em foco → 🔵 vira ⚪ no daemon */
export function markSeenIfLooking(paneId: string | null): void {
  const id = lookingAt(getUi().app, paneId, document.hasFocus())
  if (id) window.gt.send({ t: 'pane.seen', paneId: id })
}

/** trocar de aba leva o foco para um painel dela (o foco antigo ficaria numa aba escondida) */
export function activateTab(tabId: string): void {
  updateLayout((l) => (l.activeTabId === tabId || !l.tabs.some((t) => t.id === tabId) ? l : { ...l, activeTabId: tabId }))
  const tab = getUi().app?.layout.tabs.find((t) => t.id === tabId)
  const last = leaves(tab?.root ?? null).at(-1)
  if (last) focusPane(last)
  else setUi({ focusedPaneId: null })
}

export function revealNextAttention(): void {
  const ui = getUi()
  const next = nextInQueue(attentionQueue(ui.app?.panes ?? []), ui.focusedPaneId)
  if (next) revealPane(next)
}

/** tira da grade e abre numa janela flutuante (terminal, sessão ou arquivo) */
export function floatPane(paneId: string): void {
  hidePane(paneId)
  window.gt.request({ t: 'float.set', paneId, mode: 'float' }).catch(showError)
}

/** volta da flutuante para a grade (aba ativa do espaço) */
export function dockFloat(paneId: string): void {
  window.gt.request({ t: 'float.set', paneId, mode: 'dock' }).catch(showError)
}

/** fecha a flutuante sem encaixar: a sessão segue viva e oculta; arquivo com alteração pergunta antes */
export async function hideFloat(paneId: string): Promise<void> {
  if (dirtyFiles.has(paneId)) {
    const r = await window.gt.confirm({ message: 'Fechar o arquivo sem salvar?', detail: 'As alterações não salvas serão perdidas.', confirmLabel: 'Fechar sem salvar' })
    if (!r.ok) return
  }
  await window.gt.request({ t: 'float.set', paneId, mode: 'hide' }).catch(showError)
}

export function runMenuAction(action: string): void {
  // janela flutuante: ⌘W esconde, ⇧⌘F encaixa; o resto vai para a janela do espaço (aqui não há grade nem modais)
  if (FLOAT_PANE) {
    if (action === 'hide-pane') void hideFloat(FLOAT_PANE)
    else if (action === 'toggle-float') dockFloat(FLOAT_PANE)
    else if (action === 'open-file') openFilePicker()
    else void window.gt.toWorkspace({ t: 'menu', action }).catch(showError)
    return
  }
  if (action === 'toggle-float') {
    const id = getUi().focusedPaneId
    if (id) floatPane(id)
    return
  }
  if (action === 'new-session') openNewSessionDialog()
  else if (action === 'split-right') splitFocused('row')
  else if (action === 'split-down') splitFocused('column')
  else if (action === 'hide-pane') {
    const id = getUi().focusedPaneId
    if (id && isFilePane(id)) void requestCloseFile(id)
    else if (id) void hidePaneAnimated(id)
    else window.close() // sem painel em foco, ⌘W fecha a janela do espaço (as sessões continuam)
  } else if (action === 'new-workspace') setUi({ modal: { kind: 'workspace-name', mode: 'create' } })
  else if (action === 'rename-workspace') setUi({ modal: { kind: 'workspace-name', mode: 'rename' } })
  else if (action === 'end-workspace') void endWorkspace()
  else if (action === 'next-attention') revealNextAttention()
  else if (action === 'preferences') setUi({ modal: { kind: 'preferences' } })
  else if (action === 'palette') setUi({ modal: { kind: 'palette' } })
  else if (action === 'open-file') openFilePicker()
  else if (action === 'setup') setUi({ modal: { kind: 'setup' } })
  else if (action === 'new-tab') addTab()
  else if (action === 'toggle-sidebar') setUi((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))
  else if (action.startsWith('tab-')) {
    const n = Number(action.slice(4))
    const tab = getUi().app?.layout.tabs[n - 1]
    if (tab) activateTab(tab.id)
  } else if (action.startsWith('focus-')) moveFocus(action.slice(6) as Dir)
}

/** encerra as sessões do espaço (ficam para retomar) e fecha a janela */
async function endWorkspace(): Promise<void> {
  const app = getUi().app
  if (!app) return
  const w = app.workspaces.find((x) => x.id === app.workspaceId)
  const n = w?.sessions ?? 0
  const detail = n === 0 ? 'Não há sessões rodando.' : n === 1 ? 'A sessão será encerrada e fica para retomar.' : `As ${n} sessões serão encerradas e ficam para retomar.`
  const r = await window.gt.confirm({ message: `Encerrar o espaço ${w?.name ?? ''}?`, detail, confirmLabel: 'Encerrar espaço' })
  if (!r.ok) return
  try {
    await window.gt.request({ t: 'workspace.end', id: app.workspaceId })
    window.close()
  } catch (e) {
    showError(e)
  }
}

/** ids de painéis de arquivo com alteração não salva (o FilePane mantém) */
export const dirtyFiles = new Set<string>()
/** linha para onde o painel recém-aberto deve rolar */
export const pendingLine = new Map<string, number>()

export async function openFile(path: string, o: { line?: number | null; besideId?: string | null } = {}): Promise<void> {
  // na flutuante o arquivo abre na grade da janela do espaço
  if (FLOAT_PANE) return window.gt.toWorkspace({ t: 'open-file', path, line: o.line ?? null }).catch(showError)
  const app = getUi().app
  if (!app) return
  const open = findFilePane(app.filePanes, app.layout, path)
  if (open) {
    if (o.line) pendingLine.set(open, o.line)
    revealPane(open)
    return
  }
  const id = `file:${crypto.randomUUID()}`
  if (o.line) pendingLine.set(id, o.line)
  await window.gt.request({ t: 'filepane.set', id, path, mode: languageFor(path) === 'markdown' ? 'view' : 'edit' })
  updateLayout((l) => insertFileLeaf(l, id, o.besideId ?? getUi().focusedPaneId, newTab(l.tabs.length + 1, null)))
  focusPane(id)
}

export async function requestCloseFile(id: string): Promise<void> {
  if (dirtyFiles.has(id)) {
    const name = (getUi().app?.filePanes[id]?.path ?? '').split('/').pop() ?? ''
    const r = await window.gt.confirm({ message: `Descartar as alterações em ${name}?`, confirmLabel: 'Descartar' })
    if (!r.ok) return
  }
  dirtyFiles.delete(id)
  await hidePaneAnimated(id)
}

export function openFilePicker(root?: string): void {
  const app = getUi().app
  if (!app) return
  const r = root ?? pickerRoot(app, getUi().focusedPaneId)
  if (FLOAT_PANE) void window.gt.toWorkspace({ t: 'pick-file', root: r }).catch(showError)
  else setUi({ modal: { kind: 'file-picker', root: r } })
}
