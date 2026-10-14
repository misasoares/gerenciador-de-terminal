import type { MachineDetail, MachineView } from '../../shared/types'
import { formatEtime, gb, pressureLabel } from '../../shared/machine-format'

function consumers(d: MachineDetail): string[] {
  const groups = d.groups.filter((g) => g.count > 0).slice(0, 2).map((g) => `${g.label}${g.key === 'sessoes' ? ` (${g.count})` : ''} ${gb(g.rss)} GB`)
  const procs = d.top.slice(0, 2).map((p) => `${p.name} ${Math.round(p.cpu)}% CPU`)
  return [...groups, ...procs]
}

export function gateRefusal(v: MachineView, d: MachineDetail): string {
  return [
    `Máquina sobrecarregada: ${v.reasons.join(' · ')} (CPU ${Math.round(v.cpu)}%, RAM ${gb(v.ram.used)}/${gb(v.ram.total)} GB).`,
    `Maiores consumidores: ${consumers(d).join(' · ')}.`,
    'Contratar agora pode travar o computador. Pergunte ao usuário; só repita com forcar: true se ele autorizar.',
  ].join(' ')
}

export function machineReport(v: MachineView, d: MachineDetail, claudePanes: { rss: number }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    nivel: v.level,
    motivos: v.reasons,
    cpu: `${Math.round(v.cpu)}%`,
    cpu_1min: `${Math.round(v.cpu1m)}%`,
    ram: `${gb(v.ram.used)}/${gb(v.ram.total)} GB`,
    swap: `${gb(v.swap.used)} GB`,
    pressao: pressureLabel(v.pressure),
    grupos: d.groups.map((g) => ({ nome: g.label, processos: g.count, ram: `${gb(g.rss)} GB`, cpu: `${Math.round(g.cpu)}%` })),
    maiores_processos: d.top.map((p) => ({ nome: p.name, pid: p.pid, cpu: `${Math.round(p.cpu)}%`, ram: `${gb(p.rss)} GB`, tempo: formatEtime(p.etime) })),
  }
  if (claudePanes.length > 0) {
    const avg = claudePanes.reduce((a, p) => a + p.rss, 0) / claudePanes.length
    out.media_por_sessao_claude = `${gb(avg)} GB`
    if (avg > 0) out.cabem_ate_amarelo = Math.max(0, Math.floor((0.85 * v.ram.total - v.ram.used) / avg))
  }
  return out
}
