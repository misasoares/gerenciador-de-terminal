/**
 * Último tamanho que esta janela mandou ao terminal (pane.resize). Outra janela (a flutuante) pode redimensionar
 * o mesmo terminal enquanto este painel está fora da tela: ao remontar, reset() força mandar de novo.
 */
export class SizeTracker {
  private last = ''

  changed(cols: number, rows: number): boolean {
    const size = `${cols}x${rows}`
    if (size === this.last) return false
    this.last = size
    return true
  }

  reset(): void {
    this.last = ''
  }
}
