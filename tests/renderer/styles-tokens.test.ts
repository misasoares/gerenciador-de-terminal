import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_THEMES, TOKEN_NAMES } from '../../src/renderer/src/app-themes'

const css = readFileSync('src/renderer/src/styles.css', 'utf8')
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
const body = css.slice(css.indexOf('}', css.indexOf(':root {')) + 1)
/** cores que são da mídia, não do tema: fundo de vídeo e de pdf */
const ALLOWED = [/\.media-video video \{[^}]*#000/, /\.media-pdf \{[^}]*#fff/]

describe('styles.css usa só tokens', () => {
  it('sem cor literal fora do :root (exceto as de mídia documentadas)', () => {
    const bad = body
      .split('\n')
      .filter((l) => /#[0-9a-f]{3,8}\b|rgba?\(\s*\d/i.test(l) && !ALLOWED.some((re) => re.test(l)))
      .map((l) => l.trim())
    expect(bad).toEqual([])
  })
  it(':root só tem declarações válidas (uma linha estranha engoliria a declaração seguinte)', () => {
    const lines = root.split('\n').slice(1).map((l) => l.trim()).filter((l) => l && !l.startsWith('/*'))
    const ok = /^(--[a-z-]+: .+|font-family: var\(--font-ui\)|font-size: var\(--text-base\)|color: var\(--fg\));$/
    expect(lines.filter((l) => !ok.test(l))).toEqual([])
  })
  it(':root traz exatamente os valores do tema Padrão (primeira pintura sem JS = Padrão)', () => {
    for (const k of TOKEN_NAMES) expect(root, k).toContain(`--${k}: ${APP_THEMES.padrao.tokens[k]};`)
  })
})
