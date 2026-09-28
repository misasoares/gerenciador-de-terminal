import type { UsageView } from '../../shared/types'
import { crossings, pruneNotified } from './alerts'
import { applyResets } from './logins'
import type { Login, ReadResult } from './types'

export interface MonitorDeps {
  read: (login: Login) => Promise<ReadResult>
  onChange: () => void
  /** texto do aviso + todas as chaves avisadas (para persistir); devolve se chegou a algum app */
  onAlert: (text: string, notified: string[]) => boolean
  labelOf: (accountId: string) => string
  notified: string[]
  log?: (msg: string) => void
  intervalMs?: number
  minGapMs?: number
  maxBackoffMs?: number
}

interface Entry {
  login: Login
  view: UsageView | null
  hint: string | null
  timer: NodeJS.Timeout | null
  running: boolean
  pending: boolean
  lastReadAt: number
  failures: number
}

const HINT = {
  expired: 'token vencido: abra uma sessão deste agente para atualizar',
  'no-token': 'sem login do plano (Keychain ou .credentials.json)',
  'no-data': 'o Codex ainda não registrou limites: use-o uma vez',
} as const

export class UsageMonitor {
  private entries = new Map<string, Entry>()
  private notified: Set<string>
  private logged = new Map<string, number>()
  private stopped = false
  private interval: number
  private minGap: number
  private maxBackoff: number

  constructor(private d: MonitorDeps) {
    this.notified = new Set(d.notified)
    this.interval = d.intervalMs ?? 300_000
    this.minGap = d.minGapMs ?? 60_000
    this.maxBackoff = d.maxBackoffMs ?? 1_800_000
  }

  setLogins(logins: Login[]): void {
    const keep = new Set(logins.map((l) => l.key))
    for (const [k, e] of this.entries) {
      if (keep.has(k)) continue
      if (e.timer) clearTimeout(e.timer)
      this.entries.delete(k)
    }
    for (const l of logins) {
      const e = this.entries.get(l.key)
      if (e) {
        e.login = l
        if (e.view) e.view = { ...e.view, accountIds: l.accountIds }
        continue
      }
      const fresh: Entry = { login: l, view: null, hint: null, timer: null, running: false, pending: false, lastReadAt: 0, failures: 0 }
      this.entries.set(l.key, fresh)
      void this.run(fresh)
    }
    this.d.onChange()
  }

  /** um Stop do agente: lê de novo logo, respeitando o intervalo mínimo */
  poke(accountId: string): void {
    const e = [...this.entries.values()].find((x) => x.login.accountIds.includes(accountId))
    if (!e || this.stopped) return
    if (e.running) {
      e.pending = true
      return
    }
    this.schedule(e, Math.max(0, e.lastReadAt + this.minGap - Date.now()))
  }

  views(): UsageView[] {
    const now = Date.now()
    return [...this.entries.values()].filter((e) => e.view).map((e) => ({ ...e.view!, windows: applyResets(e.view!.windows, now) }))
  }

  hints(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const e of this.entries.values()) if (!e.view && e.hint) for (const id of e.login.accountIds) out[id] = e.hint
    return out
  }

  stop(): void {
    this.stopped = true
    for (const e of this.entries.values()) if (e.timer) clearTimeout(e.timer)
  }

  private schedule(e: Entry, ms: number): void {
    if (e.timer) clearTimeout(e.timer)
    e.timer = setTimeout(() => void this.run(e), ms)
  }

  private async run(e: Entry): Promise<void> {
    if (this.stopped || e.running) return
    e.running = true
    if (e.timer) clearTimeout(e.timer)
    e.timer = null
    let r: ReadResult
    try {
      r = await this.d.read(e.login)
    } catch {
      r = { kind: 'retry', reason: 'erro na leitura' }
    }
    e.running = false
    if (this.stopped || this.entries.get(e.login.key) !== e) return
    e.lastReadAt = Date.now()
    this.apply(e, r)
    const delay = r.kind === 'retry' ? Math.min(this.interval * 2 ** e.failures, this.maxBackoff) : this.interval
    if (e.pending) {
      e.pending = false
      this.schedule(e, this.minGap)
    } else this.schedule(e, delay)
    this.d.onChange()
  }

  private apply(e: Entry, r: ReadResult): void {
    const base = { loginKey: e.login.key, agent: e.login.agent, accountIds: e.login.accountIds }
    if (r.kind !== 'retry') e.failures = 0
    switch (r.kind) {
      case 'ok':
        e.hint = null
        e.view = { ...base, windows: r.windows, plan: r.plan, readAt: Date.now(), status: 'ok' }
        this.alert(e)
        break
      case 'retry':
        e.failures++
        this.log(e, 'retry', r.reason)
        if (e.view) e.view = { ...e.view, status: 'stale' }
        break
      case 'expired':
        if (e.view) e.view = { ...e.view, status: 'expired' }
        else e.hint = HINT.expired
        break
      case 'no-token':
      case 'no-data':
        e.view = null
        e.hint = HINT[r.kind]
        break
      case 'bad-format':
        this.log(e, 'bad-format', r.reason)
        e.view = { ...base, windows: [], plan: e.view?.plan ?? null, readAt: e.view?.readAt ?? null, status: 'unavailable' }
        break
    }
  }

  private alert(e: Entry): void {
    const now = Date.now()
    this.notified = new Set(pruneNotified(this.notified, now))
    const label = this.d.labelOf(e.login.accountIds[0])
    for (const c of crossings(e.login.key, label, applyResets(e.view!.windows, now), this.notified, now)) {
      const next = new Set([...this.notified, ...c.keys])
      // não entregue (app fechado): não conta como avisado, volta na próxima leitura
      if (this.d.onAlert(c.text, [...next])) this.notified = next
    }
  }

  /** no máximo 1x/hora por login e tipo; nunca inclui token nem corpo de resposta */
  private log(e: Entry, kind: string, reason: string): void {
    const key = `${e.login.key}|${kind}`
    const now = Date.now()
    if ((this.logged.get(key) ?? -Infinity) > now - 3_600_000) return
    this.logged.set(key, now)
    this.d.log?.(`uso do plano ${e.login.key}: ${kind} (${reason})`)
  }
}
