/** mídia que o painel de arquivo mostra no lugar do editor */
export type MediaKind = 'image' | 'video' | 'audio' | 'pdf'

const KINDS: [RegExp, MediaKind][] = [
  [/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i, 'image'],
  [/\.(mp4|mov|webm|m4v)$/i, 'video'],
  [/\.(mp3|wav|m4a|ogg|oga|flac|aac|opus)$/i, 'audio'],
  [/\.pdf$/i, 'pdf'],
]

/** extensões de mídia (os links de caminho no terminal também as reconhecem) */
export const MEDIA_EXT = 'png|jpe?g|gif|webp|svg|avif|bmp|ico|mp4|mov|webm|m4v|mp3|wav|m4a|ogg|oga|flac|aac|opus|pdf'

export function mediaKind(p: string): MediaKind | null {
  return KINDS.find(([re]) => re.test(p))?.[1] ?? null
}

/** esquema servido pelo processo principal (streaming, com Range para o vídeo avançar) */
export const MEDIA_SCHEME = 'gt-file'
const HOST = 'local'

/** endereço do arquivo no protocolo; a versão (mtime) força recarregar quando o arquivo muda */
export function mediaUrl(p: string, version: number): string {
  return `${MEDIA_SCHEME}://${HOST}${p.split('/').map(encodeURIComponent).join('/')}?v=${version}`
}

/** caminho absoluto de um endereço do protocolo; null se não for nosso */
export function pathFromMediaUrl(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${MEDIA_SCHEME}:` || u.host !== HOST) return null
  try {
    return decodeURIComponent(u.pathname)
  } catch {
    return null
  }
}
