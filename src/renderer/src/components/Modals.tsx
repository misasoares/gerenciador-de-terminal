import { useState } from 'react'
import { ConflictsModal } from './ConflictsModal'
import { Preferences } from './Preferences'
import { Palette } from './Palette'
import { SetupWizard } from './SetupWizard'
import { ConversationsModal } from './ConversationsModal'
import { FilePicker } from './FilePicker'
import { revealPane } from '../actions'
import { confirmRemove } from '../flows'
import { headerView } from '../header'
import { sessionLabel } from '../sidebar-model'
import { setUi, useUi } from '../store'

function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onMouseDown={() => setUi({ modal: null })}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setUi({ modal: null })}>
        {children}
      </div>
    </div>
  )
}

/** 2f · 2i/1i · 2j */
export function Modals() {
  const modal = useUi((s) => s.modal)
  const app = useUi((s) => s.app)
  const [deleteBranch, setDeleteBranch] = useState(false)
  if (!modal || !app) return null
  if (modal.kind === 'conflicts') return <ConflictsModal projectPath={modal.projectPath} />
  if (modal.kind === 'preferences') return <Preferences />
  if (modal.kind === 'palette') return <Palette />
  if (modal.kind === 'setup') return <SetupWizard />
  if (modal.kind === 'conversations') return <ConversationsModal {...modal} />
  if (modal.kind === 'file-picker') return <FilePicker root={modal.root} />
  const close = () => {
    setDeleteBranch(false)
    setUi({ modal: null })
  }

  if (modal.kind === 'kill') {
    const pane = app.panes.find((p) => p.id === modal.paneId)
    if (!pane) return null
    const h = headerView(pane, app)
    return (
      <Backdrop>
        <h3>Encerrar sessão?</h3>
        <p>"{sessionLabel(pane)}" ainda está trabalhando</p>
        <div className="modal-context">
          <span className="ph-block ph-project">{h.project.toUpperCase()}</span>
          <span className={`ph-block ph-worktree${h.isMainWorktree ? '' : ' extra'}`}>⎇ {h.worktree}</span>
          {h.account && <span style={{ color: h.account.color }}>{h.account.label}</span>}
        </div>
        <p className="sb-dim">O processo do Claude será interrompido. Para só tirar da tela, use Esconder (⌘W).</p>
        <div className="modal-actions">
          <button autoFocus onClick={close}>
            Cancelar
          </button>
          <button
            className="danger"
            onClick={() => {
              window.gt.send({ t: 'pane.kill', paneId: modal.paneId })
              close()
            }}
          >
            Encerrar
          </button>
        </div>
      </Backdrop>
    )
  }

  const c = modal.check
  const project = app.projects.find((p) => p.worktrees.some((w) => w.path === c.path))
  const wtName = c.path.split('/').pop()
  const context = (
    <div className="modal-context">
      <span className="ph-block ph-project">{project?.name.toUpperCase() ?? '?'}</span>
      <span className="ph-block ph-worktree extra">⎇ {wtName}</span>
      {c.branch && <span className="ph-branch">{c.branch}</span>}
    </div>
  )

  if (modal.kind === 'blocked') {
    const sessions = app.panes.filter((p) => p.alive && p.worktreePath === c.path)
    return (
      <Backdrop>
        <h3>Não dá para remover ainda</h3>
        {context}
        <p>Feche as sessões antes de remover:</p>
        <ul className="modal-list">
          {sessions.map((p) => (
            <li key={p.id}>
              {sessionLabel(p)} <span className="sb-dim">{app.accounts.find((a) => a.id === p.accountId)?.label ?? ''}</span>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button
            onClick={() => {
              sessions.forEach((p) => revealPane(p.id))
              close()
            }}
          >
            Ir para as sessões
          </button>
          <button className="primary" autoFocus onClick={close}>
            Ok
          </button>
        </div>
      </Backdrop>
    )
  }

  const risky = c.dirtyFiles.length > 0 || c.unpushedCommits.length > 0
  return (
    <Backdrop>
      <h3>Remover worktree?</h3>
      {context}
      {risky ? (
        <>
          <div className="modal-warn">
            ⚠ {c.unpushedCommits.length} {c.unpushedCommits.length === 1 ? 'commit não enviado' : 'commits não enviados'} · {c.dirtyFiles.length}{' '}
            {c.dirtyFiles.length === 1 ? 'arquivo alterado' : 'arquivos alterados'}
          </div>
          <p>Esse trabalho será perdido se você remover agora.</p>
          <details>
            <summary className="sb-dim">ver detalhes</summary>
            <pre className="modal-pre">{[...c.unpushedCommits, ...c.dirtyFiles].join('\n')}</pre>
          </details>
        </>
      ) : (
        <p className="ok">✓ Tudo commitado e enviado</p>
      )}
      {c.ignoredFiles.length > 0 && (
        <div className="modal-warn">
          ⚠ {c.ignoredFiles.length} {c.ignoredFiles.length === 1 ? 'arquivo ignorado pelo git será apagado' : 'arquivos ignorados pelo git serão apagados'}:{' '}
          {c.ignoredFiles.slice(0, 8).join(', ')}
          {c.ignoredFiles.length > 8 ? '…' : ''}
        </div>
      )}
      {c.branch && (
        <label className="check">
          <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} /> Apagar a branch {c.branch} também
        </label>
      )}
      <div className="modal-actions">
        <button autoFocus onClick={close}>
          Cancelar
        </button>
        <button
          className="danger"
          onClick={() => {
            const d = deleteBranch
            close()
            void confirmRemove(c, d)
          }}
        >
          {risky || c.ignoredFiles.length > 0 ? 'Remover mesmo assim' : 'Remover'}
        </button>
      </div>
    </Backdrop>
  )
}
