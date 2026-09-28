import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { NotifyKeeper } from '../../src/main/notify-keeper'

describe('I4: notificação não é coletada antes do clique', () => {
  it('guarda até click/close e solta depois', () => {
    const keeper = new NotifyKeeper()
    const n = new EventEmitter()
    keeper.keep(n)
    expect(keeper.size).toBe(1)
    n.emit('click')
    expect(keeper.size).toBe(0)
    const m = new EventEmitter()
    keeper.keep(m)
    m.emit('close')
    expect(keeper.size).toBe(0)
  })
  it('revelação espera o renderer carregar', () => {
    const keeper = new NotifyKeeper()
    const sent: string[] = []
    keeper.reveal('p1', false, (id) => sent.push(id))
    expect(sent).toEqual([])
    keeper.loaded((id) => sent.push(id))
    expect(sent).toEqual(['p1'])
    keeper.reveal('p2', true, (id) => sent.push(id))
    expect(sent).toEqual(['p1', 'p2'])
  })
})
