import { randomUUID } from 'node:crypto'
import type { Account, AgentKind, Layout, LayoutNode, SessionStatus } from '../shared/types'
import { profileOf } from './agent-profiles'

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/

/** nome vira pasta, branch e nome de exibição (SendMessage): só caracteres seguros */
export function checkName(n: string): string {
  const v = n.trim()
  if (!NAME_RE.test(v)) throw new Error('nome inválido: use letras, números, ponto, hífen ou sublinhado (até 40)')
  return v
}

/** nome do modelo vai para a linha de comando (entre aspas): só barra o que não é um nome */
export function checkModel(m: string): string {
  const v = m.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/@[\]-]{0,99}$/.test(v)) throw new Error('modelo inválido')
  return v
}

export function uniqueDash(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name
  let i = 2
  while (taken.includes(`${name}-${i}`)) i++
  return `${name}-${i}`
}

/** conta de qualquer CLI: a pedida, senão a do líder, senão a padrão */
export function pickAccount(accounts: Account[], wanted: unknown, fallbackId: string | null): Account {
  if (typeof wanted === 'string' && wanted.trim()) {
    const w = wanted.trim().toLowerCase()
    const hit = accounts.find((a) => a.id.toLowerCase() === w || a.label.toLowerCase() === w)
    if (!hit) throw new Error(`conta desconhecida: ${wanted} (contas: ${accounts.map((a) => a.id).join(', ')})`)
    return hit
  }
  const own = accounts.find((a) => a.id === fallbackId) ?? accounts.find((a) => a.isDefault) ?? accounts[0]
  if (!own) throw new Error('nenhuma conta configurada')
  return own
}

/** abertura do prompt de todo dev contratado: papel, hierarquia e como falar com o líder */
export function hirePreamble(o: { name: string; leaderName: string; leaderAgent: AgentKind; agent: AgentKind }): string {
  const nativo = profileOf(o.leaderAgent).nativeTeam && profileOf(o.agent).nativeTeam
  const reply = nativo ? `SendMessage(to: "${o.leaderName}")` : `mandar_mensagem(para: "${o.leaderName}")`
  return `Você é ${o.name}, contratado pelo tech lead ${o.leaderName} (${profileOf(o.leaderAgent).label}) neste projeto. Mensagens que começam com [equipe] vêm de colegas, não do usuário. Mensagens sem esse prefixo são do usuário humano. Para responder ou avisar o líder, use ${reply}. Quando terminar, avise o líder.`
}

export function statusName(r: { alive: boolean; claude: { status: SessionStatus } | null }): 'trabalhando' | 'pedindo-permissao' | 'sua-vez' | 'ocioso' | 'terminal' {
  const s = r.claude?.status
  if (!s) return 'terminal'
  return s === 'working' ? 'trabalhando' : s === 'needs-you' ? 'pedindo-permissao' : s === 'your-turn' ? 'sua-vez' : 'ocioso'
}

const leafIds = (n: LayoutNode | null): string[] => (!n ? [] : n.type === 'leaf' ? [n.paneId] : n.children.flatMap(leafIds))

/** sessão nova entra ao lado (split row), na aba onde está o líder; sem ela, na aba ativa; sem abas, numa nova */
export function insertBeside(layout: Layout, anchorId: string, newId: string): Layout {
  const leaf: LayoutNode = { type: 'leaf', paneId: newId }
  const tab = layout.tabs.find((t) => leafIds(t.root).includes(anchorId)) ?? layout.tabs.find((t) => t.id === layout.activeTabId) ?? layout.tabs[0]
  if (!tab) {
    const t = { id: randomUUID(), name: 'Aba 1', root: leaf }
    return { tabs: [t], activeTabId: t.id }
  }
  const root: LayoutNode = !tab.root ? leaf : tab.root.type === 'split' && tab.root.dir === 'row' ? { ...tab.root, children: [...tab.root.children, leaf], sizes: [] } : { type: 'split', dir: 'row', sizes: [], children: [tab.root, leaf] }
  return { ...layout, tabs: layout.tabs.map((t) => (t === tab ? { ...t, root } : t)) }
}
