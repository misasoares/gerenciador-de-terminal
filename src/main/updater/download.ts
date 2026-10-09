import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export async function sha256File(file: string): Promise<string> {
  const h = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer)
  return h.digest('hex')
}

/** baixa em .part e só renomeia se o SHA-256 bater; em qualquer falha não deixa nada para trás */
export async function downloadVerified(o: { fetch: Fetch; url: string; dir: string; name: string; sha256: string }): Promise<string> {
  fs.mkdirSync(o.dir, { recursive: true })
  const final = path.join(o.dir, o.name)
  if (fs.existsSync(final) && (await sha256File(final)) === o.sha256) return final
  const part = final + '.part'
  fs.rmSync(part, { force: true })
  try {
    const res = await o.fetch(o.url, { redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`download falhou: HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), fs.createWriteStream(part))
    if ((await sha256File(part)) !== o.sha256) throw new Error(`SHA-256 diferente em ${o.name}`)
    fs.renameSync(part, final)
    return final
  } catch (e) {
    fs.rmSync(part, { force: true })
    fs.rmSync(final, { force: true })
    throw e
  }
}

/** apaga as pastas de outras versões (pending.json, logs e backups ficam) */
export function pruneVersions(updatesDir: string, keep: string): void {
  for (const e of fs.readdirSync(updatesDir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== keep && /^\d+\.\d+\.\d+$/.test(e.name)) fs.rmSync(path.join(updatesDir, e.name), { recursive: true, force: true })
  }
}
