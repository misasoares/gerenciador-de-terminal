import { describe, expect, it } from 'vitest'
import { originFor } from '../../src/renderer/src/pointer'

describe('origem do zoom', () => {
  it('clique recente (≤ 400 ms): o ponto do clique relativo à caixa', () => {
    expect(originFor({ x: 300, y: 120, t: 1000 }, 1300, { left: 200, top: 100 })).toBe('100px 20px')
  })
  it('clique antigo ou nenhum (abriu por atalho): topo-centro', () => {
    expect(originFor({ x: 300, y: 120, t: 1000 }, 1500, { left: 200, top: 100 })).toBe('50% 0%')
    expect(originFor(null, 1500, { left: 0, top: 0 })).toBe('50% 0%')
  })
})
