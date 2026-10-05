import type React from 'react'
import { APP_THEME_IDS, type Appearance, type AppThemeId } from '../../../shared/settings'
import { APP_THEMES, cssVars } from '../app-themes'
import { THEMES } from '../themes'

/** miniatura desenhada com os tokens reais do tema (variáveis só dentro do cartão, terminal pareado incluso) */
function ThemeCard({ id, selected, onPick }: { id: AppThemeId; selected: boolean; onPick(): void }) {
  const t = APP_THEMES[id]
  const vars = { ...cssVars(t, { reducedMotion: true }), '--term-bg': THEMES[t.terminal].xterm.background ?? t.tokens.bg }
  return (
    <button className={`theme-card${selected ? ' selected' : ''}`} onClick={onPick} aria-pressed={selected}>
      <div className="theme-mini" style={vars as React.CSSProperties}>
        <div className="tm-side" />
        <div className="tm-main">
          <div className="tm-tabs">
            <span className="tm-tab on" />
            <span className="tm-tab" />
          </div>
          <div className="tm-term">
            <i />
            <i />
            <i className="short" />
          </div>
        </div>
      </div>
      <span className="theme-name">{t.label}</span>
    </button>
  )
}

function Row({ value, onPick }: { value: AppThemeId; onPick(id: AppThemeId): void }) {
  return (
    <div className="theme-row">
      {APP_THEME_IDS.map((id) => (
        <ThemeCard key={id} id={id} selected={value === id} onPick={() => onPick(id)} />
      ))}
    </div>
  )
}

/** Preferências → Aparência: fixo (um tema) ou automático (um para o macOS claro, outro para o escuro) */
export function AppearancePanel({ value, onChange }: { value: Appearance; onChange(a: Appearance): void }) {
  return (
    <div className="appearance-panel">
      <div className="seg">
        <button className={value.mode === 'fixed' ? 'active' : ''} onClick={() => onChange({ ...value, mode: 'fixed' })}>
          Fixo
        </button>
        <button className={value.mode === 'auto' ? 'active' : ''} onClick={() => onChange({ ...value, mode: 'auto' })}>
          Automático
        </button>
      </div>
      {value.mode === 'fixed' ? (
        <Row value={value.theme} onPick={(theme) => onChange({ ...value, theme })} />
      ) : (
        <>
          <div className="field-label">QUANDO O MACOS ESTIVER CLARO</div>
          <Row value={value.light} onPick={(light) => onChange({ ...value, light })} />
          <div className="field-label">QUANDO ESTIVER ESCURO</div>
          <Row value={value.dark} onPick={(dark) => onChange({ ...value, dark })} />
        </>
      )}
    </div>
  )
}
