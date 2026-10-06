type Click = { x: number; y: number; t: number }
let last: Click | null = null

/** guarda o último pointerdown (origem do zoom dos modais) */
export function trackPointer(): void {
  window.addEventListener('pointerdown', (e) => (last = { x: e.clientX, y: e.clientY, t: performance.now() }), { capture: true })
}
export const lastPointer = (): Click | null => last

/** origem do zoom: o clique, se o modal abriu logo depois dele; senão o topo-centro (abriu por atalho) */
export function originFor(click: Click | null, now: number, box: { left: number; top: number }): string {
  return click && now - click.t <= 400 ? `${click.x - box.left}px ${click.y - box.top}px` : '50% 0%'
}
