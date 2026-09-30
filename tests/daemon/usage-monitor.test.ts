import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsageMonitor } from '../../src/daemon/usage/monitor'
import type { Login, ReadResult } from '../../src/daemon/usage/types'

const L = (key: string, ids: string[]): Login => ({ key, agent: 'claude', configDir: key.split(':')[1], accountIds: ids })
const ok = (percent: number, resetsAt: number | null = null): ReadResult => ({ kind: 'ok', plan: 'max', windows: [{ kind: 'week', percent, resetsAt }] })

let mon: UsageMonitor | null = null
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 28, 10, 0))
})
afterEach(() => {
  mon?.stop()
  mon = null
  vi.useRealTimers()
})

function make(results: ReadResult[], extra: { notified?: string[]; delivered?: () => boolean } = {}) {
  const reads: string[] = []
  const alerts: { text: string; notified: string[] }[] = []
  const logs: string[] = []
  mon = new UsageMonitor({
    read: async (l) => {
      reads.push(l.key)
      return results.length > 1 ? results.shift()! : results[0]
    },
    onChange: () => {},
    onAlert: (text, notified) => {
      alerts.push({ text, notified })
      return extra.delivered ? extra.delivered() : true
    },
    labelOf: (id) => id,
    notified: extra.notified ?? [],
    log: (m) => logs.push(m),
  })
  return { mon, reads, alerts, logs }
}

describe('UsageMonitor', () => {
  it('lê ao entrar e a cada 5 min', async () => {
    const { mon, reads } = make([ok(10)])
    mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(0)
    expect(reads).toEqual(['claude:/a'])
    expect(mon.views()[0]).toMatchObject({ loginKey: 'claude:/a', accountIds: ['a'], status: 'ok', plan: 'max', windows: [{ percent: 10 }] })
    await vi.advanceTimersByTimeAsync(299_000)
    expect(reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reads).toHaveLength(2)
  })

  it('poke (Stop) antecipa respeitando 60 s desde a última leitura', async () => {
    const { mon, reads } = make([ok(10)])
    mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(10_000)
    mon.poke('a')
    await vi.advanceTimersByTimeAsync(49_000)
    expect(reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reads).toHaveLength(2)
    mon.poke('desconhecido') // não quebra
  })

  it('retry: mantém o último valor como stale e dobra o intervalo até 30 min', async () => {
    const { mon, reads, logs } = make([ok(10), { kind: 'retry', reason: 'HTTP 429' }, { kind: 'retry', reason: 'HTTP 429' }, { kind: 'retry', reason: 'HTTP 429' }, { kind: 'retry', reason: 'HTTP 429' }, ok(12)])
    mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(300_000) // 2ª leitura: retry
    expect(mon.views()[0]).toMatchObject({ status: 'stale', windows: [{ percent: 10 }] })
    await vi.advanceTimersByTimeAsync(600_000) // 10 min
    expect(reads).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1_200_000) // 20 min
    expect(reads).toHaveLength(4)
    await vi.advanceTimersByTimeAsync(1_800_000) // teto de 30 min (seria 40)
    expect(reads).toHaveLength(5)
    await vi.advanceTimersByTimeAsync(1_800_000)
    expect(mon.views()[0]).toMatchObject({ status: 'ok', windows: [{ percent: 12 }] })
    expect(logs).toHaveLength(2) // 1x/hora por login e tipo: aos 5 min e de novo aos 65 min
  })

  it('expired sem leitura anterior vira dica; com leitura anterior vira ~ (expired)', async () => {
    const a = make([{ kind: 'expired' }])
    a.mon.setLogins([L('claude:/a', ['a', 'b'])])
    await vi.advanceTimersByTimeAsync(0)
    expect(a.mon.views()).toEqual([])
    expect(Object.keys(a.mon.hints())).toEqual(['a', 'b'])
    a.mon.stop()
    const b = make([ok(10), { kind: 'expired' }])
    b.mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(300_000)
    expect(b.mon.views()[0]).toMatchObject({ status: 'expired', windows: [{ percent: 10 }] })
  })

  it('no-token some da barra; bad-format vira unavailable', async () => {
    const { mon } = make([ok(10), { kind: 'no-token' }, { kind: 'bad-format', reason: 'campos desconhecidos' }])
    mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(300_000)
    expect(mon.views()).toEqual([])
    expect(mon.hints().a).toBeTruthy()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(mon.views()[0]).toMatchObject({ status: 'unavailable', windows: [] })
  })

  it('setLogins remove logins que sumiram (ex.: padrão trocado pelo diretório real)', async () => {
    const { mon } = make([ok(10)])
    mon.setLogins([L('claude:', ['misa'])])
    await vi.advanceTimersByTimeAsync(0)
    mon.setLogins([L('claude:/s/1-m', ['misa'])])
    await vi.advanceTimersByTimeAsync(0)
    expect(mon.views().map((v) => v.loginKey)).toEqual(['claude:/s/1-m'])
  })

  it('aviso não entregue (app fechado) não conta como avisado e volta na próxima leitura', async () => {
    let online = false
    const { mon, alerts } = make([ok(81)], { delivered: () => online })
    mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(0)
    expect(alerts).toHaveLength(1)
    online = true
    await vi.advanceTimersByTimeAsync(300_000)
    expect(alerts).toHaveLength(2)
    expect(alerts[1].notified).toEqual(['claude:/a|week|na|80'])
    await vi.advanceTimersByTimeAsync(300_000)
    expect(alerts).toHaveLength(2)
  })

  it('avisa uma vez por limiar, não repete com notified salvo e mostra 0% após reset', async () => {
    const reset = new Date(2026, 9, 5, 9, 0).getTime()
    const { mon, alerts } = make([ok(81, reset)])
    mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(300_000)
    expect(alerts.map((x) => x.text)).toEqual(['a: 80% da janela semanal · renova seg 09:00'])
    const saved = alerts[0].notified
    mon.stop()
    const again = make([ok(83, reset)], { notified: saved })
    again.mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(0)
    expect(again.alerts).toEqual([])
    vi.setSystemTime(reset + 1)
    expect(again.mon.views()[0].windows[0]).toEqual({ kind: 'week', percent: 0, resetsAt: null })
  })
})
