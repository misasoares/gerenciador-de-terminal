import { describe, expect, it, vi } from 'vitest'
import { Mailbox, MAILBOX_KEEP, type TeamMessage } from '../../src/daemon/team/mailbox'

const base = { from: 'p1', to: 'p2', fromName: 'lider', toName: 'dev-1', fromAgent: 'claude' as const, kind: 'equipe' as const, team: 'p1', body: 'oi', text: 'oi', interrupt: false }

function box(items: TeamMessage[] = []) {
  let t = 1000
  const onChange = vi.fn()
  const mb = new Mailbox(items, onChange, () => t++)
  return { mb, onChange }
}

describe('Mailbox', () => {
  it('enqueue grava na fila com id, createdAt e estado', () => {
    const { mb, onChange } = box()
    const m = mb.enqueue(base)
    expect(m).toMatchObject({ state: 'na-fila', deliveredAt: null, error: null, createdAt: 1000 })
    expect(m.id).toBeTruthy()
    expect(mb.queued('p2')).toEqual([m])
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('enqueue guarda a equipe e o corpo como vieram', () => {
    const { mb } = box()
    expect(mb.enqueue({ ...base, team: 'L1', body: 'só o corpo' })).toMatchObject({ team: 'L1', body: 'só o corpo' })
  })

  it('next devolve a interrupção antes de uma mensagem comum mais antiga', () => {
    const { mb } = box()
    mb.enqueue({ ...base, text: 'comum' })
    const urgente = mb.enqueue({ ...base, text: 'urgente', interrupt: true })
    expect(mb.next('p2')?.id).toBe(urgente.id)
    expect(mb.next('p9')).toBeNull()
  })

  it('markDelivered tira da fila e grava deliveredAt', () => {
    const { mb, onChange } = box()
    const a = mb.enqueue(base)
    const b = mb.enqueue({ ...base, text: 'segunda' })
    onChange.mockClear()
    mb.markDelivered(a.id)
    expect(mb.queued('p2').map((m) => m.id)).toEqual([b.id])
    expect(mb.all().find((m) => m.id === a.id)).toMatchObject({ state: 'entregue', deliveredAt: 1002 })
    expect(mb.next('p2')?.id).toBe(b.id)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("failAll marca só as na-fila do destinatário com o motivo", () => {
    const { mb } = box()
    const a = mb.enqueue(base)
    const outro = mb.enqueue({ ...base, to: 'p3' })
    const feita = mb.enqueue(base)
    mb.markDelivered(feita.id)
    mb.failAll('p2', 'demitido')
    expect(mb.all().find((m) => m.id === a.id)).toMatchObject({ state: 'falhou', error: 'demitido' })
    expect(mb.all().find((m) => m.id === outro.id)?.state).toBe('na-fila')
    expect(mb.all().find((m) => m.id === feita.id)?.state).toBe('entregue')
    expect(mb.queued('p2')).toEqual([])
  })

  it('com 600 entregues guarda 500 e nunca descarta uma na-fila', () => {
    const { mb } = box()
    const fila = mb.enqueue({ ...base, to: 'p9' })
    for (let i = 0; i < 600; i++) mb.markDelivered(mb.enqueue(base).id)
    const entregues = mb.all().filter((m) => m.state === 'entregue')
    expect(entregues).toHaveLength(MAILBOX_KEEP)
    expect(mb.queued('p9').map((m) => m.id)).toEqual([fila.id])
  })
})
