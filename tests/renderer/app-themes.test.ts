import { describe, expect, it } from 'vitest'
import { APP_THEMES, contrast, cssVars, resolveTheme, TOKEN_NAMES } from '../../src/renderer/src/app-themes'
import { APP_THEME_IDS, DEFAULT_SETTINGS } from '../../src/shared/settings'

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
        for (const bg of ['bg', 'bg-side', 'bg-bar', 'bg-raised'] as const)
          expect(contrast(t.tokens[fg], t.tokens[bg]), `${t.id}: ${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
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
})
