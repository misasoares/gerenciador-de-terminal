import { describe, expect, it } from 'vitest'
import { fitView, isFit, MAX_SCALE, panBy, zoomTo } from '../../src/renderer/src/image-zoom'

const box = { w: 400, h: 300 }
const img = { w: 1600, h: 900 }

describe('zoom da imagem', () => {
  it('ajustar: cabe inteira e centraliza; na galeria cola no topo', () => {
    expect(fitView(box, img)).toEqual({ scale: 0.25, x: 0, y: (300 - 225) / 2 })
    expect(fitView(box, img, true)).toEqual({ scale: 0.25, x: 0, y: 0 })
  })
  it('imagem pequena não amplia ao ajustar', () => {
    expect(fitView(box, { w: 100, h: 50 })).toEqual({ scale: 1, x: 150, y: 125 })
  })
  it('zoom mantém o ponto sob o cursor', () => {
    const v = zoomTo(fitView(box, img), 1, { x: 200, y: 150 }, box, img)
    expect(v.scale).toBe(1)
    // o centro da imagem continua no centro da caixa
    expect(v.x + 800).toBeCloseTo(200)
    expect(v.y + 450).toBeCloseTo(150)
  })
  it('zoom fica entre ajustar e o máximo', () => {
    const f = fitView(box, img)
    expect(zoomTo(f, 0.01, { x: 0, y: 0 }, box, img).scale).toBe(0.25)
    expect(zoomTo(f, 999, { x: 0, y: 0 }, box, img).scale).toBe(MAX_SCALE)
  })
  it('arrastar não deixa sobrar borda vazia', () => {
    const v = zoomTo(fitView(box, img), 1, { x: 0, y: 0 }, box, img)
    expect(panBy(v, 500, 500, box, img)).toMatchObject({ x: 0, y: 0 })
    expect(panBy(v, -5000, -5000, box, img)).toMatchObject({ x: 400 - 1600, y: 300 - 900 })
    expect(panBy(v, -100, -50, box, img)).toMatchObject({ x: -100, y: -50 })
  })
  it('isFit: só na escala de ajustar', () => {
    expect(isFit(fitView(box, img), box, img)).toBe(true)
    expect(isFit(zoomTo(fitView(box, img), 0.5, { x: 0, y: 0 }, box, img), box, img)).toBe(false)
  })
})
