import type { EventEmitter } from 'node:events'

/**
 * Notificações do Electron precisam de referência viva até o clique (senão o GC as coleta e o 'click' some),
 * e a revelação do painel precisa esperar o renderer carregar quando a janela foi recriada.
 */
export class NotifyKeeper {
  private held = new Set<EventEmitter>()
  private queued: string[] = []

  get size(): number {
    return this.held.size
  }

  keep(n: EventEmitter): void {
    this.held.add(n)
    const drop = () => this.held.delete(n)
    n.once('click', drop)
    n.once('close', drop)
  }

  reveal(paneId: string, rendererReady: boolean, send: (paneId: string) => void): void {
    if (rendererReady) send(paneId)
    else this.queued.push(paneId)
  }

  loaded(send: (paneId: string) => void): void {
    for (const id of this.queued.splice(0)) send(id)
  }
}
