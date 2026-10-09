import { describe, expect, it } from 'vitest'
import { updatedNotice, updateItem } from '../../src/renderer/src/update-model'

describe('item de atualização na barra de status', () => {
  it('pronta: Atualizar + novidades', () => {
    expect(updateItem({ kind: 'ready', version: '0.2.0', notes: 'n' }, 'darwin')).toEqual({
      text: '● Versão 0.2.0 pronta',
      tone: 'info',
      action: { label: 'Atualizar', run: 'install' },
      notes: true,
    })
  })
  it('.deb/.rpm: Baixar abre a release', () => {
    expect(updateItem({ kind: 'notify-only', version: '0.2.0', notes: '', url: 'u' }, 'linux')).toMatchObject({
      text: '● Versão 0.2.0 disponível',
      action: { label: 'Baixar', run: 'open-release' },
      notes: true,
    })
  })
  it('bloqueada: diz o que fazer, por sistema', () => {
    expect(updateItem({ kind: 'blocked', version: '0.2.0', reason: 'not-writable' }, 'darwin')!.text).toBe('Versão 0.2.0 disponível · mova o app para Aplicativos para atualizar')
    expect(updateItem({ kind: 'blocked', version: '0.2.0', reason: 'not-writable' }, 'linux')!.text).toBe('Versão 0.2.0 disponível · mova o AppImage para uma pasta sua para atualizar')
  })
  it('falhou: aviso sem ação', () => {
    expect(updateItem({ kind: 'failed-last', to: '0.2.0', current: '0.1.0' }, 'darwin')).toEqual({
      text: 'A atualização para 0.2.0 falhou; você continua na 0.1.0',
      tone: 'warn',
      action: null,
      notes: false,
    })
  })
  it('ocioso: nada', () => {
    expect(updateItem({ kind: 'idle' }, 'darwin')).toBeNull()
  })
})

describe('aviso depois de atualizar', () => {
  it('singular, plural e nenhuma sessão', () => {
    expect(updatedNotice('0.2.0', 5)).toBe('Atualizado para 0.2.0 · 5 sessões retomadas')
    expect(updatedNotice('0.2.0', 1)).toBe('Atualizado para 0.2.0 · 1 sessão retomada')
    expect(updatedNotice('0.2.0', 0)).toBe('Atualizado para 0.2.0')
  })
})
