import { describe, expect, it } from 'vitest'
import { cascade, fitBounds, floatHome, floatWindowOptions, syncFloats, windowOpacity } from '../../src/main/float-model'

const spec = (paneId: string, over = {}) => ({ paneId, bounds: null, onTop: true, allDesks: false, opacity: 1, ...over })
const ws = (id: string, floating: ReturnType<typeof spec>[]) => ({ id, name: id, open: true, sessions: 0, attention: 0, tabs: [], hidden: [], floating })

describe('float-model', () => {
  it('sync: abre as que faltam, fecha as que saíram, atualiza prefs; ignora espaço não ativado', () => {
    const summary = [ws('a', [spec('p1'), spec('p2', { onTop: false })]), ws('b', [spec('p3')])]
    const openNow = new Map([['p2', spec('p2')], ['p9', spec('p9')]])
    const r = syncFloats(summary, new Set(['a']), openNow)
    expect(r.open).toEqual([{ ...spec('p1'), wsId: 'a' }])
    expect(r.close).toEqual(['p9'])
    expect(r.update).toEqual([{ ...spec('p2', { onTop: false }), wsId: 'a' }])
  })
  it('sync: mudar só a opacidade também atualiza a janela', () => {
    const r = syncFloats([ws('a', [spec('p1', { opacity: 0.5 })])], new Set(['a']), new Map([['p1', spec('p1')]]))
    expect(r.update).toEqual([{ ...spec('p1', { opacity: 0.5 }), wsId: 'a' }])
  })
  it('janelas aceitam o primeiro clique (⌘+clique numa janela inativa chega ao terminal)', () => {
    expect(floatWindowOptions({ x: 0, y: 0, width: 640, height: 400 }, false)).toMatchObject({ acceptFirstMouse: true })
  })
  it('mac: vidro sempre ativo por trás (mesmo sem foco) e fundo da janela transparente; linux sem vidro', () => {
    const b = { x: 0, y: 0, width: 640, height: 400 }
    expect(floatWindowOptions(b, true)).toMatchObject({ vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: '#00000000' })
    expect(floatWindowOptions(b, false)).not.toHaveProperty('vibrancy')
    expect(floatWindowOptions(b, false)).toMatchObject({ backgroundColor: '#1e1e1e' })
  })
  it('opacidade: no mac é do fundo (a janela fica inteira); no linux é da janela, com piso', () => {
    expect(windowOpacity(0, true)).toBe(1)
    expect(windowOpacity(0.5, true)).toBe(1)
    expect(windowOpacity(0.5, false)).toBe(0.5)
    expect(windowOpacity(0, false)).toBe(0.3)
  })
  it('fitBounds: fora de qualquer monitor volta ao padrão', () => {
    const screen = { x: 0, y: 0, width: 1440, height: 900 }
    const fb = { x: 100, y: 100, width: 640, height: 400 }
    expect(fitBounds({ x: 3000, y: 100, width: 640, height: 400 }, [screen], fb)).toEqual(fb)
    expect(fitBounds(null, [screen], fb)).toEqual(fb)
    expect(fitBounds({ x: 10, y: 10, width: 640, height: 400 }, [screen], fb)).toEqual({ x: 10, y: 10, width: 640, height: 400 })
  })
  it('cascata e posição inicial no canto superior direito', () => {
    expect(cascade({ x: 0, y: 0, width: 640, height: 400 }, 2)).toEqual({ x: 60, y: 60, width: 640, height: 400 })
    expect(floatHome({ x: 0, y: 0, width: 1440, height: 900 }, { x: 0, y: 0, width: 1440, height: 900 }, 0)).toEqual({ x: 776, y: 24, width: 640, height: 400 })
  })
  it('janela flutuante nunca vira tela cheia (sem moldura não teria como sair)', () => {
    const o = floatWindowOptions({ x: 1, y: 2, width: 640, height: 400 }, true)
    expect(o).toMatchObject({ x: 1, y: 2, width: 640, height: 400, frame: false, fullscreenable: false, minWidth: 320, minHeight: 180 })
  })
})
