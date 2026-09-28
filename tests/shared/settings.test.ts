import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings, SESSION_COLORS, THEME_IDS } from '../../src/shared/settings'

describe('preferências', () => {
  it('padrões e limites', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ fontSize: 99, lineHeight: 0.2 })).toMatchObject({ fontSize: 24, lineHeight: 1 })
    expect(normalizeSettings({ fontSize: 3, lineHeight: 9 })).toMatchObject({ fontSize: 10, lineHeight: 1.6 })
    expect(normalizeSettings({ theme: 'inexistente' as never }).theme).toBe('vscode-dark')
    expect(normalizeSettings({ fontFamily: '   ' }).fontFamily).toBe(DEFAULT_SETTINGS.fontFamily)
  })
  it('6 temas e 8 cores com hex válido', () => {
    expect(THEME_IDS).toHaveLength(6)
    expect(SESSION_COLORS).toHaveLength(8)
    for (const c of SESSION_COLORS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/)
  })
})
