import { describe, expect, it } from 'vitest'
import { APP_THEMES } from '../../src/renderer/src/app-themes'
import { backdropCss, paneVars, safeGlass } from '../../src/renderer/src/backdrop'

const o = { userDir: '/Users/u/.gerenciador-terminal/fundos', userList: ['0123456789abcdef.jpg'], windowDesktop: false, base: 'file:///app/out/renderer/' }
const t = APP_THEMES.aurora

describe('backdrop', () => {
  it('tema = gradiente do tema; nenhum = cor bg; ambos sem vidro seguro', () => {
    expect(backdropCss({ kind: 'theme' }, t, o)).toEqual({ css: t.tokens['app-backdrop'], safe: false })
    expect(backdropCss({ kind: 'none' }, t, o)).toEqual({ css: t.tokens.bg, safe: false })
  })
  it('imagem incluída e do usuário: url com cover sobre bg; vidro seguro', () => {
    // endereço absoluto: um url() relativo dentro de variável CSS seria resolvido contra o arquivo .css, não contra a página
    expect(backdropCss({ kind: 'image', image: 'bundled:aurora-1' }, t, o)).toEqual({ css: `url("file:///app/out/renderer/fundos/aurora-1.jpg") center / cover no-repeat, ${t.tokens.bg}`, safe: true })
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
  it('paneVars: sólido usa o fundo do terminal; vidro usa ele translúcido e desfocado', () => {
    expect(paneVars(APP_THEMES.aurora, '#ffffff', false)).toEqual({ '--pane-surface': '#ffffff', '--file-surface': '#ffffff', '--pane-blur': '0px', '--pane-header-bg': 'var(--bg-bar)' })
    // desfoque menor que o das barras: o fundo aparece mais definido atrás do texto
    expect(paneVars(APP_THEMES.aurora, '#ffffff', true)).toEqual({ '--pane-surface': 'rgba(255, 255, 255, 0.85)', '--file-surface': 'rgba(255, 255, 255, 0.85)', '--pane-blur': '12px', '--pane-header-bg': 'var(--bg-bar)' })
    // leitor de arquivo usa a cor do tema (não a do terminal) em vidro
    expect(paneVars(APP_THEMES.noite, '#ffffff', true)['--file-surface']).toBe('rgba(17, 18, 25, 0.85)')
  })
  it('paneVars: terminal escuro num tema claro (e vice-versa) ganha cabeçalho sólido', () => {
    expect(paneVars(APP_THEMES.aurora, '#111219', false)['--pane-header-bg']).toBe('var(--bg-raised)')
    expect(paneVars(APP_THEMES.noite, '#ffffff', true)['--pane-header-bg']).toBe('var(--bg-raised)')
    expect(paneVars(APP_THEMES.noite, '#111219', false)['--pane-header-bg']).toBe('var(--bg-bar)')
  })
})
