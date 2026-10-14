import type os from 'node:os'
import { describe, expect, it } from 'vitest'
import { cpuPercent, cpuTotals, MachineMonitor, type MemSample } from '../../src/daemon/machine/monitor'
import { makeMemReader } from '../../src/daemon/machine/read'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import type { MachineView } from '../../src/shared/types'

const G = 1024 ** 3
const cpu = (idle: number, total: number): os.CpuInfo[] => [{ model: '', speed: 0, times: { user: total - idle, nice: 0, sys: 0, idle, irq: 0 } }]
const mem = (p: Partial<MemSample> = {}): MemSample => ({ ramUsed: 10 * G, ramTotal: 24 * G, swapUsed: 0, swapTotal: 0, pressure: 'normal', ...p })

function setup(cpus: os.CpuInfo[][], read: () => Promise<MemSample>, now = { t: 1000 }) {
  const seen: MachineView[] = []
  let i = 0
  const m = new MachineMonitor({
    readMem: read,
    cpus: () => cpus[Math.min(i++, cpus.length - 1)],
    limits: () => DEFAULT_SETTINGS.machine,
    onChange: (v) => seen.push(v),
    now: () => now.t,
  })
  return { m, seen, now }
}

describe('MachineMonitor', () => {
  it('CPU por delta dos tempos', () => {
    expect(cpuTotals(cpu(30, 100))).toEqual({ idle: 30, total: 100 })
    expect(cpuPercent({ idle: 0, total: 0 }, { idle: 25, total: 100 })).toBe(75)
    expect(cpuPercent({ idle: 5, total: 10 }, { idle: 5, total: 10 })).toBe(0)
  })
  it('1ª leitura só guarda a base; a 2ª emite', async () => {
    const { m, seen } = setup([cpu(0, 0), cpu(50, 100)], async () => mem())
    await m.tick()
    expect(m.view()).toBeNull()
    await m.tick()
    expect(seen).toHaveLength(1)
    expect(m.view()).toMatchObject({ cpu: 50, cpu1m: 50, ram: { used: 10 * G, total: 24 * G }, level: 'ok', stale: false, at: 1000 })
  })
  it('média de 1 min e nível pela média', async () => {
    const { m } = setup([cpu(0, 0), cpu(0, 100), cpu(100, 200)], async () => mem())
    await m.tick()
    await m.tick() // 100%
    await m.tick() // 0%
    expect(m.view()).toMatchObject({ cpu: 0, cpu1m: 50 })
  })
  it('só emite quando muda ou a cada 30 s', async () => {
    const { m, seen, now } = setup([cpu(0, 0), cpu(50, 100), cpu(100, 200), cpu(150, 300)], async () => mem())
    await m.tick()
    await m.tick()
    await m.tick() // igual
    expect(seen).toHaveLength(1)
    now.t += 30_000
    await m.tick() // heartbeat
    expect(seen).toHaveLength(2)
  })
  it('falha na leitura: mantém a última com stale e avisa', async () => {
    let fail = false
    const { m, seen } = setup([cpu(0, 0), cpu(50, 100), cpu(100, 200)], async () => {
      if (fail) throw new Error('vm_stat sumiu')
      return mem()
    })
    await m.tick()
    await m.tick()
    fail = true
    await m.tick()
    expect(m.view()).toMatchObject({ stale: true, at: 1000 })
    expect(seen.at(-1)?.stale).toBe(true)
  })
  it('falha antes da 1ª leitura boa: continua sem visão', async () => {
    const { m } = setup([cpu(0, 0), cpu(50, 100)], async () => {
      throw new Error('x')
    })
    await m.tick()
    await m.tick()
    expect(m.view()).toBeNull()
  })
  it('leitura lenta não empilha ticks', async () => {
    let calls = 0
    let release!: () => void
    const { m } = setup([cpu(0, 0), cpu(50, 100), cpu(100, 200)], () => {
      calls++
      return new Promise((r) => (release = () => r(mem())))
    })
    await m.tick()
    const a = m.tick()
    const b = m.tick() // ainda lendo: ignora
    release()
    await Promise.all([a, b])
    expect(calls).toBe(1)
  })
  it('recompute aplica limites novos sem nova leitura', async () => {
    let lim = DEFAULT_SETTINGS.machine
    const seen: MachineView[] = []
    let i = 0
    const cpus = [cpu(0, 0), cpu(25, 100)]
    const m = new MachineMonitor({ readMem: async () => mem(), cpus: () => cpus[Math.min(i++, 1)], limits: () => lim, onChange: (v) => seen.push(v), now: () => 1 })
    await m.tick()
    await m.tick() // 75% → warn
    expect(m.view()?.level).toBe('warn')
    lim = { ...lim, cpuWarn: 80, cpuBad: 95 }
    m.recompute()
    expect(m.view()?.level).toBe('ok')
    expect(seen).toHaveLength(2)
  })
  it.runIf(process.platform === 'darwin')('leitor real do macOS devolve números plausíveis', async () => {
    const s = await makeMemReader('darwin')()
    expect(s.ramTotal).toBeGreaterThan(G)
    expect(s.ramUsed).toBeGreaterThan(0)
    expect(s.ramUsed).toBeLessThanOrEqual(s.ramTotal * 1.05)
    expect(['normal', 'alerta', 'critica']).toContain(s.pressure)
  })
})
