import type { ClaudeSession, HookPayload, SessionStatus } from '../../shared/types'

/** corpo de SendMessage que não é texto: JSON até este tamanho */
const NATIVE_BODY_MAX = 2000

/** mudança de estado que vale um evento no grupo; null = nenhuma */
export function statusEvent(prev: SessionStatus | null, next: ClaudeSession | null, p: HookPayload): 'terminou' | 'permissao' | 'pergunta' | 'travou' | null {
  if (p.hook_event_name === 'StopFailure') return 'travou'
  if (!next) return null
  if (next.status === 'needs-you' && prev !== 'needs-you') {
    const permission = p.hook_event_name === 'PermissionRequest' || (p.hook_event_name === 'Notification' && p.notification_type === 'permission_prompt')
    return permission ? 'permissao' : 'pergunta'
  }
  if (prev === 'working' && next.status === 'your-turn') return 'terminou'
  return null
}

/** SendMessage capturado no PreToolUse do Claude; null = não é SendMessage ou sem destino */
export function nativeMessage(p: HookPayload): { to: string; body: string } | null {
  if (p.hook_event_name !== 'PreToolUse' || p.tool_name !== 'SendMessage') return null
  const input = p.tool_input as { to?: unknown; message?: unknown } | undefined
  if (typeof input?.to !== 'string' || !input.to) return null
  // sem message é só inscrição para o aviso de "ficou parado" (notify_when_idle): nada foi dito
  if (input.message === undefined || input.message === '') return null
  const body = typeof input.message === 'string' ? input.message : (JSON.stringify(input.message) ?? '').slice(0, NATIVE_BODY_MAX)
  // "dev-1 [3fa9c1]": o [ref] desempata sessões com o mesmo nome; o grupo acha o membro pelo nome
  return { to: input.to.replace(/ \[[^\]]*\]$/, ''), body }
}
