import { describe, expect, it } from 'vitest'
import { decideKey } from '../../src/renderer/src/keys'

const k = (over: Partial<Parameters<typeof decideKey>[0]>) => decideKey({ type: 'keydown', key: 'a', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...over })

describe('decideKey', () => {
  it('Shift+Enter envia a sequência só no keydown e engole o resto', () => {
    expect(k({ key: 'Enter', shiftKey: true })).toBe('send-shift-enter')
    expect(k({ key: 'Enter', shiftKey: true, type: 'keypress' })).toBe('swallow')
    expect(k({ key: 'Enter' })).toBe('xterm')
  })
  it('⌘ fica com o menu do app', () => {
    expect(k({ key: 't', metaKey: true })).toBe('swallow')
  })
  it('teclas mortas e ⌥ seguem para o xterm (composição de acentos)', () => {
    expect(k({ key: 'Dead' })).toBe('xterm')
    expect(k({ key: 'Dead', shiftKey: true })).toBe('xterm')
    expect(k({ key: 'ã' })).toBe('xterm')
    expect(k({ key: 'ç', altKey: true })).toBe('xterm')
  })
})

const linux = (bound: string[] = []) => ({ platform: 'linux' as const, bound: new Set(bound) })
const kl = (over: Partial<Parameters<typeof decideKey>[0]>, bound: string[] = []) =>
  decideKey({ type: 'keydown', key: 'a', code: 'KeyA', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...over }, linux(bound))

describe('decideKey no Linux', () => {
  it('Ctrl puro vai para o shell', () => {
    expect(kl({ key: 'd', code: 'KeyD', ctrlKey: true }, ['Ctrl+Shift+D'])).toBe('xterm')
    expect(kl({ key: 'c', code: 'KeyC', ctrlKey: true })).toBe('xterm')
  })
  it('copiar/colar e atalhos do app ficam com o menu', () => {
    expect(kl({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true })).toBe('swallow')
    expect(kl({ key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true })).toBe('swallow')
    expect(kl({ key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true }, ['Ctrl+Shift+D'])).toBe('swallow')
    expect(kl({ key: '1', code: 'Digit1', altKey: true }, ['Alt+1'])).toBe('swallow')
  })
  it('atalho personalizado com Ctrl puro vence o shell', () => {
    expect(kl({ key: 'w', code: 'KeyW', ctrlKey: true }, ['Ctrl+W'])).toBe('swallow')
  })
  it('Super sem atalho segue para o xterm; Shift+Enter igual ao Mac', () => {
    expect(kl({ key: 't', code: 'KeyT', metaKey: true })).toBe('xterm')
    expect(kl({ key: 'Enter', code: 'Enter', shiftKey: true })).toBe('send-shift-enter')
  })
})

describe('decideKey no Mac com atalho sem ⌘', () => {
  it('atalho personalizado sem ⌘ fica com o menu', () => {
    const mac = { platform: 'mac' as const, bound: new Set(['Ctrl+Alt+X']) }
    expect(decideKey({ type: 'keydown', key: 'x', code: 'KeyX', shiftKey: false, metaKey: false, ctrlKey: true, altKey: true }, mac)).toBe('swallow')
  })
})
