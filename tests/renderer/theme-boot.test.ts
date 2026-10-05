import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const html = readFileSync('src/renderer/index.html', 'utf8')
const head = html.slice(0, html.indexOf('</head>'))

describe('tema antes da primeira pintura', () => {
  it('index.html carrega theme-boot.js no <head>, síncrono (não módulo, sem defer/async)', () => {
    expect(head).toMatch(/<script src="\.\/theme-boot\.js"><\/script>/)
  })
  it('theme-boot.js lê o mesmo cache que appearance.ts (gt-theme) e falha em silêncio', () => {
    const boot = readFileSync('src/renderer/public/theme-boot.js', 'utf8')
    const appearance = readFileSync('src/renderer/src/appearance.ts', 'utf8')
    expect(appearance).toContain("const KEY = 'gt-theme'")
    expect(boot).toContain("'gt-theme'")
    expect(boot).toMatch(/try\s*\{/)
  })
})
