/** o que usamos da electron-liquid-glass (NSGlassEffectView do macOS 26; antes disso ela mesma cai no vidro clássico) */
export interface GlassLib {
  addView(handle: Buffer, options?: { cornerRadius?: number }): number
  unstable_setVariant(id: number, variant: number): void
  unstable_setScrim(id: number, scrim: number): void
  unstable_setSubdued(id: number, subdued: number): void
}

/** variante "clear": a mais transparente; o borrão do que está atrás fica aparente sem dar para ler */
const CLEAR = 1

/**
 * Põe o Liquid Glass atrás do conteúdo da janela, sem escurecimento (scrim/subdued 0).
 * false: o módulo não carregou ou recusou a janela — quem chama usa o vidro clássico.
 */
export function applyGlass(win: { getNativeWindowHandle(): Buffer }, load: () => GlassLib): boolean {
  try {
    const lib = load()
    const id = lib.addView(win.getNativeWindowHandle(), { cornerRadius: 10 })
    if (id < 0) return false
    lib.unstable_setVariant(id, CLEAR)
    lib.unstable_setScrim(id, 0)
    lib.unstable_setSubdued(id, 0)
    return true
  } catch (e) {
    console.error('liquid glass indisponível', e)
    return false
  }
}
