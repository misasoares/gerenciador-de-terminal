import fs from 'node:fs'
import { Readable } from 'node:stream'
import { protocol } from 'electron'
import { MEDIA_SCHEME, pathFromMediaUrl } from '../shared/media'

const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
  pdf: 'application/pdf',
}

export function contentType(p: string): string {
  return TYPES[p.slice(p.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'
}

/** "bytes=a-b" | "bytes=a-" | "bytes=-n" → intervalo dentro do arquivo; null = arquivo inteiro / inválido */
export function parseRange(h: string | null, size: number): { start: number; end: number } | null {
  const m = h?.match(/^bytes=(\d*)-(\d*)$/)
  if (!m || (!m[1] && !m[2])) return null
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  return start <= end && start < size ? { start, end } : null
}

/** antes do app ficar pronto: esquema padrão e seguro, com streaming (vídeo/áudio) e fetch */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])
}

/** gt-file://local/<caminho>: o arquivo do disco, com Range (o vídeo avança sem baixar tudo) */
export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const p = pathFromMediaUrl(req.url)
    if (!p) return new Response(null, { status: 404 })
    let size: number
    try {
      const st = await fs.promises.stat(p)
      if (!st.isFile()) return new Response(null, { status: 404 })
      size = st.size
    } catch {
      return new Response(null, { status: 404 })
    }
    const type = contentType(p)
    const r = parseRange(req.headers.get('range'), size)
    const body = (start: number, end: number) => Readable.toWeb(fs.createReadStream(p, { start, end })) as ReadableStream
    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' }
    if (!r) return new Response(size ? body(0, size - 1) : null, { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
    return new Response(body(r.start, r.end), {
      status: 206,
      headers: { ...headers, 'Content-Length': String(r.end - r.start + 1), 'Content-Range': `bytes ${r.start}-${r.end}/${size}` },
    })
  })
}
