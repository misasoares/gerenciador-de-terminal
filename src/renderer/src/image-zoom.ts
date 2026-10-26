export type Size = { w: number; h: number }
/** escala sobre o tamanho real e canto superior esquerdo da imagem dentro da caixa */
export type ZoomView = { scale: number; x: number; y: number }

export const MAX_SCALE = 16
const EPS = 1e-3

/** ajustar: cabe inteira, sem ampliar além do tamanho real; centralizada (ou colada no topo, na galeria) */
export function fitScale(box: Size, img: Size): number {
  if (img.w <= 0 || img.h <= 0 || box.w <= 0 || box.h <= 0) return 1
  return Math.min(box.w / img.w, box.h / img.h, 1)
}

/** num eixo: menor que a caixa centraliza (ou cola no início); maior não deixa sobrar borda vazia */
function clampAxis(pos: number, size: number, box: number, start: boolean): number {
  if (size <= box) return start ? 0 : (box - size) / 2
  return Math.min(0, Math.max(box - size, pos))
}

export function clampView(v: ZoomView, box: Size, img: Size, top = false): ZoomView {
  return { scale: v.scale, x: clampAxis(v.x, img.w * v.scale, box.w, false), y: clampAxis(v.y, img.h * v.scale, box.h, top) }
}

export function fitView(box: Size, img: Size, top = false): ZoomView {
  return clampView({ scale: fitScale(box, img), x: 0, y: 0 }, box, img, top)
}

export function isFit(v: ZoomView, box: Size, img: Size): boolean {
  return v.scale <= fitScale(box, img) + EPS
}

/** escala nova com o ponto p (coordenadas da caixa) parado sob o cursor; nunca menor que ajustar */
export function zoomTo(v: ZoomView, scale: number, p: { x: number; y: number }, box: Size, img: Size, top = false): ZoomView {
  const s = Math.min(MAX_SCALE, Math.max(fitScale(box, img), scale))
  const k = s / v.scale
  return clampView({ scale: s, x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k }, box, img, top)
}

export function panBy(v: ZoomView, dx: number, dy: number, box: Size, img: Size, top = false): ZoomView {
  return clampView({ ...v, x: v.x + dx, y: v.y + dy }, box, img, top)
}
