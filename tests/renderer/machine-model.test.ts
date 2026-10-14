import { describe, expect, it } from 'vitest'
import { machineChip, segments } from '../../src/renderer/src/machine-model'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import type { MachineView } from '../../src/shared/types'

const G = 1024 ** 3
const L = DEFAULT_SETTINGS.machine
const v = (p: Partial<MachineView> = {}): MachineView => ({ cpu: 34, cpu1m: 30, ram: { used: 19.4 * G, total: 24 * G }, swap: { used: 2 * G, total: 4 * G }, pressure: 'normal', level: 'ok', reasons: [], at: 0, stale: false, ...p })

describe('chip da máquina', () => {
  it('segmentos: 0 vazio, qualquer uso acende 1, cheio 5', () => {
    expect([0, 1, 20, 34, 81, 100, 130].map(segments)).toEqual([0, 1, 1, 2, 4, 5, 5])
  })
  it('barras de CPU e RAM com porcentagem', () => {
    const c = machineChip(v(), L)
    expect(c.bars).toEqual([
      { label: 'CPU', percent: 34, filled: 2, level: 'ok' },
      { label: 'RAM', percent: 81, filled: 4, level: 'ok' },
    ])
    expect(c.swap).toBeNull()
    expect(c.dim).toBe(false)
  })
  it('cor da CPU pelos limites; cor da RAM pela pressão', () => {
    expect(machineChip(v({ cpu: 75 }), L).bars[0].level).toBe('warn')
    expect(machineChip(v({ cpu: 95 }), L).bars[0].level).toBe('bad')
    expect(machineChip(v({ pressure: 'alerta' }), L).bars[1].level).toBe('warn')
    expect(machineChip(v({ pressure: 'critica' }), L).bars[1].level).toBe('bad')
  })
  it('RAM sem pressão (Linux sem PSI): 85% amarelo, 95% vermelho', () => {
    expect(machineChip(v({ pressure: null, ram: { used: 21 * G, total: 24 * G } }), L).bars[1].level).toBe('warn')
    expect(machineChip(v({ pressure: null, ram: { used: 23 * G, total: 24 * G } }), L).bars[1].level).toBe('bad')
  })
  it('swap só aparece fora do normal (em % da RAM) ou com pressão', () => {
    expect(machineChip(v({ swap: { used: 8.7 * G, total: 10 * G } }), L).swap).toEqual({ text: 'swap 8,7G', level: 'warn' })
    expect(machineChip(v({ swap: { used: 18.5 * G, total: 20 * G } }), L).swap).toEqual({ text: 'swap 18,5G', level: 'bad' })
    expect(machineChip(v({ pressure: 'alerta' }), L).swap).toEqual({ text: 'swap 2,0G', level: 'ok' })
  })
  it('leitura velha: apagado e tooltip avisa', () => {
    const c = machineChip(v({ stale: true }), L)
    expect(c.dim).toBe(true)
    expect(c.tooltip).toContain('leitura indisponível')
  })
  it('tooltip com os números', () => {
    expect(machineChip(v(), L).tooltip).toBe('CPU 34% (1 min 30%)\nRAM 19,4/24,0 GB\nswap 2,0 GB\npressão normal')
  })
})
