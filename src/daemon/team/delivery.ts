import type { AgentKind, SessionStatus } from '../../shared/types'
import { profileOf } from '../agent-profiles'
import type { Mailbox } from './mailbox'

export const USER_TYPING_GRACE_MS = 5000
export const INTERRUPT_QUIET_MS = 1500
export const READY_TIMEOUT_MS = 60_000
/** o Esc de interromper vale para a entrega por esse tempo */
const INTERRUPT_WINDOW_MS = 30_000
/** pausa entre o fim da colagem e o Enter */
const PASTE_SETTLE_MS = 150

export interface DeliveryPane {
  id: string
  alive: boolean
  agent: AgentKind | null
  status: SessionStatus | null
  /** quando o status atual começou */
  statusSince: number
  /** primeiro SessionStart do painel (null = a CLI ainda não ficou pronta) */
  sessionSince: number | null
  createdAt: number
  lastUserInputAt: number
  lastOutputAt: number
}

export interface DeliveryDeps {
  mailbox: Mailbox
  pane(id: string): DeliveryPane | null
  writeRaw(id: string, data: string): void
  now(): number
  /** espera entre o fim da colagem e o Enter */
  sleep(ms: number): Promise<void>
}

/** colagem entre marcadores de bracketed paste + Enter; ESC no texto sairia da colagem, então não passa */
export function pasteAndSubmit(text: string): [string, string] {
  return ['\x1b[200~' + text.replace(/\x1b/g, '') + '\x1b[201~', '\r']
}

export class Deliverer {
  /** destinatários com colagem em andamento */
  private busy = new Set<string>()
  /** statusSince do destinatário na última entrega: a próxima espera ele mudar */
  private deliveredAt = new Map<string, number>()
  private interruptedAt = new Map<string, number>()

  constructor(private d: DeliveryDeps) {}

  /** tenta entregar a próxima de cada destinatário com fila; chamado em onChange e a cada 1 s */
  async tick(): Promise<void> {
    const targets = new Set(this.d.mailbox.all().filter((m) => m.state === 'na-fila').map((m) => m.to))
    await Promise.all([...targets].map((to) => this.deliverTo(to)))
  }

  /** manda a tecla de interromper agora e registra o instante */
  interrupt(to: string): void {
    const p = this.d.pane(to)
    if (!p?.alive) return
    this.d.writeRaw(to, profileOf(p.agent ?? 'claude').interruptKey)
    this.interruptedAt.set(to, this.d.now())
  }

  /** recados atrasados: na fila há mais de 60 s sem SessionStart */
  late(to: string): boolean {
    const p = this.d.pane(to)
    if (!p || p.sessionSince !== null) return false
    const now = this.d.now()
    return this.d.mailbox.queued(to).some((m) => now - m.createdAt > READY_TIMEOUT_MS)
  }

  private ready(p: DeliveryPane, interrupt: boolean): boolean {
    const now = this.d.now()
    if (!p.alive || now - p.lastUserInputAt < USER_TYPING_GRACE_MS) return false
    const after = this.deliveredAt.get(p.id)
    const settled = p.status === 'idle' || p.status === 'your-turn'
    if (settled) return after === undefined || p.statusSince > after
    // Esc no Claude não dispara Stop: o silêncio do terminal é o sinal de que ele parou
    const at = this.interruptedAt.get(p.id)
    return interrupt && p.status === 'working' && at !== undefined && now - at <= INTERRUPT_WINDOW_MS && now - p.lastOutputAt >= INTERRUPT_QUIET_MS
  }

  private async deliverTo(to: string): Promise<void> {
    if (this.busy.has(to)) return
    const p = this.d.pane(to)
    const m = this.d.mailbox.next(to)
    if (!p || !m || !this.ready(p, m.interrupt)) return
    this.busy.add(to)
    try {
      const [paste, enter] = pasteAndSubmit(m.text)
      this.d.writeRaw(to, paste)
      await this.d.sleep(PASTE_SETTLE_MS)
      this.d.writeRaw(to, enter)
      this.deliveredAt.set(to, p.statusSince)
      this.interruptedAt.delete(to)
      this.d.mailbox.markDelivered(m.id)
    } finally {
      this.busy.delete(to)
    }
  }
}
