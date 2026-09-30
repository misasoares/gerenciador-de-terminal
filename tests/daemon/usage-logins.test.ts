import { describe, expect, it } from 'vitest'
import { applyResets, groupLogins, missingLoginHints } from '../../src/daemon/usage/logins'
import { crossings, pruneNotified } from '../../src/daemon/usage/alerts'
import type { Account } from '../../src/shared/types'

const acc = (id: string, over: Partial<Account> = {}): Account => ({ id, label: id, command: id, color: '#111111', agent: 'claude', configDirMatch: [], isDefault: false, settingsMatch: null, pathPrefix: null, ...over })

describe('logins', () => {
  it('agrupa por agente+diretório, respeita planUsage e ordem da lista', () => {
    const accounts = [
      acc('misa', { isDefault: true }),
      acc('weboption', { planUsage: false }),
      acc('weboption-max'),
      acc('mslabs'),
      acc('codex', { agent: 'codex', isDefault: true }),
      acc('sem-hook'),
    ]
    const dirs = { weboption: '/s/2-w', 'weboption-max': '/s/2-w', mslabs: '/s/3-m' }
    expect(groupLogins(accounts, dirs)).toEqual([
      { key: 'claude:', agent: 'claude', configDir: '', accountIds: ['misa'] },
      { key: 'claude:/s/2-w', agent: 'claude', configDir: '/s/2-w', accountIds: ['weboption-max'] },
      { key: 'claude:/s/3-m', agent: 'claude', configDir: '/s/3-m', accountIds: ['mslabs'] },
      { key: 'codex:', agent: 'codex', configDir: '', accountIds: ['codex'] },
    ])
  })

  it('agente padrão com diretório já descoberto deixa de usar o padrão', () => {
    expect(groupLogins([acc('misa', { isDefault: true })], { misa: '/s/1-m' })).toEqual([{ key: 'claude:/s/1-m', agent: 'claude', configDir: '/s/1-m', accountIds: ['misa'] }])
  })

  it('dica para agentes com plano ainda sem login conhecido', () => {
    const accounts = [acc('a', { isDefault: true }), acc('b'), acc('c', { planUsage: false })]
    const hints = missingLoginHints(accounts, groupLogins(accounts, {}))
    expect(Object.keys(hints)).toEqual(['b'])
  })

  it('janela com reset no passado vira 0% e reset desconhecido', () => {
    expect(applyResets([{ kind: 'week', percent: 90, resetsAt: 100 }, { kind: '5h', percent: 50, resetsAt: 300 }], 200)).toEqual([
      { kind: 'week', percent: 0, resetsAt: null },
      { kind: '5h', percent: 50, resetsAt: 300 },
    ])
  })
})

describe('avisos de limiar', () => {
  const now = new Date(2026, 8, 28, 10, 0).getTime()
  const reset = new Date(2026, 9, 5, 9, 0).getTime()

  it('cruzar 80 avisa uma vez; pular direto para 96 avisa só o 95 e marca os dois', () => {
    const notified = new Set<string>()
    const a = crossings('claude:/m', 'mslabs', [{ kind: 'week', percent: 81, resetsAt: reset }], notified, now)
    expect(a).toEqual([{ keys: [`claude:/m|week|${reset}|80`], text: 'mslabs: 80% da janela semanal · renova seg 09:00' }])
    a.forEach((c) => c.keys.forEach((k) => notified.add(k)))
    expect(crossings('claude:/m', 'mslabs', [{ kind: 'week', percent: 85, resetsAt: reset }], notified, now)).toEqual([])
    const b = crossings('claude:/n', 'misa', [{ kind: '5h', percent: 96, resetsAt: null }], new Set(), now)
    expect(b).toEqual([{ keys: ['claude:/n|5h|na|80', 'claude:/n|5h|na|95'], text: 'misa: 95% da janela de 5h' }])
  })

  it('janela nova (outro resetsAt) volta a avisar; chaves vencidas são podadas', () => {
    const old = `claude:/m|week|${now - 1}|80`
    const live = `claude:/m|week|${reset}|80`
    expect(pruneNotified([old, live, 'claude:/m|5h|na|80'], now)).toEqual([live, 'claude:/m|5h|na|80'])
    const next = crossings('claude:/m', 'mslabs', [{ kind: 'week', percent: 82, resetsAt: reset + 1 }], new Set([live]), now)
    expect(next).toHaveLength(1)
  })
})
