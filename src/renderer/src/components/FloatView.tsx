import { useEffect, useMemo } from 'react'
import { isFilePane } from '../file-model'
import { isTeamPane } from '../team-model'
import { TeamPane } from './TeamPane'
import { headerView } from '../header'
import { useUi } from '../store'
import { GLASS } from '../view'
import { FilePane } from './FilePane'
import { FloatControls } from './FloatControls'
import { PaneFrame } from './PaneFrame'
import { STATUS_DOT } from './PaneHeader'

/** janela flutuante: um painel só, com cabeçalho que arrasta a janela */
export function FloatView({ paneId }: { paneId: string }) {
  const ready = useUi((s) => s.app !== null)
  const pane = useUi((s) => s.app?.panes.find((p) => p.id === paneId))
  const projects = useUi((s) => s.app?.projects)
  const accounts = useUi((s) => s.app?.accounts)
  const userHome = useUi((s) => s.app?.userHome ?? '')
  const opacity = useUi((s) => s.app?.workspaces.find((w) => w.id === s.app?.workspaceId)?.floating.find((f) => f.paneId === paneId)?.opacity ?? 1)
  // mac: o fundo deixa o vidro (borrão do que está atrás) aparecer; o texto continua inteiro
  useEffect(() => {
    if (!GLASS) return
    document.documentElement.classList.add('glass')
    document.documentElement.style.setProperty('--glass-alpha', String(opacity))
  }, [opacity])
  const h = useMemo(() => (pane && projects && accounts ? headerView(pane, { projects, accounts, userHome }) : null), [pane, projects, accounts, userHome])
  if (!ready) return <div className="loading">Conectando ao daemon…</div>
  if (isFilePane(paneId)) {
    return (
      <div className="float-root">
        <FilePane paneId={paneId} floating />
      </div>
    )
  }
  if (isTeamPane(paneId)) {
    return (
      <div className="float-root">
        <TeamPane paneId={paneId} floating />
      </div>
    )
  }
  const status = pane?.claude?.status
  return (
    <div className={`float-root${status === 'needs-you' ? ' needs-you' : status === 'your-turn' ? ' your-turn' : ''}`}>
      <div className="float-header">
        {h && (
          <span className="float-title" title={pane?.cwd}>
            {h.status !== 'shell' && <span>{STATUS_DOT[h.status]}</span>}
            <b>{h.project.toUpperCase()}</b>
            <span className="float-dim">⎇ {h.worktree}</span>
            <span>{h.label}</span>
          </span>
        )}
        <span className="ph-spacer" />
        <FloatControls paneId={paneId} />
      </div>
      <div className="float-body">
        <PaneFrame paneId={paneId} floating />
      </div>
    </div>
  )
}
