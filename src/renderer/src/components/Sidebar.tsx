import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { openNewSessionDialog, PANE_MIME, revealPane } from '../actions'
import { conflictPartners } from '../conflicts-model'
import { addProjectFlow, analyzeConflictsFlow, projectMenu, sessionMenu, worktreeMenu } from '../flows'
import { buildSidebar, isExpanded, railLabel, splitWorktrees, type ProjectItem, type SessionItem } from '../sidebar-model'
import { setUi, showError, useUi } from '../store'
import { STATUS_DOT } from './PaneHeader'
import { textOn } from '../header'
import { useMotionPreset } from '../use-motion'
import { otherWorkspaces, type OtherWorkspace } from '../workspaces-model'

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
  const pr = useMotionPreset()
  // a bolinha só anima quando o estado muda (não ao montar a lista)
  const prev = useRef(s.status)
  const changed = prev.current !== s.status
  useEffect(() => {
    prev.current = s.status
  })
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
      {focused && <motion.span layoutId="sb-sel" className="sb-sel" transition={pr.reduced ? { duration: 0 } : pr.enter} />}
      <motion.span key={s.status} className="dot" initial={changed ? { opacity: 0, scale: pr.reduced ? 1 : 0.6 } : false} animate={{ opacity: 1, scale: 1 }} transition={pr.enter}>
        {STATUS_DOT[s.status] || '›'}
      </motion.span>
      {s.color && <span className="sb-color" style={{ background: s.color }} />}
      <span className="sb-label">{s.label}</span>
      {s.hidden && <span className="sb-tag">oculta</span>}
      {s.floating && (
        <span className="sb-tag" title="numa janela flutuante">
          ⧉
        </span>
      )}
      {s.tab !== null && (
        <span className="sb-tab" title={`aberta na aba ${s.tab}`}>
          ⌘{s.tab}
        </span>
      )}
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
  /** projetos com as worktrees sem sessão à mostra */
  const [showIdle, setShowIdle] = useState<Record<string, boolean>>({})
  const pr = useMotionPreset()
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
              <span className={`sb-name${p.color ? ' colored' : ''}`} style={p.color ? { background: p.color, color: textOn(p.color) } : undefined} title={p.name}>
                {p.name}
              </span>
              <button
                className="sb-mini sb-conflicts"
                title="Analisar conflitos entre worktrees"
                onClick={(e) => {
                  e.stopPropagation()
                  analyzeConflictsFlow(p.path)
                }}
              >
                ⇄
              </button>
              {(p.error || p.fetchError) && (
                <span className="ph-warn" title={p.error ?? p.fetchError ?? ''}>
                  ⚠
                </span>
              )}
              <Summary s={p.summary} />
            </div>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div
                  key="body"
                  style={{ overflow: 'hidden' }}
                  initial={pr.reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={pr.reduced ? { opacity: 0, transition: pr.exit } : { height: 0, opacity: 0, transition: pr.exit }}
                  transition={pr.enter}
                >
                  {(() => {
                    const view = app.projects.find((x) => x.path === p.path)
                    const conflicted = new Set((view?.conflicts?.pairs ?? []).flatMap((x) => [x.a, x.b]).concat((view?.conflicts?.vsMain ?? []).filter((x) => x.files.length > 0).map((x) => x.worktreePath)))
                    const { visible, hidden } = splitWorktrees(p.worktrees, conflicted)
                    return [...visible, ...(showIdle[p.path] ? hidden : [])]
                  })().map((w) => (
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
                        {(() => {
                          const view = app.projects.find((x) => x.path === p.path)
                          const partners = conflictPartners(view?.conflicts ?? null, w.path, (path) => {
                            const other = view?.worktrees.find((x) => x.path === path)
                            return other?.isMain ? 'principal' : (path.split('/').pop() ?? path)
                          })
                          return partners.length > 0 ? (
                            <span
                              className="sb-conflict"
                              title={`conflita com: ${partners.join(', ')}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                setUi({ modal: { kind: 'conflicts', projectPath: p.path } })
                              }}
                            >
                              ⚠
                            </span>
                          ) : null
                        })()}
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
                  {(() => {
                    const view = app.projects.find((x) => x.path === p.path)
                    const conflicted = new Set((view?.conflicts?.pairs ?? []).flatMap((x) => [x.a, x.b]).concat((view?.conflicts?.vsMain ?? []).filter((x) => x.files.length > 0).map((x) => x.worktreePath)))
                    const n = splitWorktrees(p.worktrees, conflicted).hidden.length
                    if (n === 0) return null
                    const on = !!showIdle[p.path]
                    return (
                      <button className="sb-more" onClick={() => setShowIdle((o) => ({ ...o, [p.path]: !on }))}>
                        {on ? 'esconder worktrees sem sessão' : `+${n} ${n === 1 ? 'worktree sem sessão' : 'worktrees sem sessão'}`}
                      </button>
                    )
                  })()}
                </motion.div>
              )}
            </AnimatePresence>
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

const goTo = (wsId: string, paneId: string | null) => void window.gt.revealIn(wsId, paneId).catch(showError)

function OtherWorkspaceItem({ w }: { w: OtherWorkspace }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="sb-ws">
      <div className="sb-ws-head" onClick={() => goTo(w.id, null)} title="Ir para a janela deste espaço">
        <span
          className="sb-caret"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
        >
          {open ? '▾' : '▸'}
        </span>
        <span className="sb-label">{w.name}</span>
        {w.attention > 0 && <span className="sb-ws-attn">●{w.attention}</span>}
        <span className="sb-dim">{w.sessions}</span>
      </div>
      {open &&
        [...w.tabs.map((t) => ({ key: t.id, name: t.name, panes: t.panes })), ...(w.hidden.length ? [{ key: '__hidden', name: 'Escondidas', panes: w.hidden }] : [])].map((g) => (
          <div key={g.key} className="sb-ws-tab">
            <div className="sb-ws-tabname">{g.name}</div>
            {g.panes.map((p) => (
              <div key={p.id} className="sb-session" onClick={() => goTo(w.id, p.id)} title={`Ir para ${p.label} em ${w.name}`}>
                <span className="dot">{(p.status && STATUS_DOT[p.status]) || '›'}</span>
                <span className="sb-label">{p.label}</span>
              </div>
            ))}
          </div>
        ))}
    </div>
  )
}

/** sessões dos outros espaços abertos: um clique leva à janela (e à mesa) dela, já na aba e com o terminal em foco */
function OtherWorkspaces() {
  const list = useUi((s) => s.app?.workspaces)
  const current = useUi((s) => s.app?.workspaceId ?? '')
  const others = useMemo(() => otherWorkspaces(list ?? [], current), [list, current])
  const [open, setOpen] = useState(true)
  if (others.length === 0) return null
  return (
    <div className="sb-others">
      <div className="sb-others-head" onClick={() => setOpen(!open)}>
        <span className="sb-caret">{open ? '▾' : '▸'}</span> OUTROS ESPAÇOS
      </div>
      {open && others.map((w) => <OtherWorkspaceItem key={w.id} w={w} />)}
    </div>
  )
}

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  if (collapsed) return <Rail />
  return (
    <aside className="sidebar">
      <OtherWorkspaces />
      <Tree />
    </aside>
  )
}
