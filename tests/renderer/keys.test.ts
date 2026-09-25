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
