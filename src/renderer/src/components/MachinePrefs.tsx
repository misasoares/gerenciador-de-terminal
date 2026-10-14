import { DEFAULT_SETTINGS, type MachineLimits } from '../../../shared/settings'
import { gb } from '../../../shared/machine-format'
import { useUi } from '../store'

export function MachinePrefs({ value, onChange }: { value: MachineLimits; onChange: (m: MachineLimits) => void }) {
  const ramTotal = useUi((s) => s.machine?.ram.total ?? 0)
  const set = (patch: Partial<MachineLimits>) => onChange({ ...value, ...patch })
  const ofRam = (pct: number) => (ramTotal > 0 ? ` (${gb((ramTotal * pct) / 100)} GB)` : '')
  return (
    <>
      <p className="card-note">Amarelo avisa na barra de status. Bloqueio faz o contratar_dev recusar até você autorizar.</p>
      <div className="field">
        <div className="field-label">CPU (MÉDIA DE 1 MIN) · AMARELO A PARTIR DE {value.cpuWarn}%</div>
        <input type="range" min={10} max={100} value={value.cpuWarn} onChange={(e) => set({ cpuWarn: Number(e.target.value) })} />
      </div>
      <div className="field">
        <div className="field-label">CPU · BLOQUEIA CONTRATAR A PARTIR DE {value.cpuBad}%</div>
        <input type="range" min={10} max={100} value={value.cpuBad} onChange={(e) => set({ cpuBad: Number(e.target.value) })} />
      </div>
      <div className="field">
        <div className="field-label">SWAP · AMARELO A PARTIR DE {value.swapWarn}% DA RAM{ofRam(value.swapWarn)}</div>
        <input type="range" min={5} max={150} step={5} value={value.swapWarn} onChange={(e) => set({ swapWarn: Number(e.target.value) })} />
      </div>
      <div className="field">
        <div className="field-label">SWAP · BLOQUEIA CONTRATAR A PARTIR DE {value.swapBad}% DA RAM{ofRam(value.swapBad)}</div>
        <input type="range" min={5} max={150} step={5} value={value.swapBad} onChange={(e) => set({ swapBad: Number(e.target.value) })} />
      </div>
      <label className="field pref-check">
        <input type="checkbox" checked={value.pressureGate} onChange={(e) => set({ pressureGate: e.target.checked })} />
        Usar a pressão de memória do sistema (alerta = amarelo, crítica = bloqueia)
      </label>
      <button onClick={() => onChange(DEFAULT_SETTINGS.machine)}>Restaurar padrões</button>
    </>
  )
}
