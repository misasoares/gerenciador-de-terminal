import type { SessionStatus, TeamFeedItem, TeamFeedView, TeamMember } from '../../shared/types'
import type { TeamLogEntry } from './log'
import type { TeamMessage } from './mailbox'

/** conversa do grupo de um líder: mensagens da Mailbox (equipe e usuário) e o TeamLog, por hora */
export function buildFeed(o: {
  leaderId: string
  leaderName: string
  active: boolean
  members: TeamMember[]
  messages: TeamMessage[]
  log: TeamLogEntry[]
  statusOf(paneId: string): { status: SessionStatus | null; since: number } | null
}): TeamFeedView {
  const items: TeamFeedItem[] = []
  for (const m of o.messages) {
    if (m.team !== o.leaderId || (m.kind !== 'equipe' && m.kind !== 'usuario')) continue
    items.push({
      kind: 'msg', id: m.id, at: m.createdAt, fromName: m.fromName, toId: m.to, toName: m.toName, body: m.body,
      interrupt: m.interrupt, byUser: m.kind === 'usuario', via: 'app', state: m.state, error: m.error,
    })
  }
  for (const e of o.log) {
    if (e.team !== o.leaderId) continue
    if (e.type === 'nativo') {
      items.push({ kind: 'msg', id: e.id, at: e.at, fromName: e.fromName, toId: e.toId ?? '', toName: e.toName, body: e.body, interrupt: false, byUser: false, via: 'nativo', state: null, error: null })
      continue
    }
    const st = e.paneId ? o.statusOf(e.paneId) : null
    const open = (e.event === 'permissao' || e.event === 'pergunta') && st?.status === 'needs-you' && st.since === e.since
    items.push({ kind: 'event', id: e.id, at: e.at, paneId: e.paneId, name: e.name, event: e.event, detail: e.detail, open })
  }
  items.sort((a, b) => a.at - b.at)
  return { leaderId: o.leaderId, leaderName: o.leaderName, active: o.active, members: o.members, items }
}
