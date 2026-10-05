import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeKeybindings, normalizeSettings, SESSION_COLORS, THEME_IDS } from '../../src/shared/settings'

describe('preferências', () => {
  it('padrões e limites', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ fontSize: 99, lineHeight: 0.2 })).toMatchObject({ fontSize: 24, lineHeight: 1 })
    expect(normalizeSettings({ fontSize: 3, lineHeight: 9 })).toMatchObject({ fontSize: 10, lineHeight: 1.6 })
    expect(normalizeSettings({ fontFamily: '   ' }).fontFamily).toBe(DEFAULT_SETTINGS.fontFamily)
  })
  it('7 temas de terminal e 8 cores com hex válido', () => {
    expect(THEME_IDS).toHaveLength(7)
    expect(SESSION_COLORS).toHaveLength(8)
    for (const c of SESSION_COLORS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('migração: tema de terminal antigo padrão vira "acompanhar"; outro fica fixado; sem nada → padrões', () => {
    expect(normalizeSettings({ theme: 'vscode-dark' } as never).terminalTheme).toBe('match')
    expect(normalizeSettings({ theme: 'dracula' } as never).terminalTheme).toBe('dracula')
    expect(normalizeSettings({}).terminalTheme).toBe('match')
    expect(normalizeSettings({}).appearance).toEqual({ mode: 'fixed', theme: 'padrao', light: 'claro', dark: 'padrao' })
    expect('theme' in normalizeSettings({ theme: 'dracula' } as never)).toBe(false)
  })
  it('aparência: valores inválidos caem no padrão campo a campo', () => {
    const a = normalizeSettings({ appearance: { mode: 'x', theme: 'claro', light: 'nao-existe', dark: 'claro' } as never }).appearance
    expect(a).toEqual({ mode: 'fixed', theme: 'claro', light: 'claro', dark: 'claro' })
    expect(normalizeSettings({ terminalTheme: 'inexistente' as never }).terminalTheme).toBe('match')
    expect(normalizeSettings({ terminalTheme: 'nord' }).terminalTheme).toBe('nord')
  })
  it('atalhos: só ids conhecidos, canônicos, sem duplicados', () => {
    expect(DEFAULT_SETTINGS.keybindings).toEqual({})
    expect(DEFAULT_SETTINGS.showGitStatus).toBe(true)
    expect(normalizeKeybindings('x')).toEqual({})
    expect(normalizeKeybindings(['a'])).toEqual({})
    expect(normalizeKeybindings({ 'split-right': 42, nada: 'Ctrl+Shift+Q', palette: 'CmdOrCtrl+K' })).toEqual({})
    expect(normalizeKeybindings({ 'split-right': 'shift+ctrl+r', palette: null })).toEqual({ 'split-right': 'Ctrl+Shift+R', palette: null })
    // dois com o mesmo atalho: o segundo (na ordem de ACTIONS) fica sem
    expect(normalizeKeybindings({ 'split-right': 'Ctrl+Shift+R', 'split-down': 'Ctrl+Shift+R' })).toEqual({ 'split-right': 'Ctrl+Shift+R', 'split-down': null })
  })
  it('showGitStatus', () => {
    expect(normalizeSettings({ showGitStatus: false }).showGitStatus).toBe(false)
    expect(normalizeSettings({ showGitStatus: 'não' as never }).showGitStatus).toBe(true)
  })
  it('máximo de sessões por líder: padrão 10, entre 1 e 50', () => {
    expect(normalizeSettings(undefined).maxHiredPerLeader).toBe(10)
    expect(normalizeSettings({ maxHiredPerLeader: 0 }).maxHiredPerLeader).toBe(1)
    expect(normalizeSettings({ maxHiredPerLeader: 99 }).maxHiredPerLeader).toBe(50)
    expect(normalizeSettings({ maxHiredPerLeader: 7.4 }).maxHiredPerLeader).toBe(7)
  })
})
