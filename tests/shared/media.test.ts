import { describe, expect, it } from 'vitest'
import { mediaKind, mediaUrl, pathFromMediaUrl } from '../../src/shared/media'

describe('media', () => {
  it('tipo pela extensão (sem diferenciar maiúsculas); texto e desconhecido → null', () => {
    expect(mediaKind('/a/print.PNG')).toBe('image')
    expect(['x.jpg', 'x.jpeg', 'x.gif', 'x.webp', 'x.svg', 'x.avif', 'x.bmp', 'x.ico'].map(mediaKind)).toEqual(Array(8).fill('image'))
    expect(['x.mp4', 'x.mov', 'x.webm', 'x.m4v'].map(mediaKind)).toEqual(Array(4).fill('video'))
    expect(['x.mp3', 'x.wav', 'x.m4a', 'x.ogg', 'x.flac', 'x.aac'].map(mediaKind)).toEqual(Array(6).fill('audio'))
    expect(mediaKind('/docs/contrato.pdf')).toBe('pdf')
    expect(mediaKind('/a/README.md')).toBeNull()
    expect(mediaKind('/a/sem-extensao')).toBeNull()
  })
  it('endereço do protocolo: ida e volta com espaço, acento, # e ?', () => {
    const p = '/Volumes/SSD MISA/apps/ação #1/foto?v=2.png'
    const u = mediaUrl(p, 0)
    expect(u.startsWith('gt-file://local/')).toBe(true)
    expect(u).not.toContain(' ')
    expect(pathFromMediaUrl(u)).toBe(p)
  })
  it('versão (mtime) muda o endereço para recarregar sem cache', () => {
    expect(mediaUrl('/a/b.png', 1)).not.toBe(mediaUrl('/a/b.png', 2))
    expect(pathFromMediaUrl(mediaUrl('/a/b.png', 2))).toBe('/a/b.png')
  })
  it('endereço de outro host ou esquema não vira caminho', () => {
    expect(pathFromMediaUrl('gt-file://outro/etc/passwd')).toBeNull()
    expect(pathFromMediaUrl('https://local/etc/passwd')).toBeNull()
  })
})
