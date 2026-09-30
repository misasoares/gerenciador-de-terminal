import type { AppState, UsageView, UsageWindow } from '../../shared/types'
import { formatClock, formatReset } from '../../shared/usage-format'

export type Level = 'ok' | 'warn' | 'bad'

export interface UsageChip {
  key: string
  label: string
  color: string
  parts: { text: string; level: Level }[]
  dim: boolean
  unavailable: boolean
  tooltip: string
}

export const levelOf = (p: number): Level => (p >= 95 ? 'bad' : p >= 80 ? 'warn' : 'ok')

const SHORT: Record<UsageWindow['kind'], string> = { '5h': '5h', week: 'sem' }

function parts(v: UsageView): { text: string; level: Level }[] {
  const dim = v.status === 'stale' || v.status === 'expired'
  const kinds: UsageWindow['kind'][] = v.agent === 'claude' ? ['5h', 'week'] : v.windows.map((w) => w.kind)
  return kinds.map((k) => {
    const w = v.windows.find((x) => x.kind === k)
    return { text: `${dim ? '~' : ''}${SHORT[k]} ${w ? `${Math.round(w.percent)}%` : '—'}`, level: w ? levelOf(w.percent) : 'ok' }
  })
}

export function usageChips(app: Pick<AppState, 'usage' | 'accounts'>, now: number): UsageChip[] {
  return app.usage.map((v) => {
    const acc = app.accounts.find((a) => a.id === v.accountIds[0])
    const lines: string[] = []
    if (v.plan) lines.push(`plano ${v.plan}`)
    for (const w of v.windows) lines.push(`${SHORT[w.kind]}: ${Math.round(w.percent)}%${w.resetsAt !== null ? ` · ${formatReset(w.resetsAt, now)}` : ''}`)
    if (v.readAt !== null) lines.push(`lido às ${formatClock(v.readAt)}`)
    if (v.status === 'expired') lines.push('token vencido: abra uma sessão desta conta para atualizar')
    if (v.status === 'stale') lines.push('não foi possível atualizar agora')
    if (v.status === 'unavailable') lines.push('o formato da resposta mudou: uso indisponível')
    const unavailable = v.status === 'unavailable'
    return {
      key: v.loginKey,
      label: acc?.label ?? v.accountIds[0],
      color: acc?.color ?? '#888888',
      parts: unavailable ? [] : parts(v),
      dim: v.status === 'stale' || v.status === 'expired',
      unavailable,
      tooltip: lines.join('\n'),
    }
  })
}

export function accountUsage(app: Pick<AppState, 'usage' | 'usageHints'>, accountId: string): { text: string | null; hint: string | null } {
  const v = app.usage.find((u) => u.accountIds.includes(accountId))
  if (v && v.status !== 'unavailable') return { text: parts(v).map((p) => p.text).join(' · '), hint: null }
  return { text: null, hint: app.usageHints[accountId] ?? null }
}
