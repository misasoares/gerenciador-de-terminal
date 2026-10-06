import { effectiveBackground, wantsDesktop, type TerminalSettings } from '../../shared/settings'
import { cssVars, resolveTheme } from './app-themes'
import { backdropCss, safeGlass } from './backdrop'
import { FLOAT_PANE, VIEW, WINDOW_DESKTOP } from './view'
import { setUi } from './store'
import { terminals } from './terminals'

const KEY = 'gt-theme'
export type ThemeCache = { id: string; scheme: 'light' | 'dark'; vars: Record<string, string> }

const dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
let last: TerminalSettings | null = null
/** imagens de fundo do usuário (pasta e nomes), vindas do processo principal */
let userBg: { dir: string | null; list: string[] } = { dir: null, list: [] }
const platform = () => window.gt?.platform ?? 'darwin'

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
  const bg = effectiveBackground(s.appearance, app.id, app.premium, platform())
  const bd = backdropCss(bg, app, { userDir: userBg.dir, userList: userBg.list, windowDesktop: WINDOW_DESKTOP, base: location.href })
  let vars = cssVars(app, { reducedMotion: reduced?.matches ?? false })
  vars['--app-backdrop'] = bd.css
  if (bd.safe) vars = safeGlass(vars)
  const c: ThemeCache = { id: app.id, scheme: app.scheme, vars }
  paint(c)
  terminals.applySettings(s, terminal)
  try {
    storage()?.setItem(KEY, JSON.stringify(c))
  } catch {
    // sem armazenamento: só não terá o atalho na próxima abertura
  }
  const desktop = wantsDesktop(s.appearance, app.id, app.premium, platform())
  window.gt?.setAppearance({ scheme: app.scheme, follow: s.appearance.mode === 'auto', bg: app.tokens.bg, desktop })
  // janela de espaço criada no outro modo (ex.: o automático trocou para um tema com mesa): avisa, nada fecha sozinho
  if (!FLOAT_PANE && VIEW !== 'reopen') setUi({ desktopMismatch: desktop !== WINDOW_DESKTOP })
}

/** boot: pinta o último tema antes do React montar; reaplica quando o macOS muda aparência ou movimento */
export function initAppearance(): void {
  const c = readCache(storage())
  if (c) paint(c)
  const again = () => last && applyAppearance(last)
  void refreshBackgrounds()
  dark?.addEventListener('change', again)
  reduced?.addEventListener('change', again)
}

/** recarrega a lista de imagens do usuário (depois de importar/remover) e reaplica o tema */
export async function refreshBackgrounds(): Promise<void> {
  try {
    const r = await window.gt?.backgrounds()
    if (r) userBg = r
  } catch {
    // sem lista: imagens do usuário caem no gradiente do tema
  }
  if (last) applyAppearance(last)
}
