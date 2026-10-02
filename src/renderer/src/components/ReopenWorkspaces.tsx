import { useEffect, useState } from 'react'
import type { WorkspaceSummary } from '../../../shared/types'
import { errorMessage } from '../api'
import { reopenRows, type ReopenRow } from '../workspaces-model'
import { WorkspaceNameModal } from './WorkspaceNameModal'

/** janela pequena ao abrir o app com 2+ espaços: escolher quais reabrir */
export function ReopenWorkspaces() {
  const [rows, setRows] = useState<ReopenRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [naming, setNaming] = useState(false)

  useEffect(() => {
    window.gt
      .request<WorkspaceSummary[]>({ t: 'workspace.list' })
      .then((list) => setRows(reopenRows(list)))
      .catch((e) => setError(errorMessage(e)))
  }, [])
  useEffect(() => window.gt.onMenu((a) => a === 'new-workspace' && setNaming(true)), [])

  const open = (ids: string[]) => window.gt.openWorkspaces(ids).catch((e) => setError(errorMessage(e)))
  const selected = (rows ?? []).filter((r) => r.checked).map((r) => r.id)

  return (
    <div className="reopen">
      <h3>Reabrir espaços de trabalho</h3>
      {error && <p className="modal-warn">{error}</p>}
      {!rows ? (
        <p className="sb-dim">Carregando…</p>
      ) : (
        <ul className="reopen-list">
          {rows.map((r) => (
            <li key={r.id}>
              <label className="check">
                <input type="checkbox" checked={r.checked} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, checked: e.target.checked } : x)))} />
                <span className="reopen-name">{r.name}</span>
                <span className="sb-dim">{r.detail}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="reopen-actions">
        <button className="link" onClick={() => setNaming(true)}>
          Novo espaço de trabalho…
        </button>
        <span className="spacer" />
        <button disabled={!rows} onClick={() => void open((rows ?? []).map((r) => r.id))}>
          Abrir todos
        </button>
        <button className="primary" disabled={selected.length === 0} onClick={() => void open(selected)}>
          Abrir selecionados
        </button>
      </div>
      {naming && <WorkspaceNameModal title="Novo espaço de trabalho" confirmLabel="Criar" onSubmit={(name) => window.gt.createWorkspace(name)} onClose={() => setNaming(false)} />}
    </div>
  )
}
