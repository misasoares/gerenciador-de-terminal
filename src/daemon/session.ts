import type { ClaudeSession, HookPayload } from '../shared/types'

const NEEDS_YOU_NOTIFICATIONS = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input'])

export function reduceSession(prev: ClaudeSession | null, p: HookPayload): ClaudeSession | null {
  const ev = p.hook_event_name
  if (ev === 'SessionEnd') return null
  const base: ClaudeSession =
    prev && prev.sessionId === p.session_id
      ? prev
      : { sessionId: p.session_id, status: 'idle', title: null, transcriptPath: null }
  const next: ClaudeSession = { ...base, transcriptPath: p.transcript_path ?? base.transcriptPath }

  switch (ev) {
    case 'SessionStart':
      return p.source === 'compact' ? next : { ...next, status: 'idle' }
    case 'UserPromptSubmit':
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return { ...next, status: 'working' }
    case 'PreToolUse':
      return { ...next, status: p.tool_name === 'AskUserQuestion' ? 'needs-you' : 'working' }
    case 'PermissionRequest':
      return { ...next, status: 'needs-you' }
    case 'Notification':
      // Esc/Ctrl+C não dispara Stop; o idle_prompt (~60s parado) corrige o estado
      if (p.notification_type === 'idle_prompt') return { ...next, status: 'idle' }
      return NEEDS_YOU_NOTIFICATIONS.has(p.notification_type ?? '') ? { ...next, status: 'needs-you' } : next
    case 'Stop':
    case 'StopFailure':
      return { ...next, status: 'idle' }
    default:
      return next
  }
}
