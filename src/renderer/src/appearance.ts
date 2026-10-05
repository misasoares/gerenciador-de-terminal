import type { TerminalSettings } from '../../shared/settings'
import { cssVars, resolveTheme } from './app-themes'
import { terminals } from './terminals'

const KEY = 'gt-theme'
export type ThemeCache = { id: string; scheme: 'light' | 'dark'; vars: Record<string, string> }

const dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
let last: TerminalSettings | null = null

/** cache do último tema: falha de storage ou formato errado = null (fica o Padrão do CSS) */
export function readCache(storage: Pick<Storage, 'getItem'> | null): ThemeCache | null {
  try {
    const raw = storage?.getItem(KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as ThemeCache
    return typeof c?.id === 'string' && (c.scheme === 'light' || c.scheme === 'dark') && c.vars && typeof c.vars === 'object' ? c : null
  } catch {
    return null
  }
}

function paint(c: ThemeCache): void {
  const el = document.documentElement
  for (const [k, v] of Object.entries(c.vars)) el.style.setProperty(k, v)
  el.dataset.theme = c.id
  el.style.colorScheme = c.scheme
}

const storage = (): Storage | null => {
  try {
    return localStorage
  } catch {
    return null
  }
}

/** resolve o tema efetivo e aplica: variáveis, terminal, cache e esquema nativo no processo principal */
export function applyAppearance(s: TerminalSettings): void {
  last = s
  const { app, terminal } = resolveTheme(s, dark?.matches ?? true)
  const c: ThemeCache = { id: app.id, scheme: app.scheme, vars: cssVars(app, { reducedMotion: reduced?.matches ?? false }) }
  paint(c)
  terminals.applySettings(s, terminal)
  try {
    storage()?.setItem(KEY, JSON.stringify(c))
  } catch {
    // sem armazenamento: só não terá o atalho na próxima abertura
  }
  window.gt?.setAppearance({ scheme: app.scheme, follow: s.appearance.mode === 'auto', bg: app.tokens.bg })
}

/** boot: pinta o último tema antes do React montar; reaplica quando o macOS muda aparência ou movimento */
export function initAppearance(): void {
  const c = readCache(storage())
  if (c) paint(c)
  const again = () => last && applyAppearance(last)
  dark?.addEventListener('change', again)
  reduced?.addEventListener('change', again)
}
