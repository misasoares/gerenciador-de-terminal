import type React from 'react'
import { APP_THEME_IDS, effectiveBackground, wantsDesktop, type Appearance, type AppThemeId, type Background } from '../../../shared/settings'
import { APP_THEMES, cssVars } from '../app-themes'
import { backdropCss } from '../backdrop'
import { THEMES } from '../themes'
import { FLOAT_PANE, WINDOW_DESKTOP } from '../view'
import { BackgroundRow } from './BackgroundRow'

/** miniatura desenhada com os tokens reais do tema (variáveis só dentro do cartão, terminal pareado incluso) */
function ThemeCard({ id, selected, onPick, bg }: { id: AppThemeId; selected: boolean; onPick(): void; bg: Background }) {
  const t = APP_THEMES[id]
  // a miniatura mostra o fundo escolhido para o tema (imagem do usuário e mesa: o gradiente do tema)
  const backdrop = backdropCss(bg, t, { userDir: null, userList: [], windowDesktop: false, base: location.href }).css
  const vars = { ...cssVars(t, { reducedMotion: true }), '--term-bg': THEMES[t.terminal].xterm.background ?? t.tokens.bg, '--app-backdrop': backdrop }
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

function Row({ value, onPick, a }: { value: AppThemeId; onPick(id: AppThemeId): void; a: Appearance }) {
  return (
    <div className="theme-row">
      {APP_THEME_IDS.map((id) => (
        <ThemeCard key={id} id={id} selected={value === id} onPick={() => onPick(id)} bg={effectiveBackground(a, id, APP_THEMES[id].premium, window.gt.platform)} />
      ))}
    </div>
  )
}

/** Preferências → Aparência: fixo (um tema) ou automático (um para o macOS claro, outro para o escuro) */
/** escolha que muda o tipo de janela (mesa do macOS ↔ opaca) pede confirmação e reabre as janelas */
async function pickWithReopen(next: Appearance, onChange: (a: Appearance) => void): Promise<void> {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches
  const id = next.mode === 'auto' ? (dark ? next.dark : next.light) : next.theme
  const want = wantsDesktop(next, id, APP_THEMES[id].premium, window.gt.platform)
  if (want === WINDOW_DESKTOP || FLOAT_PANE) return onChange(next)
  const r = await window.gt.confirm({ message: 'As janelas vão ser reabertas para aplicar o fundo.', detail: 'As sessões continuam rodando.', confirmLabel: 'Reabrir' })
  if (!r.ok) return
  onChange(next)
  // o gt:appearance desta escolha precisa chegar ao processo principal antes de reabrir
  await new Promise((r) => setTimeout(r, 150))
  await window.gt.reopenWindows()
}

/** fileira de fundo para o tema premium escolhido */
function Backgrounds({ a, theme, pick }: { a: Appearance; theme: AppThemeId; pick(next: Appearance): void }) {
  if (!APP_THEMES[theme].premium) return null
  return (
    <>
      <div className="field-label">FUNDO · {APP_THEMES[theme].label.toUpperCase()}</div>
      <BackgroundRow theme={theme} value={a.backgrounds[theme] ?? { kind: 'theme' }} onChange={(b) => pick({ ...a, backgrounds: { ...a.backgrounds, [theme]: b } })} />
    </>
  )
}

export function AppearancePanel({ value, onChange: save }: { value: Appearance; onChange(a: Appearance): void }) {
  const onChange = (next: Appearance) => void pickWithReopen(next, save)
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
        <>
          <Row value={value.theme} a={value} onPick={(theme) => onChange({ ...value, theme })} />
          <Backgrounds a={value} theme={value.theme} pick={onChange} />
        </>
      ) : (
        <>
          <div className="field-label">QUANDO O MACOS ESTIVER CLARO</div>
          <Row value={value.light} a={value} onPick={(light) => onChange({ ...value, light })} />
          <Backgrounds a={value} theme={value.light} pick={onChange} />
          <div className="field-label">QUANDO ESTIVER ESCURO</div>
          <Row value={value.dark} a={value} onPick={(dark) => onChange({ ...value, dark })} />
          <Backgrounds a={value} theme={value.dark} pick={onChange} />
        </>
      )}
    </div>
  )
}
