import { describe, expect, it } from 'vitest'
import { encode, LineDecoder } from '../../src/shared/framing'

describe('framing', () => {
  it('junta pedaços e separa por linha', () => {
    const d = new LineDecoder()
    expect(d.push('{"a":1}\n{"b"')).toEqual([{ a: 1 }])
    expect(d.push(':2}\n')).toEqual([{ b: 2 }])
  })

  it('ignora linha inválida sem perder as outras', () => {
    const d = new LineDecoder()
    expect(d.push('lixo\n{"ok":true}\n')).toEqual([{ ok: true }])
  })

  it('encode escapa quebras de linha dentro de strings', () => {
    const line = encode({ data: 'a\nb' })
    expect(line.split('\n')).toHaveLength(2)
    expect(new LineDecoder().push(line)).toEqual([{ data: 'a\nb' }])
  })
})
