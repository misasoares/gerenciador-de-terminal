import path from 'node:path'
import { mediaKind } from '../shared/media'
import type { MediaGallery } from '../shared/types'

const SHAPE = 'passe caminhos (lista) ou grupos (lista de listas)'

const isStrList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.trim() !== '')
const optList = (v: unknown, nome: string): string[] | null => {
  if (v === undefined || v === null) return null
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new Error(`${SHAPE}; ${nome} deve ser lista de textos`)
  return v
}

/** argumentos do abrir_midia → caminhos absolutos validados; qualquer problema recusa tudo (nada abre pela metade) */
export function parseOpenMedia(args: Record<string, unknown>, o: { cwd: string; home: string; isFile(p: string): boolean }): MediaGallery {
  const { caminhos, grupos } = args
  let raw: string[][]
  if (caminhos !== undefined && grupos === undefined && isStrList(caminhos)) raw = caminhos.map((c) => [c])
  else if (grupos !== undefined && caminhos === undefined && Array.isArray(grupos) && grupos.length > 0 && grupos.every(isStrList)) raw = grupos as string[][]
  else throw new Error(SHAPE)
  const labels = optList(args.rotulos, 'rotulos')
  const titles = optList(args.titulos, 'titulos')
  const abs = (p: string) => path.resolve(o.cwd, p === '~' ? o.home : p.startsWith('~/') ? path.join(o.home, p.slice(2)) : p)
  const groups = raw.map((g) => g.map((p) => abs(p.trim())))
  const bad = [...new Set(groups.flat())].flatMap((p) =>
    !o.isFile(p) ? [`${p} (não existe)`] : !mediaKind(p) ? [`${p} (não é imagem, vídeo, áudio ou PDF)`] : [],
  )
  if (bad.length) throw new Error(`não abri nada: ${bad.join(', ')}`)
  return { groups, labels, titles }
}
