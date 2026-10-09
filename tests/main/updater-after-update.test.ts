import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { clearAfterUpdate, markStarted, openThenConfirm, readAfterUpdate } from '../../src/main/updater/after-update'

const dir = (pending?: unknown, failed = false) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-after-'))
  if (pending !== undefined) fs.writeFileSync(path.join(d, 'pending.json'), typeof pending === 'string' ? pending : JSON.stringify(pending))
  if (failed) fs.writeFileSync(path.join(d, 'failed.json'), '{}')
  return d
}

describe('depois de atualizar', () => {
  it('abriu na versão nova → updated', () => {
    expect(readAfterUpdate(dir({ from: '0.1.0', to: '0.2.0' }), '0.2.0')).toEqual({ kind: 'updated', to: '0.2.0' })
  })
  it('voltou para a anterior → failed', () => {
    expect(readAfterUpdate(dir({ from: '0.1.0', to: '0.2.0' }, true), '0.1.0')).toEqual({ kind: 'failed', to: '0.2.0', current: '0.1.0' })
  })
  it('na versão de origem sem failed.json (o script ainda espera a nova) → none', () => {
    expect(readAfterUpdate(dir({ from: '0.1.0', to: '0.2.0' }), '0.1.0')).toEqual({ kind: 'none' })
  })
  it('pendência de outra versão (instalada à mão), sem pendência ou ilegível → none', () => {
    expect(readAfterUpdate(dir({ from: '0.1.0', to: '0.2.0' }), '0.3.0')).toEqual({ kind: 'none' })
    expect(readAfterUpdate(dir(), '0.2.0')).toEqual({ kind: 'none' })
    expect(readAfterUpdate(dir('{quebrado'), '0.2.0')).toEqual({ kind: 'none' })
    expect(readAfterUpdate(dir({ from: 1 }), '0.2.0')).toEqual({ kind: 'none' })
  })
  it('confirma a abertura e limpa a pendência (o ok fica para o script)', () => {
    const d = dir({ from: '0.1.0', to: '0.2.0' }, true)
    markStarted(d, '0.2.0')
    clearAfterUpdate(d)
    expect(fs.readdirSync(d)).toEqual(['ok-0.2.0'])
  })
  it('pasta inexistente: tudo sem erro', () => {
    const d = path.join(os.tmpdir(), 'gt-nao-existe-' + Date.now())
    expect(readAfterUpdate(d, '0.1.0')).toEqual({ kind: 'none' })
    expect(() => clearAfterUpdate(d)).not.toThrow()
  })
})

describe('confirmar só com as janelas prontas', () => {
  it('abre os espaços, espera os renderers e só então confirma', async () => {
    const log: string[] = []
    let ready!: () => void
    const p = openThenConfirm({ ids: ['a', 'b'], open: async (id) => void log.push('open ' + id), rendered: () => new Promise<void>((r) => (ready = r)), confirm: () => log.push('ok') })
    await new Promise((r) => setTimeout(r, 10))
    expect(log).toEqual(['open a', 'open b'])
    ready()
    await p
    expect(log).toEqual(['open a', 'open b', 'ok'])
  })
  it('renderer que nunca fica pronto: não confirma (o script volta para a anterior)', async () => {
    let confirmed = false
    void openThenConfirm({ ids: ['a'], open: async () => {}, rendered: () => new Promise<void>(() => {}), confirm: () => (confirmed = true) })
    await new Promise((r) => setTimeout(r, 20))
    expect(confirmed).toBe(false)
  })
})
