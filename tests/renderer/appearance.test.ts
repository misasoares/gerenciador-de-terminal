import { describe, expect, it } from 'vitest'
import { readCache } from '../../src/renderer/src/appearance'

const st = (v: string | null) => ({ getItem: () => v })

describe('appearance', () => {
  it('cache válido volta inteiro', () => {
    const c = { id: 'claro', scheme: 'light', vars: { '--bg': '#ffffff' } }
    expect(readCache(st(JSON.stringify(c)))).toEqual(c)
  })
  it('sem storage, vazio, JSON quebrado ou formato errado → null (fica o Padrão do CSS)', () => {
    expect(readCache(null)).toBeNull()
    expect(readCache(st(null))).toBeNull()
    expect(readCache(st('{quebrado'))).toBeNull()
    expect(readCache(st(JSON.stringify({ id: 'x' })))).toBeNull()
    expect(readCache({ getItem: () => { throw new Error('bloqueado') } })).toBeNull()
  })
})
