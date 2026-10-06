import { describe, expect, it } from 'vitest'
import { presetsFor } from '../../src/renderer/src/motion-presets'

describe('motion-presets', () => {
  it('sutil: tween curto, sem mola nem materializar', () => {
    const p = presetsFor('subtle', { reduced: false, gpu: true })
    expect(p.enter).toEqual({ duration: 0.15, ease: [0.2, 0, 0, 1] })
    expect(p.exit).toEqual({ duration: 0.12, ease: [0.4, 0, 1, 1] })
    expect(p.materialize).toBe(false)
    expect(p.scaleFrom).toBe(0.96)
  })
  it('calmo, preciso e vivo: molas com os valores da spec', () => {
    expect(presetsFor('calm', { reduced: false, gpu: true }).enter).toEqual({ type: 'spring', bounce: 0, visualDuration: 0.45 })
    expect(presetsFor('crisp', { reduced: false, gpu: true }).enter).toEqual({ type: 'spring', bounce: 0, visualDuration: 0.25 })
    expect(presetsFor('lively', { reduced: false, gpu: true }).enter).toEqual({ type: 'spring', bounce: 0.15, visualDuration: 0.4 })
    expect(presetsFor('crisp', { reduced: false, gpu: true }).exit).toEqual({ duration: 0.14, ease: [0.4, 0, 1, 1] })
    expect(presetsFor('lively', { reduced: false, gpu: true }).scaleFrom).toBe(0.9)
  })
  it('materializar só com GPU e sem reduzir movimento', () => {
    expect(presetsFor('calm', { reduced: false, gpu: true }).materialize).toBe(true)
    expect(presetsFor('calm', { reduced: false, gpu: false }).materialize).toBe(false)
    expect(presetsFor('calm', { reduced: true, gpu: true }).materialize).toBe(false)
  })
  it('reduzir movimento: só opacidade, 120 ms, sem escala', () => {
    const p = presetsFor('lively', { reduced: true, gpu: true })
    expect(p.reduced).toBe(true)
    expect(p.enter).toEqual({ duration: 0.12, ease: 'linear' })
    expect(p.exit).toEqual({ duration: 0.12, ease: 'linear' })
    expect(p.scaleFrom).toBe(1)
  })
})
