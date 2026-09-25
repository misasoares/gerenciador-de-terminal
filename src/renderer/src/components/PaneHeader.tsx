import { useEffect, useMemo, useRef, useState } from 'react'
import type { PaneView } from '../../../shared/types'
import { hidePane, PANE_MIME } from '../actions'
import { headerView } from '../header'
import { useUi } from '../store'

export const STATUS_DOT = { working: '🟢', 'needs-you': '🟡', idle: '⚪', shell: '' } as const

/** Cabeçalho "C" do wireframe: bloco do projeto + bloco da worktree colados no início */
export function PaneHeader({ pane, compact, onAddProject }: { pane: PaneView; compact: boolean; onAddProject?: (dir: string) => void }) {
  const projects = useUi((s) => s.app!.projects)
  const accounts = useUi((s) => s.app!.accounts)
  const userHome = useUi((s) => s.app!.userHome)
  const h = useMemo(() => headerView(pane, { projects, accounts, userHome }), [pane, projects, accounts, userHome])

  const [flash, setFlash] = useState(false)
  const prev = useRef(pane.worktreePath)
  useEffect(() => {
    if (prev.current === pane.worktreePath) return
    prev.current = pane.worktreePath
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 600)
    return () => clearTimeout(t)
  }, [pane.worktreePath])

  const outside = pane.projectPath === null
  return (
    <div className={`pane-header${flash ? ' flash' : ''}`} draggable onDragStart={(e) => e.dataTransfer.setData(PANE_MIME, pane.id)}>
      {outside ? (
        <>
          <span className="ph-block ph-unknown">?</span>
          <span className="ph-path">{h.worktree}</span>
          {!compact && <span className="ph-muted">pasta não cadastrada</span>}
          {onAddProject && (
            <button className="ph-link" onClick={() => onAddProject(pane.cwd)}>
              + Adicionar projeto
            </button>
          )}
        </>
      ) : (
        <>
          <span className="ph-block ph-project">{h.project.toUpperCase()}</span>
          <span className={`ph-block ph-worktree${h.isMainWorktree ? '' : ' extra'}`}>⎇ {h.worktree}</span>
          {!compact && h.branch && <span className="ph-branch">{h.branch}</span>}
          <span className={h.changed ? 'ph-changed dirty' : 'ph-changed'}>
            ● {h.changed}
            {!compact && ' alterados'}
          </span>
          <span className="ph-sync" title={h.hasUpstream ? undefined : 'branch sem upstream'}>
            ↑{h.ahead} ↓{h.behind}
          </span>
          {h.warning && (
            <span className="ph-warn" title={h.warning}>
              ⚠
            </span>
          )}
        </>
      )}
      <span className="ph-spacer" />
      {h.status !== 'shell' && <span className="ph-status">{STATUS_DOT[h.status]}</span>}
      {h.account &&
        (compact ? (
          <span className="ph-account-square" style={{ background: h.account.color }} title={h.account.label} />
        ) : (
          <span className="ph-account" style={{ color: h.account.color, borderColor: h.account.color }}>
            {h.account.label}
          </span>
        ))}
      <button className="ph-close" title="Esconder painel (a sessão continua rodando) ⌘W" onClick={() => hidePane(pane.id)}>
        ✕
      </button>
    </div>
  )
}
