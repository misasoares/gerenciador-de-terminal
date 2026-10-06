import { describe, expect, it } from 'vitest'
import { animateOut, shouldAnimateEnter } from '../../src/renderer/src/pane-motion'

describe('painéis', () => {
  it('primeira visita a uma aba não anima; voltar à aba não anima; painel novo numa aba já vista anima', () => {
    const seen = new Map<string, Set<string>>()
    expect(shouldAnimateEnter('t1', 'a', seen)).toBe(false)
    expect(shouldAnimateEnter('t1', 'a', seen)).toBe(false)
    expect(shouldAnimateEnter('t1', 'b', seen)).toBe(true)
    expect(shouldAnimateEnter('t1', 'b', seen)).toBe(false)
  })
  it('aba vazia já visitada: o primeiro painel anima', () => {
    const seen = new Map<string, Set<string>>([['t2', new Set()]])
    expect(shouldAnimateEnter('t2', 'x', seen)).toBe(true)
  })
  it('animateOut sem o elemento na tela resolve na hora (não trava o fechar)', async () => {
    await expect(animateOut('nao-existe', { opacity: 0, scale: 0.98 }, { duration: 0.14 })).resolves.toBeUndefined()
  })
})
