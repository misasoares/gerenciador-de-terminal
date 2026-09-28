import { createRoot } from 'react-dom/client'
import type { AppState, PaneView } from '../../shared/types'
import { markSeenIfLooking, revealPane, runMenuAction } from './actions'
import { App } from './App'
import { dockBadge, noticesFor, throttleNotices } from './attention'
import { headerView } from './header'
import { leaves } from './layout'
import { getUi, setUi, showError } from './store'
import { terminals } from './terminals'
import './styles.css'

let seenFirstState = false
const sentNotices = new Map<string, number>()

function visiblePaneIds(): Set<string> {
  const app = getUi().app
  const tab = app?.layout.tabs.find((t) => t.id === app.layout.activeTabId)
  return new Set(leaves(tab?.root ?? null))
}

function onStateArrived(prevPanes: PaneView[] | null): void {
  const app = getUi().app
  if (!app) return
  window.gt.setBadge(dockBadge(app.panes))
  const notices = throttleNotices(
    noticesFor(seenFirstState ? prevPanes : null, app.panes, { windowFocused: document.hasFocus(), visible: visiblePaneIds() }),
    sentNotices,
    Date.now(),
  )
  seenFirstState = true
  for (const n of notices) {
    const p = app.panes.find((x) => x.id === n.paneId)
    if (!p) continue
    const h = headerView(p, app)
    const who = p.name ?? p.claude?.title ?? `sessão ${p.seq}`
    window.gt.notify({
      paneId: p.id,
      title: `${h.project.toUpperCase()} · ⎇ ${h.worktree}`,
      body: `${who} — ${n.kind === 'needs-you' ? 'pedindo permissão' : 'terminou, sua vez'}`,
    })
  }
  // olhando para o painel quando ele virou 🔵: já conta como visto
  markSeenIfLooking(getUi().focusedPaneId)
}

window.gt.onEvent((e) => {
  switch (e.t) {
    case 'state': {
      const prev = getUi().app
      // depois do primeiro carregamento o layout é do renderer (evita "voltar" com broadcast atrasado)
      setUi((s) => ({ app: s.app ? { ...e.state, layout: s.app.layout } : e.state, connected: true }))
      if (JSON.stringify(e.state.settings) !== JSON.stringify(prev?.settings)) terminals.applySettings(e.state.settings)
      onStateArrived(prev?.panes ?? null)
      break
    }
    case 'pane.data':
      terminals.onData(e.paneId, e.data, e.seq)
      break
    case 'disconnected':
      setUi({ connected: false })
      break
    case 'reconnected':
      setUi({ connected: true })
      terminals.reattachAll()
      break
    case 'version-mismatch':
      setUi({ versionMismatch: { daemon: e.daemon, app: e.app } })
      break
  }
})
window.gt.onMenu(runMenuAction)
window.addEventListener('focus', () => markSeenIfLooking(getUi().focusedPaneId))
window.gt.onReveal((paneId) => revealPane(paneId))
window.gt
  .request<AppState>({ t: 'state.get' })
  .then((app) => {
    setUi((s) => ({ app: s.app ?? app, connected: true }))
    terminals.applySettings(getUi().app?.settings ?? app.settings)
    // instalação nova: sem agentes, abre o assistente
    if ((getUi().app?.accounts ?? app.accounts).length === 0) setUi({ modal: { kind: 'setup' } })
  })
  .catch(showError)

createRoot(document.getElementById('root')!).render(<App />)
