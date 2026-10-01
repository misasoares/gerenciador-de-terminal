import fs from 'node:fs'

/** nome da pasta que o Claude usa em projects/ para um cwd */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9-]/g, '-')
}

export async function readHead(file: string, bytes: number): Promise<string> {
  const fh = await fs.promises.open(file, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await fh.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fh.close()
  }
}

export async function readTail(file: string, bytes: number): Promise<string> {
  const fh = await fs.promises.open(file, 'r')
  try {
    const { size } = await fh.stat()
    const len = Math.min(size, bytes)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, size - len)
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

/** objetos JSON de cada linha; linhas inválidas (cortadas, lixo) são ignoradas */
export function jsonLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const l of text.split('\n')) {
    if (!l.startsWith('{')) continue
    try {
      const o = JSON.parse(l)
      if (o && typeof o === 'object') out.push(o as Record<string, unknown>)
    } catch {
      // linha cortada
    }
  }
  return out
}

export async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
