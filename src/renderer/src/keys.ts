import { accelFromEvent, isReserved, type Platform } from '../../shared/keybindings'

/** ESC + CR: o Claude Code interpreta como quebra de linha (igual ao Option+Enter) */
export const SHIFT_ENTER_SEQUENCE = '\x1b\r'

export type KeyDecision = 'send-shift-enter' | 'swallow' | 'xterm'

export interface KeyContext {
  platform: Platform
  /** atalhos do app em vigor (resolvidos) */
  bound: ReadonlySet<string>
}

let context: KeyContext = { platform: 'mac', bound: new Set() }

export function setKeyContext(c: KeyContext): void {
  context = c
}

export function decideKey(
  e: { type: string; key: string; code?: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  c: KeyContext = context,
): KeyDecision {
  if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey) return e.type === 'keydown' ? 'send-shift-enter' : 'swallow'
  // Mac: ⌘ fica com o menu do app (⌘T, ⌘D, ⌘W, ⌘C, ⌘V…); o paste continua pelo evento nativo
  if (c.platform === 'mac' && e.metaKey) return 'swallow'
  // atalho do app, ou copiar/colar do Linux (Ctrl+Shift+C/V): o menu trata e o xterm não manda a tecla ao shell
  const accel = accelFromEvent(e, c.platform)
  if (accel && (c.bound.has(accel) || isReserved(c.platform, accel))) return 'swallow'
  return 'xterm'
}
