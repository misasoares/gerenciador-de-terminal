import type { Background } from '../../shared/settings'
import { mediaUrl } from '../../shared/media'
import { contrast, GLASS_TOKENS, SAFE_GLASS_ALPHA, TERMINAL_GLASS_ALPHA, type AppTheme } from './app-themes'

/**
 * valor de --app-backdrop; `base` = endereço da página (as imagens incluídas viram endereço absoluto:
 * um url() relativo dentro de variável CSS é resolvido contra o arquivo .css, não contra a página)
 */
export function backdropCss(
  b: Background,
  t: AppTheme,
  o: { userDir: string | null; userList: string[]; windowDesktop: boolean; base: string },
): { css: string; safe: boolean } {
  const theme = { css: t.tokens['app-backdrop'], safe: false }
  if (b.kind === 'none') return { css: t.tokens.bg, safe: false }
  if (b.kind === 'desktop') return o.windowDesktop ? { css: 'transparent', safe: true } : theme
  if (b.kind === 'image') {
    const [src, name] = b.image.split(':')
    if (src === 'bundled') return { css: `url("${new URL(`fundos/${name}.jpg`, o.base).href}") center / cover no-repeat, ${t.tokens.bg}`, safe: true }
    if (o.userDir && o.userList.includes(name)) return { css: `url("${mediaUrl(`${o.userDir}/${name}`, 0)}") center / cover no-repeat, ${t.tokens.bg}`, safe: true }
  }
  return theme
}

/** vidro sobre fundo imprevisível: alfa das superfícies de vidro sobe para o seguro */
export function safeGlass(vars: Record<string, string>): Record<string, string> {
  const out = { ...vars }
  for (const k of GLASS_TOKENS) {
    const v = out[`--${k}`]
    if (v?.startsWith('rgba(')) out[`--${k}`] = v.replace(/[\d.]+\)$/, `${SAFE_GLASS_ALPHA})`)
  }
  return out
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
/** fundo escuro: contrasta mais com branco que com preto */
const isDark = (hex: string) => contrast(hex, '#ffffff') > contrast(hex, '#000000')

/**
 * painéis encaixados: fundo do terminal (o do tom; translúcido no vidro), do leitor de arquivo, desfoque e cabeçalho.
 * Terminal no tom oposto ao do tema ganha cabeçalho sólido (vidro claro sobre terminal escuro não passa no contraste).
 */
/** desfoque dos painéis em vidro: menor que o das barras, o fundo aparece mais definido atrás do texto */
const PANE_GLASS_BLUR = '12px'

export function paneVars(t: AppTheme, terminalBg: string, glass: boolean): Record<string, string> {
  const translucent = (hex: string) => (glass ? `rgba(${rgb(hex).join(', ')}, ${TERMINAL_GLASS_ALPHA})` : hex)
  return {
    '--pane-surface': translucent(terminalBg),
    // leitor de arquivo: a cor do próprio tema (o tom do terminal não se aplica ao editor)
    '--file-surface': translucent(t.tokens.bg),
    '--pane-blur': glass ? PANE_GLASS_BLUR : '0px',
    '--pane-header-bg': isDark(terminalBg) !== (t.scheme === 'dark') ? 'var(--bg-raised)' : 'var(--bg-bar)',
  }
}
