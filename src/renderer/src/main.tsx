import { createRoot } from 'react-dom/client'
import type { AppState } from '../../shared/types'
import { runMenuAction } from './actions'
import { App } from './App'
import { setUi, showError } from './store'
import { terminals } from './terminals'
import './styles.css'

window.gt.onEvent((e) => {
  switch (e.t) {
    case 'state':
      // depois do primeiro carregamento o layout é do renderer (evita "voltar" com broadcast atrasado)
      setUi((s) => ({ app: s.app ? { ...e.state, layout: s.app.layout } : e.state, connected: true }))
      break
    case 'pane.data':
      terminals.onData(e.paneId, e.data)
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
window.gt
  .request<AppState>({ t: 'state.get' })
  .then((app) => setUi((s) => ({ app: s.app ?? app, connected: true })))
  .catch(showError)

createRoot(document.getElementById('root')!).render(<App />)
