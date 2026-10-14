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
  it('reset (conexão nova) repete o último foco', () => {
    const sent: (string | null)[] = []
    const r = new FocusReporter((id) => sent.push(id))
    r.report('a', true)
    r.reset()
    r.report('a', true)
    expect(sent).toEqual(['a', 'a'])
  })
})
