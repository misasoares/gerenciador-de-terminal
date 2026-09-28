import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { reduceSession } from '../../src/daemon/session'
import { readTitle } from '../../src/daemon/title'
import type { ClaudeSession, HookPayload } from '../../src/shared/types'

const ev = (hook_event_name: string, extra: Partial<HookPayload> = {}): HookPayload => ({ hook_event_name, session_id: 's1', cwd: '/p', ...extra })

function run(events: HookPayload[]): ClaudeSession | null {
  return events.reduce<ClaudeSession | null>((s, e) => reduceSession(s, e), null)
}

describe('reduceSession', () => {
  it('ciclo normal de um turno', () => {
    expect(run([ev('SessionStart')])?.status).toBe('idle')
    expect(run([ev('SessionStart'), ev('UserPromptSubmit')])?.status).toBe('working')
    expect(run([ev('SessionStart'), ev('UserPromptSubmit'), ev('PreToolUse', { tool_name: 'Bash' }), ev('PostToolUse')])?.status).toBe('working')
    expect(run([ev('SessionStart'), ev('UserPromptSubmit'), ev('Stop')])?.status).toBe('your-turn')
  })

  it('precisa de você: permissão, pergunta e notificações', () => {
    expect(run([ev('UserPromptSubmit'), ev('PermissionRequest')])?.status).toBe('needs-you')
    expect(run([ev('UserPromptSubmit'), ev('PreToolUse', { tool_name: 'AskUserQuestion' })])?.status).toBe('needs-you')
    expect(run([ev('UserPromptSubmit'), ev('Notification', { notification_type: 'permission_prompt' })])?.status).toBe('needs-you')
    expect(run([ev('UserPromptSubmit'), ev('Notification', { notification_type: 'auth_success' })])?.status).toBe('working')
  })

  it('SessionStart de compact no meio do trabalho mantém o estado', () => {
    expect(run([ev('UserPromptSubmit'), ev('SessionStart', { source: 'compact' })])?.status).toBe('working')
  })

  it('evento sem SessionStart cria a sessão (app aberto no meio)', () => {
    expect(run([ev('PostToolUse', { transcript_path: '/t.jsonl' })])).toEqual({ sessionId: 's1', agent: 'claude', status: 'working', statusSince: expect.any(Number), title: null, transcriptPath: '/t.jsonl' })
  })

  it('/clear troca o id e zera o título; SessionEnd encerra', () => {
    const a = { ...run([ev('SessionStart')])!, title: 'velho' }
    const b = reduceSession(a, ev('SessionStart', { session_id: 's2', source: 'clear' }))
    expect(b).toMatchObject({ sessionId: 's2', title: null })
    expect(reduceSession(b, ev('SessionEnd'))).toBeNull()
  })

  it('CwdChanged não mexe no estado', () => {
    expect(run([ev('UserPromptSubmit'), ev('CwdChanged')])?.status).toBe('working')
  })
})

describe('readTitle', () => {
  it('prefere o título manual (/rename) ao título gerado', async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-t-')), 't.jsonl')
    fs.writeFileSync(f, [
      JSON.stringify({ type: 'user', message: 'oi' }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Título gerado', sessionId: 's1' }),
      JSON.stringify({ type: 'custom-title', customTitle: 'meu nome', sessionId: 's1' }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Outro gerado', sessionId: 's1' }),
      '',
    ].join('\n'))
    expect(await readTitle(f)).toBe('meu nome')
  })
  it('usa o último título gerado quando não há manual; arquivo ausente → null', async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-t-')), 't.jsonl')
    fs.writeFileSync(f, JSON.stringify({ type: 'ai-title', aiTitle: 'A' }) + '\n' + JSON.stringify({ type: 'ai-title', aiTitle: 'B' }) + '\n')
    expect(await readTitle(f)).toBe('B')
    expect(await readTitle('/nao/existe.jsonl')).toBeNull()
  })
})
