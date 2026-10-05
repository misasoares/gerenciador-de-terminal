import { beforeEach, describe, expect, it } from 'vitest'

const sent: unknown[] = []
beforeEach(() => {
  sent.length = 0
  ;(globalThis as unknown as { window: unknown }).window = { gt: { send: (r: unknown) => sent.push(r) } }
})

describe('dono do layout', () => {
  it('janela flutuante não grava layout', async () => {
    const { setUi, setLayoutOwner, updateLayout } = await import('../../src/renderer/src/store')
    setUi({ app: { layout: { tabs: [], activeTabId: null } } as never })
    setLayoutOwner(false)
    updateLayout(() => ({ tabs: [{ id: 't', name: 'A', root: null }], activeTabId: 't' }))
    expect(sent).toEqual([])
    setLayoutOwner(true)
    updateLayout(() => ({ tabs: [{ id: 't', name: 'A', root: null }], activeTabId: 't' }))
    expect(sent).toHaveLength(1)
  })
})
