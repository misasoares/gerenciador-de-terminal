import { describe, expect, it } from 'vitest'
import { uniqueName } from '../../src/daemon/workspaces'

describe('uniqueName', () => {
  it('mantém, numera repetidos e recusa vazio', () => {
    expect(uniqueName(' TCHEERP ', ['Principal'])).toBe('TCHEERP')
    expect(uniqueName('Principal', ['Principal'])).toBe('Principal 2')
    expect(uniqueName('Principal', ['Principal', 'Principal 2'])).toBe('Principal 3')
    expect(() => uniqueName('   ', [])).toThrow('nome obrigatório')
  })
})
