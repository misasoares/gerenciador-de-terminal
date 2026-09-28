import { useState } from 'react'
import { normalizeSettings, THEME_IDS, type TerminalSettings } from '../../../shared/settings'
import { THEMES } from '../themes'
import { setUi, showError, useUi } from '../store'

export function Preferences() {
  const saved = useUi((s) => s.app?.settings)
  const [draft, setDraft] = useState<TerminalSettings | null>(saved ?? null)
  if (!saved || !draft) return null
  const update = (patch: Partial<TerminalSettings>) => {
    const next = normalizeSettings({ ...draft, ...patch })
    setDraft(next)
    window.gt.request({ t: 'settings.save', settings: next }).catch(showError)
  }
  const close = () => setUi({ modal: null })
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>Preferências</h3>
        <div className="field">
          <div className="field-label">TEMA DO TERMINAL</div>
          <select value={draft.theme} onChange={(e) => update({ theme: e.target.value as TerminalSettings['theme'] })}>
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
        <div className="modal-actions">
          <button className="primary" autoFocus onClick={close}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
