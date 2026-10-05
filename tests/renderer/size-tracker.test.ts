import { describe, expect, it } from 'vitest'
import { SizeTracker } from '../../src/renderer/src/size-tracker'

describe('SizeTracker', () => {
  it('manda o tamanho só quando muda; depois de remontar (voltou de flutuante) manda de novo mesmo igual', () => {
    const t = new SizeTracker()
    expect(t.changed(80, 24)).toBe(true)
    expect(t.changed(80, 24)).toBe(false)
    expect(t.changed(100, 24)).toBe(true)
    t.reset() // outra janela pode ter redimensionado o terminal enquanto este estava fora da tela
    expect(t.changed(100, 24)).toBe(true)
  })
})
