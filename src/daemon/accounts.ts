import path from 'node:path'
import type { Account, AgentKind } from '../shared/types'
import { profileOf, type McpServerSpec } from './agent-profiles'
import { shq } from './shell-quote'

export const DEFAULT_ACCOUNTS: Account[] = [
  { agent: 'claude', id: 'misa', label: 'misa', command: 'claude', color: '#4fc1ff', configDirMatch: ['1-misasoaresms2'], isDefault: true, settingsMatch: null, pathPrefix: null },
  { agent: 'claude', id: 'mslabs', label: 'mslabs', command: 'claude-mslabs', color: '#c586c0', configDirMatch: ['3-misael_mslabs-dev.com'], isDefault: false, settingsMatch: null, pathPrefix: null },
  { agent: 'claude', id: 'weboption', label: 'weboption', command: 'claude-weboption', color: '#dcdcaa', configDirMatch: ['2-weboption2011_gmail.com'], isDefault: false, settingsMatch: 'weboption-gateway', pathPrefix: '~/Documents/weboption', planUsage: false },
  { agent: 'claude', id: 'weboption-max', label: 'weboption-max', command: 'claude-weboption-max', color: '#ce9178', configDirMatch: ['2-weboption2011_gmail.com'], isDefault: false, settingsMatch: 'weboption-max', pathPrefix: null },
]

export function detectAccount(accounts: Account[], agent: AgentKind, configDir: string | null, argv: string | null): string | null {
  const own = accounts.filter((a) => a.agent === agent)
  const candidates = configDir ? own.filter((a) => a.configDirMatch.some((m) => configDir.includes(m))) : own.filter((a) => a.isDefault)
  if (candidates.length <= 1) return candidates[0]?.id ?? null
  const bySettings = candidates.find((a) => a.settingsMatch && argv?.includes(a.settingsMatch))
  return (bySettings ?? candidates.find((a) => !a.settingsMatch) ?? candidates[0]).id
}

const SESSION_ID_RE = /^[0-9a-f-]{8,64}$/i

export interface CommandExtras {
  /** MCP do Gerenciador (Claude: --mcp-config; Codex: -c mcp_servers…, precisa também de paneId e socketPath) */
  mcp?: McpServerSpec | null
  paneId?: string
  socketPath?: string
  /** modelo da sessão (--model no Claude, -m no Codex) */
  model?: string
  /** -n: nome de exibição da sessão (o SendMessage acha por ele) */
  name?: string
  /** arquivo com o prompt inicial: vai como "$(cat …)" para aspas e quebras chegarem intactas */
  promptFile?: string
}

export function buildCommand(account: Account, resumeSessionId?: string, extra: CommandExtras = {}): string {
  let cmd = account.command
  // o daemon compartilhado do Codex roda os hooks com o env de quem o criou (outro painel): cada sessão no seu processo
  if (account.agent === 'codex' && !/(^|\s)--no-daemon(\s|$)/.test(cmd)) cmd += ' --no-daemon'
  const profile = profileOf(account.agent)
  if (resumeSessionId && !SESSION_ID_RE.test(resumeSessionId)) throw new Error(`session id inválido: ${resumeSessionId}`)
  // Claude: --resume <id> antes das demais opções
  if (resumeSessionId && account.agent === 'claude') cmd += ` --resume ${resumeSessionId}`
  const mcpUsable = extra.mcp && (account.agent === 'claude' || (extra.paneId && extra.socketPath))
  if (mcpUsable) cmd += ` ${profile.mcpArgs(extra.mcp!, extra.paneId ?? '', extra.socketPath ?? '')}`
  if (extra.model) cmd += ` ${profile.modelArgs(extra.model)}`
  // Codex: subcomando no fim (codex --yolo … resume <id>)
  if (resumeSessionId && account.agent === 'codex') cmd += ` resume ${resumeSessionId}`
  if (account.agent !== 'claude') return cmd
  if (extra.name) cmd += ` -n ${shq(extra.name)}`
  if (extra.promptFile) cmd += ` "$(cat ${shq(extra.promptFile)})"`
  return cmd
}

/** agente usado para retomar sem conta: o padrão daquele tipo, ou o CLI puro */
export function resumeAccount(accounts: Account[], agent: AgentKind): Account {
  return accounts.find((a) => a.agent === agent && a.isDefault) ?? accounts.find((a) => a.agent === agent) ?? { id: agent, label: agent, command: agent, color: '#888888', agent, configDirMatch: [], isDefault: false, settingsMatch: null, pathPrefix: null }
}

export function suggestAccount(accounts: Account[], projectPath: string, userHome: string): string | null {
  for (const a of accounts) {
    if (!a.pathPrefix) continue
    const prefix = a.pathPrefix.startsWith('~/') ? path.join(userHome, a.pathPrefix.slice(2)) : a.pathPrefix
    if (projectPath === prefix || projectPath.startsWith(prefix + '/')) return a.id
  }
  return null
}

export function suggestAgents(_detected: { claude: boolean; codex: boolean }): Account[] {
  return [
    { id: 'claude', label: 'Claude', command: 'claude --dangerously-skip-permissions', color: '#d97757', agent: 'claude', configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null },
    { id: 'codex', label: 'Codex', command: 'codex --yolo', color: '#10a37f', agent: 'codex', configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null },
  ]
}

export function validateAccounts(list: Account[]): string | null {
  const seen = new Set<string>()
  for (const a of list) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(a.id)) return `id inválido: "${a.id}" (use letras minúsculas, números e -)`
    if (seen.has(a.id)) return `id repetido: ${a.id}`
    seen.add(a.id)
    if (!a.label?.trim()) return `agente ${a.id}: nome vazio`
    if (!a.command?.trim()) return `agente ${a.id}: comando vazio`
    if (!/^#[0-9a-fA-F]{6}$/.test(a.color)) return `agente ${a.id}: cor inválida (${a.color})`
    if (a.agent !== 'claude' && a.agent !== 'codex') return `agente ${a.id}: tipo inválido (${String(a.agent)})`
  }
  return null
}

export function migrateAccounts(list: unknown[]): Account[] {
  return list.map((raw) => {
    const a = raw as Partial<Account>
    return {
      id: String(a.id ?? ''),
      label: String(a.label ?? a.id ?? ''),
      command: String(a.command ?? ''),
      color: a.color ?? '#888888',
      agent: a.agent === 'codex' ? 'codex' : 'claude',
      configDirMatch: Array.isArray(a.configDirMatch) ? a.configDirMatch : [],
      isDefault: Boolean(a.isDefault),
      settingsMatch: a.settingsMatch ?? null,
      pathPrefix: a.pathPrefix ?? null,
      planUsage: typeof a.planUsage === 'boolean' ? a.planUsage : !(a.settingsMatch ?? '').includes('gateway'),
    }
  })
}
