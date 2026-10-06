import type { Background } from '../../shared/settings'
import { mediaUrl } from '../../shared/media'
import { GLASS_TOKENS, SAFE_GLASS_ALPHA, type AppTheme } from './app-themes'

/** valor de --app-backdrop para o fundo efetivo; safe = fundo imprevisível (vidro mais opaco) */
export function backdropCss(b: Background, t: AppTheme, o: { userDir: string | null; userList: string[]; windowDesktop: boolean }): { css: string; safe: boolean } {
  const theme = { css: t.tokens['app-backdrop'], safe: false }
  if (b.kind === 'none') return { css: t.tokens.bg, safe: false }
  if (b.kind === 'desktop') return o.windowDesktop ? { css: 'transparent', safe: true } : theme
  if (b.kind === 'image') {
    const [src, name] = b.image.split(':')
    if (src === 'bundled') return { css: `url("./fundos/${name}.jpg") center / cover no-repeat, ${t.tokens.bg}`, safe: true }
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
