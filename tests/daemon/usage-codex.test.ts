import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { latestRollout, parseCodexRateLimits, readCodex } from '../../src/daemon/usage/codex'

const line = (rl: unknown) => JSON.stringify({ timestamp: 't', type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rl } })
const rl = (primary: unknown, secondary: unknown = null) => ({ limit_id: 'codex', primary, secondary, plan_type: 'prolite' })

describe('uso do Codex', () => {
  it('pega o ÚLTIMO rate_limits e mapeia janelas por window_minutes', () => {
    const text = [
      line(rl({ used_percent: 10, window_minutes: 10080, resets_at: 100 })),
      line(rl({ used_percent: 31, window_minutes: 10080, resets_at: 1790595481 }, { used_percent: 7, window_minutes: 300, resets_at: 1790500000 })),
      JSON.stringify({ type: 'response_item', payload: {} }),
    ].join('\n')
    expect(parseCodexRateLimits(text)).toEqual({
      plan: 'prolite',
      windows: [
        { kind: 'week', percent: 31, resetsAt: 1790595481_000 },
        { kind: '5h', percent: 7, resetsAt: 1790500000_000 },
      ],
    })
  })

  it('primeira linha cortada, lixo e janela de tamanho desconhecido são ignorados', () => {
    const text = ['e_limits":{"primary":{"used_percent":99', 'lixo', line(rl({ used_percent: 5, window_minutes: 60, resets_at: 1 }, { used_percent: 12, window_minutes: 10080 }))].join('\n')
    expect(parseCodexRateLimits(text)).toEqual({ plan: 'prolite', windows: [{ kind: 'week', percent: 12, resetsAt: null }] })
  })

  it('sem rate_limits → null', () => {
    expect(parseCodexRateLimits(JSON.stringify({ type: 'x' }))).toBeNull()
    expect(parseCodexRateLimits('')).toBeNull()
  })

  it('latestRollout desce pelas pastas de data e escolhe o mais recente do dia', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cx-'))
    const mk = (rel: string, mtime: number) => {
      const f = path.join(root, rel)
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, '')
      fs.utimesSync(f, mtime, mtime)
      return f
    }
    mk('2026/09/21/rollout-a.jsonl', 1000)
    mk('2026/09/28/rollout-b.jsonl', 2000)
    const c = mk('2026/09/28/rollout-c.jsonl', 3000)
    mk('2026/09/28/outro.txt', 9000)
    expect(await latestRollout(root)).toBe(c)
    expect(await latestRollout(path.join(root, 'nada'))).toBeNull()
  })

  it('readCodex: padrão = ~/.codex; sem rollout → no-data; com rate_limits → ok', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cxh-'))
    const login = { key: 'codex:', agent: 'codex' as const, configDir: '', accountIds: ['codex'] }
    expect(await readCodex(login, { userHome: home })).toEqual({ kind: 'no-data' })
    const f = path.join(home, '.codex', 'sessions', '2026', '09', '28', 'rollout-x.jsonl')
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, 'x'.repeat(300_000) + '\n' + line(rl({ used_percent: 31, window_minutes: 10080, resets_at: 2 })) + '\n')
    expect(await readCodex(login, { userHome: home })).toEqual({ kind: 'ok', plan: 'prolite', windows: [{ kind: 'week', percent: 31, resetsAt: 2000 }] })
  })
})
