import { useEffect, useMemo, useRef, useState } from 'react'
import type { PaneView } from '../../../shared/types'
import { hidePane, PANE_MIME } from '../actions'
import { headerView, textOn } from '../header'
import { getUi, setUi, useUi } from '../store'

export const STATUS_DOT = { working: '🟢', 'needs-you': '🟡', 'your-turn': '🔵', idle: '⚪', shell: '' } as const

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
  const renaming = useUi((s) => s.renamingPaneId === pane.id)
  return (
    <div className={`pane-header${flash ? ' flash' : ''}`} draggable={!renaming} onDragStart={(e) => e.dataTransfer.setData(PANE_MIME, pane.id)}>
      <div className="ph-row1">
        {outside ? (
          <>
            <span className="ph-block ph-unknown">?</span>
            <span className="ph-path" title={pane.cwd}>
              {h.worktree}
            </span>
          </>
        ) : (
          <>
            <span className="ph-block ph-project" style={pane.color ? { background: pane.color, color: textOn(pane.color) } : undefined}>
              {h.project.toUpperCase()}
            </span>
            <span className={`ph-block ph-worktree${h.isMainWorktree ? '' : ' extra'}`}>⎇ {h.worktree}</span>
          </>
        )}
        {renaming ? (
          <input
            className="ph-rename"
            autoFocus
            defaultValue={pane.name ?? ''}
            placeholder={h.label}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setUi({ renamingPaneId: null })
            }}
            onBlur={(e) => {
              if (getUi().renamingPaneId === pane.id) window.gt.send({ t: 'pane.meta', paneId: pane.id, name: e.target.value })
              setUi({ renamingPaneId: null })
            }}
          />
        ) : (
          <span className="ph-label" title={`${h.label} — duplo clique para renomear`} onDoubleClick={() => setUi({ renamingPaneId: pane.id })}>
            {h.label}
          </span>
        )}
        {/* à direita, fixos: nunca somem por falta de espaço */}
        <span className="ph-fixed">
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
        </span>
      </div>
      <div className="ph-row2">
        {outside ? (
          <>
            <span className="ph-muted">pasta não cadastrada</span>
            {onAddProject && (
              <button className="ph-link" onClick={() => onAddProject(pane.cwd)}>
                + Adicionar projeto
              </button>
            )}
          </>
        ) : (
          <>
            <span className="ph-branch" title={h.branch ?? 'HEAD destacado'}>
              {h.branch ?? 'HEAD destacado'}
            </span>
            <span className="ph-fixed">
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
            </span>
          </>
        )}
      </div>
    </div>
  )
}
