import type { HibernateSettings } from '../../../shared/settings'
import { Switch } from './Switch'

export function HibernatePrefs({ value, onChange }: { value: HibernateSettings; onChange: (h: HibernateSettings) => void }) {
  return (
    <>
      <div className="field pref-check">
        <Switch checked={value.enabled} label="Hibernar sessões ociosas" onChange={(enabled) => onChange({ ...value, enabled })} />
        Hibernar sessões ociosas (encerra o agente para liberar memória e retoma a conversa ao focar)
      </div>
      <div className="field">
        <div className="field-label">HIBERNAR DEPOIS DE {value.minutes} MIN PARADA</div>
        <input type="range" min={5} max={240} step={5} disabled={!value.enabled} value={value.minutes} onChange={(e) => onChange({ ...value, minutes: Number(e.target.value) })} />
      </div>
      <p className="card-note">Nunca hiberna sessão em foco, trabalhando, pedindo permissão, líder 👑, dev contratado ou com comando rodando. Desligar não acorda as já hibernadas: elas voltam ao focar.</p>
    </>
  )
}
