import { describe, expect, it } from 'vitest'
import { machineLevel } from '../../src/daemon/machine/level'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'

const L = DEFAULT_SETTINGS.machine
const G = 1024 ** 3
const base = { cpu1m: 20, ramTotal: 24 * G, swapUsed: 0, pressure: 'normal' as const }

describe('nível da máquina', () => {
  it('tudo baixo: ok sem motivos', () => {
    expect(machineLevel(base, L)).toEqual({ level: 'ok', reasons: [] })
  })
  it('CPU de 1 min: 70 amarelo, 90 bloqueia', () => {
    expect(machineLevel({ ...base, cpu1m: 75 }, L)).toEqual({ level: 'warn', reasons: ['CPU 75%'] })
    expect(machineLevel({ ...base, cpu1m: 93.4 }, L)).toEqual({ level: 'bad', reasons: ['CPU 93%'] })
  })
  it('swap em % da RAM: 25% de 24 GB = 6 GB amarelo, 75% = 18 GB bloqueia', () => {
    expect(machineLevel({ ...base, swapUsed: 5.9 * G }, L).level).toBe('ok')
    expect(machineLevel({ ...base, swapUsed: 14.3 * G }, L)).toEqual({ level: 'warn', reasons: ['swap 14,3 GB'] })
    expect(machineLevel({ ...base, swapUsed: 18.2 * G }, L)).toEqual({ level: 'bad', reasons: ['swap 18,2 GB'] })
  })
  it('pressão: alerta amarelo, crítica bloqueia; desligada nas preferências não conta', () => {
    expect(machineLevel({ ...base, pressure: 'alerta' }, L)).toEqual({ level: 'warn', reasons: ['pressão em alerta'] })
    expect(machineLevel({ ...base, pressure: 'critica' }, L)).toEqual({ level: 'bad', reasons: ['pressão crítica'] })
    expect(machineLevel({ ...base, pressure: 'critica' }, { ...L, pressureGate: false }).level).toBe('ok')
    expect(machineLevel({ ...base, pressure: null }, L).level).toBe('ok')
  })
  it('combinação: bad vence, motivos de bad e warn listados', () => {
    expect(machineLevel({ ...base, cpu1m: 75, pressure: 'critica' }, L)).toEqual({ level: 'bad', reasons: ['CPU 75%', 'pressão crítica'] })
  })
})
