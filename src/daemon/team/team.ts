import type { AgentKind } from '../../shared/types'
import { profileOf } from '../agent-profiles'
import type { PaneMetaEntry } from '../persist'

type Meta = Record<string, PaneMetaEntry>

/** líder da equipe do painel: ele mesmo se for líder, senão quem o contratou; null = fora de equipe */
export function teamLeaderOf(paneId: string, meta: Meta): string | null {
  const m = meta[paneId]
  if (m?.leader === true) return paneId
  return m?.createdBy ?? null
}

export function sameTeam(a: string, b: string, meta: Meta): boolean {
  const la = teamLeaderOf(a, meta)
  return la !== null && la === teamLeaderOf(b, meta)
}

/** rótulo da sessão: o nome, ou "sessão <seq>"; é por ele que as ferramentas acham o destinatário */
export function displayName(r: { id: string; seq: number }, meta: Meta): string {
  return meta[r.id]?.name ?? `sessão ${r.seq}`
}

/** corpo do remetente: sem marcadores do app ([equipe], [gerenciador]) nem caracteres de controle C0/C1 além de \n e \t */
export function sanitizeBody(text: string): string {
  return text.replace(/\[(equipe|gerenciador)\]/gi, '($1)').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
}

/** cabeçalho montado pelo app: o remetente nunca escreve o próprio */
export function teamHeader(o: { fromName: string; fromAgent: AgentKind; toName: string; toAgent: AgentKind; text: string }): string {
  const nativo = profileOf(o.fromAgent).nativeTeam && profileOf(o.toAgent).nativeTeam
  const reply = nativo ? `SendMessage(to: "${o.fromName}")` : `mandar_mensagem(para: "${o.fromName}")`
  return `[equipe] de ${o.fromName} (${profileOf(o.fromAgent).label}) → para ${o.toName}: ${sanitizeBody(o.text)} (para responder: ${reply})`
}
