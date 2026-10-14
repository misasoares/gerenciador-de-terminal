import type { AgentKind, SessionStatus } from '../shared/types'
import { descendants, findAgent, foregroundOf, type Proc } from './platform/procs'
import type { PaneRecord } from './panes'

/** sessão cujo agente foi encerrado para liberar memória; o shell do painel continua vivo */
export interface Hibernation {
  sessionId: string
  agent: AgentKind
  accountId: string | null
  transcriptPath: string | null
  /** título da conversa (a sidebar e o cabeçalho continuam mostrando) */
  title: string | null
  /** epoch ms em que hibernou */
  since: number
}

export interface Candidate {
  status: SessionStatus | null
  statusSince: number
  focused: boolean
  leader: boolean
  hired: boolean
  /** há shell entre os descendentes do agente (comando do Bash/Monitor rodando) */
  shellBusy: boolean
  hibernated: boolean
  waking: boolean
  cooldownUntil: number
}

export function shouldHibernate(c: Candidate, now: number, thresholdMs: number): boolean {
  if (c.status !== 'idle' && c.status !== 'your-turn') return false
  if (now - c.statusSince < thresholdMs) return false
  // líder e devs contratados conversam pelo SendMessage nativo, que só alcança sessões vivas
  if (c.focused || c.leader || c.hired || c.shellBusy || c.hibernated || c.waking) return false
  return now >= c.cooldownUntil
}

// 1º token do comando: sh, bash, zsh, fish ou dash (com caminho ou "-" de shell de login)
const SHELL_RE = /^(\S*\/)?-?(sh|bash|zsh|fish|dash)(\s|$)/

/** a ferramenta Bash do Claude (e os comandos do Codex) sempre rodam dentro de um shell */
export function hasShellDescendant(procs: Proc[], pid: number): boolean {
  return descendants(procs, pid).some((p) => SHELL_RE.test(p.args))
}

export interface HibernatorDeps {
  records(): PaneRecord[]
  /** pid do shell do painel */
  shellPid(id: string): number | undefined
  write(id: string, data: string): void
  resumeCommand(h: Hibernation): string
  settings(): { enabled: boolean; minutes: number }
  /** sobrescreve minutes × 60 000 (testes) */
  thresholdMs?: number
  meta(id: string): { leader: boolean; hired: boolean }
  /** painéis em foco em alguma janela */
  focused(): Set<string>
  onChange(): void
  snapshot(): Promise<Proc[]>
  signal(pid: number, sig: 'SIGTERM' | 'SIGKILL'): void
  exists(pid: number): boolean
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  graceMs?: number
  cooldownMs?: number
  wakingTimeoutMs?: number
}

const STEP_MS = 250

export class Hibernator {
  /** painéis com hibernação ou despertar em andamento */
  private busy = new Set<string>()

  constructor(private d: HibernatorDeps) {}

  private now(): number {
    return (this.d.now ?? Date.now)()
  }

  private sleep(ms: number): Promise<void> {
    return this.d.sleep ? this.d.sleep(ms) : new Promise((res) => setTimeout(res, ms))
  }

  private candidate(r: PaneRecord, shellBusy: boolean): Candidate {
    const m = this.d.meta(r.id)
    return {
      status: r.claude?.status ?? null,
      statusSince: r.claude?.statusSince ?? 0,
      focused: this.d.focused().has(r.id),
      leader: m.leader,
      hired: m.hired,
      shellBusy,
      hibernated: r.hibernated !== null,
      waking: r.waking !== null,
      cooldownUntil: r.hibernateCooldownUntil,
    }
  }

  async tick(): Promise<void> {
    const now = this.now()
    let expired = false
    for (const r of this.d.records()) {
      if (r.waking && now - r.waking.since > (this.d.wakingTimeoutMs ?? 60_000)) {
        r.waking = null
        expired = true
      }
    }
    if (expired) this.d.onChange()
    const s = this.d.settings()
    if (!s.enabled) return
    const threshold = this.d.thresholdMs ?? s.minutes * 60_000
    const pre = this.d.records().filter((r) => r.alive && r.claude && !this.busy.has(r.id) && shouldHibernate(this.candidate(r, false), now, threshold))
    if (pre.length === 0) return
    const procs = await this.d.snapshot()
    if (procs.length === 0) return // ps falhou: não dá para saber se há comando rodando
    await Promise.all(
      pre.map(async (r) => {
        const shell = this.d.shellPid(r.id)
        const agent = shell ? findAgent(procs, shell) : null
        if (!agent) return
        // reconfere logo antes do SIGTERM: o status pode ter mudado enquanto o ps rodava
        if (!shouldHibernate(this.candidate(r, hasShellDescendant(procs, agent.proc.pid)), this.now(), threshold)) return
        await this.hibernate(r, agent.proc.pid)
      }),
    )
  }

  private async hibernate(r: PaneRecord, pid: number): Promise<void> {
    const c = r.claude
    if (!c) return
    this.busy.add(r.id)
    const h: Hibernation = { sessionId: c.sessionId, agent: c.agent, accountId: r.accountId ?? r.launchedAccountId, transcriptPath: c.transcriptPath, title: c.title, since: this.now() }
    const active = () => r.claude?.status === 'working' || r.claude?.status === 'needs-you'
    try {
      this.d.signal(pid, 'SIGTERM')
      const grace = this.d.graceMs ?? 10_000
      for (let waited = 0; waited < grace && this.d.exists(pid); waited += STEP_MS) {
        await this.sleep(STEP_MS)
        if (active() || !r.alive) return
      }
      if (this.d.exists(pid)) {
        this.d.signal(pid, 'SIGKILL')
        await this.sleep(STEP_MS)
        if (this.d.exists(pid)) {
          r.hibernateCooldownUntil = this.now() + (this.d.cooldownMs ?? 30 * 60_000)
          return
        }
      }
      if (!r.alive) return
      r.hibernated = h
      this.d.onChange()
    } finally {
      this.busy.delete(r.id)
    }
    // o usuário focou enquanto o agente saía: acorda já
    if (r.hibernated && this.d.focused().has(r.id)) await this.wake(r.id)
  }

  /** true = digitou o comando de retomada; false = não estava hibernada ou o shell estava ocupado */
  async wake(paneId: string): Promise<boolean> {
    const r = this.d.records().find((x) => x.id === paneId)
    if (!r?.alive || !r.hibernated || this.busy.has(r.id)) return false
    const h = r.hibernated
    r.hibernated = null // antes do await: um 2º foco simultâneo não digita de novo
    this.busy.add(r.id)
    try {
      const shell = this.d.shellPid(r.id)
      const procs = shell ? await this.d.snapshot() : []
      const atPrompt = shell !== undefined && procs.length > 0 && foregroundOf(procs, shell)?.pid === shell
      if (atPrompt) {
        r.launchedAccountId = h.accountId
        r.accountId = h.accountId
        // Ctrl-U antes: o que o usuário digitou entre o foco e aqui não gruda no comando
        this.d.write(r.id, '\x15' + this.d.resumeCommand(h) + '\r')
        r.waking = { since: this.now() }
      }
      this.d.onChange()
      return atPrompt
    } finally {
      this.busy.delete(r.id)
    }
  }
}
