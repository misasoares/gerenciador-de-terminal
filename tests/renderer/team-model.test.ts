import { describe, expect, it } from 'vitest'
import { deliveryMark, feedLine, isTeamPane, isVirtualPane, leaderOfTeamPane, parseGroupInput, teamPaneId } from '../../src/renderer/src/team-model'
import type { TeamFeedItem } from '../../src/shared/types'

type Msg = Extract<TeamFeedItem, { kind: 'msg' }>
const msg = (o: Partial<Msg>): Msg => ({ kind: 'msg', id: 'm', at: 0, fromName: 'lider', toId: 'p2', toName: 'dev-1', body: 'x', interrupt: false, byUser: false, via: 'app', state: 'na-fila', error: null, ...o })
const ev = (event: Extract<TeamFeedItem, { kind: 'event' }>['event'], detail: string | null = null): TeamFeedItem => ({ kind: 'event', id: 'e', at: 0, paneId: 'p2', name: 'dev-1', event, detail, open: false })

describe('ids do painel do grupo', () => {
  it('team:<líder>', () => {
    expect(teamPaneId('L1')).toBe('team:L1')
    expect(isTeamPane('team:L1')).toBe(true)
    expect(isTeamPane('file:x')).toBe(false)
    expect(leaderOfTeamPane('team:L1')).toBe('L1')
  })
  it('painéis virtuais: arquivo e grupo', () => {
    expect(isVirtualPane('file:x')).toBe(true)
    expect(isVirtualPane('team:x')).toBe(true)
    expect(isVirtualPane('abc')).toBe(false)
  })
})

describe('parseGroupInput', () => {
  const names = ['lider', 'dev-1']
  it('@nome no começo', () => {
    expect(parseGroupInput('@dev-1 faz X', names)).toEqual({ to: 'dev-1', text: 'faz X', interrupt: false })
  })
  it('⚡ com ou sem espaço', () => {
    expect(parseGroupInput('⚡ @dev-1 para', names)).toEqual({ to: 'dev-1', text: 'para', interrupt: true })
    expect(parseGroupInput('⚡@dev-1 para', names)).toEqual({ to: 'dev-1', text: 'para', interrupt: true })
  })
  it('sem @: líder', () => {
    expect(parseGroupInput('  faz Y  ', names)).toEqual({ to: null, text: 'faz Y', interrupt: false })
  })
  it('nome com espaço: o maior que casa até espaço ou fim (RF1)', () => {
    const n = ['sessão 3', 'sessão 31']
    expect(parseGroupInput('@sessão 3 faz', n)).toEqual({ to: 'sessão 3', text: 'faz', interrupt: false })
    expect(parseGroupInput('@sessão 31 faz', n)).toEqual({ to: 'sessão 31', text: 'faz', interrupt: false })
    expect(parseGroupInput('@sessão 3\nfaz', n)).toEqual({ to: 'sessão 3', text: 'faz', interrupt: false })
  })
  it('não casa pela metade: usa a palavra inteira', () => {
    expect(parseGroupInput('@dev-1-novo oi', ['dev-1'])).toEqual({ to: 'dev-1-novo', text: 'oi', interrupt: false })
  })
  it('só o @nome', () => {
    expect(parseGroupInput('@dev-1', names)).toEqual({ to: 'dev-1', text: '', interrupt: false })
  })
})

describe('textos do grupo', () => {
  it('eventos', () => {
    expect(feedLine(ev('contratou', 'Codex'), 'lider')).toEqual({ icon: '🤝', text: 'lider contratou dev-1 (Codex)' })
    expect(feedLine(ev('demitiu'), 'lider')).toEqual({ icon: '👋', text: 'lider demitiu dev-1' })
    expect(feedLine(ev('terminou'), 'lider')).toEqual({ icon: '✅', text: 'dev-1 terminou' })
    expect(feedLine(ev('permissao'), 'lider')).toEqual({ icon: '✋', text: 'dev-1 está pedindo permissão' })
    expect(feedLine(ev('pergunta'), 'lider')).toEqual({ icon: '🔵', text: 'dev-1 está esperando você' })
    expect(feedLine(ev('travou'), 'lider')).toEqual({ icon: '⚠️', text: 'dev-1 travou' })
    expect(feedLine(ev('travou', 'limite'), 'lider')).toEqual({ icon: '⚠️', text: 'dev-1 travou: limite' })
    expect(feedLine(ev('saiu'), 'lider')).toEqual({ icon: '⏹', text: 'dev-1 saiu' })
    expect(feedLine(ev('interrompeu', 'você'), 'lider')).toEqual({ icon: '⚡', text: 'você interrompeu dev-1' })
  })
  it('mensagens', () => {
    expect(feedLine(msg({}), 'lider')).toEqual({ icon: '', text: 'lider → dev-1' })
    expect(feedLine(msg({ interrupt: true }), 'lider')).toEqual({ icon: '⚡', text: 'lider → dev-1' })
  })
  it('marca de entrega', () => {
    expect(deliveryMark(msg({ via: 'nativo', state: null }))).toBe('SendMessage')
    expect(deliveryMark(msg({ state: 'na-fila' }))).toBe('🕓')
    expect(deliveryMark(msg({ state: 'entregue' }))).toBe('✓✓')
    expect(deliveryMark(msg({ state: 'falhou', error: 'sessão encerrada' }))).toBe('✕ não entregue: sessão encerrada')
  })
})
