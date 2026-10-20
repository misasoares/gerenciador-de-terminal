import type { TeamFeedItem } from '../../shared/types'

export const isTeamPane = (id: string): boolean => id.startsWith('team:')
export const teamPaneId = (leaderId: string): string => `team:${leaderId}`
export const leaderOfTeamPane = (id: string): string => id.slice('team:'.length)
/** painel que não é sessão (arquivo ou grupo): fica de fora das contas de sessão */
export const isVirtualPane = (id: string): boolean => id.startsWith('file:') || isTeamPane(id)

/** "⚡ @dev-1 faz X": interromper, destinatário (o maior nome que casa; nome com espaço vale) e texto; sem @ = líder */
export function parseGroupInput(raw: string, names: string[]): { to: string | null; text: string; interrupt: boolean } {
  let s = raw.trim()
  const interrupt = s.startsWith('⚡')
  if (interrupt) s = s.slice('⚡'.length).trimStart()
  if (!s.startsWith('@')) return { to: null, text: s, interrupt }
  const rest = s.slice(1)
  const name = names
    .filter((n) => rest.startsWith(n) && (rest.length === n.length || /\s/.test(rest[n.length])))
    .sort((a, b) => b.length - a.length)[0]
  // @ que não casa com ninguém: a palavra vai como destino e o daemon responde o erro
  const to = name ?? rest.split(/\s/)[0]
  return { to, text: rest.slice(to.length).trim(), interrupt }
}

export function feedLine(item: TeamFeedItem, leaderName: string): { icon: string; text: string } {
  if (item.kind === 'msg') return { icon: item.interrupt ? '⚡' : '', text: `${item.fromName} → ${item.toName}` }
  const n = item.name
  switch (item.event) {
    case 'contratou':
      return { icon: '🤝', text: `${leaderName} contratou ${n}${item.detail ? ` (${item.detail})` : ''}` }
    case 'demitiu':
      return { icon: '👋', text: `${leaderName} demitiu ${n}` }
    case 'terminou':
      return { icon: '✅', text: `${n} terminou` }
    case 'permissao':
      return { icon: '✋', text: `${n} está pedindo permissão` }
    case 'pergunta':
      return { icon: '🔵', text: `${n} está esperando você` }
    case 'travou':
      return { icon: '⚠️', text: `${n} travou${item.detail ? `: ${item.detail}` : ''}` }
    case 'saiu':
      return { icon: '⏹', text: `${n} saiu` }
    case 'interrompeu':
      return { icon: '⚡', text: `${item.detail ?? leaderName} interrompeu ${n}` }
  }
}

export function deliveryMark(item: Extract<TeamFeedItem, { kind: 'msg' }>): string {
  if (item.via === 'nativo') return 'SendMessage'
  if (item.state === 'entregue') return '✓✓'
  if (item.state === 'falhou') return `✕ não entregue: ${item.error ?? ''}`
  return '🕓'
}
