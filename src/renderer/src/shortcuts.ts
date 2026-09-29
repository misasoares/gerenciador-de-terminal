import { platformOf, resolveBindings, type Bindings, type KeyOverrides } from '../../shared/keybindings'
import { setKeyContext } from './keys'

export const platform = platformOf(window.gt.platform)

let active: Bindings = resolveBindings(platform, {})
let suspended = false

function push(): void {
  const b: Bindings = suspended ? Object.fromEntries(Object.keys(active).map((k) => [k, null])) : active
  window.gt.setKeybindings(b)
  setKeyContext({ platform, bound: new Set(Object.values(b).filter((v): v is string => !!v)) })
}

/** preferências mudaram: resolve, reconstrói o menu e atualiza o que o xterm deixa passar */
export function syncKeybindings(overrides: KeyOverrides): void {
  active = resolveBindings(platform, overrides)
  push()
}

/** gravando um atalho na tela de Preferências: desliga os atalhos para a combinação não disparar a ação */
export function suspendShortcuts(on: boolean): void {
  if (suspended === on) return
  suspended = on
  push()
}
