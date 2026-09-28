import type { Account, UsageWindow } from '../../shared/types'
import type { Login } from './types'

/** agentes com planUsage agrupados por agente + diretório de config (o diretório define o plano) */
export function groupLogins(accounts: Account[], loginDirs: Record<string, string>): Login[] {
  const map = new Map<string, Login>()
  for (const a of accounts) {
    if (a.planUsage === false) continue
    const dir = a.id in loginDirs ? loginDirs[a.id] : a.isDefault ? '' : null
    if (dir === null) continue
    const key = `${a.agent}:${dir}`
    const cur = map.get(key)
    if (cur) cur.accountIds.push(a.id)
    else map.set(key, { key, agent: a.agent, configDir: dir, accountIds: [a.id] })
  }
  return [...map.values()]
}

export function missingLoginHints(accounts: Account[], logins: Login[]): Record<string, string> {
  const known = new Set(logins.flatMap((l) => l.accountIds))
  const out: Record<string, string> = {}
  for (const a of accounts) {
    if (a.planUsage === false || known.has(a.id)) continue
    out[a.id] = 'abra uma sessão deste agente uma vez para o app descobrir o login'
  }
  return out
}

/** janela cujo reset já passou: o uso zerou, e o próximo reset ainda não é conhecido */
export function applyResets(windows: UsageWindow[], now: number): UsageWindow[] {
  return windows.map((w) => (w.resetsAt !== null && w.resetsAt <= now ? { ...w, percent: 0, resetsAt: null } : w))
}
