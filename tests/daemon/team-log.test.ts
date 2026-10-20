import { describe, expect, it, vi } from 'vitest'
import { TEAM_LOG_KEEP, TeamLog } from '../../src/daemon/team/log'

describe('TeamLog', () => {
  it('event e native gravam id, equipe e hora, e avisam a mudança', () => {
    const onChange = vi.fn()
    const log = new TeamLog([], onChange, () => 42)
    log.event({ team: 'L1', paneId: 'p2', name: 'dev-1', event: 'contratou', detail: 'Claude' })
    log.native({ team: 'L1', fromName: 'lider', toId: 'p2', toName: 'dev-1', body: 'faz X' })
    const [e, n] = log.of('L1')
    expect(e).toMatchObject({ type: 'event', team: 'L1', at: 42, paneId: 'p2', name: 'dev-1', event: 'contratou', detail: 'Claude', since: null })
    expect(n).toMatchObject({ type: 'nativo', team: 'L1', at: 42, fromName: 'lider', toId: 'p2', toName: 'dev-1', body: 'faz X' })
    expect(e.id).toBeTruthy()
    expect(e.id).not.toBe(n.id)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it(`guarda as ${TEAM_LOG_KEEP} mais novas por equipe, sem mexer nas outras`, () => {
    let t = 0
    const log = new TeamLog([], () => {}, () => t++)
    for (let i = 0; i < 5; i++) log.event({ team: 'L2', paneId: null, name: 'x', event: 'saiu' })
    for (let i = 0; i < 310; i++) log.event({ team: 'L1', paneId: null, name: `d${i}`, event: 'saiu' })
    expect(TEAM_LOG_KEEP).toBe(300)
    expect(log.of('L1')).toHaveLength(300)
    expect(log.of('L1')[0]).toMatchObject({ name: 'd10' })
    expect(log.of('L2')).toHaveLength(5)
    expect(log.all()).toHaveLength(305)
  })
})
