import { Workspace } from './components/Workspace'
import { useUi } from './store'

export function App() {
  const ready = useUi((s) => s.app !== null)
  if (!ready) return <div className="loading">Conectando ao daemon…</div>
  return (
    <div className="app">
      <main className="main">
        <Workspace />
      </main>
    </div>
  )
}
