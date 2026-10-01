import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { closeDeadPane, dropOnPane, focusPane, openNewPane, PANE_MIME } from '../actions'
import { tildify } from '../header'
import { chooseConversationFor } from '../flows'
import { isMissing } from '../conversations-model'
import { dropZone, type DropZone } from '../layout'
import { setUi, showError, useUi } from '../store'
import { PaneHeader } from './PaneHeader'
import { TerminalView } from './TerminalView'

const COMPACT_BELOW = 320

export function PaneFrame({ paneId, onAddProject }: { paneId: string; onAddProject?: (dir: string) => void }) {
  const pane = useUi((s) => s.app?.panes.find((p) => p.id === paneId))
  const focused = useUi((s) => s.focusedPaneId === paneId)
  const flashing = useUi((s) => s.flashPaneId === paneId)
  const resumable = useUi((s) => s.app?.resumable.find((r) => r.paneId === paneId))
  const missing = useUi((s) => s.missingResume.includes(paneId))
  const accounts = useUi((s) => s.app?.accounts)
  const userHome = useUi((s) => s.app?.userHome ?? '')
  const [zone, setZone] = useState<DropZone | null>(null)
  const [compact, setCompact] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current!
    const ro = new ResizeObserver(() => setCompact(el.clientWidth < COMPACT_BELOW))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const zoneAt = (e: React.DragEvent<HTMLDivElement>): DropZone => {
    const r = e.currentTarget.getBoundingClientRect()
    return dropZone((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }

  const resume = () => {
    if (!resumable) return
    openNewPane({ paneId, cwd: resumable.cwd, accountId: resumable.accountId, resumeSessionId: resumable.sessionId ?? undefined, resumeAgent: resumable.agent, transcriptPath: resumable.transcriptPath ?? null }).catch((e) => {
      if (isMissing(e)) setUi((s) => ({ missingResume: [...s.missingResume.filter((id) => id !== paneId), paneId] }))
      else showError(e)
    })
  }

  const status = pane?.claude?.status
  const cls = ['pane', focused && 'focused', status === 'needs-you' && 'needs-you', status === 'your-turn' && 'your-turn', flashing && 'flash-outline']
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={ref}
      className={cls}
      data-pane-id={paneId}
      onMouseDown={() => focusPane(paneId)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PANE_MIME)) return
        e.preventDefault()
        setZone(zoneAt(e))
      }}
      onDragLeave={() => setZone(null)}
      onDrop={(e) => {
        const dragged = e.dataTransfer.getData(PANE_MIME)
        setZone(null)
        if (!dragged || dragged === paneId) return
        e.preventDefault()
        dropOnPane(dragged, paneId, zoneAt(e))
      }}
    >
      {pane && <PaneHeader pane={pane} compact={compact} onAddProject={onAddProject} />}
      {pane?.alive ? (
        <TerminalView paneId={paneId} />
      ) : resumable ? (
        <div className="pane-dead">
          <div className="pane-dead-title">{missing ? 'A conversa salva não foi encontrada' : resumable.sessionId ? 'sessão perdida' : 'terminal perdido'}</div>
          <div className="pane-dead-actions">
            {missing ? (
              <button className="primary" onClick={() => chooseConversationFor(paneId)}>
                Escolher conversa…
              </button>
            ) : (
              <button className="primary" onClick={resume}>
                {resumable.sessionId ? 'Retomar sessão' : 'Abrir de novo'}
              </button>
            )}
            <button onClick={() => closeDeadPane(paneId)}>Descartar</button>
          </div>
          <div className="pane-dead-detail">
            {resumable.sessionId ? (resumable.agent === 'codex' ? 'codex resume · ' : 'claude --resume · ') : ''}
            {tildify(resumable.cwd, userHome)}
            {resumable.accountId ? ` · ${accounts?.find((a) => a.id === resumable.accountId)?.label ?? resumable.accountId}` : ''}
          </div>
        </div>
      ) : (
        <div className="pane-dead">
          <div className="pane-dead-title">
            {pane ? `terminal encerrado${pane.exitCode !== null ? ` (código ${pane.exitCode})` : ''}` : 'painel indisponível'}
          </div>
          <div className="pane-dead-actions">
            <button onClick={() => closeDeadPane(paneId)}>Fechar</button>
          </div>
        </div>
      )}
      {zone && <div className={`drop-zone drop-${zone}`} />}
    </div>
  )
}
