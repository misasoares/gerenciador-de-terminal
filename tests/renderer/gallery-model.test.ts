import { describe, expect, it } from 'vitest'
import { bestColumns, gridColumns, groupTitle, isGalleryView, stepGroup } from '../../src/renderer/src/gallery-model'

describe('galeria', () => {
  it('galeria só com mais de uma mídia', () => {
    expect(isGalleryView(undefined)).toBe(false)
    expect(isGalleryView({ groups: [['/a.png']], labels: null, titles: null, createdBy: 'x' })).toBe(false)
    expect(isGalleryView({ groups: [['/a.png'], ['/b.png']], labels: null, titles: null, createdBy: 'x' })).toBe(true)
    expect(isGalleryView({ groups: [['/a.png', '/b.png']], labels: null, titles: null, createdBy: 'x' })).toBe(true)
  })
  it('colunas: até 4 numa linha, depois grade √n', () => {
    expect([1, 2, 3, 4, 5, 6, 9, 10].map(gridColumns)).toEqual([1, 2, 3, 4, 3, 3, 3, 4])
  })
  it('colunas pelo espaço: imagens largas num painel largo e alto empilham', () => {
    const m = { gap: 6, pad: 6, label: 22 }
    // o caso do print: 2 imagens 3,6:1 num painel 1740×820 ficam uma em cima da outra
    expect(bestColumns([3.6, 3.6], { w: 1740, h: 820 }, m)).toBe(1)
    // retrato num painel largo: lado a lado
    expect(bestColumns([0.6, 0.6, 0.6], { w: 1740, h: 820 }, m)).toBe(3)
    // 4 telas 16:9 num painel quase quadrado: 2×2
    expect(bestColumns([16 / 9, 16 / 9, 16 / 9, 16 / 9], { w: 1000, h: 800 }, m)).toBe(2)
    // painel estreito (encaixado ao lado de terminais): uma coluna
    expect(bestColumns([16 / 9, 16 / 9], { w: 500, h: 900 }, m)).toBe(1)
    // sem medida do painel ainda: padrão antigo
    expect(bestColumns([1, 1, 1], { w: 0, h: 0 }, m)).toBe(3)
    expect(bestColumns([2], { w: 900, h: 900 }, m)).toBe(1)
  })
  it('título: o dado ou o nome do primeiro arquivo sem extensão', () => {
    const g = { groups: [['/x/cmp-01-equalizer.png'], ['/y/b.png']], labels: null, titles: null }
    expect(groupTitle(g, 0)).toBe('cmp-01-equalizer')
    expect(groupTitle({ ...g, titles: ['eq'] }, 0)).toBe('eq')
  })
  it('navegação presa nas pontas', () => {
    expect(stepGroup(0, -1, 6)).toBe(0)
    expect(stepGroup(5, 1, 6)).toBe(5)
    expect(stepGroup(2, 1, 6)).toBe(3)
  })
})
