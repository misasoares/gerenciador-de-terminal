import fs from 'node:fs'

interface Cursor {
  offset: number
  rest: Buffer
  custom: string | null
  ai: string | null
}

function scan(c: Cursor, chunk: Buffer): void {
  const buf = c.rest.length ? Buffer.concat([c.rest, chunk]) : chunk
  const end = buf.lastIndexOf(0x0a)
  if (end < 0) {
    c.rest = buf
    return
  }
  c.rest = Buffer.from(buf.subarray(end + 1))
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    if (line.includes('"type":"custom-title"')) {
      try {
        const o = JSON.parse(line) as { customTitle?: unknown }
        if (typeof o.customTitle === 'string') c.custom = o.customTitle
      } catch {
        // linha quebrada
      }
    } else if (line.includes('"type":"ai-title"')) {
      try {
        const o = JSON.parse(line) as { aiTitle?: unknown }
        if (typeof o.aiTitle === 'string') c.ai = o.aiTitle
      } catch {
        // linha quebrada
      }
    }
  }
}

/** lê só o que foi acrescentado desde a última chamada para aquele arquivo */
export function createTitleReader(): (file: string) => Promise<string | null> {
  const cursors = new Map<string, Cursor>()
  return async (file) => {
    let size: number
    try {
      size = (await fs.promises.stat(file)).size
    } catch {
      return null
    }
    let c = cursors.get(file)
    if (!c || size < c.offset) c = { offset: 0, rest: Buffer.alloc(0), custom: null, ai: null }
    if (size > c.offset) {
      const fh = await fs.promises.open(file, 'r')
      try {
        const chunk = Buffer.alloc(size - c.offset)
        const { bytesRead } = await fh.read(chunk, 0, chunk.length, c.offset)
        scan(c, chunk.subarray(0, bytesRead))
        c.offset += bytesRead
      } finally {
        await fh.close()
      }
    }
    cursors.set(file, c)
    return c.custom ?? c.ai
  }
}

/** leitura avulsa (compatível com a fase 1) */
export async function readTitle(file: string): Promise<string | null> {
  return createTitleReader()(file)
}
