import { createHash } from 'node:crypto'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { keychainService, parseClaudeUsage, parseCredentials, readClaude, type ClaudeDeps } from '../../src/daemon/usage/claude'
import type { Login } from '../../src/daemon/usage/types'

const creds = (over: Record<string, unknown> = {}) => JSON.stringify({ claudeAiOauth: { accessToken: 'tok-123', refreshToken: 'r', expiresAt: 2_000, subscriptionType: 'max', ...over } })
const login: Login = { key: 'claude:/p/3-m', agent: 'claude', configDir: '/p/3-m', accountIds: ['mslabs'] }
const res = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

function deps(over: Partial<ClaudeDeps> = {}): ClaudeDeps & { calls: { url: string; auth: string | null }[] } {
  const calls: { url: string; auth: string | null }[] = []
  return {
    platform: 'darwin',
    userHome: '/home/u',
    now: () => 1_000,
    keychain: async () => creds(),
    readFile: async () => null,
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get('authorization') })
      return res(200, { five_hour: { utilization: 42, resets_at: '2026-09-28T20:40:00Z' }, seven_day: { utilization: 18.4, resets_at: null } })
    }) as typeof fetch,
    calls,
    ...over,
  }
}

describe('uso do Claude', () => {
  it('nome da entrada do Keychain', () => {
    expect(keychainService('')).toBe('Claude Code-credentials')
    const h = createHash('sha256').update('/p/3-m').digest('hex').slice(0, 8)
    expect(keychainService('/p/3-m')).toBe(`Claude Code-credentials-${h}`)
  })

  it('parseCredentials pega token, validade e plano; lixo → null', () => {
    expect(parseCredentials(creds())).toEqual({ accessToken: 'tok-123', expiresAt: 2_000, plan: 'max' })
    expect(parseCredentials('{}')).toBeNull()
    expect(parseCredentials('não é json')).toBeNull()
    expect(parseCredentials(JSON.stringify({ claudeAiOauth: { accessToken: '' } }))).toBeNull()
  })

  it('parseClaudeUsage: janelas, nulos e formato desconhecido', () => {
    expect(parseClaudeUsage({ five_hour: { utilization: 42, resets_at: '2026-09-28T20:40:00Z' }, seven_day: null })).toEqual([
      { kind: '5h', percent: 42, resetsAt: Date.parse('2026-09-28T20:40:00Z') },
    ])
    expect(parseClaudeUsage({ five_hour: null, seven_day: { utilization: 3, resets_at: 'x' } })).toEqual([{ kind: 'week', percent: 3, resetsAt: null }])
    expect(parseClaudeUsage({ outra: 1 })).toBeNull()
    expect(parseClaudeUsage(null)).toBeNull()
  })

  it('lê o Keychain do login e consulta com o token', async () => {
    const seen: string[] = []
    const d = deps({ keychain: async (s) => (seen.push(s), creds()) })
    const r = await readClaude(login, d)
    expect(seen).toEqual([keychainService('/p/3-m')])
    expect(d.calls).toEqual([{ url: 'https://api.anthropic.com/api/oauth/usage', auth: 'Bearer tok-123' }])
    expect(r).toEqual({ kind: 'ok', plan: 'max', windows: [{ kind: '5h', percent: 42, resetsAt: Date.parse('2026-09-28T20:40:00Z') }, { kind: 'week', percent: 18.4, resetsAt: null }] })
  })

  it('Linux (ou Keychain vazio) usa <configDir>/.credentials.json; padrão = ~/.claude', async () => {
    const files: string[] = []
    const d = deps({ platform: 'linux', readFile: async (p) => (files.push(p), creds()) })
    await readClaude({ ...login, configDir: '' }, d)
    expect(files).toEqual([path.join('/home/u', '.claude', '.credentials.json')])
    const d2 = deps({ keychain: async () => null, readFile: async (p) => (files.push(p), creds()) })
    expect((await readClaude(login, d2)).kind).toBe('ok')
    expect(files[1]).toBe(path.join('/p/3-m', '.credentials.json'))
  })

  it('sem credencial → no-token; vencido → expired sem consultar', async () => {
    expect(await readClaude(login, deps({ keychain: async () => null }))).toEqual({ kind: 'no-token' })
    const d = deps({ now: () => 5_000 })
    expect(await readClaude(login, d)).toEqual({ kind: 'expired' })
    expect(d.calls).toEqual([])
  })

  it('401 → expired; 429/5xx/rede → retry; 404/JSON ruim/campos → bad-format', async () => {
    const withRes = (r: () => Promise<Response>) => deps({ fetch: (async () => r()) as typeof fetch })
    expect((await readClaude(login, withRes(async () => res(401, {})))).kind).toBe('expired')
    expect((await readClaude(login, withRes(async () => res(429, {})))).kind).toBe('retry')
    expect((await readClaude(login, withRes(async () => res(503, {})))).kind).toBe('retry')
    expect((await readClaude(login, withRes(async () => { throw new Error('ECONNRESET') }))).kind).toBe('retry')
    expect((await readClaude(login, withRes(async () => res(404, {})))).kind).toBe('bad-format')
    expect((await readClaude(login, withRes(async () => res(200, 'html')))).kind).toBe('bad-format')
    expect((await readClaude(login, withRes(async () => res(200, { x: 1 })))).kind).toBe('bad-format')
  })

  it('o token nunca aparece no motivo de erro', async () => {
    const d = deps({ fetch: (async () => { throw new Error('falhou tok-123') }) as typeof fetch })
    const r = await readClaude(login, d)
    expect(JSON.stringify(r)).not.toContain('tok-123')
  })
})
