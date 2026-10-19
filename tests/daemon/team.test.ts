import { describe, expect, it } from 'vitest'
import type { PaneMetaEntry } from '../../src/daemon/persist'
import { displayName, sameTeam, teamHeader, teamLeaderOf } from '../../src/daemon/team/team'

const meta: Record<string, PaneMetaEntry> = {
  L: { name: 'lider', color: null, leader: true },
  D1: { name: 'dev-1', color: null, createdBy: 'L' },
  D2: { name: 'dev-2', color: null, createdBy: 'L' },
  L2: { name: 'outro', color: null, leader: true },
  E1: { name: 'dev-x', color: null, createdBy: 'L2' },
  S: { name: 'solta', color: null },
}

describe('equipe', () => {
  it('teamLeaderOf: o líder é dele mesmo, o contratado é de quem o contratou, a sessão solta fica fora', () => {
    expect(teamLeaderOf('L', meta)).toBe('L')
    expect(teamLeaderOf('D1', meta)).toBe('L')
    expect(teamLeaderOf('S', meta)).toBeNull()
    expect(teamLeaderOf('nao-existe', meta)).toBeNull()
  })

  it('sameTeam: líder e contratado, e contratados do mesmo líder; equipes diferentes não', () => {
    expect(sameTeam('L', 'D1', meta)).toBe(true)
    expect(sameTeam('D1', 'D2', meta)).toBe(true)
    expect(sameTeam('D1', 'E1', meta)).toBe(false)
    expect(sameTeam('L', 'L2', meta)).toBe(false)
    expect(sameTeam('S', 'S', meta)).toBe(false)
  })

  it('displayName: o nome, ou "sessão <seq>"', () => {
    expect(displayName({ id: 'D1', seq: 4 }, meta)).toBe('dev-1')
    expect(displayName({ id: 'zzz', seq: 7 }, meta)).toBe('sessão 7')
  })

  it('teamHeader: Codex → Claude usa mandar_mensagem', () => {
    expect(teamHeader({ fromName: 'dev-1', fromAgent: 'codex', toName: 'líder', toAgent: 'claude', text: 'feito' })).toBe(
      '[equipe] de dev-1 (Codex) → para líder: feito — responda com mandar_mensagem(para: "dev-1")',
    )
  })

  it('teamHeader: Claude → Claude usa SendMessage; Claude → Codex usa mandar_mensagem', () => {
    expect(teamHeader({ fromName: 'lider', fromAgent: 'claude', toName: 'dev-1', toAgent: 'claude', text: 'x' })).toBe(
      '[equipe] de lider (Claude) → para dev-1: x — responda com SendMessage(to: "lider")',
    )
    expect(teamHeader({ fromName: 'lider', fromAgent: 'claude', toName: 'dev-1', toAgent: 'codex', text: 'x' })).toContain('mandar_mensagem(para: "lider")')
  })
})
