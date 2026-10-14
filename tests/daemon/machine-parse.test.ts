import { describe, expect, it } from 'vitest'
import { parseMeminfo, parsePressureLevel, parsePsi, parseSwapUsage, parseVmStatUsed } from '../../src/daemon/machine/parse'

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     2917.
Pages active:                                 223105.
Pages inactive:                               207049.
Pages speculative:                             14574.
Pages throttled:                                   0.
Pages wired down:                             455150.
Pages purgeable:                                   0.
"Translation faults":                  1645371187190.
Pages copy-on-write:                      4350582940.
File-backed pages:                            161739.
Anonymous pages:                              282989.
Pages stored in compressor:                  3247708.
Pages occupied by compressor:                 627010.
Swapins:                                   521498890.
Swapouts:                                  581629978.
`
const SYSCTL = `vm.swapusage: total = 15360.00M  used = 14692.94M  free = 667.06M  (encrypted)
kern.memorystatus_vm_pressure_level: 2
`
const MEMINFO = `MemTotal:       16303428 kB
MemFree:          812344 kB
MemAvailable:    6303428 kB
Buffers:          123456 kB
SwapTotal:       4194300 kB
SwapFree:        3145724 kB
`

describe('parsers de memória', () => {
  it('vm_stat: (active + wired + ocupadas pelo compressor) × página', () => {
    expect(parseVmStatUsed(VM_STAT)).toBe((223105 + 455150 + 627010) * 16384)
    expect(parseVmStatUsed('')).toBeNull()
  })
  it('swapusage em M e G', () => {
    expect(parseSwapUsage(SYSCTL)).toEqual({ total: 15360 * 1024 ** 2, used: 14692.94 * 1024 ** 2 })
    expect(parseSwapUsage('vm.swapusage: total = 2.00G  used = 0.50G  free = 1.50G')).toEqual({ total: 2 * 1024 ** 3, used: 0.5 * 1024 ** 3 })
    expect(parseSwapUsage('vm.swapusage: total = 0.00M  used = 0.00M  free = 0.00M')).toEqual({ total: 0, used: 0 })
    expect(parseSwapUsage('nada')).toBeNull()
  })
  it('pressão do macOS: 1 normal, 2 alerta, 4 crítica', () => {
    expect(parsePressureLevel(SYSCTL)).toBe('alerta')
    expect(parsePressureLevel('kern.memorystatus_vm_pressure_level: 1')).toBe('normal')
    expect(parsePressureLevel('kern.memorystatus_vm_pressure_level: 4')).toBe('critica')
    expect(parsePressureLevel('')).toBeNull()
  })
  it('/proc/meminfo: usada = total − disponível', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({ ramTotal: 16303428 * 1024, ramUsed: (16303428 - 6303428) * 1024, swapTotal: 4194300 * 1024, swapUsed: (4194300 - 3145724) * 1024 })
    expect(parseMeminfo('MemTotal: 1 kB')).toBeNull()
  })
  it('PSI: some avg10 ≥ 10 alerta, ≥ 40 crítica', () => {
    const psi = (n: number) => `some avg10=${n} avg60=0.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n`
    expect(parsePsi(psi(0.5))).toBe('normal')
    expect(parsePsi(psi(12.3))).toBe('alerta')
    expect(parsePsi(psi(55))).toBe('critica')
    expect(parsePsi('')).toBeNull()
  })
})
