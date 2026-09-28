import { describe, expect, it } from 'vitest'
import { detectAccount, migrateAccounts, suggestAgents, validateAccounts } from '../../src/daemon/accounts'
import type { Account } from '../../src/shared/types'

const acc = (over: Partial<Account>): Account => ({ id: 'x', label: 'X', command: 'x', color: '#111111', agent: 'claude', configDirMatch: [], isDefault: false, settingsMatch: null, pathPrefix: null, ...over })

describe('agentes', () => {
  it('sugere Claude e Codex em modo yolo', () => {
    expect(suggestAgents({ claude: true, codex: true }).map((a) => [a.id, a.agent, a.command, a.isDefault])).toEqual([
      ['claude', 'claude', 'claude --dangerously-skip-permissions', true],
      ['codex', 'codex', 'codex --yolo', true],
    ])
  })

  it('valida id único, campos obrigatórios, cor e tipo', () => {
    expect(validateAccounts([acc({ id: 'a' }), acc({ id: 'b' })])).toBeNull()
    expect(validateAccounts([acc({ id: 'a' }), acc({ id: 'a' })])).toMatch(/repetido/)
    expect(validateAccounts([acc({ id: 'A B' })])).toMatch(/id inválido/)
    expect(validateAccounts([acc({ command: '  ' })])).toMatch(/comando/)
    expect(validateAccounts([acc({ label: '' })])).toMatch(/nome/)
    expect(validateAccounts([acc({ color: 'red' })])).toMatch(/cor/)
    expect(validateAccounts([acc({ agent: 'kimi' as never })])).toMatch(/tipo/)
  })

  it('migra contas antigas para o tipo claude', () => {
    const old = [{ id: 'misa', label: 'misa', command: 'claude', color: '#4fc1ff', configDirMatch: ['1-misa'], isDefault: true, settingsMatch: null, pathPrefix: null }]
    expect(migrateAccounts(old)[0]).toMatchObject({ id: 'misa', agent: 'claude', configDirMatch: ['1-misa'] })
  })

  it('migração de planUsage: gateway vira false, resto true, valor explícito é mantido', () => {
    const out = migrateAccounts([
      { id: 'a', label: 'a', command: 'x', color: '#111111', configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null },
      { id: 'b', label: 'b', command: 'x', color: '#111111', configDirMatch: [], isDefault: false, settingsMatch: 'weboption-gateway', pathPrefix: null },
      { id: 'c', label: 'c', command: 'x', color: '#111111', configDirMatch: [], isDefault: false, settingsMatch: 'weboption-gateway', pathPrefix: null, planUsage: true },
    ])
    expect(out.map((a) => a.planUsage)).toEqual([true, false, true])
  })

  it('detecção olha só os agentes do mesmo tipo', () => {
    const list = [acc({ id: 'c', agent: 'claude', isDefault: true }), acc({ id: 'x', agent: 'codex', isDefault: true }), acc({ id: 'x2', agent: 'codex', configDirMatch: ['/.codex-trabalho'] })]
    expect(detectAccount(list, 'claude', null, null)).toBe('c')
    expect(detectAccount(list, 'codex', null, null)).toBe('x')
    expect(detectAccount(list, 'codex', '/Users/u/.codex-trabalho', null)).toBe('x2')
  })
})
