import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fitWidth, listBackgrounds, removeBackground, userBgName } from '../../src/main/backgrounds'

describe('imagens de fundo do usuário', () => {
  it('fitWidth: reduz mantendo a proporção; menor que o limite fica como está', () => {
    expect(fitWidth(8064, 6048)).toEqual({ width: 2560, height: 1920 })
    expect(fitWidth(1920, 1080)).toEqual({ width: 1920, height: 1080 })
  })
  it('nome = 16 hex do sha256 do conteúdo (a mesma imagem não duplica)', () => {
    const a = userBgName(Buffer.from('x')), b = userBgName(Buffer.from('x'))
    expect(a).toMatch(/^[a-f0-9]{16}\.jpg$/)
    expect(a).toBe(b)
    expect(userBgName(Buffer.from('y'))).not.toBe(a)
  })
  it('listar ignora nomes fora do formato; remover só apaga nome válido', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-fundos-'))
    fs.writeFileSync(path.join(dir, '0123456789abcdef.jpg'), 'a')
    fs.writeFileSync(path.join(dir, 'outra.png'), 'b')
    expect(listBackgrounds(dir).list).toEqual(['0123456789abcdef.jpg'])
    expect(removeBackground(dir, '../outra.png')).toBe(false)
    expect(removeBackground(dir, '0123456789abcdef.jpg')).toBe(true)
    expect(listBackgrounds(dir).list).toEqual([])
    expect(listBackgrounds(path.join(dir, 'nao-existe')).list).toEqual([])
  })
})
