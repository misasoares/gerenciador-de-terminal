import { describe, expect, it } from 'vitest'
import { filterConversations, isMissing, normalize, relativeTime } from '../../src/renderer/src/conversations-model'
import type { ConversationInfo } from '../../src/shared/types'

const c = (sessionId: string, title: string, branch: string | null = null): ConversationInfo => ({ agent: 'claude', sessionId, cwd: '/r', title, branch, lastActivity: 0, messages: 1, accountIds: [], openPaneId: null })

describe('conversations-model', () => {
  it('filtro sem acento e sem diferenciar maiúsculas, também pela branch', () => {
    const list = [c('a', 'Configuração do login'), c('b', 'build quebrado', 'feat/agenda-google'), c('c', 'outra')]
    expect(normalize('ÇÃo')).toBe('cao')
    expect(filterConversations(list, 'configuracao').map((x) => x.sessionId)).toEqual(['a'])
    expect(filterConversations(list, 'AGENDA').map((x) => x.sessionId)).toEqual(['b'])
    expect(filterConversations(list, '  ')).toHaveLength(3)
  })

  it('horário relativo', () => {
    const now = new Date(2026, 9, 1, 15, 0).getTime()
    expect(relativeTime(now - 20_000, now)).toBe('agora')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('há 5 min')
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe('há 2 h')
    expect(relativeTime(new Date(2026, 8, 30, 14, 10).getTime(), now)).toBe('ontem 14:10')
    expect(relativeTime(new Date(2026, 8, 20, 9, 5).getTime(), now)).toBe('20/09 09:05')
  })

  it('isMissing reconhece o erro do daemon', () => {
    expect(isMissing(new Error('conversation-missing'))).toBe(true)
    expect(isMissing(new Error('outra coisa'))).toBe(false)
  })
})
