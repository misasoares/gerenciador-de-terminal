import { ModalFrame } from './ModalFrame'
import { setUi } from '../store'

/** notas da release em texto simples (nunca HTML) */
export function ReleaseNotesModal(p: { version: string; notes: string }) {
  const close = () => setUi({ modal: null })
  return (
    <ModalFrame onClose={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <h3>Novidades da versão {p.version}</h3>
      <div className="release-notes">{p.notes.trim() || 'Sem notas para esta versão.'}</div>
      <div className="modal-actions">
        <button className="primary" autoFocus onClick={close}>
          Fechar
        </button>
      </div>
    </ModalFrame>
  )
}
