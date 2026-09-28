import type { ClaudeSession, HookPayload, SessionStatus } from '../shared/types'

const NEEDS_YOU_NOTIFICATIONS = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input'])

function withStatus(s: ClaudeSession, status: SessionStatus, now: number): ClaudeSession {
  return s.status === status ? s : { ...s, status, statusSince: now }
}

export function reduceSession(prev: ClaudeSession | null, p: HookPayload, now = Date.now()): ClaudeSession | null {
  const ev = p.hook_event_name
  if (ev === 'SessionEnd') return null
  const base: ClaudeSession =
    prev && prev.sessionId === p.session_id
      ? prev
      : { sessionId: p.session_id, status: 'idle', statusSince: now, title: null, transcriptPath: null }
  const next: ClaudeSession = { ...base, transcriptPath: p.transcript_path ?? base.transcriptPath }

  switch (ev) {
    case 'SessionStart':
      return p.source === 'compact' ? next : withStatus(next, 'idle', now)
    case 'UserPromptSubmit':
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return withStatus(next, 'working', now)
    case 'PreToolUse':
      return withStatus(next, p.tool_name === 'AskUserQuestion' ? 'needs-you' : 'working', now)
    case 'PermissionRequest':
      return withStatus(next, 'needs-you', now)
    case 'Notification':
      // Esc/Ctrl+C não dispara Stop; o idle_prompt (~60s parado) avisa que é a vez do usuário
      if (p.notification_type === 'idle_prompt') return next.status === 'idle' ? next : withStatus(next, 'your-turn', now)
      return NEEDS_YOU_NOTIFICATIONS.has(p.notification_type ?? '') ? withStatus(next, 'needs-you', now) : next
    case 'Stop':
    case 'StopFailure':
      return withStatus(next, 'your-turn', now)
    default:
      return next
  }
}

/** o usuário focou o painel: 🔵 vira ⚪; os outros estados não mudam */
export function markSeen(s: ClaudeSession | null, now = Date.now()): ClaudeSession | null {
  if (!s || s.status !== 'your-turn') return s
  return { ...s, status: 'idle', statusSince: now }
}
