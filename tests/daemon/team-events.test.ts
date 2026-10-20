import { describe, expect, it } from 'vitest'
import { nativeMessage, statusEvent } from '../../src/daemon/team/events'
import { reduceSession } from '../../src/daemon/session'
import type { ClaudeSession, HookPayload, SessionStatus } from '../../src/shared/types'

const ev = (hook_event_name: string, extra: Partial<HookPayload> = {}): HookPayload => ({ hook_event_name, session_id: 's', cwd: '/w', ...extra })
const sess = (status: SessionStatus): ClaudeSession => ({ sessionId: 's', agent: 'claude', status, statusSince: 1, title: null, transcriptPath: null })
/** estado anterior → hook → evento, passando pelo reduceSession de verdade */
const run = (prev: SessionStatus, p: HookPayload) => statusEvent(prev, reduceSession(sess(prev), p, 2), p)

describe('statusEvent', () => {
  it('terminou: de working para your-turn', () => {
    expect(run('working', ev('Stop'))).toBe('terminou')
    expect(run('idle', ev('Stop'))).toBeNull()
  })
  it('permissão e pergunta ao entrar em needs-you', () => {
    expect(run('working', ev('PermissionRequest'))).toBe('permissao')
    expect(run('working', ev('Notification', { notification_type: 'permission_prompt' }))).toBe('permissao')
    expect(run('working', ev('PreToolUse', { tool_name: 'AskUserQuestion' }))).toBe('pergunta')
    expect(run('needs-you', ev('PermissionRequest'))).toBeNull()
  })
  it('travou: StopFailure', () => {
    expect(run('working', ev('StopFailure'))).toBe('travou')
  })
  it('outras mudanças não viram evento', () => {
    expect(run('your-turn', ev('UserPromptSubmit'))).toBeNull()
    expect(statusEvent('working', null, ev('SessionEnd'))).toBeNull()
  })
})

describe('nativeMessage', () => {
  it('SendMessage com destino e texto', () => {
    expect(nativeMessage(ev('PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'dev-1', message: 'oi' } }))).toEqual({ to: 'dev-1', body: 'oi' })
  })
  it('mensagem que não é texto vira JSON, cortado em 2000', () => {
    expect(nativeMessage(ev('PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'dev-1', message: { type: 'shutdown_request' } } }))).toEqual({ to: 'dev-1', body: '{"type":"shutdown_request"}' })
    expect(nativeMessage(ev('PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'dev-1', message: { t: 'x'.repeat(5000) } } }))!.body).toHaveLength(2000)
  })
  it('só inscrição de aviso (sem message): não é mensagem', () => {
    expect(nativeMessage(ev('PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'dev-1', notify_when_idle: true } }))).toBeNull()
    expect(nativeMessage(ev('PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'dev-1', message: '', notify_when_idle: true } }))).toBeNull()
  })
  it('destino com [ref] vira só o nome', () => {
    expect(nativeMessage(ev('PreToolUse', { tool_name: 'SendMessage', tool_input: { to: 'dev-1 [3fa9c1]', message: 'oi' } }))).toEqual({ to: 'dev-1', body: 'oi' })
  })
  it('sem destino, outra ferramenta ou outro evento: null', () => {
    expect(nativeMessage(ev('PreToolUse', { tool_name: 'SendMessage', tool_input: { message: 'oi' } }))).toBeNull()
    expect(nativeMessage(ev('PreToolUse', { tool_name: 'Bash', tool_input: { to: 'dev-1', message: 'oi' } }))).toBeNull()
    expect(nativeMessage(ev('PostToolUse', { tool_name: 'SendMessage', tool_input: { to: 'dev-1', message: 'oi' } }))).toBeNull()
  })
})
