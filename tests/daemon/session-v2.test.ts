import { describe, expect, it } from 'vitest'
import { markSeen, reduceSession } from '../../src/daemon/session'
import type { ClaudeSession, HookPayload } from '../../src/shared/types'

const ev = (hook_event_name: string, extra: Partial<HookPayload> = {}): HookPayload => ({ hook_event_name, session_id: 's1', cwd: '/p', ...extra })
const run = (events: [HookPayload, number][]) => events.reduce<ClaudeSession | null>((s, [e, t]) => reduceSession(s, e, t), null)

describe('estado 🔵 sua vez', () => {
  it('Stop e StopFailure viram your-turn', () => {
    expect(run([[ev('UserPromptSubmit'), 1], [ev('Stop'), 2]])?.status).toBe('your-turn')
    expect(run([[ev('UserPromptSubmit'), 1], [ev('StopFailure'), 2]])?.status).toBe('your-turn')
  })

  it('idle_prompt vira your-turn, a não ser que já tenha sido visto', () => {
    const working = run([[ev('UserPromptSubmit'), 1]])
    expect(reduceSession(working, ev('Notification', { notification_type: 'idle_prompt' }), 2)?.status).toBe('your-turn')
    const seen = markSeen(run([[ev('UserPromptSubmit'), 1], [ev('Stop'), 2]]), 3)
    expect(seen?.status).toBe('idle')
    expect(reduceSession(seen, ev('Notification', { notification_type: 'idle_prompt' }), 4)?.status).toBe('idle')
  })

  it('statusSince muda só quando o estado muda', () => {
    const a = run([[ev('UserPromptSubmit'), 10], [ev('PreToolUse', { tool_name: 'Bash' }), 20], [ev('PostToolUse'), 30]])
    expect(a).toMatchObject({ status: 'working', statusSince: 10 })
    expect(reduceSession(a, ev('Stop'), 40)).toMatchObject({ status: 'your-turn', statusSince: 40 })
  })

  it('markSeen só mexe em your-turn', () => {
    const turn = run([[ev('UserPromptSubmit'), 1], [ev('Stop'), 2]])
    expect(markSeen(turn, 5)).toMatchObject({ status: 'idle', statusSince: 5 })
    const perm = run([[ev('PermissionRequest'), 1]])
    expect(markSeen(perm, 5)).toBe(perm)
    expect(markSeen(null, 5)).toBeNull()
  })
})
