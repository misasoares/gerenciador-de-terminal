import { useState } from 'react'
import { normalizeSettings, THEME_IDS, type TerminalSettings } from '../../../shared/settings'
import { THEMES } from '../themes'
import { matchLabel } from '../app-themes'
import { AppearancePanel } from './AppearancePanel'
import { AgentsPanel } from './AgentsPanel'
import { KeybindingsPanel } from './KeybindingsPanel'
import { MachinePrefs } from './MachinePrefs'
import { setUi, showError, useUi } from '../store'
import { ModalFrame } from './ModalFrame'

export function Preferences() {
  const saved = useUi((s) => s.app?.settings)
  const [draft, setDraft] = useState<TerminalSettings | null>(saved ?? null)
  const [tab, setTab] = useState<'appearance' | 'terminal' | 'agents' | 'shortcuts' | 'machine'>('appearance')
  if (!saved || !draft) return null
  const update = (patch: Partial<TerminalSettings>) => {
    const next = normalizeSettings({ ...draft, ...patch })
    setDraft(next)
    window.gt.request({ t: 'settings.save', settings: next }).catch(showError)
  }
  const close = () => setUi({ modal: null })
  return (
    <ModalFrame onClose={close} className="modal prefs" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <h3>Preferências</h3>
      <div className="pref-tabs">
        <button className={tab === 'appearance' ? 'active' : ''} onClick={() => setTab('appearance')}>
          Aparência
        </button>
        <button className={tab === 'terminal' ? 'active' : ''} onClick={() => setTab('terminal')}>
          Terminal
        </button>
        <button className={tab === 'agents' ? 'active' : ''} onClick={() => setTab('agents')}>
          Agentes
        </button>
        <button className={tab === 'shortcuts' ? 'active' : ''} onClick={() => setTab('shortcuts')}>
          Atalhos
        </button>
        <button className={tab === 'machine' ? 'active' : ''} onClick={() => setTab('machine')}>
          Máquina
        </button>
      </div>
      {tab === 'appearance' ? (
        <AppearancePanel value={draft.appearance} onChange={(appearance) => update({ appearance })} />
      ) : tab === 'agents' ? (
        <AgentsPanel />
      ) : tab === 'machine' ? (
        <MachinePrefs value={draft.machine} onChange={(machine) => update({ machine })} />
      ) : tab === 'shortcuts' ? (
        <KeybindingsPanel overrides={draft.keybindings} onChange={(keybindings) => update({ keybindings })} />
      ) : (
        <>
      <div className="field">
        <div className="field-label">TEMA DO TERMINAL</div>
        <select value={draft.terminalTheme} onChange={(e) => update({ terminalTheme: e.target.value as TerminalSettings['terminalTheme'] })}>
          <option value="match">{matchLabel(draft.appearance)}</option>
          {THEME_IDS.map((id) => (
            <option key={id} value={id}>
              {THEMES[id].label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <div className="field-label">FONTE</div>
        <input className="text-input" defaultValue={draft.fontFamily} onBlur={(e) => update({ fontFamily: e.target.value })} />
      </div>
      <div className="field">
        <div className="field-label">TAMANHO · {draft.fontSize}px</div>
        <input type="range" min={10} max={24} value={draft.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} />
      </div>
      <div className="field">
        <div className="field-label">ALTURA DE LINHA · {draft.lineHeight.toFixed(1)}</div>
        <input type="range" min={1} max={1.6} step={0.1} value={draft.lineHeight} onChange={(e) => update({ lineHeight: Number(e.target.value) })} />
      </div>
      <label className="field pref-check">
        <input type="checkbox" checked={draft.showGitStatus} onChange={(e) => update({ showGitStatus: e.target.checked })} />
        Mostrar status do git no cabeçalho (● alterados, ↑↓ commits)
      </label>
      <div className="field">
        <div className="field-label">MÁXIMO DE SESSÕES POR LÍDER · {draft.maxHiredPerLeader}</div>
        <input type="range" min={1} max={50} value={draft.maxHiredPerLeader} onChange={(e) => update({ maxHiredPerLeader: Number(e.target.value) })} />
      </div>
        </>
      )}
      <div className="modal-actions">
        <button className="primary" autoFocus onClick={close}>
          Fechar
        </button>
      </div>
    </ModalFrame>
  )
}
