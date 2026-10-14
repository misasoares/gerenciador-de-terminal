import type { MachineLevel, MemPressure } from '../../shared/types'
import type { MachineLimits } from '../../shared/settings'
import { gb, pressureLabel } from '../../shared/machine-format'

const RANK: Record<MachineLevel, number> = { ok: 0, warn: 1, bad: 2 }

/** swap conta em % da RAM física: o total de swap do macOS cresce sozinho e fica sempre quase cheio */
export function machineLevel(s: { cpu1m: number; ramTotal: number; swapUsed: number; pressure: MemPressure }, lim: MachineLimits): { level: MachineLevel; reasons: string[] } {
  let level: MachineLevel = 'ok'
  const reasons: string[] = []
  const hit = (l: MachineLevel, reason: string) => {
    if (l === 'ok') return
    reasons.push(reason)
    if (RANK[l] > RANK[level]) level = l
  }
  const by = (v: number, warn: number, bad: number): MachineLevel => (v >= bad ? 'bad' : v >= warn ? 'warn' : 'ok')
  hit(by(s.cpu1m, lim.cpuWarn, lim.cpuBad), `CPU ${Math.round(s.cpu1m)}%`)
  if (s.ramTotal > 0) hit(by((s.swapUsed / s.ramTotal) * 100, lim.swapWarn, lim.swapBad), `swap ${gb(s.swapUsed)} GB`)
  if (lim.pressureGate && s.pressure) hit(s.pressure === 'critica' ? 'bad' : s.pressure === 'alerta' ? 'warn' : 'ok', pressureLabel(s.pressure))
  return { level, reasons }
}
