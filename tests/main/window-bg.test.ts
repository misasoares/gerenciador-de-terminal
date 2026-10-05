import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readWindowBg, writeWindowBg } from '../../src/main/window-bg'

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-bg-')), 'window-bg')

describe('fundo das janelas na abertura do app', () => {
  it('sem arquivo → fundo do Padrão', () => {
    expect(readWindowBg(tmp())).toBe('#1e1e1e')
  })
  it('lembra o último fundo gravado (o Claro abre branco desde o primeiro quadro)', () => {
    const f = tmp()
    writeWindowBg(f, '#ffffff')
    expect(readWindowBg(f)).toBe('#ffffff')
  })
  it('conteúdo inválido no arquivo → fundo do Padrão; valor inválido não é gravado', () => {
    const f = tmp()
    fs.writeFileSync(f, 'red; drop')
    expect(readWindowBg(f)).toBe('#1e1e1e')
    writeWindowBg(f, 'url(x)')
    expect(fs.readFileSync(f, 'utf8')).toBe('red; drop')
  })
})
