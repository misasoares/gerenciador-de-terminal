import { randomUUID } from 'node:crypto'
import type { AgentKind } from '../../shared/types'

export type MessageKind = 'equipe' | 'gerenciador' | 'prompt-inicial'

export interface TeamMessage {
  id: string
  /** paneId do remetente; null = o app */
  from: string | null
  /** paneId do destinatário */
  to: string
  fromName: string
  toName: string
  fromAgent: AgentKind | null
  kind: MessageKind
  /** texto já com cabeçalho, pronto para digitar */
  text: string
  interrupt: boolean
  createdAt: number
  state: 'na-fila' | 'entregue' | 'falhou'
  deliveredAt: number | null
  error: string | null
}

/** entregues/falhas mais antigas saem; na fila nunca saem */
export const MAILBOX_KEEP = 500

type NewMessage = Omit<TeamMessage, 'id' | 'createdAt' | 'state' | 'deliveredAt' | 'error'>

export class Mailbox {
  private items: TeamMessage[]

  constructor(items: TeamMessage[], private onChange: () => void, private now: () => number = Date.now) {
    this.items = items
  }

  enqueue(m: NewMessage): TeamMessage {
    const msg: TeamMessage = { ...m, id: randomUUID(), createdAt: this.now(), state: 'na-fila', deliveredAt: null, error: null }
    this.items.push(msg)
    this.trim()
    this.onChange()
    return msg
  }

  /** próxima da fila do destinatário: interrupções primeiro, depois por createdAt */
  next(to: string): TeamMessage | null {
    const q = this.queued(to)
    return q.find((m) => m.interrupt) ?? q[0] ?? null
  }

  queued(to: string): TeamMessage[] {
    return this.items.filter((m) => m.to === to && m.state === 'na-fila').sort((a, b) => a.createdAt - b.createdAt)
  }

  markDelivered(id: string): void {
    const m = this.items.find((x) => x.id === id)
    if (!m) return
    m.state = 'entregue'
    m.deliveredAt = this.now()
    this.trim()
    this.onChange()
  }

  failAll(to: string, reason: string): void {
    const pending = this.items.filter((m) => m.to === to && m.state === 'na-fila')
    if (pending.length === 0) return
    for (const m of pending) {
      m.state = 'falhou'
      m.error = reason
    }
    this.trim()
    this.onChange()
  }

  /** para persistir */
  all(): TeamMessage[] {
    return this.items
  }

  private trim(): void {
    const done = this.items.filter((m) => m.state !== 'na-fila')
    if (done.length <= MAILBOX_KEEP) return
    const drop = new Set(done.slice(0, done.length - MAILBOX_KEEP))
    this.items = this.items.filter((m) => !drop.has(m))
  }
}
