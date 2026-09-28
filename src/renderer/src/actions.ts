import type { Layout, Tab } from '../../shared/types'
import { findTab, insertBeside, leaves, neighbor, removeLeaf, replaceLeaf, setSizes, splitLeaf, type Dir, type DropZone } from './layout'
import { attentionQueue, nextInQueue } from './attention'
import { focusAfterHide, splitCwd } from './focus'
import { getUi, setUi, showError, updateLayout } from './store'
import { terminals } from './terminals'

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
  requestAnimationFrame(() => terminals.focus(paneId))
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
  paneId?: string
  dir?: 'row' | 'column'
}): Promise<string> {
  const paneId = o.paneId ?? crypto.randomUUID()
  await window.gt.request({ t: 'pane.create', paneId, cwd: o.cwd, accountId: o.accountId, resumeSessionId: o.resumeSessionId, cols: 100, rows: 30 })
  placePane(paneId, o.dir ?? 'row')
  focusPane(paneId)
  return paneId
}

/** clique na sidebar: vai para a aba do painel (ou reabre em split) e pisca o contorno */
export function revealPane(paneId: string): void {
  placePane(paneId, 'row')
  focusPane(paneId)
  flash(paneId)
}

export function hidePane(paneId: string): void {
  const before = getUi().app?.layout
  const next = before && getUi().focusedPaneId === paneId ? focusAfterHide(before, paneId) : undefined
  updateLayout((l) => ({ ...l, tabs: l.tabs.map((t) => ({ ...t, root: t.root ? removeLeaf(t.root, paneId) : null })) }))
  if (next !== undefined) {
    if (next) focusPane(next)
    else setUi({ focusedPaneId: null })
  }
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
}

export function renameTab(tabId: string, name: string): void {
  const clean = name.trim()
  if (!clean) return
  updateLayout((l) => ({ ...l, tabs: l.tabs.map((t) => (t.id === tabId ? { ...t, name: clean } : t)) }))
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
  if (!paneId || !document.hasFocus()) return
  const p = getUi().app?.panes.find((x) => x.id === paneId)
  if (p?.claude?.status === 'your-turn') window.gt.send({ t: 'pane.seen', paneId })
}

export function revealNextAttention(): void {
  const ui = getUi()
  const next = nextInQueue(attentionQueue(ui.app?.panes ?? []), ui.focusedPaneId)
  if (next) revealPane(next)
}

export function runMenuAction(action: string): void {
  if (action === 'new-session') openNewSessionDialog()
  else if (action === 'split-right') splitFocused('row')
  else if (action === 'split-down') splitFocused('column')
  else if (action === 'hide-pane') {
    const id = getUi().focusedPaneId
    if (id) hidePane(id)
  } else if (action === 'next-attention') revealNextAttention()
  else if (action === 'new-tab') addTab()
  else if (action === 'toggle-sidebar') setUi((s) => ({ sidebarCollapsed: !s.sidebarCollapsed }))
  else if (action.startsWith('tab-')) {
    const n = Number(action.slice(4))
    updateLayout((l) => (l.tabs[n - 1] ? { ...l, activeTabId: l.tabs[n - 1].id } : l))
  } else if (action.startsWith('focus-')) moveFocus(action.slice(6) as Dir)
}
