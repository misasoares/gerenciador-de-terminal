import { describe, expect, it } from 'vitest'
import { enqueue } from '../../src/renderer/src/island-queue'

const a = { paneId: 'a', label: 'dev-1' }, b = { paneId: 'b', label: 'dev-2' }

describe('fila da ilha', () => {
  it('ordem de chegada; a mesma sessão não entra duas vezes', () => {
    let q = enqueue([], a)
    q = enqueue(q, b)
    q = enqueue(q, a)
    expect(q.map((x) => x.paneId)).toEqual(['a', 'b'])
  })
})
