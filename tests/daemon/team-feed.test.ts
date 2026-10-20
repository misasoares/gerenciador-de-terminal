import { describe, expect, it } from 'vitest'
import { buildFeed } from '../../src/daemon/team/feed'
import type { TeamMessage } from '../../src/daemon/team/mailbox'
import type { TeamLogEntry } from '../../src/daemon/team/log'

const msg = (o: Partial<TeamMessage>): TeamMessage => ({
  id: 'm', from: 'L1', to: 'p2', fromName: 'lider', toName: 'dev-1', fromAgent: 'codex', kind: 'equipe', team: 'L1', body: 'corpo',
  text: '[equipe] de lider … corpo', interrupt: false, createdAt: 10, state: 'na-fila', deliveredAt: null, error: null, ...o,
})
const base = { leaderId: 'L1', leaderName: 'lider', active: true, members: [], statusOf: () => null }

describe('buildFeed', () => {
  it('só mensagens desta equipe e de equipe/usuário; a do gerenciador fica de fora', () => {
    const f = buildFeed({
      ...base,
      messages: [msg({ id: 'a' }), msg({ id: 'b', team: 'L9' }), msg({ id: 'c', kind: 'gerenciador' }), msg({ id: 'd', kind: 'usuario', from: null, fromName: 'você', fromAgent: null }), msg({ id: 'e', team: null })],
      log: [],
    })
    expect(f.items.map((i) => i.id)).toEqual(['a', 'd'])
    expect(f).toMatchObject({ leaderId: 'L1', leaderName: 'lider', active: true, members: [] })
  })

  it('mensagem do app e SendMessage nativo, em ordem de hora', () => {
    const log: TeamLogEntry[] = [
      { type: 'nativo', id: 'n', team: 'L1', at: 5, fromName: 'lider', toId: null, toName: 'dev-x', body: 'oi' },
      { type: 'event', id: 'e', team: 'L1', at: 20, paneId: 'p2', name: 'dev-1', event: 'terminou', detail: null, since: null },
    ]
    const f = buildFeed({ ...base, messages: [msg({ id: 'a', state: 'falhou', error: 'saiu', interrupt: true }), msg({ id: 'u', kind: 'usuario', createdAt: 15, state: 'entregue' })], log })
    expect(f.items.map((i) => i.id)).toEqual(['n', 'a', 'u', 'e'])
    expect(f.items[0]).toEqual({ kind: 'msg', id: 'n', at: 5, fromName: 'lider', toId: '', toName: 'dev-x', body: 'oi', interrupt: false, byUser: false, via: 'nativo', state: null, error: null })
    expect(f.items[1]).toEqual({ kind: 'msg', id: 'a', at: 10, fromName: 'lider', toId: 'p2', toName: 'dev-1', body: 'corpo', interrupt: true, byUser: false, via: 'app', state: 'falhou', error: 'saiu' })
    expect(f.items[2]).toMatchObject({ byUser: true, state: 'entregue' })
    expect(f.items[3]).toEqual({ kind: 'event', id: 'e', at: 20, paneId: 'p2', name: 'dev-1', event: 'terminou', detail: null, open: false })
  })

  it('alerta de permissão aberto só enquanto o membro segue no mesmo needs-you', () => {
    const log: TeamLogEntry[] = [{ type: 'event', id: 'e', team: 'L1', at: 1, paneId: 'p2', name: 'dev-1', event: 'permissao', detail: null, since: 100 }]
    const open = (s: { status: 'needs-you' | 'working'; since: number }) => (buildFeed({ ...base, messages: [], log, statusOf: () => s }).items[0] as { open: boolean }).open
    expect(open({ status: 'needs-you', since: 100 })).toBe(true)
    expect(open({ status: 'needs-you', since: 200 })).toBe(false)
    expect(open({ status: 'working', since: 100 })).toBe(false)
    const term: TeamLogEntry[] = [{ type: 'event', id: 't', team: 'L1', at: 1, paneId: 'p2', name: 'dev-1', event: 'terminou', detail: null, since: 100 }]
    expect((buildFeed({ ...base, messages: [], log: term, statusOf: () => ({ status: 'needs-you', since: 100 }) }).items[0] as { open: boolean }).open).toBe(false)
  })
})
