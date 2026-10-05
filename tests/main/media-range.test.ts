import { describe, expect, it } from 'vitest'
import { contentType, parseRange } from '../../src/main/media-protocol'

describe('media-protocol', () => {
  it('Range: início-fim, início aberto, sufixo; inválido ou fora → null', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 })
    expect(parseRange('bytes=2000-', 1000)).toBeNull()
    expect(parseRange('lixo', 1000)).toBeNull()
    expect(parseRange(null, 1000)).toBeNull()
  })
  it('tipo de conteúdo pela extensão', () => {
    expect(contentType('/a/b.PNG')).toBe('image/png')
    expect(contentType('/a/b.svg')).toBe('image/svg+xml')
    expect(contentType('/a/b.mov')).toBe('video/quicktime')
    expect(contentType('/a/b.m4a')).toBe('audio/mp4')
    expect(contentType('/a/b.pdf')).toBe('application/pdf')
    expect(contentType('/a/b.xyz')).toBe('application/octet-stream')
  })
})
