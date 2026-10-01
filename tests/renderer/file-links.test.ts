import { describe, expect, it } from 'vitest'
import { findPathCandidates } from '../../src/renderer/src/file-links'

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
