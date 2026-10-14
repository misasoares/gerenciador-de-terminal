import type { MachineLevel, MachineView } from '../../shared/types'
import type { MachineLimits } from '../../shared/settings'
import { gb, pressureLabel } from '../../shared/machine-format'

export interface MachineBar {
  label: 'CPU' | 'RAM'
  percent: number
  filled: number
  level: MachineLevel
}

export interface MachineChipVm {
  bars: MachineBar[]
  swap: { text: string; level: MachineLevel } | null
  dim: boolean
  tooltip: string
}

export const segments = (percent: number): number => (percent <= 0 ? 0 : Math.min(5, Math.max(1, Math.round(percent / 20))))

const by = (v: number, warn: number, bad: number): MachineLevel => (v >= bad ? 'bad' : v >= warn ? 'warn' : 'ok')

export function machineChip(v: MachineView, lim: MachineLimits): MachineChipVm {
  const cpu = Math.round(v.cpu)
  const ram = v.ram.total > 0 ? Math.round((v.ram.used / v.ram.total) * 100) : 0
  // no Mac a RAM "usada" vive alta; quem diz se aperta é a pressão do sistema
  const ramLevel: MachineLevel = v.pressure === 'critica' ? 'bad' : v.pressure === 'alerta' ? 'warn' : v.pressure === null ? by(ram, 85, 95) : 'ok'
  const swapPct = v.ram.total > 0 ? (v.swap.used / v.ram.total) * 100 : 0
  const swapLevel = by(swapPct, lim.swapWarn, lim.swapBad)
  const showSwap = swapLevel !== 'ok' || v.pressure === 'alerta' || v.pressure === 'critica'
  const lines = [`CPU ${cpu}% (1 min ${Math.round(v.cpu1m)}%)`, `RAM ${gb(v.ram.used)}/${gb(v.ram.total)} GB`, `swap ${gb(v.swap.used)} GB`, pressureLabel(v.pressure)]
  if (v.stale) lines.push('leitura indisponível')
  return {
    bars: [
      { label: 'CPU', percent: cpu, filled: segments(cpu), level: by(cpu, lim.cpuWarn, lim.cpuBad) },
      { label: 'RAM', percent: ram, filled: segments(ram), level: ramLevel },
    ],
    swap: showSwap ? { text: `swap ${gb(v.swap.used)}G`, level: swapLevel } : null,
    dim: v.stale,
    tooltip: lines.join('\n'),
  }
}
