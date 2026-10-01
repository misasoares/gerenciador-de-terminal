import { describe, expect, it } from 'vitest'
import { findPathCandidates, linkRange } from '../../src/renderer/src/file-links'

const paths = (s: string) => findPathCandidates(s).map((c) => [c.path, c.line])

describe('findPathCandidates', () => {
  it('relativo, absoluto, :N e :N:M', () => {
    expect(paths('O relatório parcial está em .private/revisao-interna/frente-a-projetos.md.')).toEqual([['.private/revisao-interna/frente-a-projetos.md', null]])
    expect(paths('erro em src/app.ts:42 e /Users/u/x/y.json:3:7')).toEqual([['src/app.ts', 42], ['/Users/u/x/y.json', 3]])
  })
  it('.env sozinho, ./x e nome com extensão conhecida', () => {
    expect(paths('edite o .env, depois ./scripts/run e README.md')).toEqual([['.env', null], ['./scripts/run', null], ['README.md', null]])
  })
  it('pontuação final e parênteses', () => {
    expect(paths('(veja docs/a.md), docs/b.md: ok; docs/c.md!')).toEqual([['docs/a.md', null], ['docs/b.md', null], ['docs/c.md', null]])
  })
  it('caminho com espaço entre aspas', () => {
    expect(paths('abra "/Volumes/SSD MISA/x/notas.md" agora')).toEqual([['/Volumes/SSD MISA/x/notas.md', null]])
  })
  it('ignora URL, versão, e.g. e palavras soltas', () => {
    expect(paths('https://github.com/a/b.md www.x.com/a.md v1.2.3 1.2.3 e.g. i.e. ok')).toEqual([])
  })
  it('start/end cobrem o texto, incluindo :N', () => {
    const line = 'x src/app.ts:42 y'
    const [c] = findPathCandidates(line)
    expect(line.slice(c.start, c.end)).toBe('src/app.ts:42')
    expect(c.text).toBe('src/app.ts:42')
  })
})

describe('linkRange (linha quebrada pelo terminal)', () => {
  it('converte índices da linha lógica em coordenadas do xterm (1-based, fim inclusivo)', () => {
    // 10 colunas; a linha lógica começa na linha 5 da tela
    expect(linkRange(2, 6, 5, 10)).toEqual({ start: { x: 3, y: 5 }, end: { x: 6, y: 5 } })
    expect(linkRange(8, 14, 5, 10)).toEqual({ start: { x: 9, y: 5 }, end: { x: 4, y: 6 } })
    expect(linkRange(10, 20, 5, 10)).toEqual({ start: { x: 1, y: 6 }, end: { x: 10, y: 6 } })
  })
})
