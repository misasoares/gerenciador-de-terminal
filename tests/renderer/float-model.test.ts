import { describe, expect, it } from 'vitest'
import { revealTarget } from '../../src/renderer/src/float-model'

describe('revelar painel flutuante', () => {
  it('flutuante → foca a janela; senão → grade', () => {
    expect(revealTarget({ floating: ['p'] }, 'p')).toBe('float')
    expect(revealTarget({ floating: [] }, 'p')).toBe('grid')
  })
})
