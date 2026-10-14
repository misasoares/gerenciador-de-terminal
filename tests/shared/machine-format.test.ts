import { describe, expect, it } from 'vitest'
import { formatEtime, gb, pressureLabel } from '../../src/shared/machine-format'

describe('formatação da máquina', () => {
  it('gb com vírgula e 1 casa', () => {
    expect(gb(19.4 * 1024 ** 3)).toBe('19,4')
    expect(gb(0)).toBe('0,0')
  })
  it('etime do ps vira texto curto', () => {
    expect(formatEtime('05-19:10:57')).toBe('5d19h')
    expect(formatEtime('43-09:24:51')).toBe('43d9h')
    expect(formatEtime('1:02:03')).toBe('1h02m')
    expect(formatEtime('01:43')).toBe('1m43s')
    expect(formatEtime('00:12')).toBe('12s')
    expect(formatEtime('lixo')).toBe('lixo')
  })
  it('rótulo da pressão', () => {
    expect(pressureLabel('normal')).toBe('pressão normal')
    expect(pressureLabel('alerta')).toBe('pressão em alerta')
    expect(pressureLabel('critica')).toBe('pressão crítica')
    expect(pressureLabel(null)).toBe('pressão indisponível')
  })
})
