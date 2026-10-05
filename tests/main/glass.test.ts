import { describe, expect, it, vi } from 'vitest'
import { applyGlass, type GlassLib } from '../../src/main/glass'

const win = { getNativeWindowHandle: () => Buffer.from([1]) }
const fakeLib = (id: number): GlassLib & { calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    addView: (_h, o) => (calls.push(`add:${o?.cornerRadius}`), id),
    unstable_setVariant: (i, v) => void calls.push(`variant:${i}:${v}`),
    unstable_setScrim: (i, v) => void calls.push(`scrim:${i}:${v}`),
    unstable_setSubdued: (i, v) => void calls.push(`subdued:${i}:${v}`),
  }
}

describe('glass', () => {
  it('aplica o Liquid Glass "clear" sem escurecimento (o borrão de trás fica aparente)', () => {
    const lib = fakeLib(3)
    expect(applyGlass(win, () => lib)).toBe(true)
    expect(lib.calls).toEqual(['add:10', 'variant:3:1', 'scrim:3:0', 'subdued:3:0'])
  })
  it('módulo que não carrega: false (quem chama cai no vidro clássico)', () => {
    expect(applyGlass(win, () => { throw new Error('sem binário') })).toBe(false)
  })
  it('addView recusado (-1): false, sem ajustar nada', () => {
    const lib = fakeLib(-1)
    const spy = vi.spyOn(lib, 'unstable_setVariant')
    expect(applyGlass(win, () => lib)).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })
})
