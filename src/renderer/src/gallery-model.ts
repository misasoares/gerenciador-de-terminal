import type { FilePaneMeta, MediaGallery } from '../../shared/types'

/** galeria só quando há o que comparar ou navegar; uma mídia só fica no painel de arquivo comum */
export function isGalleryView(g: FilePaneMeta['gallery']): boolean {
  return !!g && (g.groups.length > 1 || g.groups.some((x) => x.length > 1))
}

/** até 4 numa linha; acima disso, grade quase quadrada */
export function gridColumns(n: number): number {
  return n <= 4 ? n : Math.ceil(Math.sqrt(n))
}

export function groupTitle(g: MediaGallery, i: number): string {
  return g.titles?.[i] ?? (g.groups[i]?.[0] ?? '').split('/').pop()!.replace(/\.[^.]+$/, '')
}

/** sem dar a volta: nas pontas fica parado */
export function stepGroup(i: number, delta: 1 | -1, total: number): number {
  return Math.min(Math.max(0, i + delta), Math.max(0, total - 1))
}
