import type { FilePaneMeta, MediaGallery } from '../../shared/types'

/** galeria só quando há o que comparar ou navegar; uma mídia só fica no painel de arquivo comum */
export function isGalleryView(g: FilePaneMeta['gallery']): boolean {
  return !!g && (g.groups.length > 1 || g.groups.some((x) => x.length > 1))
}

/** até 4 numa linha; acima disso, grade quase quadrada (antes de saber o tamanho do painel) */
export function gridColumns(n: number): number {
  return n <= 4 ? n : Math.ceil(Math.sqrt(n))
}

/** medidas da grade: espaço entre células, margem interna e altura do rótulo, em px */
export interface GridMetrics {
  gap: number
  pad: number
  label: number
}

/**
 * colunas que deixam as mídias maiores no painel: testa de 1 a n colunas e fica com a que dá
 * mais área somada às mídias ajustadas (largura ÷ altura de cada uma; sem medida ainda, 16:9).
 * Empate: mais colunas (lado a lado, como antes). Sem tamanho do painel, cai no padrão de gridColumns.
 */
export function bestColumns(aspects: (number | null)[], box: { w: number; h: number }, m: GridMetrics): number {
  const n = aspects.length
  if (n <= 1) return 1
  if (box.w <= 0 || box.h <= 0) return gridColumns(n)
  let best = gridColumns(n)
  let bestArea = -1
  for (let c = n; c >= 1; c--) {
    const r = Math.ceil(n / c)
    const cw = (box.w - 2 * m.pad - (c - 1) * m.gap) / c
    const ch = (box.h - 2 * m.pad - (r - 1) * m.gap) / r - m.label
    if (cw <= 0 || ch <= 0) continue
    let area = 0
    for (const a0 of aspects) {
      const a = a0 && a0 > 0 ? a0 : 16 / 9
      const w = Math.min(cw, ch * a)
      area += (w * w) / a
    }
    if (area > bestArea * 1.0001) {
      bestArea = area
      best = c
    }
  }
  return best
}

export function groupTitle(g: MediaGallery, i: number): string {
  return g.titles?.[i] ?? (g.groups[i]?.[0] ?? '').split('/').pop()!.replace(/\.[^.]+$/, '')
}

/** sem dar a volta: nas pontas fica parado */
export function stepGroup(i: number, delta: 1 | -1, total: number): number {
  return Math.min(Math.max(0, i + delta), Math.max(0, total - 1))
}
