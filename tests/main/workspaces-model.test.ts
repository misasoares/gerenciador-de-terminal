import { describe, expect, it } from 'vitest'
import { badgeTotal, closeDialogText, closedNoticeText, decideStartup } from '../../src/main/workspaces-model'

const ws = (id: string, open = true, sessions = 0, attention = 0) => ({ id, name: id, open, sessions, attention, tabs: [], hidden: [] })

describe('workspaces-model', () => {
  it('início: 1 espaço abre direto; 2+ mostram a tela de reabrir', () => {
    expect(decideStartup([ws('principal')])).toEqual({ kind: 'direct', id: 'principal' })
    expect(decideStartup([])).toEqual({ kind: 'direct', id: 'principal' })
    expect(decideStartup([ws('a'), ws('b', false)])).toEqual({ kind: 'chooser' })
  })
  it('textos do fechar', () => {
    expect(closeDialogText('TCHEERP', 6)).toBe('Fechar a janela "TCHEERP"? As 6 sessões continuam rodando em segundo plano. Você reabre pelo menu Janela ou pelo Dock.')
    expect(closeDialogText('X', 1)).toBe('Fechar a janela "X"? A sessão continua rodando em segundo plano. Você reabre pelo menu Janela ou pelo Dock.')
    expect(closedNoticeText('TCHEERP', 6)).toBe('TCHEERP fechado · 6 sessões continuam em segundo plano')
    expect(closedNoticeText('X', 1)).toBe('X fechado · 1 sessão continua em segundo plano')
  })
  it('badge soma todos os espaços, inclusive os de janela fechada', () => {
    expect(badgeTotal([ws('a', true, 4, 2), ws('b', false, 3, 3), ws('c')])).toBe('5')
    expect(badgeTotal([ws('a', true, 2, 0)])).toBe('')
  })
})
