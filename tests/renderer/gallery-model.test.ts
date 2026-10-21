import { describe, expect, it } from 'vitest'
import { gridColumns, groupTitle, isGalleryView, stepGroup } from '../../src/renderer/src/gallery-model'

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
