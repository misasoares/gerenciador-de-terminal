import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeMachineLimits, normalizeSettings } from '../../src/shared/settings'

describe('limites da máquina', () => {
  it('padrões', () => {
    expect(DEFAULT_SETTINGS.machine).toEqual({ cpuWarn: 70, cpuBad: 90, swapWarn: 25, swapBad: 75, pressureGate: true })
    expect(normalizeSettings(undefined).machine).toEqual(DEFAULT_SETTINGS.machine)
  })
  it('state.json antigo sem machine ganha os padrões', () => {
    expect(normalizeSettings({ fontSize: 14 } as never).machine).toEqual(DEFAULT_SETTINGS.machine)
  })
  it('faixas: CPU 10–100, swap 5–150, arredonda', () => {
    expect(normalizeMachineLimits({ cpuWarn: 2, cpuBad: 400, swapWarn: 1, swapBad: 999, pressureGate: false })).toEqual({ cpuWarn: 10, cpuBad: 100, swapWarn: 5, swapBad: 150, pressureGate: false })
    expect(normalizeMachineLimits({ cpuWarn: 70.6, cpuBad: 90, swapWarn: 25, swapBad: 75, pressureGate: true }).cpuWarn).toBe(71)
  })
  it('warn ≥ bad: warn desce para bad − 5', () => {
    expect(normalizeMachineLimits({ cpuWarn: 95, cpuBad: 90, swapWarn: 80, swapBad: 80, pressureGate: true })).toMatchObject({ cpuWarn: 85, cpuBad: 90, swapWarn: 75, swapBad: 80 })
    expect(normalizeMachineLimits({ cpuWarn: 10, cpuBad: 10, swapWarn: 5, swapBad: 5, pressureGate: true })).toMatchObject({ cpuWarn: 10, cpuBad: 15, swapWarn: 5, swapBad: 10 })
  })
  it('lixo vira padrão', () => {
    expect(normalizeMachineLimits('x')).toEqual(DEFAULT_SETTINGS.machine)
    expect(normalizeMachineLimits({ cpuWarn: 'a', pressureGate: 1 })).toEqual(DEFAULT_SETTINGS.machine)
  })
})
