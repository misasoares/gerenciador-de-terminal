/** pedido de foco para um terminal que ainda não existe (o xterm nasce quando o estado volta do daemon) */
export class PendingFocus {
  private id: string | null = null

  /** tenta focar agora; se não der, guarda o pedido (substituindo o anterior) */
  request(id: string, tryFocus: (id: string) => boolean): void {
    this.id = tryFocus(id) ? null : id
  }

  /** o terminal de `id` ficou pronto: aplica o pedido guardado, se for dele */
  ready(id: string, tryFocus: (id: string) => boolean): void {
    if (this.id === id && tryFocus(id)) this.id = null
  }

  clear(id: string): void {
    if (this.id === id) this.id = null
  }
}
