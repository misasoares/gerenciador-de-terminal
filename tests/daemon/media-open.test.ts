import { describe, expect, it } from 'vitest'
import { parseOpenMedia } from '../../src/daemon/media-open'

const files = new Set(['/p/a.png', '/p/b.png', '/Volumes/SSD MISA/x/ç.png', '/h/s.jpg', '/p/n.txt'])
const o = { cwd: '/p', home: '/h', isFile: (p: string) => files.has(p) }

describe('abrir_midia: argumentos', () => {
  it('caminhos: cada um vira um grupo; relativo resolve pelo cwd; ~/ pela home', () => {
    expect(parseOpenMedia({ caminhos: ['a.png', '~/s.jpg'] }, o)).toEqual({ groups: [['/p/a.png'], ['/h/s.jpg']], labels: null, titles: null })
  })
  it('grupos com rótulos e títulos; espaço e acento no caminho passam', () => {
    expect(parseOpenMedia({ grupos: [['/p/a.png', '/Volumes/SSD MISA/x/ç.png']], rotulos: ['iOS', 'Android'], titulos: ['home'] }, o)).toEqual({
      groups: [['/p/a.png', '/Volumes/SSD MISA/x/ç.png']],
      labels: ['iOS', 'Android'],
      titles: ['home'],
    })
  })
  it('recusa a chamada inteira listando os caminhos ruins', () => {
    expect(() => parseOpenMedia({ caminhos: ['/p/a.png', '/p/zz.png', '/p/n.txt'] }, o)).toThrow(
      'não abri nada: /p/zz.png (não existe), /p/n.txt (não é imagem, vídeo, áudio ou PDF)',
    )
  })
  it('formato inválido', () => {
    for (const bad of [{}, { caminhos: [] }, { grupos: [] }, { grupos: [[]] }, { caminhos: ['a.png'], grupos: [['a.png']] }, { caminhos: 'a.png' }, { grupos: [['a.png']], rotulos: [1] }])
      expect(() => parseOpenMedia(bad, o)).toThrow('passe caminhos (lista) ou grupos (lista de listas)')
  })
})
