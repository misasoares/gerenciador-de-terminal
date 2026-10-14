import type { MemPressure } from './types'

export const gb = (bytes: number): string => (bytes / 1024 ** 3).toFixed(1).replace('.', ',')

/** etime do ps ([dd-]hh:mm:ss ou mm:ss) em texto curto */
export function formatEtime(ps: string): string {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(ps.trim())
  if (!m) return ps
  const [d, h, min, s] = [m[1], m[2], m[3], m[4]].map((x) => Number(x ?? 0))
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${String(min).padStart(2, '0')}m`
  if (min > 0) return `${min}m${String(s).padStart(2, '0')}s`
  return `${s}s`
}

export function pressureLabel(p: MemPressure): string {
  return p === 'critica' ? 'pressão crítica' : p === 'alerta' ? 'pressão em alerta' : p === 'normal' ? 'pressão normal' : 'pressão indisponível'
}
