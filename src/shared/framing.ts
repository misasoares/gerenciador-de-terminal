export class LineDecoder {
  private buf = ''

  push(chunk: string): unknown[] {
    this.buf += chunk
    const out: unknown[] = []
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i)
      this.buf = this.buf.slice(i + 1)
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line))
      } catch {
        // linha corrompida: descarta e segue
      }
    }
    return out
  }
}

export const encode = (msg: unknown): string => JSON.stringify(msg) + '\n'
