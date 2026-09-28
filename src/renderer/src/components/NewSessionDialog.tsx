import { useEffect, useMemo, useState } from 'react'
import type { AppState } from '../../../shared/types'
import { openNewPane } from '../actions'
import { worktreeLabel } from '../header'
import { AGENT_LABEL } from '../agents-model'
import { accountUsage } from '../usage-model'
import { accountsWithoutHooks } from '../sidebar-model'
import { getUi, setUi, showError, useUi } from '../store'

function defaults(app: AppState, projectPath: string | null, worktreePath: string | null) {
  const project = app.projects.find((p) => p.path === projectPath) ?? app.projects[0]
  const wt = project?.worktrees.find((w) => w.path === worktreePath) ?? project?.worktrees[0]
  const accountId = project?.defaultAccountId ?? app.accounts.find((a) => a.isDefault)?.id ?? null
  return { projectPath: project?.path ?? '', worktreePath: wt?.path ?? '', accountId }
}

/** Modal 2h: contexto herdado do painel em foco, worktrees em lista, contas como cartões */
export function NewSessionDialog() {
  const req = useUi((s) => s.newSession)
  const app = useUi((s) => s.app)
  const [form, setForm] = useState<{ projectPath: string; worktreePath: string; accountId: string | null }>({ projectPath: '', worktreePath: '', accountId: null })
  const noHooks = useMemo(() => (app ? accountsWithoutHooks(app) : new Set<string>()), [app])

  useEffect(() => {
    if (req && app) setForm(defaults(app, req.projectPath, req.worktreePath))
    // só ao abrir o diálogo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req])

  if (!req || !app) return null
  const close = () => setUi({ newSession: null })
  const project = app.projects.find((p) => p.path === form.projectPath)
  const focused = app.panes.find((p) => p.id === getUi().focusedPaneId)
  const focusedWt = focused?.worktreePath ?? null
  const sessionsIn = (path: string) => app.panes.filter((p) => p.alive && p.worktreePath === path).length
  const open = (withClaude: boolean) => {
    if (!form.worktreePath) return
    close()
    openNewPane({ cwd: form.worktreePath, accountId: withClaude ? form.accountId : null }).catch(showError)
  }
  const focusedProject = app.projects.find((p) => p.path === focused?.projectPath)
  const focusedWorktree = focusedProject?.worktrees.find((w) => w.path === focusedWt)

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter' && e.metaKey) open(true)
        }}
      >
        <h3>Nova sessão</h3>
        {focusedProject && focusedWorktree && (
          <div className="modal-sub">
            abre em split ao lado de {focusedProject.name.toUpperCase()} · {worktreeLabel(focusedWorktree)}
          </div>
        )}
        {app.projects.length === 0 ? (
          <p>Adicione um projeto na barra lateral primeiro.</p>
        ) : (
          <>
            <div className="field">
              <div className="field-label">PROJETO</div>
              <select value={form.projectPath} onChange={(e) => setForm(defaults(app, e.target.value, null))}>
                {app.projects.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.name.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <div className="field-label">WORKTREE</div>
              {project?.worktrees
                .filter((w) => !w.prunable)
                .map((w) => {
                  const n = sessionsIn(w.path)
                  return (
                    <label key={w.path} className="radio">
                      <input type="radio" checked={form.worktreePath === w.path} onChange={() => setForm({ ...form, worktreePath: w.path })} />⎇{' '}
                      {worktreeLabel(w)}
                      <span className="sb-dim">
                        {' '}
                        · {n ? `${n} ${n === 1 ? 'sessão' : 'sessões'}` : 'sem sessão'}
                        {w.path === focusedWt ? ' · em foco' : ''}
                      </span>
                    </label>
                  )
                })}
            </div>
            <div className="field">
              <div className="field-label">CONTA</div>
              <div className="accounts">
                {app.accounts.map((a) => (
                  <button
                    key={a.id}
                    className={`account-card${form.accountId === a.id ? ' selected' : ''}`}
                    style={{ borderColor: a.color }}
                    onClick={() => setForm({ ...form, accountId: a.id })}
                  >
                    <span style={{ color: a.color }}>{a.label}</span>
                    <span className="card-note">{AGENT_LABEL[a.agent]}</span>
                    {(() => {
                      const u = accountUsage(app, a.id)
                      return u.text ? <span className="card-note">{u.text}</span> : u.hint ? <span className="card-note" title={u.hint}>uso: —</span> : null
                    })()}
                    {form.accountId === a.id && ' ✓'}
                    {project?.defaultAccountId === a.id && <span className="card-note">padrão do projeto</span>}
                    {noHooks.has(a.id) && <span className="card-note warn">⚠ sem hooks</span>}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="modal-actions">
          <button onClick={() => open(false)} disabled={!form.worktreePath}>
            Só abrir terminal
          </button>
          <button className="primary" autoFocus disabled={!form.worktreePath || !form.accountId} onClick={() => open(true)}>
            Abrir agente ⌘↵
          </button>
        </div>
      </div>
    </div>
  )
}
