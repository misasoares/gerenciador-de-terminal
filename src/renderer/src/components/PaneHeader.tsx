import { useEffect, useMemo, useRef, useState } from 'react'
import type { PaneView } from '../../../shared/types'
import { floatPane, hidePane, PANE_MIME } from '../actions'
import { gitBadges, headerView, sharesContext, textOn } from '../header'
import { getUi, setUi, useUi } from '../store'

export const STATUS_DOT = { working: '🟢', 'needs-you': '🟡', 'your-turn': '🔵', idle: '⚪', shell: '' } as const

/** Cabeçalho "C" do wireframe: bloco do projeto + bloco da worktree colados no início */
export function PaneHeader({ pane, compact, onAddProject }: { pane: PaneView; compact: boolean; onAddProject?: (dir: string) => void }) {
  const projects = useUi((s) => s.app!.projects)
  const accounts = useUi((s) => s.app!.accounts)
  const userHome = useUi((s) => s.app!.userHome)
  const h = useMemo(() => headerView(pane, { projects, accounts, userHome }), [pane, projects, accounts, userHome])
  // aba toda no mesmo projeto/worktree: projeto e worktree ficam discretos (a informação se repete em cada painel)
  const quiet = useUi((s) => (s.app ? sharesContext(pane.id, s.app.layout, s.app.panes) : false))
  const showGit = useUi((s) => s.app!.settings.showGitStatus)
  const g = gitBadges(h, showGit)

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
            <span
              className={`ph-block ph-project${quiet ? ' quiet' : ''}`}
              style={quiet ? (h.projectColor ? { color: h.projectColor } : undefined) : h.projectColor ? { background: h.projectColor, color: textOn(h.projectColor) } : undefined}
              title={quiet ? 'todos os painéis desta aba estão neste projeto e worktree' : undefined}
            >
              {h.project.toUpperCase()}
            </span>
            <span className={`ph-block ph-worktree${h.isMainWorktree ? '' : ' extra'}${quiet ? ' quiet' : ''}`}
              title={h.worktreeInferred ? `o agente está editando em ${h.worktree}; o shell está em ${h.shellWorktree ?? 'outra pasta'}` : undefined}
            >
              ⎇ {h.worktree}
              {h.worktreeInferred ? ' ·' : ''}
            </span>
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
          <span
            className={`ph-label${h.sessionColor ? ' colored' : ''}`}
            style={h.sessionColor ? { background: h.sessionColor, color: textOn(h.sessionColor) } : undefined}
            title={`${h.label} — duplo clique para renomear`}
            onDoubleClick={() => setUi({ renamingPaneId: pane.id })}
          >
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
          <button className="ph-close" title="Flutuar · ⇧⌘F" onClick={() => floatPane(pane.id)}>
            ⧉
          </button>
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
            <span className="ph-branch" title={h.hasUpstream ? (h.branch ?? 'HEAD destacado') : `${h.branch ?? 'HEAD destacado'} · branch sem upstream`}>
              {h.branch ?? 'HEAD destacado'}
            </span>
            <span className="ph-fixed">
              {g.changed !== null && (
                <span className="ph-changed dirty">
                  ● {g.changed}
                  {!compact && (g.changed === 1 ? ' alterado' : ' alterados')}
                </span>
              )}
              {(g.ahead !== null || g.behind !== null) && (
                <span className="ph-sync">{[g.ahead !== null && `↑${g.ahead}`, g.behind !== null && `↓${g.behind}`].filter(Boolean).join(' ')}</span>
              )}
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
