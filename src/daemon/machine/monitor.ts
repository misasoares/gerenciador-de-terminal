import os from 'node:os'
import type { MachineView, MemPressure } from '../../shared/types'
import type { MachineLimits } from '../../shared/settings'
import { machineLevel } from './level'

export interface MemSample {
  ramUsed: number
  ramTotal: number
  swapUsed: number
  swapTotal: number
  pressure: MemPressure
}

export interface MachineMonitorDeps {
  readMem: () => Promise<MemSample>
  cpus?: () => os.CpuInfo[]
  limits: () => MachineLimits
  onChange: (v: MachineView) => void
  intervalMs?: number
  heartbeatMs?: number
  now?: () => number
  log?: (m: string) => void
}

type Totals = { idle: number; total: number }

export function cpuTotals(cpus: os.CpuInfo[]): Totals {
  let idle = 0
  let total = 0
  for (const c of cpus) {
    const t = c.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  return { idle, total }
}

export function cpuPercent(a: Totals, b: Totals): number {
  const dt = b.total - a.total
  if (dt <= 0) return 0
  return Math.min(100, Math.max(0, 100 * (1 - (b.idle - a.idle) / dt)))
}

/** CPU/RAM da máquina a cada 3 s; o gate do contratar_dev e o chip da barra leem daqui */
export class MachineMonitor {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private stopped = false
  private base: Totals | null = null
  private hist: number[] = []
  private raw: { cpu: number; mem: MemSample; at: number } | null = null
  private current: MachineView | null = null
  private lastKey = ''
  private lastEmitAt = -Infinity
  private loggedAt = -Infinity
  private interval: number
  private heartbeat: number
  private window: number

  constructor(private d: MachineMonitorDeps) {
    this.interval = d.intervalMs ?? 3000
    this.heartbeat = d.heartbeatMs ?? 30_000
    this.window = Math.max(1, Math.round(60_000 / this.interval))
  }

  start(): void {
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.interval)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
  }

  view(): MachineView | null {
    return this.current
  }

  /** limites mudaram nas preferências: recalcula o nível com a última leitura */
  recompute(): void {
    if (!this.raw) return
    this.current = { ...this.build(), stale: this.current?.stale ?? false }
    this.emit()
  }

  async tick(): Promise<void> {
    if (this.stopped || this.running) return
    const now = this.d.now ?? Date.now
    const t = cpuTotals((this.d.cpus ?? os.cpus)())
    const prev = this.base
    this.base = t
    if (!prev) return // 1ª leitura: só a base do delta
    const cpu = cpuPercent(prev, t)
    this.hist.push(cpu)
    if (this.hist.length > this.window) this.hist.shift()
    this.running = true
    let mem: MemSample | null = null
    try {
      mem = await this.d.readMem()
    } catch (e) {
      if (now() - this.loggedAt > 3_600_000) {
        this.loggedAt = now()
        this.d.log?.(`monitor da máquina: leitura falhou (${e instanceof Error ? e.message : String(e)})`)
      }
    } finally {
      this.running = false
    }
    if (this.stopped) return
    if (!mem) {
      if (this.current && !this.current.stale) {
        this.current = { ...this.current, stale: true }
        this.emit()
      }
      return
    }
    this.raw = { cpu, mem, at: now() }
    this.current = this.build()
    this.emit()
  }

  private build(): MachineView {
    const { cpu, mem, at } = this.raw!
    const cpu1m = this.hist.reduce((a, b) => a + b, 0) / this.hist.length
    const { level, reasons } = machineLevel({ cpu1m, ramTotal: mem.ramTotal, swapUsed: mem.swapUsed, pressure: mem.pressure }, this.d.limits())
    return { cpu, cpu1m, ram: { used: mem.ramUsed, total: mem.ramTotal }, swap: { used: mem.swapUsed, total: mem.swapTotal }, pressure: mem.pressure, level, reasons, at, stale: false }
  }

  /** só quando muda o que aparece (CPU inteira, 0,1 GB, nível, pressão, stale) ou a cada heartbeat */
  private emit(): void {
    const v = this.current
    if (!v) return
    const now = (this.d.now ?? Date.now)()
    const r = (b: number) => Math.round(b / 1e8)
    const key = [Math.round(v.cpu), Math.round(v.cpu1m), r(v.ram.used), r(v.swap.used), v.level, v.pressure, v.stale, v.reasons.join()].join('|')
    if (key === this.lastKey && now - this.lastEmitAt < this.heartbeat) return
    this.lastKey = key
    this.lastEmitAt = now
    this.d.onChange(v)
  }
}
