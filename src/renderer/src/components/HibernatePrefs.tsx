import type { HibernateSettings } from '../../../shared/settings'

export function HibernatePrefs({ value, onChange }: { value: HibernateSettings; onChange: (h: HibernateSettings) => void }) {
  return (
    <>
      <label className="field pref-check">
        <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />
        Hibernar sessões ociosas (encerra o agente para liberar memória e retoma a conversa ao focar)
      </label>
      <div className="field">
        <div className="field-label">HIBERNAR DEPOIS DE {value.minutes} MIN PARADA</div>
        <input type="range" min={5} max={240} step={5} disabled={!value.enabled} value={value.minutes} onChange={(e) => onChange({ ...value, minutes: Number(e.target.value) })} />
      </div>
      <p className="card-note">Nunca hiberna sessão em foco, trabalhando, pedindo permissão, líder 👑, dev contratado ou com comando rodando.</p>
    </>
  )
}
