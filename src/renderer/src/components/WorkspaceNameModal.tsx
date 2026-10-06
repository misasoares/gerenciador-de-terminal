import { useState } from 'react'
import { errorMessage } from '../api'
import { ModalFrame } from './ModalFrame'

/** pede o nome do espaço (criar ou renomear); serve à janela normal e à tela de reabrir */
export function WorkspaceNameModal(p: { title: string; initial?: string; confirmLabel: string; onSubmit(name: string): Promise<void>; onClose(): void }) {
  const [name, setName] = useState(p.initial ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!name.trim()) return setError('O nome é obrigatório.')
    setBusy(true)
    try {
      await p.onSubmit(name.trim())
      p.onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <ModalFrame onClose={p.onClose} onKeyDown={(e) => e.key === 'Escape' && p.onClose()}>
      <h3>{p.title}</h3>
      <label className="field">
        <span className="field-label">NOME</span>
        <input
          className="ws-name-input"
          autoFocus
          value={name}
          placeholder="Ex.: TCHEERP"
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
      </label>
      {error && <p className="modal-warn">{error}</p>}
      <div className="modal-actions">
        <button onClick={p.onClose}>Cancelar</button>
        <button className="primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
          {p.confirmLabel}
        </button>
      </div>
    </ModalFrame>
  )
}
