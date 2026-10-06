import type { Bounds, FloatSpec, WorkspaceSummary } from '../shared/types'

type Placed = FloatSpec & { wsId: string }
const same = (a: FloatSpec, b: FloatSpec) => a.onTop === b.onTop && a.allDesks === b.allDesks && a.opacity === b.opacity

/** o resumo do daemon manda; só espaços ativados nesta execução mostram flutuantes */
export function syncFloats(summary: WorkspaceSummary[], activeWs: Set<string>, openNow: Map<string, FloatSpec>) {
  const want = new Map<string, Placed>()
  for (const w of summary) if (activeWs.has(w.id)) for (const f of w.floating) want.set(f.paneId, { ...f, wsId: w.id })
  const open: Placed[] = []
  const update: Placed[] = []
  for (const [id, f] of want) {
    const cur = openNow.get(id)
    if (!cur) open.push(f)
    else if (!same(cur, f)) update.push(f)
  }
  const close = [...openNow.keys()].filter((id) => !want.has(id))
  return { open, close, update }
}

const overlap = (a: Bounds, b: Bounds) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) >= 50 && Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) >= 50

export function fitBounds(b: Bounds | null, displays: Bounds[], fallback: Bounds): Bounds {
  return b && displays.some((d) => overlap(b, d)) ? b : fallback
}

export function cascade(base: Bounds, n: number): Bounds {
  return { ...base, x: base.x + 30 * n, y: base.y + 30 * n }
}

export function floatHome(workspaceWin: Bounds | null, screen: Bounds, n: number): Bounds {
  const area = workspaceWin ?? screen
  return cascade({ x: area.x + area.width - 640 - 24, y: area.y + 24, width: 640, height: 400 }, n)
}

/**
 * Opções da janela flutuante. fullscreenable: false — sem moldura não há como sair da tela cheia, e o macOS
 * a punha numa mesa própria ao arrastá-la para outra mesa estando sobre um app em tela cheia.
 * acceptFirstMouse: no mac o ⌘+clique numa janela inativa não a ativa e, sem isso, o clique se perde.
 * mac: janela transparente para o Liquid Glass (glass.ts) ficar por trás — o borrão do que está embaixo; o renderer
 * põe o fundo com a opacidade escolhida por cima dele. Sem vibrancy: ela cobriria o vidro e borraria demais.
 */
export function floatWindowOptions(bounds: Bounds, mac: boolean, bg: string) {
  const base = { ...bounds, minWidth: 320, minHeight: 180, frame: false, fullscreenable: false, acceptFirstMouse: true }
  return mac ? { ...base, transparent: true, backgroundColor: '#00000000' } : { ...base, backgroundColor: bg }
}

/** linux não tem vidro: a opacidade vale para a janela inteira, com piso para não sumir */
const LINUX_MIN_OPACITY = 0.3

/** opacidade da janela: no mac fica inteira (a opacidade é só do fundo, sobre o vidro) */
export function windowOpacity(opacity: number, mac: boolean): number {
  return mac ? 1 : Math.max(LINUX_MIN_OPACITY, opacity)
}

/**
 * opções de setVisibleOnAllWorkspaces: no mac, visibleOnFullScreen sem skipTransformProcessType faz o Electron
 * chamar app.dock.hide() — o app vira UIElement, some do Dock e perde a barra de menus. Nunca transformar.
 */
export function allDesksOptions(allDesks: boolean): { visibleOnFullScreen: boolean; skipTransformProcessType: true } {
  return { visibleOnFullScreen: allDesks, skipTransformProcessType: true }
}
