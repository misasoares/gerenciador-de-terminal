import { EmptyState } from './components/EmptyState'
import { HooksBanner } from './components/HooksBanner'
import { Modals } from './components/Modals'
import { NewSessionDialog } from './components/NewSessionDialog'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { Workspace } from './components/Workspace'
import { addProjectFlow } from './flows'
import { useUi } from './store'

export function App() {
  const ready = useUi((s) => s.app !== null)
  const hasProjects = useUi((s) => (s.app?.projects.length ?? 0) > 0)
  if (!ready) return <div className="loading">Conectando ao daemon…</div>
  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        const file = e.dataTransfer.files[0]
        if (!file) return
        e.preventDefault()
        void addProjectFlow(window.gt.pathForFile(file))
      }}
    >
      <Sidebar />
      <main className="main">
        <HooksBanner />
        <Workspace empty={<EmptyState hasProjects={hasProjects} />} onAddProject={(dir) => void addProjectFlow(dir)} />
        <StatusBar />
      </main>
      <NewSessionDialog />
      <Modals />
    </div>
  )
}
