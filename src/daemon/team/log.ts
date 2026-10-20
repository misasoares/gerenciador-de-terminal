import { randomUUID } from 'node:crypto'
import type { TeamEventKind } from '../../shared/types'

export type TeamLogEntry =
  | {
      type: 'event'
      id: string
      team: string
      at: number
      paneId: string | null
      name: string
      event: TeamEventKind
      detail: string | null
      /** statusSince do needs-you que gerou o alerta */
      since: number | null
    }
  | { type: 'nativo'; id: string; team: string; at: number; fromName: string; toId: string | null; toName: string; body: string }

/** entradas guardadas por equipe; as mais antigas saem */
export const TEAM_LOG_KEEP = 300

/** o que acontece numa equipe e não passa pela Mailbox: eventos e SendMessage entre Claudes */
export class TeamLog {
  constructor(private items: TeamLogEntry[], private onChange: () => void, private now: () => number = Date.now) {}

  event(e: { team: string; paneId: string | null; name: string; event: TeamEventKind; detail?: string | null; since?: number | null }): void {
    this.push({ type: 'event', id: randomUUID(), at: this.now(), team: e.team, paneId: e.paneId, name: e.name, event: e.event, detail: e.detail ?? null, since: e.since ?? null })
  }

  native(m: { team: string; fromName: string; toId: string | null; toName: string; body: string }): void {
    this.push({ type: 'nativo', id: randomUUID(), at: this.now(), ...m })
  }

  of(team: string): TeamLogEntry[] {
    return this.items.filter((x) => x.team === team)
  }

  /** para persistir */
  all(): TeamLogEntry[] {
    return this.items
  }

  private push(entry: TeamLogEntry): void {
    this.items.push(entry)
    const mine = this.of(entry.team)
    if (mine.length > TEAM_LOG_KEEP) {
      const drop = new Set(mine.slice(0, mine.length - TEAM_LOG_KEEP))
      this.items = this.items.filter((x) => !drop.has(x))
    }
    this.onChange()
  }
}
