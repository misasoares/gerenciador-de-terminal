import type { UsageWindow } from '../../shared/types'
import { formatReset } from '../../shared/usage-format'

export const THRESHOLDS = [80, 95]

const keyOf = (loginKey: string, w: UsageWindow, t: number) => `${loginKey}|${w.kind}|${w.resetsAt ?? 'na'}|${t}`

/** um aviso por janela com o maior limiar novo; keys marca todos os limiares cruzados */
export function crossings(loginKey: string, label: string, windows: UsageWindow[], notified: Set<string>, now: number): { keys: string[]; text: string }[] {
  const out: { keys: string[]; text: string }[] = []
  for (const w of windows) {
    const fresh = THRESHOLDS.filter((t) => w.percent >= t && !notified.has(keyOf(loginKey, w, t)))
    if (fresh.length === 0) continue
    const top = fresh[fresh.length - 1]
    const janela = w.kind === '5h' ? 'de 5h' : 'semanal'
    const reset = w.resetsAt !== null ? ` · ${formatReset(w.resetsAt, now)}` : ''
    out.push({ keys: fresh.map((t) => keyOf(loginKey, w, t)), text: `${label}: ${top}% da janela ${janela}${reset}` })
  }
  return out
}

/** descarta chaves de janelas que já reiniciaram */
export function pruneNotified(keys: Iterable<string>, now: number): string[] {
  return [...keys].filter((k) => {
    const resetsAt = Number(k.split('|')[2])
    return !Number.isFinite(resetsAt) || resetsAt > now
  })
}
