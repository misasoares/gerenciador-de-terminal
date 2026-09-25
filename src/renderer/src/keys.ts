/** ESC + CR: o Claude Code interpreta como quebra de linha (igual ao Option+Enter) */
export const SHIFT_ENTER_SEQUENCE = '\x1b\r'

export type KeyDecision = 'send-shift-enter' | 'swallow' | 'xterm'

export function decideKey(e: { type: string; key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): KeyDecision {
  if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey) return e.type === 'keydown' ? 'send-shift-enter' : 'swallow'
  // ⌘ fica com o menu do app (⌘T, ⌘D, ⌘W, ⌘C, ⌘V…); o paste continua pelo evento nativo
  if (e.metaKey) return 'swallow'
  return 'xterm'
}
