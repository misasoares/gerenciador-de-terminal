import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import type { UsageWindow } from '../../shared/types'
import type { Login, ReadResult } from './types'

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

export interface ClaudeCreds {
  accessToken: string
  expiresAt: number | null
  plan: string | null
}

export interface ClaudeDeps {
  platform: NodeJS.Platform
  userHome: string
  now: () => number
  keychain: (service: string) => Promise<string | null>
  readFile: (p: string) => Promise<string | null>
  fetch: typeof fetch
}

/** nome da entrada que o Claude Code usa no Keychain para aquele CLAUDE_CONFIG_DIR */
export function keychainService(configDir: string): string {
  if (!configDir) return 'Claude Code-credentials'
  return `Claude Code-credentials-${createHash('sha256').update(configDir).digest('hex').slice(0, 8)}`
}

export function parseCredentials(raw: string): ClaudeCreds | null {
  try {
    const o = (JSON.parse(raw) as { claudeAiOauth?: Record<string, unknown> })?.claudeAiOauth
    if (!o || typeof o.accessToken !== 'string' || !o.accessToken) return null
    return {
      accessToken: o.accessToken,
      expiresAt: typeof o.expiresAt === 'number' ? o.expiresAt : null,
      plan: typeof o.subscriptionType === 'string' ? o.subscriptionType : null,
    }
  } catch {
    return null
  }
}

/** null = formato desconhecido (nem five_hour nem seven_day) */
export function parseClaudeUsage(body: unknown): UsageWindow[] | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (!('five_hour' in b) && !('seven_day' in b)) return null
  const out: UsageWindow[] = []
  for (const [key, kind] of [['five_hour', '5h'], ['seven_day', 'week']] as const) {
    const w = b[key] as { utilization?: unknown; resets_at?: unknown } | null | undefined
    if (!w || typeof w.utilization !== 'number') continue
    const t = typeof w.resets_at === 'string' ? Date.parse(w.resets_at) : NaN
    out.push({ kind, percent: w.utilization, resetsAt: Number.isFinite(t) ? t : null })
  }
  return out
}

/** só lê: nunca renova nem grava */
export async function readClaudeToken(configDir: string, d: ClaudeDeps): Promise<ClaudeCreds | null> {
  if (d.platform === 'darwin') {
    const raw = await d.keychain(keychainService(configDir))
    const c = raw ? parseCredentials(raw) : null
    if (c) return c
  }
  const dir = configDir || path.join(d.userHome, '.claude')
  const raw = await d.readFile(path.join(dir, '.credentials.json'))
  return raw ? parseCredentials(raw) : null
}

export async function readClaude(login: Login, d: ClaudeDeps): Promise<ReadResult> {
  const creds = await readClaudeToken(login.configDir, d)
  if (!creds) return { kind: 'no-token' }
  if (creds.expiresAt !== null && creds.expiresAt <= d.now()) return { kind: 'expired' }
  let res: Response
  try {
    res = await d.fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${creds.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return { kind: 'retry', reason: 'rede' } // a mensagem do erro pode ecoar cabeçalhos: não repassa
  }
  if (res.status === 401) return { kind: 'expired' }
  if (res.status === 429 || res.status >= 500) return { kind: 'retry', reason: `HTTP ${res.status}` }
  if (!res.ok) return { kind: 'bad-format', reason: `HTTP ${res.status}` }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { kind: 'bad-format', reason: 'JSON inválido' }
  }
  const windows = parseClaudeUsage(body)
  return windows ? { kind: 'ok', windows, plan: creds.plan } : { kind: 'bad-format', reason: 'campos desconhecidos' }
}

export function realKeychain(service: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', service, '-w'], { timeout: 5_000 }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim() || null)
    })
  })
}
