import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Updater, type UpdaterDeps } from '../../src/main/updater/updater'
import type { UpdateStatus } from '../../src/shared/update'

const ZIP = Buffer.from('zip da 0.2.0')
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex')
const release = (tag = 'v0.2.0') => ({
  tag_name: tag,
  body: 'notas',
  html_url: 'https://gh/rel',
  assets: [
    { name: `gerenciador-de-terminal-${tag.slice(1)}-mac-arm64.zip`, browser_download_url: 'https://dl/zip', size: ZIP.length },
    { name: 'SHA256SUMS', browser_download_url: 'https://dl/sums', size: 1 },
  ],
})

function setup(o: { tag?: string; zip?: Buffer; sums?: string; canWrite?: boolean; platform?: string; appImage?: boolean; failApi?: boolean } = {}) {
  const calls: string[] = []
  const tag = o.tag ?? 'v0.2.0'
  const fetch: UpdaterDeps['fetch'] = async (url) => {
    calls.push(url)
    if (url === 'https://api/latest') {
      if (o.failApi) throw new Error('sem rede')
      return new Response(JSON.stringify(release(tag)))
    }
    if (url === 'https://dl/sums') return new Response(o.sums ?? `${sha(ZIP)}  gerenciador-de-terminal-${tag.slice(1)}-mac-arm64.zip\n`)
    if (url === 'https://dl/zip') return new Response(new Uint8Array(o.zip ?? ZIP))
    return new Response('', { status: 404 })
  }
  const statuses: UpdateStatus[] = []
  const updatesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-upd-'))
  const u = new Updater({
    current: '0.1.0',
    platform: o.platform ?? 'darwin',
    arch: 'arm64',
    appImage: o.appImage ?? false,
    updatesDir,
    apiUrl: 'https://api/latest',
    fetch,
    canWrite: () => o.canWrite ?? true,
    onStatus: (s) => statuses.push(s),
  })
  return { u, calls, statuses, updatesDir }
}

describe('Updater', () => {
  it('versão nova: baixa, confere e fica pronta', async () => {
    const { u, statuses, updatesDir } = setup()
    await u.check()
    expect(u.status).toEqual({ kind: 'ready', version: '0.2.0', notes: 'notas' })
    expect(statuses).toEqual([u.status])
    expect(u.ready).toEqual({ version: '0.2.0', kind: 'mac-zip', file: path.join(updatesDir, '0.2.0', 'gerenciador-de-terminal-0.2.0-mac-arm64.zip') })
    expect(fs.readFileSync(u.ready!.file)).toEqual(ZIP)
  })
  it('mesma versão ou mais velha: nada (nunca rebaixa)', async () => {
    for (const tag of ['v0.1.0', 'v0.0.9']) {
      const { u, calls, statuses } = setup({ tag })
      await u.check()
      expect(u.status).toEqual({ kind: 'idle' })
      expect(statuses).toEqual([])
      expect(calls).toEqual(['https://api/latest'])
    }
  })
  it('já pronta: nova verificação não baixa de novo', async () => {
    const { u, calls } = setup()
    await u.check()
    await u.check()
    expect(calls.filter((c) => c === 'https://dl/zip')).toHaveLength(1)
  })
  it('verificações simultâneas fazem um download só', async () => {
    const { u, calls } = setup()
    await Promise.all([u.check(), u.check(), u.check()])
    expect(calls.filter((c) => c === 'https://api/latest')).toHaveLength(1)
    expect(calls.filter((c) => c === 'https://dl/zip')).toHaveLength(1)
  })
  it('SHA-256 diferente: segue ocioso, sem arquivo', async () => {
    const { u, updatesDir } = setup({ zip: Buffer.from('corrompido') })
    await u.check()
    expect(u.status).toEqual({ kind: 'idle' })
    expect(u.ready).toBeNull()
    expect(fs.readdirSync(path.join(updatesDir, '0.2.0'))).toEqual([])
  })
  it('sem SHA256SUMS para o arquivo: não baixa', async () => {
    const { u, calls } = setup({ sums: `${'a'.repeat(64)}  outro.zip\n` })
    await u.check()
    expect(u.status).toEqual({ kind: 'idle' })
    expect(calls).not.toContain('https://dl/zip')
  })
  it('sem rede: não lança e segue ocioso', async () => {
    const { u } = setup({ failApi: true })
    await expect(u.check()).resolves.toBeUndefined()
    expect(u.status).toEqual({ kind: 'idle' })
  })
  it('pasta sem escrita: avisa "bloqueado" sem baixar', async () => {
    const { u, calls } = setup({ canWrite: false })
    await u.check()
    expect(u.status).toEqual({ kind: 'blocked', version: '0.2.0', reason: 'not-writable' })
    expect(calls).not.toContain('https://dl/zip')
  })
  it('Linux por .deb/.rpm: só avisa, com a página da release', async () => {
    const { u, calls } = setup({ platform: 'linux', appImage: false })
    await u.check()
    expect(u.status).toEqual({ kind: 'notify-only', version: '0.2.0', notes: 'notas', url: 'https://gh/rel' })
    expect(calls).toEqual(['https://api/latest'])
  })
  it('falha anterior aparece até haver novidade', () => {
    const { u, statuses } = setup()
    u.setFailed('0.2.0', '0.1.0')
    expect(u.status).toEqual({ kind: 'failed-last', to: '0.2.0', current: '0.1.0' })
    expect(statuses).toHaveLength(1)
  })
})
