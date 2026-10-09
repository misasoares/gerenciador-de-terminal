import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { downloadVerified, pruneVersions, sha256File } from '../../src/main/updater/download'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gt-dl-'))
const bytes = Buffer.from('conteúdo do zip')
const sha = crypto.createHash('sha256').update(bytes).digest('hex')
const fetchOf = (body: Buffer, status = 200) => {
  let calls = 0
  const f = async () => {
    calls++
    return new Response(new Uint8Array(body), { status })
  }
  return { f, calls: () => calls }
}

describe('download conferido', () => {
  it('baixa, confere e deixa só o arquivo final', async () => {
    const dir = path.join(tmp(), '0.2.0')
    const { f } = fetchOf(bytes)
    const file = await downloadVerified({ fetch: f, url: 'https://x/a.zip', dir, name: 'a.zip', sha256: sha })
    expect(file).toBe(path.join(dir, 'a.zip'))
    expect(fs.readFileSync(file)).toEqual(bytes)
    expect(fs.existsSync(file + '.part')).toBe(false)
    expect(await sha256File(file)).toBe(sha)
  })
  it('hash diferente → lança e não deixa nada', async () => {
    const dir = path.join(tmp(), '0.2.0')
    const { f } = fetchOf(Buffer.from('corrompido'))
    await expect(downloadVerified({ fetch: f, url: 'u', dir, name: 'a.zip', sha256: sha })).rejects.toThrow(/SHA-256/)
    expect(fs.readdirSync(dir)).toEqual([])
  })
  it('HTTP com erro → lança', async () => {
    const dir = path.join(tmp(), '0.2.0')
    const { f } = fetchOf(Buffer.from(''), 404)
    await expect(downloadVerified({ fetch: f, url: 'u', dir, name: 'a.zip', sha256: sha })).rejects.toThrow(/404/)
  })
  it('arquivo já baixado e conferido → não baixa de novo', async () => {
    const dir = path.join(tmp(), '0.2.0')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'a.zip'), bytes)
    const { f, calls } = fetchOf(bytes)
    await downloadVerified({ fetch: f, url: 'u', dir, name: 'a.zip', sha256: sha })
    expect(calls()).toBe(0)
  })
  it('limpa pastas de outras versões e mantém arquivos soltos', () => {
    const upd = tmp()
    for (const d of ['0.1.5', '0.2.0', 'outra']) fs.mkdirSync(path.join(upd, d))
    fs.writeFileSync(path.join(upd, 'pending.json'), '{}')
    pruneVersions(upd, '0.2.0')
    expect(fs.readdirSync(upd).sort()).toEqual(['0.2.0', 'outra', 'pending.json'])
  })
})
