import { describe, expect, it } from 'vitest'
import { APP_THEMES } from '../../src/renderer/src/app-themes'
import { backdropCss, safeGlass } from '../../src/renderer/src/backdrop'

const o = { userDir: '/Users/u/.gerenciador-terminal/fundos', userList: ['0123456789abcdef.jpg'], windowDesktop: false }
const t = APP_THEMES.aurora

describe('backdrop', () => {
  it('tema = gradiente do tema; nenhum = cor bg; ambos sem vidro seguro', () => {
    expect(backdropCss({ kind: 'theme' }, t, o)).toEqual({ css: t.tokens['app-backdrop'], safe: false })
    expect(backdropCss({ kind: 'none' }, t, o)).toEqual({ css: t.tokens.bg, safe: false })
  })
  it('imagem incluída e do usuário: url com cover sobre bg; vidro seguro', () => {
    expect(backdropCss({ kind: 'image', image: 'bundled:aurora-1' }, t, o)).toEqual({ css: `url("./fundos/aurora-1.jpg") center / cover no-repeat, ${t.tokens.bg}`, safe: true })
    const u = backdropCss({ kind: 'image', image: 'user:0123456789abcdef.jpg' }, t, o)
    expect(u.safe).toBe(true)
    expect(u.css).toMatch(/^url\("gt-file:\/\/local\/Users\/u\/\.gerenciador-terminal\/fundos\/0123456789abcdef\.jpg\?v=0"\) center \/ cover no-repeat, #ffffff$/)
  })
  it('imagem do usuário que sumiu (ou pasta desconhecida) cai no gradiente do tema', () => {
    expect(backdropCss({ kind: 'image', image: 'user:ffffffffffffffff.jpg' }, t, o)).toEqual({ css: t.tokens['app-backdrop'], safe: false })
    expect(backdropCss({ kind: 'image', image: 'user:0123456789abcdef.jpg' }, t, { ...o, userDir: null })).toEqual({ css: t.tokens['app-backdrop'], safe: false })
  })
  it('mesa: transparente só se a janela foi criada transparente; senão o gradiente', () => {
    expect(backdropCss({ kind: 'desktop' }, t, { ...o, windowDesktop: true })).toEqual({ css: 'transparent', safe: true })
    expect(backdropCss({ kind: 'desktop' }, t, o)).toEqual({ css: t.tokens['app-backdrop'], safe: false })
  })
  it('safeGlass: sobe o alfa das superfícies de vidro para 0.82 e não mexe em hex', () => {
    const v = safeGlass({ '--bg-side': 'rgba(255, 255, 255, 0.55)', '--bg-bar': '#252526', '--bg-status': 'rgba(20, 21, 30, 0.55)', '--bg': '#ffffff' })
    expect(v).toEqual({ '--bg-side': 'rgba(255, 255, 255, 0.82)', '--bg-bar': '#252526', '--bg-status': 'rgba(20, 21, 30, 0.82)', '--bg': '#ffffff' })
  })
})
