import { describe, expect, it } from 'vitest'
import { accountUsage, levelOf, usageChips } from '../../src/renderer/src/usage-model'
import type { Account, UsageView } from '../../src/shared/types'

const acc = (id: string, color: string, agent: 'claude' | 'codex' = 'claude'): Account => ({ id, label: id, command: id, color, agent, configDirMatch: [], isDefault: false, settingsMatch: null, pathPrefix: null })
const now = new Date(2026, 8, 28, 10, 0).getTime()
const view = (over: Partial<UsageView>): UsageView => ({ loginKey: 'claude:/a', agent: 'claude', accountIds: ['misa'], windows: [], plan: null, readAt: now, status: 'ok', ...over })

describe('usage-model', () => {
  it('níveis 80/95', () => {
    expect([79.9, 80, 94.9, 95].map(levelOf)).toEqual(['ok', 'warn', 'warn', 'bad'])
  })

  it('chips: Claude mostra 5h e sem (— se faltar); Codex só o que vier; cor do agente', () => {
    const app = {
      accounts: [acc('misa', '#4fc1ff'), acc('codex', '#10a37f', 'codex')],
      usage: [
        view({ windows: [{ kind: 'week', percent: 81.6, resetsAt: new Date(2026, 9, 5, 9, 0).getTime() }], plan: 'max' }),
        view({ loginKey: 'codex:', agent: 'codex', accountIds: ['codex'], windows: [{ kind: 'week', percent: 31, resetsAt: null }] }),
      ],
    }
    const [c, x] = usageChips(app, now)
    expect(c).toMatchObject({ label: 'misa', color: '#4fc1ff', dim: false, unavailable: false })
    expect(c.parts).toEqual([
      { text: '5h —', level: 'ok' },
      { text: 'sem 82%', level: 'warn' },
    ])
    expect(c.tooltip).toBe('plano max\nsem: 82% · renova seg 09:00\nlido às 10:00')
    expect(x.parts).toEqual([{ text: 'sem 31%', level: 'ok' }])
  })

  it('stale/expired ficam apagados com ~; unavailable mostra indisponível', () => {
    const app = { accounts: [acc('misa', '#fff')], usage: [view({ status: 'expired', windows: [{ kind: '5h', percent: 40, resetsAt: null }] })] }
    const [c] = usageChips(app, now)
    expect(c.dim).toBe(true)
    expect(c.parts[0].text).toBe('~5h 40%')
    expect(c.tooltip).toContain('abra uma sessão desta conta para atualizar')
    const [u] = usageChips({ accounts: app.accounts, usage: [view({ status: 'unavailable' })] }, now)
    expect(u).toMatchObject({ unavailable: true, parts: [] })
  })

  it('texto do ⌘T por agente, ou a dica quando não há uso', () => {
    const app = { usage: [view({ accountIds: ['wo-max'], windows: [{ kind: '5h', percent: 7, resetsAt: null }, { kind: 'week', percent: 61, resetsAt: null }] })], usageHints: { mslabs: 'sem login' } }
    expect(accountUsage(app, 'wo-max')).toEqual({ text: '5h 7% · sem 61%', hint: null })
    expect(accountUsage(app, 'mslabs')).toEqual({ text: null, hint: 'sem login' })
    expect(accountUsage(app, 'outro')).toEqual({ text: null, hint: null })
  })
})
