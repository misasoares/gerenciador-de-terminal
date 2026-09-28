import { useMemo, useState } from 'react'
import { openNewSessionDialog, PANE_MIME, revealPane } from '../actions'
import { addProjectFlow, projectMenu, sessionMenu, worktreeMenu } from '../flows'
import { buildSidebar, isExpanded, railLabel, type ProjectItem, type SessionItem } from '../sidebar-model'
import { useUi } from '../store'
import { STATUS_DOT } from './PaneHeader'

function Summary({ s }: { s: ProjectItem['summary'] }) {
  return (
    <span className="sb-summary">
      {s.needsYou > 0 && <span>🟡{s.needsYou}</span>}
      {s.yourTurn > 0 && <span>🔵{s.yourTurn}</span>}
      {s.working > 0 && <span>🟢{s.working}</span>}
      {s.idle > 0 && <span>⚪{s.idle}</span>}
    </span>
  )
}

function SessionRow({ s, outside }: { s: SessionItem; outside?: boolean }) {
  const focused = useUi((st) => st.focusedPaneId === s.paneId)
  const cls = ['sb-session', focused && 'focused', !s.alive && 'dead', s.hidden && 'hidden'].filter(Boolean).join(' ')
  return (
    <div
      className={cls}
      draggable={s.alive}
      onDragStart={(e) => e.dataTransfer.setData(PANE_MIME, s.paneId)}
      onClick={() => revealPane(s.paneId)}
      onContextMenu={(e) => {
        e.preventDefault()
        void sessionMenu(s)
      }}
      title={s.cwd}
    >
      <span className="dot">{STATUS_DOT[s.status] || '›'}</span>
      <span className="sb-label">{s.label}</span>
      {s.hidden && <span className="sb-tag">oculta</span>}
      {s.tab !== null && <span className="sb-tab">{s.tab}</span>}
      {outside && (
        <button
          className="sb-mini"
          onClick={(e) => {
            e.stopPropagation()
            void addProjectFlow(s.cwd)
          }}
        >
          + projeto
        </button>
      )}
    </div>
  )
}

function Tree() {
  const app = useUi((s) => s.app)
  const focusedId = useUi((s) => s.focusedPaneId)
  const model = useMemo(() => (app ? buildSidebar(app) : null), [app])
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  if (!app || !model) return null
  const focusedProject = app.panes.find((p) => p.id === focusedId)?.projectPath ?? null

  return (
    <>
      <div className="sb-title">
        <span>PROJETOS{model.projects.length === 0 && <span className="sb-dim"> nenhum ainda</span>}</span>
        <button className="sb-mini" title="Adicionar projeto" onClick={() => void addProjectFlow()}>
          +
        </button>
      </div>
      {model.projects.map((p) => {
        const open = isExpanded(p.path, focusedProject, overrides, model.projects.length)
        return (
          <div key={p.path} className="sb-project">
            <div
              className="sb-project-row"
              onClick={() => setOverrides((o) => ({ ...o, [p.path]: !open }))}
              onContextMenu={(e) => {
                e.preventDefault()
                void projectMenu(p)
              }}
              title={p.path}
            >
              <span className="sb-caret">{open ? '▾' : '▸'}</span>
              <span className="sb-name">{p.name.toUpperCase()}</span>
              {(p.error || p.fetchError) && (
                <span className="ph-warn" title={p.error ?? p.fetchError ?? ''}>
                  ⚠
                </span>
              )}
              <Summary s={p.summary} />
            </div>
            {open &&
              p.worktrees.map((w) => (
                <div key={w.path} className="sb-worktree">
                  <div
                    className="sb-wt-row"
                    title={w.path}
                    onDoubleClick={() => openNewSessionDialog(p.path, w.path)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      void worktreeMenu(p, w)
                    }}
                  >
                    <span className={w.isMain ? 'sb-wt-name' : 'sb-wt-name extra'}>⎇ {w.label}</span>
                    {w.prunable && <span className="sb-dim">pasta apagada</span>}
                    {!w.prunable && w.sessions.length === 0 && <span className="sb-dim">(sem sessão)</span>}
                    {w.git && (w.git.changed > 0 || w.git.ahead > 0 || w.git.behind > 0) && (
                      <span className="sb-git">
                        {w.git.changed > 0 && <span className="dirty">●{w.git.changed} </span>}
                        {w.git.ahead > 0 && `↑${w.git.ahead} `}
                        {w.git.behind > 0 && `↓${w.git.behind}`}
                      </span>
                    )}
                  </div>
                  {w.sessions.map((s) => (
                    <SessionRow key={s.paneId} s={s} />
                  ))}
                </div>
              ))}
          </div>
        )
      })}
      {model.outside.length > 0 && (
        <div className="sb-project">
          <div className="sb-project-row">
            <span className="sb-name">FORA DE PROJETO</span>
          </div>
          {model.outside.map((s) => (
            <SessionRow key={s.paneId} s={s} outside />
          ))}
        </div>
      )}
      <button className="sb-add" onClick={() => void addProjectFlow()}>
        + Adicionar projeto
      </button>
    </>
  )
}

/** ⌘B: trilho com a sigla do projeto e o pior estado; hover abre a árvore por cima, sem empurrar os splits */
function Rail() {
  const app = useUi((s) => s.app)
  const model = useMemo(() => (app ? buildSidebar(app) : null), [app])
  const [hover, setHover] = useState(false)
  if (!model) return null
  return (
    <aside className="rail" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {model.projects.map((p) => (
        <div key={p.path} className="rail-item" title={p.name}>
          <span>{railLabel(p.name)}</span>
          {p.worst && <span className="rail-dot">{STATUS_DOT[p.worst]}</span>}
        </div>
      ))}
      <button className="sb-mini" onClick={() => void addProjectFlow()}>
        +
      </button>
      {hover && (
        <div className="sidebar floating">
          <Tree />
        </div>
      )}
    </aside>
  )
}

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  if (collapsed) return <Rail />
  return (
    <aside className="sidebar">
      <Tree />
    </aside>
  )
}
