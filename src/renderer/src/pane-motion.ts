import { animate, type Transition } from 'motion'

const seenByTab = new Map<string, Set<string>>()

/** painel anima a entrada só se for novo numa aba já vista (trocar de aba remonta tudo e não deve "crescer") */
export function shouldAnimateEnter(tabId: string, paneId: string, seen = seenByTab): boolean {
  const s = seen.get(tabId)
  if (!s) {
    seen.set(tabId, new Set([paneId]))
    return false
  }
  const fresh = !s.has(paneId)
  s.add(paneId)
  return fresh
}

/** anima a saída do painel (filho do slot); sem o elemento (já saiu, outra aba, janela flutuante), resolve na hora */
export async function animateOut(paneId: string, exit: { opacity: number; scale: number }, t: Transition): Promise<void> {
  if (typeof document === 'undefined') return
  const el = [...document.querySelectorAll<HTMLElement>('.pane-slot')].find((x) => x.dataset.paneId === paneId)?.firstElementChild
  if (!(el instanceof HTMLElement)) return
  await animate(el, exit, t).finished
}
