import { describe, expect, it } from 'vitest'
import { TERMINAL_GLASS_ALPHA, APP_THEMES, composite, contrast, cssVars, GLASS_TOKENS, gradientStops, matchLabel, PREMIUM_THEME_IDS, resolveTheme, SAFE_GLASS_ALPHA, TOKEN_NAMES } from '../../src/renderer/src/app-themes'
import { APP_THEME_IDS, DEFAULT_SETTINGS } from '../../src/shared/settings'
import { THEMES } from '../../src/renderer/src/themes'

const s = (over = {}) => ({ appearance: { ...DEFAULT_SETTINGS.appearance, ...over }, terminalTheme: 'match' as const })

describe('app-themes', () => {
  it('todo tema define exatamente todos os tokens, sem valor vazio', () => {
    expect(Object.keys(APP_THEMES).sort()).toEqual([...APP_THEME_IDS].sort())
    for (const t of Object.values(APP_THEMES)) {
      expect(Object.keys(t.tokens).sort(), t.id).toEqual([...TOKEN_NAMES].sort())
      for (const k of TOKEN_NAMES) expect(t.tokens[k].trim(), `${t.id}.${k}`).not.toBe('')
    }
  })
  it('contraste AA (4,5:1) de fg e fg-dim sobre as superfícies principais, em todo tema', () => {
    for (const t of Object.values(APP_THEMES))
      for (const fg of ['fg', 'fg-dim'] as const)
        for (const bg of ['bg', 'bg-side', 'bg-bar', 'bg-raised'] as const) {
          if (!t.tokens[bg].startsWith('#')) continue // vidro: coberto pelos testes de vidro
          expect(contrast(t.tokens[fg], t.tokens[bg]), `${t.id}: ${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
        }
  })
  it('contraste: preto/branco = 21; igual = 1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrast('#777777', '#777777')).toBe(1)
  })
  it('resolução: fixo usa o tema; automático segue o sistema', () => {
    expect(resolveTheme(s({ theme: 'claro' }), true).app.id).toBe('claro')
    expect(resolveTheme(s({ mode: 'auto' }), false).app.id).toBe('claro')
    expect(resolveTheme(s({ mode: 'auto' }), true).app.id).toBe('padrao')
  })
  it('terminal: "match" usa o par do tema; fixado vence', () => {
    expect(resolveTheme(s({ theme: 'claro' }), false).terminal).toBe('github-light')
    expect(resolveTheme(s(), false).terminal).toBe('vscode-dark')
    expect(resolveTheme({ ...s({ theme: 'claro' }), terminalTheme: 'dracula' }, false).terminal).toBe('dracula')
  })
  it('cssVars: --token para cada token; reduzir movimento zera as durações', () => {
    const v = cssVars(APP_THEMES.padrao, { reducedMotion: false })
    expect(Object.keys(v)).toHaveLength(TOKEN_NAMES.length)
    expect(v['--bg']).toBe('#1e1e1e')
    const r = cssVars(APP_THEMES.padrao, { reducedMotion: true })
    expect([r['--dur-fast'], r['--dur-base'], r['--dur-slow']]).toEqual(['0ms', '0ms', '0ms'])
  })
  it('rótulo de "acompanhar": no fixo mostra o terminal pareado; no automático, só o texto', () => {
    expect(matchLabel(DEFAULT_SETTINGS.appearance)).toBe('Acompanhar o tema (VS Code Dark)')
    expect(matchLabel({ ...DEFAULT_SETTINGS.appearance, theme: 'claro' })).toBe('Acompanhar o tema (GitHub Light)')
    expect(matchLabel({ ...DEFAULT_SETTINGS.appearance, mode: 'auto' })).toBe('Acompanhar o tema')
  })
  it('composite: rgba sobre uma base vira hex; gradientStops extrai as cores do gradiente', () => {
    expect(composite('rgba(255, 255, 255, 0.5)', '#000000')).toBe('#808080')
    expect(composite('#123456', '#ffffff')).toBe('#123456')
    expect(gradientStops('linear-gradient(135deg, #dfe9f5, #f4efe8 60%, #e9e4f3)')).toEqual(['#dfe9f5', '#f4efe8', '#e9e4f3'])
  })
  it('Padrão e Claro: tokens novos neutros (nada muda neles)', () => {
    for (const id of ['padrao', 'claro'] as const) {
      const t = APP_THEMES[id].tokens
      expect([t['app-backdrop'], t['surface-blur'], t['pane-gap'], t['pane-radius'], t['pane-shadow']]).toEqual([t.bg, '0px', '0px', '0px', 'none'])
      expect(APP_THEMES[id].premium).toBe(false)
    }
  })
  it('premium: vidro legível sobre o gradiente do tema e sobre bg (AA)', () => {
    for (const id of PREMIUM_THEME_IDS) {
      const t = APP_THEMES[id].tokens
      expect(APP_THEMES[id].premium).toBe(true)
      for (const g of GLASS_TOKENS) for (const base of [...gradientStops(t['app-backdrop']), t.bg]) {
        const c = composite(t[g], base)
        expect(contrast(t.fg, c), `${id} ${g} fg sobre ${base}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t['fg-dim'], c), `${id} ${g} fg-dim sobre ${base}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  it('premium: vidro seguro legível sobre qualquer imagem (extremos preto e branco)', () => {
    for (const id of PREMIUM_THEME_IDS) {
      const t = APP_THEMES[id].tokens
      for (const g of GLASS_TOKENS) for (const base of ['#000000', '#ffffff']) {
        const safe = t[g].replace(/[\d.]+\)$/, `${SAFE_GLASS_ALPHA})`)
        const c = composite(safe, base)
        expect(contrast(t.fg, c), `${id} ${g} fg seguro sobre ${base}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t['fg-dim'], c), `${id} ${g} fg-dim seguro sobre ${base}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  it('tom dos terminais: automático segue o tema; claro/escuro trocam o terminal pareado; terminal fixado vence', () => {
    const r = (theme: string, tone: 'auto' | 'light' | 'dark', glass = false, terminalTheme: 'match' | 'dracula' = 'match') =>
      resolveTheme({ appearance: { ...DEFAULT_SETTINGS.appearance, theme: theme as never, terminals: { [theme]: { tone, glass } } }, terminalTheme }, false)
    expect(r('aurora', 'auto').terminal).toBe('github-light')
    expect(r('aurora', 'dark').terminal).toBe('noite')
    expect(r('noite', 'light').terminal).toBe('github-light')
    expect(r('padrao', 'light').terminal).toBe('github-light')
    expect(r('claro', 'dark').terminal).toBe('vscode-dark')
    expect(r('aurora', 'dark', false, 'dracula').terminal).toBe('dracula')
    expect(r('aurora', 'auto', true).glass).toBe(true)
    expect(r('padrao', 'auto', true).glass).toBe(false) // sem fundo atrás, vidro não se aplica
  })
  it('terminal em vidro: texto legível sobre qualquer coisa atrás (preto e branco)', () => {
    for (const id of ['github-light', 'noite'] as const) {
      const x = THEMES[id].xterm
      const glass = `rgba(${[1, 3, 5].map((i) => parseInt(x.background!.slice(i, i + 2), 16)).join(', ')}, ${TERMINAL_GLASS_ALPHA})`
      for (const base of ['#000000', '#ffffff'])
        expect(contrast(x.foreground!, composite(glass, base)), `${id} sobre ${base}`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
