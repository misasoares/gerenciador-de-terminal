import path from 'node:path'
import type { Account } from '../shared/types'

export const DEFAULT_ACCOUNTS: Account[] = [
  { id: 'misa', label: 'misa', command: 'claude', color: '#4fc1ff', configDirMatch: ['1-misasoaresms2'], isDefault: true, settingsMatch: null, pathPrefix: null },
  { id: 'mslabs', label: 'mslabs', command: 'claude-mslabs', color: '#c586c0', configDirMatch: ['3-misael_mslabs-dev.com'], isDefault: false, settingsMatch: null, pathPrefix: null },
  { id: 'weboption', label: 'weboption', command: 'claude-weboption', color: '#dcdcaa', configDirMatch: ['2-weboption2011_gmail.com'], isDefault: false, settingsMatch: 'weboption-gateway', pathPrefix: '~/Documents/weboption' },
  { id: 'weboption-max', label: 'weboption-max', command: 'claude-weboption-max', color: '#ce9178', configDirMatch: ['2-weboption2011_gmail.com'], isDefault: false, settingsMatch: 'weboption-max', pathPrefix: null },
]

export function detectAccount(accounts: Account[], configDir: string | null, argv: string | null): string | null {
  const candidates = configDir
    ? accounts.filter((a) => a.configDirMatch.some((m) => configDir.includes(m)))
    : accounts.filter((a) => a.isDefault)
  if (candidates.length <= 1) return candidates[0]?.id ?? null
  const bySettings = candidates.find((a) => a.settingsMatch && argv?.includes(a.settingsMatch))
  return (bySettings ?? candidates.find((a) => !a.settingsMatch) ?? candidates[0]).id
}

const SESSION_ID_RE = /^[0-9a-f-]{8,64}$/i

export function buildCommand(account: Account, resumeSessionId?: string): string {
  if (!resumeSessionId) return account.command
  if (!SESSION_ID_RE.test(resumeSessionId)) throw new Error(`session id inválido: ${resumeSessionId}`)
  return `${account.command} --resume ${resumeSessionId}`
}

export function suggestAccount(accounts: Account[], projectPath: string, userHome: string): string | null {
  for (const a of accounts) {
    if (!a.pathPrefix) continue
    const prefix = a.pathPrefix.startsWith('~/') ? path.join(userHome, a.pathPrefix.slice(2)) : a.pathPrefix
    if (projectPath === prefix || projectPath.startsWith(prefix + '/')) return a.id
  }
  return null
}
