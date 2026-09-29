import { describe, expect, it } from 'vitest'
import {
  accelFromEvent, ACTIONS, findConflict, formatAccel, isReserved, isShellKey, parseAccel, platformOf, resolveBindings, setBinding,
} from '../../src/shared/keybindings'

const ev = (code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({
  code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods,
})

describe('keybindings', () => {
  it('padrões sem duplicados e sem Ctrl puro no Linux', () => {
    for (const p of ['mac', 'linux'] as const) {
      const vals = ACTIONS.map((a) => a[p]).filter((v): v is string => !!v)
      expect(new Set(vals).size).toBe(vals.length)
      for (const v of vals) expect(parseAccel(v)).toBe(v) // já canônicos
    }
    for (const a of ACTIONS) if (a.linux) expect(isShellKey('linux', a.linux)).toBe(false)
  })

  it('mac igual ao de hoje', () => {
    const mac = resolveBindings('mac', {})
    expect(mac['new-session']).toBe('Cmd+T')
    expect(mac['split-down']).toBe('Cmd+Shift+D')
    expect(mac['focus-left']).toBe('Cmd+Alt+Left')
    expect(mac['tab-9']).toBe('Cmd+9')
    expect(resolveBindings('linux', {})['split-down']).toBe('Ctrl+Shift+E')
  })

  it('platformOf', () => {
    expect(platformOf('darwin')).toBe('mac')
    expect(platformOf('linux')).toBe('linux')
  })

  it('parseAccel canoniza e rejeita', () => {
    expect(parseAccel('shift+ctrl+d')).toBe('Ctrl+Shift+D')
    expect(parseAccel('Alt+Cmd+left')).toBe('Cmd+Alt+Left')
    expect(parseAccel('F5')).toBe('F5')
    expect(parseAccel('D')).toBeNull() // sem modificador
    expect(parseAccel('Shift+D')).toBeNull() // só maiúscula
    expect(parseAccel('CmdOrCtrl+D')).toBeNull()
    expect(parseAccel('Ctrl+Ctrl+D')).toBeNull()
    expect(parseAccel('Ctrl+')).toBeNull()
    expect(parseAccel('Ctrl+ç')).toBeNull()
  })

  it('accelFromEvent usa o code (independe do layout)', () => {
    expect(accelFromEvent(ev('KeyD', { ctrlKey: true, shiftKey: true }), 'linux')).toBe('Ctrl+Shift+D')
    expect(accelFromEvent(ev('Digit3', { altKey: true }), 'linux')).toBe('Alt+3')
    expect(accelFromEvent(ev('KeyT', { metaKey: true }), 'mac')).toBe('Cmd+T')
    expect(accelFromEvent(ev('KeyT', { metaKey: true }), 'linux')).toBe('Super+T')
    expect(accelFromEvent(ev('ArrowLeft', { metaKey: true, altKey: true }), 'mac')).toBe('Cmd+Alt+Left')
    expect(accelFromEvent(ev('Semicolon', { ctrlKey: true }), 'linux')).toBe('Ctrl+;') // ç no ABNT2
    expect(accelFromEvent(ev('ControlLeft', { ctrlKey: true }), 'linux')).toBeNull()
    expect(accelFromEvent(ev('KeyA'), 'linux')).toBeNull()
  })

  it('resolveBindings: alteração, null, id desconhecido, inválido e disputa com padrão', () => {
    const r = resolveBindings('linux', { 'split-right': 'Ctrl+Shift+R', palette: null, nada: 'Ctrl+Shift+Q', 'new-tab': 'lixo' })
    expect(r['split-right']).toBe('Ctrl+Shift+R')
    expect(r.palette).toBeNull()
    expect(r).not.toHaveProperty('nada')
    expect(r['new-tab']).toBe('Ctrl+Shift+N') // inválido volta ao padrão
    // alteração vence o padrão de outra ação, que fica sem atalho
    const s = resolveBindings('linux', { 'split-right': 'Ctrl+Shift+K' })
    expect(s['split-right']).toBe('Ctrl+Shift+K')
    expect(s.palette).toBeNull()
  })

  it('findConflict', () => {
    const b = resolveBindings('linux', {})
    expect(findConflict(b, 'split-right', 'Ctrl+Shift+K')).toBe('palette')
    expect(findConflict(b, 'palette', 'Ctrl+Shift+K')).toBeNull()
    expect(findConflict(b, 'palette', 'Ctrl+Shift+Z')).toBeNull()
  })

  it('isShellKey e isReserved', () => {
    expect(isShellKey('linux', 'Ctrl+W')).toBe(true)
    expect(isShellKey('linux', 'Ctrl+[')).toBe(true)
    expect(isShellKey('linux', 'Ctrl+Shift+W')).toBe(false)
    expect(isShellKey('linux', 'Alt+W')).toBe(false)
    expect(isShellKey('mac', 'Ctrl+W')).toBe(false)
    expect(isReserved('linux', 'Ctrl+Shift+C')).toBe(true)
    expect(isReserved('mac', 'Cmd+C')).toBe(true)
    expect(isReserved('linux', 'Ctrl+Shift+D')).toBe(false)
  })

  it('formatAccel', () => {
    expect(formatAccel('mac', 'Cmd+Shift+D')).toBe('⇧⌘D')
    expect(formatAccel('mac', 'Cmd+Alt+Left')).toBe('⌥⌘←')
    expect(formatAccel('linux', 'Ctrl+Shift+D')).toBe('Ctrl+Shift+D')
    expect(formatAccel('linux', 'Alt+Up')).toBe('Alt+↑')
  })

  it('setBinding: padrão apaga a alteração; steal tira da outra ação', () => {
    expect(setBinding('linux', { 'split-right': 'Ctrl+Shift+R' }, 'split-right', 'Ctrl+Shift+D', false)).toEqual({})
    expect(setBinding('linux', {}, 'palette', null, false)).toEqual({ palette: null })
    expect(setBinding('linux', {}, 'split-right', 'Ctrl+Shift+K', true)).toEqual({ 'split-right': 'Ctrl+Shift+K', palette: null })
  })
})
