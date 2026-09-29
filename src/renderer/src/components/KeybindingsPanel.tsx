import { useEffect, useState } from 'react'
import {
  accelFromEvent, ACTIONS, findConflict, formatAccel, GROUP_LABELS, isReserved, isShellKey, resolveBindings, setBinding, type ActionGroup, type KeyOverrides,
} from '../../../shared/keybindings'
import { platform, suspendShortcuts } from '../shortcuts'

type Ask = { actionId: string; accel: string; kind: 'conflict'; other: string } | { actionId: string; accel: string; kind: 'shell'; conflictOk: boolean }

const labelOf = (id: string) => ACTIONS.find((a) => a.id === id)?.label ?? id

export function KeybindingsPanel({ overrides, onChange }: { overrides: KeyOverrides; onChange: (next: KeyOverrides) => void }) {
  const [recording, setRecording] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [error, setError] = useState<{ actionId: string; text: string } | null>(null)
  const bindings = resolveBindings(platform, overrides)

  useEffect(() => suspendShortcuts(recording !== null), [recording])
  useEffect(() => () => suspendShortcuts(false), [])

  const assign = (actionId: string, accel: string | null, ok: { conflict?: boolean; shell?: boolean } = {}) => {
    setError(null)
    setAsk(null)
    if (accel) {
      if (isReserved(platform, accel)) {
        setError({ actionId, text: `${formatAccel(platform, accel)} é reservado para copiar/colar e afins` })
        return
      }
      const other = findConflict(bindings, actionId, accel)
      if (other && !ok.conflict) {
        setAsk({ actionId, accel, kind: 'conflict', other })
        return
      }
      if (isShellKey(platform, accel) && !ok.shell) {
        setAsk({ actionId, accel, kind: 'shell', conflictOk: !!ok.conflict })
        return
      }
    }
    onChange(setBinding(platform, overrides, actionId, accel, true))
  }

  const groups = Object.keys(GROUP_LABELS) as ActionGroup[]
  return (
    <div className="keys-panel">
      {groups.map((g) => (
        <div key={g} className="keys-group">
          <div className="field-label">{GROUP_LABELS[g].toUpperCase()}</div>
          {ACTIONS.filter((a) => a.group === g).map((a) => {
            const accel = bindings[a.id]
            const changed = Object.prototype.hasOwnProperty.call(overrides, a.id)
            const q = ask?.actionId === a.id ? ask : null
            const isRec = recording === a.id
            return (
              <div key={a.id} className={`keys-row${changed ? ' changed' : ''}`}>
                <span className="keys-label">{a.label}</span>
                <button
                  className={`keys-accel${isRec ? ' recording' : ''}`}
                  onClick={() => {
                    setAsk(null)
                    setError(null)
                    setRecording(a.id)
                  }}
                  onBlur={() => isRec && setRecording(null)}
                  onKeyDown={(e) => {
                    if (!isRec) return
                    e.preventDefault()
                    e.stopPropagation()
                    if (e.key === 'Escape') return setRecording(null)
                    if (e.key === 'Backspace' || e.key === 'Delete') {
                      setRecording(null)
                      return assign(a.id, null)
                    }
                    const next = accelFromEvent(e, platform)
                    if (!next) return // só modificadores (ou tecla sem suporte): continua gravando
                    setRecording(null)
                    assign(a.id, next)
                  }}
                >
                  {isRec ? 'aperte a combinação…' : accel ? formatAccel(platform, accel) : '—'}
                </button>
                {changed ? (
                  <button className="keys-reset" title="Voltar ao padrão" onClick={() => assign(a.id, a[platform])}>
                    ↺
                  </button>
                ) : (
                  <span />
                )}
                {q?.kind === 'conflict' && (
                  <div className="keys-note">
                    {formatAccel(platform, q.accel)} já é usado por <b>{labelOf(q.other)}</b> —{' '}
                    <button className="ph-link" onClick={() => assign(a.id, q.accel, { conflict: true })}>
                      Trocar
                    </button>{' '}
                    <button className="ph-link" onClick={() => setAsk(null)}>
                      Cancelar
                    </button>
                  </div>
                )}
                {q?.kind === 'shell' && (
                  <div className="keys-note">
                    o terminal deixará de receber {formatAccel(platform, q.accel)} —{' '}
                    <button className="ph-link" onClick={() => assign(a.id, q.accel, { conflict: q.conflictOk, shell: true })}>
                      Usar mesmo assim
                    </button>{' '}
                    <button className="ph-link" onClick={() => setAsk(null)}>
                      Cancelar
                    </button>
                  </div>
                )}
                {error?.actionId === a.id && <div className="keys-note">{error.text}</div>}
              </div>
            )
          })}
        </div>
      ))}
      <button
        className="keys-restore"
        onClick={() => {
          setAsk(null)
          setError(null)
          onChange({})
        }}
      >
        Restaurar todos os padrões
      </button>
    </div>
  )
}
