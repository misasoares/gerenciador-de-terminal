import type { MemPressure } from '../../shared/types'

const MB = 1024 ** 2
const GB = 1024 ** 3

/** "Memória usada" do Monitor de Atividade ≈ ativa + fixa + comprimida; os.freemem() subestima no Mac */
export function parseVmStatUsed(out: string): number | null {
  const page = /page size of (\d+) bytes/.exec(out)
  const n = (label: string) => {
    const m = new RegExp(`^${label}:\\s+(\\d+)\\.`, 'm').exec(out)
    return m ? Number(m[1]) : null
  }
  const active = n('Pages active')
  const wired = n('Pages wired down')
  const comp = n('Pages occupied by compressor')
  if (!page || active === null || wired === null || comp === null) return null
  return (active + wired + comp) * Number(page[1])
}

export function parseSwapUsage(out: string): { used: number; total: number } | null {
  const m = /vm\.swapusage:\s*total = ([\d.]+)([MG])\s+used = ([\d.]+)([MG])/.exec(out)
  if (!m) return null
  const b = (v: string, u: string) => Number(v) * (u === 'G' ? GB : MB)
  return { total: b(m[1], m[2]), used: b(m[3], m[4]) }
}

export function parsePressureLevel(out: string): MemPressure {
  const m = /kern\.memorystatus_vm_pressure_level:\s*(\d+)/.exec(out)
  if (!m) return null
  const v = Number(m[1])
  return v >= 4 ? 'critica' : v >= 2 ? 'alerta' : 'normal'
}

export function parseMeminfo(text: string): { ramUsed: number; ramTotal: number; swapUsed: number; swapTotal: number } | null {
  const kb = (k: string) => {
    const m = new RegExp(`^${k}:\\s+(\\d+) kB`, 'm').exec(text)
    return m ? Number(m[1]) * 1024 : null
  }
  const total = kb('MemTotal')
  const avail = kb('MemAvailable')
  if (total === null || avail === null) return null
  const swapTotal = kb('SwapTotal') ?? 0
  const swapFree = kb('SwapFree') ?? swapTotal
  return { ramTotal: total, ramUsed: total - avail, swapTotal, swapUsed: swapTotal - swapFree }
}

export function parsePsi(text: string): MemPressure {
  const m = /^some avg10=([\d.]+)/m.exec(text)
  if (!m) return null
  const v = Number(m[1])
  return v >= 40 ? 'critica' : v >= 10 ? 'alerta' : 'normal'
}
