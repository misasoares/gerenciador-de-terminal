import { describe, expect, it } from 'vitest'
import { FocusReporter } from '../../src/renderer/src/focus-sync'

describe('FocusReporter', () => {
  it('manda o painel só com a janela em foco e só quando muda', () => {
    const sent: (string | null)[] = []
    const r = new FocusReporter((id) => sent.push(id))
    r.report('a', true)
    r.report('a', true)
    r.report('a', false)
    r.report('b', false)
    r.report('b', true)
    expect(sent).toEqual(['a', null, 'b'])
  })
  it('janela em foco sem painel também avisa (o daemon pausa o git só sem foco)', () => {
    const sent: [string | null, boolean][] = []
    const r = new FocusReporter((id, w) => sent.push([id, w]))
    r.report(null, true)
    r.report(null, false)
    r.report(null, false)
    r.report(null, true)
    expect(sent).toEqual([[null, true], [null, false], [null, true]])
  })
  it('reset (conexão nova) repete o último foco', () => {
    const sent: (string | null)[] = []
    const r = new FocusReporter((id) => sent.push(id))
    r.report('a', true)
    r.reset()
    r.report('a', true)
    expect(sent).toEqual(['a', 'a'])
  })
})
