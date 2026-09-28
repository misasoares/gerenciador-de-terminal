# Uso do plano (Claude + Codex) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar na status bar e no modal ⌘T quanto de cada plano (Claude OAuth e Codex/ChatGPT) já foi usado, por login, e avisar ao cruzar 80% e 95%.

**Architecture:** Um `UsageMonitor` no daemon lê cada login a cada 5 min (e depois de um `Stop`), por um leitor injetável: Claude = token do Keychain/`.credentials.json` + `GET /api/oauth/usage`; Codex = último `rate_limits` do rollout local. O resultado vai para `AppState.usage`/`usageHints`; os avisos saem como `ServerMessage { t: 'usage.alert' }` e o renderer usa o `gt:notify` que já existe.

**Tech Stack:** TypeScript, Electron (electron-vite), React, vitest. Node ≥ 20 no daemon (`fetch` e `AbortSignal.timeout` globais).

**Spec:** `docs/superpowers/specs/2026-09-28-uso-do-plano-design.md`

## Pré-requisito (antes da Task 1)

Este plano parte do código da branch `feat/agentes-codex-linux` (modelo `Account.agent`, `AgentsPanel`, `SetupWizard`, `migrateAccounts`, `ServerMessage`, aviso de hooks do Codex). **Só comece depois que ela estiver na `main`.** Então:

```bash
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal-uso-do-plano" rebase main
cd "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal-uso-do-plano" && npm install && npm test
```

Expected: rebase limpo (esta branch só tem docs) e a suíte passando. Se algum trecho citado abaixo ("depois da linha X", nomes de função) não bater com o código mergeado, siga o código real e anote a diferença no commit.

## Global Constraints

- O token OAuth do Claude **nunca** é renovado, gravado, logado, enviado ao renderer ou a outro host que não `https://api.anthropic.com/api/oauth/usage`.
- Limiares de aviso: **80** e **95**. Cores: normal `< 80`, amarelo `80–94`, vermelho `≥ 95`.
- Frequência: 5 min por login; `Stop` antecipa com mínimo de 60 s; backoff dobra a cada falha até 30 min.
- Rótulos pt-BR exatamente: `5h`, `sem`, `indisponível`, `renova às HH:MM`, `renova <dia> HH:MM` (dias `dom seg ter qua qui sex sáb`), `lido às HH:MM`.
- Texto do aviso: `<rótulo>: <limiar>% da janela <de 5h|semanal>[ · renova …]`.
- `planUsage` ausente vale `true`; a migração grava `false` quando `settingsMatch` contém `gateway`.
- Nenhuma dependência nova de npm.
- Testes do daemon **nunca** tocam Keychain ou rede: o leitor padrão do `Daemon` é inerte; só `src/daemon/main.ts` passa o leitor real.

## Review Focus

1. **Login descoberto depois de ler o padrão** — `misa` é `isDefault` e começa lendo o diretório padrão; quando o primeiro hook traz `CLAUDE_CONFIG_DIR`, o login antigo tem de sumir (sem item duplicado na barra). Teste na Task 6.
2. **Janela já reiniciada** — `resetsAt` no passado (Codex parado há dias) deve mostrar 0% e não disparar aviso com valor velho. Testes nas Tasks 3 e 4.
3. **Arquivo de rollout com linha cortada / lixo** — a leitura do fim do arquivo começa no meio de uma linha; não pode quebrar nem pegar `rate_limits` antigo por engano. Teste na Task 3.
4. **Endpoint muda o formato ou responde 401** — 401 vira `expired`, JSON sem `five_hour`/`seven_day` vira `unavailable`; nunca exceção não tratada. Testes na Task 2.
5. **Aviso repetido após reiniciar o app** — `usageNotified` persiste e a mesma janela/limiar não avisa de novo; ao reiniciar a janela (novo `resetsAt`) volta a valer. Testes nas Tasks 4 e 6.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/shared/types.ts` (mod) | `Account.planUsage?`, `UsageWindow`, `UsageView`, `AppState.usage` e `usageHints` |
| `src/shared/protocol.ts` (mod) | `ServerMessage` ganha `usage.alert` |
| `src/shared/usage-format.ts` (novo) | `formatClock`, `formatReset` (daemon e renderer) |
| `src/daemon/accounts.ts` (mod) | migração de `planUsage`; `weboption` com `planUsage: false` |
| `src/daemon/persist.ts` (mod) | `loginDirs`, `usageNotified` |
| `src/daemon/usage/types.ts` (novo) | `Login`, `ReadResult` |
| `src/daemon/usage/claude.ts` (novo) | nome do Keychain, parsers, leitura do token, consulta |
| `src/daemon/usage/codex.ts` (novo) | parser do `rate_limits`, rollout mais recente, leitura |
| `src/daemon/usage/logins.ts` (novo) | `groupLogins`, `applyResets`, `missingLoginHints` |
| `src/daemon/usage/alerts.ts` (novo) | `crossings`, `pruneNotified` |
| `src/daemon/usage/monitor.ts` (novo) | `UsageMonitor` (agenda, backoff, estados, avisos) |
| `src/daemon/usage/read.ts` (novo) | `makeUsageReader` (leitor real) |
| `src/daemon/daemon.ts` (mod) | liga o monitor: hooks, `accounts.save`, estado, alerta |
| `src/daemon/main.ts` (mod) | passa o leitor real |
| `src/renderer/src/usage-model.ts` (novo) | chips da barra, texto do ⌘T (puro) |
| `src/renderer/src/components/StatusBar.tsx`, `NewSessionDialog.tsx`, `AgentsPanel.tsx`, `src/renderer/src/main.tsx`, `styles.css` (mod) | interface |

---

### Task 1: Modelo — `planUsage`, tipos de uso e persistência

**Files:**
- Modify: `src/shared/types.ts`, `src/daemon/accounts.ts`, `src/daemon/persist.ts`, `src/daemon/daemon.ts` (só `buildState`, valores vazios)
- Test: `tests/daemon/agents.test.ts`, `tests/daemon/persist.test.ts`

**Interfaces:**
- Produces: `Account.planUsage?: boolean`; `UsageWindow`, `UsageStatus`, `UsageView`; `AppState.usage: UsageView[]`, `AppState.usageHints: Record<string, string>`; `Persisted.loginDirs: Record<string, string>`, `Persisted.usageNotified: string[]`.

- [ ] **Step 1: Testes que falham**

Em `tests/daemon/agents.test.ts`, dentro do `describe` existente, adicione:

```ts
  it('migração de planUsage: gateway vira false, resto true, valor explícito é mantido', () => {
    const out = migrateAccounts([
      { id: 'a', label: 'a', command: 'x', color: '#111111', configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null },
      { id: 'b', label: 'b', command: 'x', color: '#111111', configDirMatch: [], isDefault: false, settingsMatch: 'weboption-gateway', pathPrefix: null },
      { id: 'c', label: 'c', command: 'x', color: '#111111', configDirMatch: [], isDefault: false, settingsMatch: 'weboption-gateway', pathPrefix: null, planUsage: true },
    ])
    expect(out.map((a) => a.planUsage)).toEqual([true, false, true])
  })
```

Em `tests/daemon/persist.test.ts`, adicione:

```ts
  it('loginDirs e usageNotified têm padrão e fazem ida e volta', () => {
    expect(defaultPersisted()).toMatchObject({ loginDirs: {}, usageNotified: [] })
    const f = path.join(tmp(), 'state.json')
    const data = { ...defaultPersisted(), loginDirs: { mslabs: '/x/3-m' }, usageNotified: ['claude:/x|week|1|80'] }
    savePersisted(f, data)
    expect(loadPersisted(f)).toEqual(data)
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/agents.test.ts tests/daemon/persist.test.ts`
Expected: FAIL (`planUsage` undefined; `loginDirs` ausente).

- [ ] **Step 3: Implementar**

`src/shared/types.ts` — em `Account`, depois de `pathPrefix`:

```ts
  /** mostra o uso do plano deste agente; ausente = true. false para gateway ou chave de API */
  planUsage?: boolean
```

No fim do arquivo:

```ts
export interface UsageWindow {
  kind: '5h' | 'week'
  /** 0–100 */
  percent: number
  /** epoch ms; null = desconhecido */
  resetsAt: number | null
}

export type UsageStatus = 'ok' | 'stale' | 'expired' | 'unavailable'

/** uso de um login (agentes com o mesmo CLAUDE_CONFIG_DIR/CODEX_HOME compartilham o plano) */
export interface UsageView {
  loginKey: string
  agent: AgentKind
  /** agentes com planUsage deste login, na ordem da lista */
  accountIds: string[]
  windows: UsageWindow[]
  plan: string | null
  /** última leitura bem-sucedida (epoch ms) */
  readAt: number | null
  status: UsageStatus
}
```

Em `AppState`, depois de `settings`:

```ts
  usage: UsageView[]
  /** por agente: por que ainda não há uso para mostrar */
  usageHints: Record<string, string>
```

`src/daemon/accounts.ts` — no `DEFAULT_ACCOUNTS`, acrescente `planUsage: false` só no objeto `weboption` (os outros ficam sem o campo). Em `migrateAccounts`, no objeto retornado, depois de `pathPrefix`:

```ts
      planUsage: typeof a.planUsage === 'boolean' ? a.planUsage : !(a.settingsMatch ?? '').includes('gateway'),
```

`src/daemon/persist.ts` — em `Persisted`:

```ts
  /** último CLAUDE_CONFIG_DIR/CODEX_HOME visto por agente ('' = diretório padrão) */
  loginDirs: Record<string, string>
  /** chaves de aviso de uso já disparadas (loginKey|janela|resetsAt|limiar) */
  usageNotified: string[]
```

Em `defaultPersisted()`: `loginDirs: {},` e `usageNotified: [],`. Em `loadPersisted`, no objeto retornado:

```ts
      loginDirs: parsed.loginDirs && typeof parsed.loginDirs === 'object' ? parsed.loginDirs : {},
      usageNotified: Array.isArray(parsed.usageNotified) ? parsed.usageNotified.filter((k) => typeof k === 'string') : [],
```

`src/daemon/daemon.ts` — em `buildState()`, depois de `settings: this.persisted.settings,`:

```ts
      usage: [],
      usageHints: {},
```

- [ ] **Step 4: Rodar testes e typecheck**

Run: `npx vitest run tests/daemon/agents.test.ts tests/daemon/persist.test.ts && npm run typecheck`
Expected: PASS. Se o typecheck acusar `AppState` literal em algum teste do renderer, acrescente `usage: [], usageHints: {}` nesse literal.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/daemon/accounts.ts src/daemon/persist.ts src/daemon/daemon.ts tests
git commit -m "feat(uso): planUsage por agente, tipos de uso e persistência de logins"
```

---

### Task 2: Fonte Claude — Keychain, credenciais e `/api/oauth/usage`

**Files:**
- Create: `src/daemon/usage/types.ts`, `src/daemon/usage/claude.ts`
- Test: `tests/daemon/usage-claude.test.ts`

**Interfaces:**
- Consumes: `UsageWindow` (Task 1).
- Produces:
  - `interface Login { key: string; agent: AgentKind; configDir: string; accountIds: string[] }` (`configDir === ''` = padrão)
  - `type ReadResult = { kind: 'ok'; windows: UsageWindow[]; plan: string | null } | { kind: 'no-token' } | { kind: 'no-data' } | { kind: 'expired' } | { kind: 'retry'; reason: string } | { kind: 'bad-format'; reason: string }`
  - `keychainService(configDir: string): string`
  - `parseCredentials(raw: string): ClaudeCreds | null`
  - `parseClaudeUsage(body: unknown): UsageWindow[] | null`
  - `interface ClaudeDeps { platform: NodeJS.Platform; userHome: string; now: () => number; keychain: (service: string) => Promise<string | null>; readFile: (p: string) => Promise<string | null>; fetch: typeof fetch }`
  - `readClaudeToken(configDir: string, d: ClaudeDeps): Promise<ClaudeCreds | null>`
  - `readClaude(login: Login, d: ClaudeDeps): Promise<ReadResult>`
  - `realKeychain(service: string): Promise<string | null>`

- [ ] **Step 1: Confirmar o nome da entrada do Keychain (com o usuário)**

A regra assumida: sem `CLAUDE_CONFIG_DIR` → `Claude Code-credentials`; com ele → `Claude Code-credentials-` + 8 primeiros hex do SHA-256 do valor da variável. Verifique **sem ler o segredo** (sem `-w`), pedindo aprovação do usuário antes de rodar:

```bash
for d in "$HOME/.claude-swap-backup/sessions/1-misasoaresms2_gmail.com" "$HOME/.claude-swap-backup/sessions/3-misael_mslabs-dev.com" "$HOME/.claude-swap-backup/sessions/2-weboption2011_gmail.com"; do
  s="Claude Code-credentials-$(printf %s "$d" | shasum -a 256 | cut -c1-8)"
  security find-generic-password -s "$s" >/dev/null 2>&1 && echo "ok  $s" || echo "--  $s"
done
security find-generic-password -s "Claude Code-credentials" >/dev/null 2>&1 && echo "ok  padrão" || echo "--  padrão"
```

Expected: `ok` nos perfis com login. Se der `--` onde há login, pergunte ao usuário o valor exato de `CLAUDE_CONFIG_DIR` de cada comando (o hash é do texto da variável, sem normalizar) e ajuste `keychainService` e o teste do Step 2 antes de seguir.

- [ ] **Step 2: Testes que falham**

`tests/daemon/usage-claude.test.ts`:

```ts
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
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/usage-claude.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 4: Implementar**

`src/daemon/usage/types.ts`:

```ts
import type { AgentKind, UsageWindow } from '../../shared/types'

/** um login = um plano; agentes com o mesmo diretório de config compartilham */
export interface Login {
  key: string
  agent: AgentKind
  /** CLAUDE_CONFIG_DIR ou CODEX_HOME como veio do hook; '' = diretório padrão */
  configDir: string
  accountIds: string[]
}

export type ReadResult =
  | { kind: 'ok'; windows: UsageWindow[]; plan: string | null }
  /** sem login do plano (sem credencial, Keychain negado, arquivo ausente) */
  | { kind: 'no-token' }
  /** Codex ainda sem rollout com rate_limits */
  | { kind: 'no-data' }
  | { kind: 'expired' }
  /** 429, 5xx ou rede: tentar de novo mais tarde */
  | { kind: 'retry'; reason: string }
  /** resposta que não sabemos ler (endpoint mudou) */
  | { kind: 'bad-format'; reason: string }
```

`src/daemon/usage/claude.ts`:

```ts
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
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/daemon/usage-claude.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/usage/types.ts src/daemon/usage/claude.ts tests/daemon/usage-claude.test.ts
git commit -m "feat(uso): leitura do uso do Claude (Keychain/credenciais + /api/oauth/usage)"
```

---

### Task 3: Fonte Codex — `rate_limits` do rollout

**Files:**
- Create: `src/daemon/usage/codex.ts`
- Test: `tests/daemon/usage-codex.test.ts`

**Interfaces:**
- Consumes: `Login`, `ReadResult` (Task 2).
- Produces:
  - `parseCodexRateLimits(text: string): { windows: UsageWindow[]; plan: string | null } | null`
  - `latestRollout(sessionsDir: string): Promise<string | null>`
  - `readCodex(login: Login, o: { userHome: string }): Promise<ReadResult>`

- [ ] **Step 1: Testes que falham**

`tests/daemon/usage-codex.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { latestRollout, parseCodexRateLimits, readCodex } from '../../src/daemon/usage/codex'

const line = (rl: unknown) => JSON.stringify({ timestamp: 't', type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rl } })
const rl = (primary: unknown, secondary: unknown = null) => ({ limit_id: 'codex', primary, secondary, plan_type: 'prolite' })

describe('uso do Codex', () => {
  it('pega o ÚLTIMO rate_limits e mapeia janelas por window_minutes', () => {
    const text = [
      line(rl({ used_percent: 10, window_minutes: 10080, resets_at: 100 })),
      line(rl({ used_percent: 31, window_minutes: 10080, resets_at: 1790595481 }, { used_percent: 7, window_minutes: 300, resets_at: 1790500000 })),
      JSON.stringify({ type: 'response_item', payload: {} }),
    ].join('\n')
    expect(parseCodexRateLimits(text)).toEqual({
      plan: 'prolite',
      windows: [
        { kind: 'week', percent: 31, resetsAt: 1790595481_000 },
        { kind: '5h', percent: 7, resetsAt: 1790500000_000 },
      ],
    })
  })

  it('primeira linha cortada, lixo e janela de tamanho desconhecido são ignorados', () => {
    const text = ['e_limits":{"primary":{"used_percent":99', 'lixo', line(rl({ used_percent: 5, window_minutes: 60, resets_at: 1 }, { used_percent: 12, window_minutes: 10080 }))].join('\n')
    expect(parseCodexRateLimits(text)).toEqual({ plan: 'prolite', windows: [{ kind: 'week', percent: 12, resetsAt: null }] })
  })

  it('sem rate_limits → null', () => {
    expect(parseCodexRateLimits(JSON.stringify({ type: 'x' }))).toBeNull()
    expect(parseCodexRateLimits('')).toBeNull()
  })

  it('latestRollout desce pelas pastas de data e escolhe o mais recente do dia', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cx-'))
    const mk = (rel: string, mtime: number) => {
      const f = path.join(root, rel)
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, '')
      fs.utimesSync(f, mtime, mtime)
      return f
    }
    mk('2026/09/21/rollout-a.jsonl', 1000)
    mk('2026/09/28/rollout-b.jsonl', 2000)
    const c = mk('2026/09/28/rollout-c.jsonl', 3000)
    mk('2026/09/28/outro.txt', 9000)
    expect(await latestRollout(root)).toBe(c)
    expect(await latestRollout(path.join(root, 'nada'))).toBeNull()
  })

  it('readCodex: padrão = ~/.codex; sem rollout → no-data; com rate_limits → ok', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cxh-'))
    const login = { key: 'codex:', agent: 'codex' as const, configDir: '', accountIds: ['codex'] }
    expect(await readCodex(login, { userHome: home })).toEqual({ kind: 'no-data' })
    const f = path.join(home, '.codex', 'sessions', '2026', '09', '28', 'rollout-x.jsonl')
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, 'x'.repeat(300_000) + '\n' + line(rl({ used_percent: 31, window_minutes: 10080, resets_at: 2 })) + '\n')
    expect(await readCodex(login, { userHome: home })).toEqual({ kind: 'ok', plan: 'prolite', windows: [{ kind: 'week', percent: 31, resetsAt: 2000 }] })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/usage-codex.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

`src/daemon/usage/codex.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { UsageWindow } from '../../shared/types'
import type { Login, ReadResult } from './types'

const TAIL_BYTES = 256 * 1024
const KIND_BY_MINUTES: Record<number, UsageWindow['kind']> = { 300: '5h', 10080: 'week' }

function findRateLimits(o: unknown, depth = 0): Record<string, unknown> | null {
  if (!o || typeof o !== 'object' || depth > 4) return null
  const rec = o as Record<string, unknown>
  if (rec.rate_limits && typeof rec.rate_limits === 'object') return rec.rate_limits as Record<string, unknown>
  for (const v of Object.values(rec)) {
    const found = findRateLimits(v, depth + 1)
    if (found) return found
  }
  return null
}

function toWindow(w: unknown): UsageWindow | null {
  if (!w || typeof w !== 'object') return null
  const r = w as { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown }
  const kind = typeof r.window_minutes === 'number' ? KIND_BY_MINUTES[r.window_minutes] : undefined
  if (!kind || typeof r.used_percent !== 'number') return null
  return { kind, percent: r.used_percent, resetsAt: typeof r.resets_at === 'number' ? r.resets_at * 1000 : null }
}

/** último rate_limits do texto (linhas JSONL); linhas que não são JSON são ignoradas */
export function parseCodexRateLimits(text: string): { windows: UsageWindow[]; plan: string | null } | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue
    let obj: unknown
    try {
      obj = JSON.parse(lines[i])
    } catch {
      continue
    }
    const rl = findRateLimits(obj)
    if (!rl) continue
    const windows = [toWindow(rl.primary), toWindow(rl.secondary)].filter((w): w is UsageWindow => w !== null)
    return { windows, plan: typeof rl.plan_type === 'string' ? rl.plan_type : null }
  }
  return null
}

async function sortedDirs(dir: string): Promise<string[]> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse()
}

/** sessions/AAAA/MM/DD/rollout-*.jsonl mais recente */
export async function latestRollout(sessionsDir: string): Promise<string | null> {
  for (const y of await sortedDirs(sessionsDir))
    for (const m of await sortedDirs(path.join(sessionsDir, y)))
      for (const d of await sortedDirs(path.join(sessionsDir, y, m))) {
        const dayDir = path.join(sessionsDir, y, m, d)
        const files = (await fs.promises.readdir(dayDir).catch(() => [] as string[])).filter((f) => f.startsWith('rollout-') && f.endsWith('.jsonl'))
        let best: { f: string; t: number } | null = null
        for (const f of files) {
          const st = await fs.promises.stat(path.join(dayDir, f)).catch(() => null)
          if (st && (!best || st.mtimeMs > best.t)) best = { f: path.join(dayDir, f), t: st.mtimeMs }
        }
        if (best) return best.f
      }
  return null
}

async function readTail(file: string): Promise<string> {
  const fh = await fs.promises.open(file, 'r')
  try {
    const { size } = await fh.stat()
    const len = Math.min(size, TAIL_BYTES)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, size - len)
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

export async function readCodex(login: Login, o: { userHome: string }): Promise<ReadResult> {
  const dir = login.configDir || path.join(o.userHome, '.codex')
  const file = await latestRollout(path.join(dir, 'sessions'))
  if (!file) return { kind: 'no-data' }
  const parsed = parseCodexRateLimits(await readTail(file).catch(() => ''))
  return parsed ? { kind: 'ok', ...parsed } : { kind: 'no-data' }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/daemon/usage-codex.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/usage/codex.ts tests/daemon/usage-codex.test.ts
git commit -m "feat(uso): leitura do uso do Codex a partir do rollout local"
```

---

### Task 4: Logins, reset de janela, formatação e limiares de aviso

**Files:**
- Create: `src/daemon/usage/logins.ts`, `src/daemon/usage/alerts.ts`, `src/shared/usage-format.ts`
- Test: `tests/daemon/usage-logins.test.ts`, `tests/shared/usage-format.test.ts`

**Interfaces:**
- Consumes: `Account`, `UsageWindow` (Task 1); `Login` (Task 2).
- Produces:
  - `groupLogins(accounts: Account[], loginDirs: Record<string, string>): Login[]`
  - `applyResets(windows: UsageWindow[], now: number): UsageWindow[]`
  - `missingLoginHints(accounts: Account[], logins: Login[]): Record<string, string>`
  - `THRESHOLDS = [80, 95]`
  - `crossings(loginKey: string, label: string, windows: UsageWindow[], notified: Set<string>, now: number): { keys: string[]; text: string }[]`
  - `pruneNotified(keys: Iterable<string>, now: number): string[]`
  - `formatClock(ms: number): string` (`HH:MM`), `formatReset(resetsAt: number, now: number): string`

- [ ] **Step 1: Testes que falham**

`tests/shared/usage-format.test.ts` (crie a pasta se não existir):

```ts
import { describe, expect, it } from 'vitest'
import { formatClock, formatReset } from '../../src/shared/usage-format'

describe('usage-format', () => {
  it('mesmo dia → "renova às HH:MM"; outro dia → "renova <dia> HH:MM"', () => {
    const now = new Date(2026, 8, 28, 10, 0).getTime() // seg 28/09/2026
    expect(formatClock(new Date(2026, 8, 28, 7, 5).getTime())).toBe('07:05')
    expect(formatReset(new Date(2026, 8, 28, 17, 40).getTime(), now)).toBe('renova às 17:40')
    expect(formatReset(new Date(2026, 9, 5, 9, 0).getTime(), now)).toBe('renova seg 09:00')
    expect(formatReset(new Date(2026, 9, 3, 23, 59).getTime(), now)).toBe('renova sáb 23:59')
  })
})
```

`tests/daemon/usage-logins.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyResets, groupLogins, missingLoginHints } from '../../src/daemon/usage/logins'
import { crossings, pruneNotified } from '../../src/daemon/usage/alerts'
import type { Account } from '../../src/shared/types'

const acc = (id: string, over: Partial<Account> = {}): Account => ({ id, label: id, command: id, color: '#111111', agent: 'claude', configDirMatch: [], isDefault: false, settingsMatch: null, pathPrefix: null, ...over })

describe('logins', () => {
  it('agrupa por agente+diretório, respeita planUsage e ordem da lista', () => {
    const accounts = [
      acc('misa', { isDefault: true }),
      acc('weboption', { planUsage: false }),
      acc('weboption-max'),
      acc('mslabs'),
      acc('codex', { agent: 'codex', isDefault: true }),
      acc('sem-hook'),
    ]
    const dirs = { weboption: '/s/2-w', 'weboption-max': '/s/2-w', mslabs: '/s/3-m' }
    expect(groupLogins(accounts, dirs)).toEqual([
      { key: 'claude:', agent: 'claude', configDir: '', accountIds: ['misa'] },
      { key: 'claude:/s/2-w', agent: 'claude', configDir: '/s/2-w', accountIds: ['weboption-max'] },
      { key: 'claude:/s/3-m', agent: 'claude', configDir: '/s/3-m', accountIds: ['mslabs'] },
      { key: 'codex:', agent: 'codex', configDir: '', accountIds: ['codex'] },
    ])
  })

  it('agente padrão com diretório já descoberto deixa de usar o padrão', () => {
    expect(groupLogins([acc('misa', { isDefault: true })], { misa: '/s/1-m' })).toEqual([{ key: 'claude:/s/1-m', agent: 'claude', configDir: '/s/1-m', accountIds: ['misa'] }])
  })

  it('dica para agentes com plano ainda sem login conhecido', () => {
    const accounts = [acc('a', { isDefault: true }), acc('b'), acc('c', { planUsage: false })]
    const hints = missingLoginHints(accounts, groupLogins(accounts, {}))
    expect(Object.keys(hints)).toEqual(['b'])
  })

  it('janela com reset no passado vira 0% e reset desconhecido', () => {
    expect(applyResets([{ kind: 'week', percent: 90, resetsAt: 100 }, { kind: '5h', percent: 50, resetsAt: 300 }], 200)).toEqual([
      { kind: 'week', percent: 0, resetsAt: null },
      { kind: '5h', percent: 50, resetsAt: 300 },
    ])
  })
})

describe('avisos de limiar', () => {
  const now = new Date(2026, 8, 28, 10, 0).getTime()
  const reset = new Date(2026, 9, 5, 9, 0).getTime()

  it('cruzar 80 avisa uma vez; pular direto para 96 avisa só o 95 e marca os dois', () => {
    const notified = new Set<string>()
    const a = crossings('claude:/m', 'mslabs', [{ kind: 'week', percent: 81, resetsAt: reset }], notified, now)
    expect(a).toEqual([{ keys: [`claude:/m|week|${reset}|80`], text: 'mslabs: 80% da janela semanal · renova seg 09:00' }])
    a.forEach((c) => c.keys.forEach((k) => notified.add(k)))
    expect(crossings('claude:/m', 'mslabs', [{ kind: 'week', percent: 85, resetsAt: reset }], notified, now)).toEqual([])
    const b = crossings('claude:/n', 'misa', [{ kind: '5h', percent: 96, resetsAt: null }], new Set(), now)
    expect(b).toEqual([{ keys: ['claude:/n|5h|na|80', 'claude:/n|5h|na|95'], text: 'misa: 95% da janela de 5h' }])
  })

  it('janela nova (outro resetsAt) volta a avisar; chaves vencidas são podadas', () => {
    const old = `claude:/m|week|${now - 1}|80`
    const live = `claude:/m|week|${reset}|80`
    expect(pruneNotified([old, live, 'claude:/m|5h|na|80'], now)).toEqual([live, 'claude:/m|5h|na|80'])
    const next = crossings('claude:/m', 'mslabs', [{ kind: 'week', percent: 82, resetsAt: reset + 1 }], new Set([live]), now)
    expect(next).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/usage-logins.test.ts tests/shared/usage-format.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implementar**

`src/shared/usage-format.ts`:

```ts
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const pad = (n: number) => String(n).padStart(2, '0')

export function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatReset(resetsAt: number, now: number): string {
  const r = new Date(resetsAt)
  const n = new Date(now)
  const sameDay = r.getFullYear() === n.getFullYear() && r.getMonth() === n.getMonth() && r.getDate() === n.getDate()
  return sameDay ? `renova às ${formatClock(resetsAt)}` : `renova ${DIAS[r.getDay()]} ${formatClock(resetsAt)}`
}
```

`src/daemon/usage/logins.ts`:

```ts
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
```

`src/daemon/usage/alerts.ts`:

```ts
import type { UsageWindow } from '../../shared/types'
import { formatReset } from '../../shared/usage-format'

export const THRESHOLDS = [80, 95]

const keyOf = (loginKey: string, w: UsageWindow, t: number) => `${loginKey}|${w.kind}|${w.resetsAt ?? 'na'}|${t}`

/** um aviso por janela com o maior limiar novo; keys marca todos os limiares cruzados */
export function crossings(loginKey: string, label: string, windows: UsageWindow[], notified: Set<string>, now: number): { keys: string[]; text: string }[] {
  const out: { keys: string[]; text: string }[] = []
  for (const w of windows) {
    const fresh = THRESHOLDS.filter((t) => w.percent >= t && !notified.has(keyOf(loginKey, w, t)))
    if (fresh.length === 0) continue
    const top = fresh[fresh.length - 1]
    const janela = w.kind === '5h' ? 'de 5h' : 'semanal'
    const reset = w.resetsAt !== null ? ` · ${formatReset(w.resetsAt, now)}` : ''
    out.push({ keys: fresh.map((t) => keyOf(loginKey, w, t)), text: `${label}: ${top}% da janela ${janela}${reset}` })
  }
  return out
}

/** descarta chaves de janelas que já reiniciaram */
export function pruneNotified(keys: Iterable<string>, now: number): string[] {
  return [...keys].filter((k) => {
    const resetsAt = Number(k.split('|')[2])
    return !Number.isFinite(resetsAt) || resetsAt > now
  })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/daemon/usage-logins.test.ts tests/shared/usage-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/usage-format.ts src/daemon/usage/logins.ts src/daemon/usage/alerts.ts tests
git commit -m "feat(uso): agrupamento por login, reset de janela e limiares de aviso"
```

---

### Task 5: `UsageMonitor` — agenda, backoff, estados e avisos

**Files:**
- Create: `src/daemon/usage/monitor.ts`
- Test: `tests/daemon/usage-monitor.test.ts`

**Interfaces:**
- Consumes: `Login`, `ReadResult` (Task 2); `applyResets` (Task 4); `crossings`, `pruneNotified` (Task 4); `UsageView` (Task 1).
- Produces:

```ts
interface MonitorDeps {
  read: (login: Login) => Promise<ReadResult>
  onChange: () => void
  /** texto do aviso + todas as chaves avisadas (para persistir) */
  onAlert: (text: string, notified: string[]) => void
  labelOf: (accountId: string) => string
  notified: string[]
  log?: (msg: string) => void
  intervalMs?: number   // 300_000
  minGapMs?: number     // 60_000
  maxBackoffMs?: number // 1_800_000
}
class UsageMonitor {
  constructor(d: MonitorDeps)
  setLogins(logins: Login[]): void
  poke(accountId: string): void
  views(): UsageView[]
  hints(): Record<string, string>
  stop(): void
}
```

- [ ] **Step 1: Testes que falham**

`tests/daemon/usage-monitor.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsageMonitor } from '../../src/daemon/usage/monitor'
import type { Login, ReadResult } from '../../src/daemon/usage/types'

const L = (key: string, ids: string[]): Login => ({ key, agent: 'claude', configDir: key.split(':')[1], accountIds: ids })
const ok = (percent: number, resetsAt: number | null = null): ReadResult => ({ kind: 'ok', plan: 'max', windows: [{ kind: 'week', percent, resetsAt }] })

let mon: UsageMonitor | null = null
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 28, 10, 0))
})
afterEach(() => {
  mon?.stop()
  mon = null
  vi.useRealTimers()
})

function make(results: ReadResult[], extra: { notified?: string[] } = {}) {
  const reads: string[] = []
  const alerts: { text: string; notified: string[] }[] = []
  const logs: string[] = []
  mon = new UsageMonitor({
    read: async (l) => {
      reads.push(l.key)
      return results.length > 1 ? results.shift()! : results[0]
    },
    onChange: () => {},
    onAlert: (text, notified) => alerts.push({ text, notified }),
    labelOf: (id) => id,
    notified: extra.notified ?? [],
    log: (m) => logs.push(m),
  })
  return { mon, reads, alerts, logs }
}

describe('UsageMonitor', () => {
  it('lê ao entrar e a cada 5 min', async () => {
    const { mon, reads } = make([ok(10)])
    mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(0)
    expect(reads).toEqual(['claude:/a'])
    expect(mon.views()[0]).toMatchObject({ loginKey: 'claude:/a', accountIds: ['a'], status: 'ok', plan: 'max', windows: [{ percent: 10 }] })
    await vi.advanceTimersByTimeAsync(299_000)
    expect(reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reads).toHaveLength(2)
  })

  it('poke (Stop) antecipa respeitando 60 s desde a última leitura', async () => {
    const { mon, reads } = make([ok(10)])
    mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(10_000)
    mon.poke('a')
    await vi.advanceTimersByTimeAsync(49_000)
    expect(reads).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(reads).toHaveLength(2)
    mon.poke('desconhecido') // não quebra
  })

  it('retry: mantém o último valor como stale e dobra o intervalo até 30 min', async () => {
    const { mon, reads, logs } = make([ok(10), { kind: 'retry', reason: 'HTTP 429' }, { kind: 'retry', reason: 'HTTP 429' }, { kind: 'retry', reason: 'HTTP 429' }, { kind: 'retry', reason: 'HTTP 429' }, ok(12)])
    mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(300_000) // 2ª leitura: retry
    expect(mon.views()[0]).toMatchObject({ status: 'stale', windows: [{ percent: 10 }] })
    await vi.advanceTimersByTimeAsync(600_000) // 10 min
    expect(reads).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1_200_000) // 20 min
    expect(reads).toHaveLength(4)
    await vi.advanceTimersByTimeAsync(1_800_000) // teto de 30 min (seria 40)
    expect(reads).toHaveLength(5)
    await vi.advanceTimersByTimeAsync(1_800_000)
    expect(mon.views()[0]).toMatchObject({ status: 'ok', windows: [{ percent: 12 }] })
    expect(logs).toHaveLength(2) // 1x/hora por login e tipo: aos 5 min e de novo aos 65 min
  })

  it('expired sem leitura anterior vira dica; com leitura anterior vira ~ (expired)', async () => {
    const a = make([{ kind: 'expired' }])
    a.mon.setLogins([L('claude:/a', ['a', 'b'])])
    await vi.advanceTimersByTimeAsync(0)
    expect(a.mon.views()).toEqual([])
    expect(Object.keys(a.mon.hints())).toEqual(['a', 'b'])
    a.mon.stop()
    const b = make([ok(10), { kind: 'expired' }])
    b.mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(300_000)
    expect(b.mon.views()[0]).toMatchObject({ status: 'expired', windows: [{ percent: 10 }] })
  })

  it('no-token some da barra; bad-format vira unavailable', async () => {
    const { mon } = make([ok(10), { kind: 'no-token' }, { kind: 'bad-format', reason: 'campos desconhecidos' }])
    mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(300_000)
    expect(mon.views()).toEqual([])
    expect(mon.hints().a).toBeTruthy()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(mon.views()[0]).toMatchObject({ status: 'unavailable', windows: [] })
  })

  it('setLogins remove logins que sumiram (ex.: padrão trocado pelo diretório real)', async () => {
    const { mon } = make([ok(10)])
    mon.setLogins([L('claude:', ['misa'])])
    await vi.advanceTimersByTimeAsync(0)
    mon.setLogins([L('claude:/s/1-m', ['misa'])])
    await vi.advanceTimersByTimeAsync(0)
    expect(mon.views().map((v) => v.loginKey)).toEqual(['claude:/s/1-m'])
  })

  it('avisa uma vez por limiar, não repete com notified salvo e mostra 0% após reset', async () => {
    const reset = new Date(2026, 9, 5, 9, 0).getTime()
    const { mon, alerts } = make([ok(81, reset)])
    mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(300_000)
    expect(alerts.map((x) => x.text)).toEqual(['a: 80% da janela semanal · renova seg 09:00'])
    const saved = alerts[0].notified
    mon.stop()
    const again = make([ok(83, reset)], { notified: saved })
    again.mon.setLogins([L('claude:/a', ['a'])])
    await vi.advanceTimersByTimeAsync(0)
    expect(again.alerts).toEqual([])
    vi.setSystemTime(reset + 1)
    expect(again.mon.views()[0].windows[0]).toEqual({ kind: 'week', percent: 0, resetsAt: null })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/usage-monitor.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

`src/daemon/usage/monitor.ts`:

```ts
import type { UsageView } from '../../shared/types'
import { crossings, pruneNotified } from './alerts'
import { applyResets } from './logins'
import type { Login, ReadResult } from './types'

export interface MonitorDeps {
  read: (login: Login) => Promise<ReadResult>
  onChange: () => void
  onAlert: (text: string, notified: string[]) => void
  labelOf: (accountId: string) => string
  notified: string[]
  log?: (msg: string) => void
  intervalMs?: number
  minGapMs?: number
  maxBackoffMs?: number
}

interface Entry {
  login: Login
  view: UsageView | null
  hint: string | null
  timer: NodeJS.Timeout | null
  running: boolean
  pending: boolean
  lastReadAt: number
  failures: number
}

const HINT = {
  expired: 'token vencido: abra uma sessão deste agente para atualizar',
  'no-token': 'sem login do plano (Keychain ou .credentials.json)',
  'no-data': 'o Codex ainda não registrou limites: use-o uma vez',
} as const

export class UsageMonitor {
  private entries = new Map<string, Entry>()
  private notified: Set<string>
  private logged = new Map<string, number>()
  private stopped = false
  private interval: number
  private minGap: number
  private maxBackoff: number

  constructor(private d: MonitorDeps) {
    this.notified = new Set(d.notified)
    this.interval = d.intervalMs ?? 300_000
    this.minGap = d.minGapMs ?? 60_000
    this.maxBackoff = d.maxBackoffMs ?? 1_800_000
  }

  setLogins(logins: Login[]): void {
    const keep = new Set(logins.map((l) => l.key))
    for (const [k, e] of this.entries) {
      if (keep.has(k)) continue
      if (e.timer) clearTimeout(e.timer)
      this.entries.delete(k)
    }
    for (const l of logins) {
      const e = this.entries.get(l.key)
      if (e) {
        e.login = l
        if (e.view) e.view = { ...e.view, accountIds: l.accountIds }
        continue
      }
      const fresh: Entry = { login: l, view: null, hint: null, timer: null, running: false, pending: false, lastReadAt: 0, failures: 0 }
      this.entries.set(l.key, fresh)
      void this.run(fresh)
    }
    this.d.onChange()
  }

  /** um Stop do agente: lê de novo logo, respeitando o intervalo mínimo */
  poke(accountId: string): void {
    const e = [...this.entries.values()].find((x) => x.login.accountIds.includes(accountId))
    if (!e || this.stopped) return
    if (e.running) {
      e.pending = true
      return
    }
    this.schedule(e, Math.max(0, e.lastReadAt + this.minGap - Date.now()))
  }

  views(): UsageView[] {
    const now = Date.now()
    return [...this.entries.values()].filter((e) => e.view).map((e) => ({ ...e.view!, windows: applyResets(e.view!.windows, now) }))
  }

  hints(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const e of this.entries.values()) if (!e.view && e.hint) for (const id of e.login.accountIds) out[id] = e.hint
    return out
  }

  stop(): void {
    this.stopped = true
    for (const e of this.entries.values()) if (e.timer) clearTimeout(e.timer)
  }

  private schedule(e: Entry, ms: number): void {
    if (e.timer) clearTimeout(e.timer)
    e.timer = setTimeout(() => void this.run(e), ms)
  }

  private async run(e: Entry): Promise<void> {
    if (this.stopped || e.running) return
    e.running = true
    if (e.timer) clearTimeout(e.timer)
    e.timer = null
    let r: ReadResult
    try {
      r = await this.d.read(e.login)
    } catch {
      r = { kind: 'retry', reason: 'erro na leitura' }
    }
    e.running = false
    if (this.stopped || this.entries.get(e.login.key) !== e) return
    e.lastReadAt = Date.now()
    this.apply(e, r)
    const delay = r.kind === 'retry' ? Math.min(this.interval * 2 ** e.failures, this.maxBackoff) : this.interval
    if (e.pending) {
      e.pending = false
      this.schedule(e, this.minGap)
    } else this.schedule(e, delay)
    this.d.onChange()
  }

  private apply(e: Entry, r: ReadResult): void {
    const base = { loginKey: e.login.key, agent: e.login.agent, accountIds: e.login.accountIds }
    if (r.kind !== 'retry') e.failures = 0
    switch (r.kind) {
      case 'ok':
        e.hint = null
        e.view = { ...base, windows: r.windows, plan: r.plan, readAt: Date.now(), status: 'ok' }
        this.alert(e)
        break
      case 'retry':
        e.failures++
        this.log(e, 'retry', r.reason)
        if (e.view) e.view = { ...e.view, status: 'stale' }
        break
      case 'expired':
        if (e.view) e.view = { ...e.view, status: 'expired' }
        else e.hint = HINT.expired
        break
      case 'no-token':
      case 'no-data':
        e.view = null
        e.hint = HINT[r.kind]
        break
      case 'bad-format':
        this.log(e, 'bad-format', r.reason)
        e.view = { ...base, windows: [], plan: e.view?.plan ?? null, readAt: e.view?.readAt ?? null, status: 'unavailable' }
        break
    }
  }

  private alert(e: Entry): void {
    const now = Date.now()
    this.notified = new Set(pruneNotified(this.notified, now))
    const label = this.d.labelOf(e.login.accountIds[0])
    for (const c of crossings(e.login.key, label, applyResets(e.view!.windows, now), this.notified, now)) {
      c.keys.forEach((k) => this.notified.add(k))
      this.d.onAlert(c.text, [...this.notified])
    }
  }

  /** no máximo 1x/hora por login e tipo; nunca inclui token nem corpo de resposta */
  private log(e: Entry, kind: string, reason: string): void {
    const key = `${e.login.key}|${kind}`
    const now = Date.now()
    if ((this.logged.get(key) ?? -Infinity) > now - 3_600_000) return
    this.logged.set(key, now)
    this.d.log?.(`uso do plano ${e.login.key}: ${kind} (${reason})`)
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/daemon/usage-monitor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/usage/monitor.ts tests/daemon/usage-monitor.test.ts
git commit -m "feat(uso): monitor com agenda, backoff, estados e avisos"
```

---

### Task 6: Ligar no daemon — hooks, agentes, estado e alerta

**Files:**
- Create: `src/daemon/usage/read.ts`
- Modify: `src/shared/protocol.ts`, `src/daemon/daemon.ts`, `src/daemon/main.ts`, `tests/helpers/app-client.ts`
- Test: `tests/daemon/daemon.test.ts`

**Interfaces:**
- Consumes: tudo das Tasks 1–5.
- Produces:
  - `ServerMessage` com `{ t: 'usage.alert'; text: string }`
  - `DaemonOptions.usageRead?: (login: Login) => Promise<ReadResult>` (padrão inerte: `{ kind: 'no-token' }`)
  - `DaemonOptions.usageIntervalMs?: number`
  - `makeUsageReader(o: { userHome: string }): (login: Login) => Promise<ReadResult>`
  - `connectApp(...).alerts(): string[]` (helper de teste)

- [ ] **Step 1: Helper de teste**

Em `tests/helpers/app-client.ts`, crie `const alerts: string[] = []` junto de `data`; no `onMessage`, acrescente `if (m.t === 'usage.alert') alerts.push(m.text)`; no objeto retornado, `alerts: () => alerts,`.

- [ ] **Step 2: Teste que falha**

Em `tests/daemon/daemon.test.ts`, no `describe` principal, adicione:

```ts
  it('uso do plano: login aprendido pelo hook, agrupado, sem gateway e com aviso', async () => {
    repo = makeRepo()
    const reads: string[] = []
    const { o, app } = await boot({
      usageRead: async (l) => {
        reads.push(l.key)
        return { kind: 'ok', plan: 'max', windows: [{ kind: 'week', percent: 85, resetsAt: null }] }
      },
    })
    // misa é o padrão: começa lendo o diretório padrão
    await app.waitState((s) => s.usage.some((u) => u.loginKey === 'claude:'))
    let st = app.state()!
    expect(st.usageHints['weboption-max']).toBeTruthy() // ainda sem login descoberto
    expect(st.usageHints.weboption).toBeUndefined() // gateway: nem aparece

    await app.client.request({ t: 'project.add', path: repo.dir })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    const mslabs = '/Users/u/.claude-swap-backup/sessions/3-misael_mslabs-dev.com'
    await hook(o, paneId, { session_id: 's1', cwd: repo.dir, hook_event_name: 'SessionStart', source: 'startup' }, mslabs)
    st = await app.waitState((s) => s.usage.some((u) => u.loginKey === `claude:${mslabs}`))
    expect(st.usage.find((u) => u.loginKey === `claude:${mslabs}`)).toMatchObject({ accountIds: ['mslabs'], status: 'ok' })
    expect(reads).toContain(`claude:${mslabs}`)
    await app.waitState(() => app.alerts().includes('mslabs: 80% da janela semanal'))
    await waitFor(() => JSON.parse(fs.readFileSync(o.stateFile, 'utf8')).loginDirs?.mslabs === mslabs)
  })
```

Se `waitFor` ainda não estiver importado nesse arquivo, adicione `import { waitFor } from '../helpers/wait'`.

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/daemon.test.ts -t "uso do plano"`
Expected: FAIL (`usageRead` não existe / `usage` vazio).

- [ ] **Step 4: Implementar**

`src/shared/protocol.ts` — em `ServerMessage`, acrescente a variante:

```ts
  | { t: 'usage.alert'; text: string }
```

`src/daemon/usage/read.ts`:

```ts
import fs from 'node:fs'
import { readClaude, realKeychain, type ClaudeDeps } from './claude'
import { readCodex } from './codex'
import type { Login, ReadResult } from './types'

/** leitor real (Keychain/arquivo + rede); só o main.ts do daemon usa */
export function makeUsageReader(o: { userHome: string }): (login: Login) => Promise<ReadResult> {
  const claude: ClaudeDeps = {
    platform: process.platform,
    userHome: o.userHome,
    now: Date.now,
    keychain: realKeychain,
    readFile: (p) => fs.promises.readFile(p, 'utf8').catch(() => null),
    fetch: globalThis.fetch,
  }
  return (login) => (login.agent === 'claude' ? readClaude(login, claude) : readCodex(login, { userHome: o.userHome }))
}
```

`src/daemon/daemon.ts`:

1. Imports:

```ts
import { UsageMonitor } from './usage/monitor'
import { groupLogins, missingLoginHints } from './usage/logins'
import type { Login, ReadResult } from './usage/types'
```

2. Em `DaemonOptions`, depois de `codexHookGraceMs`:

```ts
  /** leitor do uso do plano; padrão inerte (testes não tocam Keychain nem rede). O main.ts passa o real */
  usageRead?: (login: Login) => Promise<ReadResult>
  usageIntervalMs?: number
```

3. Campos da classe: `private usage!: UsageMonitor` e `private logins: Login[] = []`.

4. Em `init()`, logo depois de `this.persisted = p`:

```ts
    this.usage = new UsageMonitor({
      read: this.o.usageRead ?? (async () => ({ kind: 'no-token' })),
      onChange: () => this.changed(false),
      onAlert: (text, notified) => {
        this.persisted.usageNotified = notified
        for (const c of this.server?.conns ?? []) if (c.role === 'app') c.send({ t: 'usage.alert', text })
        this.changed()
      },
      labelOf: (id) => this.persisted.accounts.find((a) => a.id === id)?.label ?? id,
      notified: p.usageNotified,
      log: (m) => console.error(m),
      intervalMs: this.o.usageIntervalMs,
    })
```

5. Em `init()`, logo depois da linha `this.server = await startServer(...)`:

```ts
    this.refreshLogins()
```

6. Novo método privado (perto de `agentsInUse`):

```ts
  private refreshLogins(): void {
    this.logins = groupLogins(this.persisted.accounts, this.persisted.loginDirs)
    this.usage.setLogins(this.logins)
  }

  /** o hook revela o CLAUDE_CONFIG_DIR/CODEX_HOME do agente; Stop antecipa a leitura do uso */
  private onUsageHook(paneId: string, configDir: string, event: string): void {
    const id = this.panes.records().find((r) => r.id === paneId)?.accountId
    if (!id) return
    if (this.persisted.loginDirs[id] !== configDir) {
      this.persisted.loginDirs[id] = configDir
      this.refreshLogins()
      this.changed()
    }
    if (event === 'Stop') this.usage.poke(id)
  }
```

7. No `case 'hook':`, depois do `await this.panes.applyHook(...)`:

```ts
        this.onUsageHook(req.paneId, req.configDir || '', req.payload.hook_event_name)
```

8. No `case 'accounts.save':`, depois de `this.hookWarnings = this.checkHookTargets()`:

```ts
        this.refreshLogins()
```

9. Em `stop()`, depois de `this.monitor.stop()`: `this.usage.stop()`.

10. Em `buildState()`, troque os valores vazios da Task 1 por:

```ts
      usage: this.usage.views(),
      usageHints: { ...missingLoginHints(this.persisted.accounts, this.logins), ...this.usage.hints() },
```

`src/daemon/main.ts` — import `import { makeUsageReader } from './usage/read'` e, no objeto de `Daemon.start`, depois de `shellArgs`:

```ts
    usageRead: makeUsageReader({ userHome: os.homedir() }),
```

- [ ] **Step 5: Rodar e ver passar (e a suíte toda)**

Run: `npx vitest run tests/daemon/daemon.test.ts -t "uso do plano" && npm test && npm run typecheck`
Expected: PASS em tudo.

- [ ] **Step 6: Commit**

```bash
git add src/shared/protocol.ts src/daemon/usage/read.ts src/daemon/daemon.ts src/daemon/main.ts tests
git commit -m "feat(uso): monitor de uso no daemon (login pelo hook, Stop, estado e aviso)"
```

---

### Task 7: Interface — status bar, ⌘T, aba Agentes e notificação

**Files:**
- Create: `src/renderer/src/usage-model.ts`
- Modify: `src/renderer/src/components/StatusBar.tsx`, `src/renderer/src/components/NewSessionDialog.tsx`, `src/renderer/src/components/AgentsPanel.tsx`, `src/renderer/src/main.tsx`, `src/renderer/src/styles.css`
- Test: `tests/renderer/usage-model.test.ts`

**Interfaces:**
- Consumes: `AppState.usage`, `AppState.usageHints`, `Account.planUsage` (Task 1); `formatClock`, `formatReset` (Task 4); `ServerMessage usage.alert` (Task 6).
- Produces:
  - `levelOf(percent: number): 'ok' | 'warn' | 'bad'`
  - `usageChips(app: Pick<AppState, 'usage' | 'accounts'>, now: number): UsageChip[]`
  - `accountUsage(app: Pick<AppState, 'usage' | 'usageHints'>, accountId: string): { text: string | null; hint: string | null }`

- [ ] **Step 1: Teste que falha**

`tests/renderer/usage-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { accountUsage, levelOf, usageChips } from '../../src/renderer/src/usage-model'
import type { Account, UsageView } from '../../src/shared/types'

const acc = (id: string, color: string, agent: 'claude' | 'codex' = 'claude'): Account => ({ id, label: id, command: id, color, agent, configDirMatch: [], isDefault: false, settingsMatch: null, pathPrefix: null })
const now = new Date(2026, 8, 28, 10, 0).getTime()
const view = (over: Partial<UsageView>): UsageView => ({ loginKey: 'claude:/a', agent: 'claude', accountIds: ['misa'], windows: [], plan: null, readAt: now, status: 'ok', ...over })

describe('usage-model', () => {
  it('níveis 80/95', () => {
    expect([79.9, 80, 94.9, 95].map(levelOf)).toEqual(['ok', 'warn', 'warn', 'bad'])
  })

  it('chips: Claude mostra 5h e sem (— se faltar); Codex só o que vier; cor do agente', () => {
    const app = {
      accounts: [acc('misa', '#4fc1ff'), acc('codex', '#10a37f', 'codex')],
      usage: [
        view({ windows: [{ kind: 'week', percent: 81.6, resetsAt: new Date(2026, 9, 5, 9, 0).getTime() }], plan: 'max' }),
        view({ loginKey: 'codex:', agent: 'codex', accountIds: ['codex'], windows: [{ kind: 'week', percent: 31, resetsAt: null }] }),
      ],
    }
    const [c, x] = usageChips(app, now)
    expect(c).toMatchObject({ label: 'misa', color: '#4fc1ff', dim: false, unavailable: false })
    expect(c.parts).toEqual([
      { text: '5h —', level: 'ok' },
      { text: 'sem 82%', level: 'warn' },
    ])
    expect(c.tooltip).toBe('plano max\nsem: 82% · renova seg 09:00\nlido às 10:00')
    expect(x.parts).toEqual([{ text: 'sem 31%', level: 'ok' }])
  })

  it('stale/expired ficam apagados com ~; unavailable mostra indisponível', () => {
    const app = { accounts: [acc('misa', '#fff')], usage: [view({ status: 'expired', windows: [{ kind: '5h', percent: 40, resetsAt: null }] })] }
    const [c] = usageChips(app, now)
    expect(c.dim).toBe(true)
    expect(c.parts[0].text).toBe('~5h 40%')
    expect(c.tooltip).toContain('abra uma sessão desta conta para atualizar')
    const [u] = usageChips({ accounts: app.accounts, usage: [view({ status: 'unavailable' })] }, now)
    expect(u).toMatchObject({ unavailable: true, parts: [] })
  })

  it('texto do ⌘T por agente, ou a dica quando não há uso', () => {
    const app = { usage: [view({ accountIds: ['wo-max'], windows: [{ kind: '5h', percent: 7, resetsAt: null }, { kind: 'week', percent: 61, resetsAt: null }] })], usageHints: { mslabs: 'sem login' } }
    expect(accountUsage(app, 'wo-max')).toEqual({ text: '5h 7% · sem 61%', hint: null })
    expect(accountUsage(app, 'mslabs')).toEqual({ text: null, hint: 'sem login' })
    expect(accountUsage(app, 'outro')).toEqual({ text: null, hint: null })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/renderer/usage-model.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o modelo**

`src/renderer/src/usage-model.ts`:

```ts
import type { AppState, UsageView, UsageWindow } from '../../shared/types'
import { formatClock, formatReset } from '../../shared/usage-format'

export type Level = 'ok' | 'warn' | 'bad'

export interface UsageChip {
  key: string
  label: string
  color: string
  parts: { text: string; level: Level }[]
  dim: boolean
  unavailable: boolean
  tooltip: string
}

export const levelOf = (p: number): Level => (p >= 95 ? 'bad' : p >= 80 ? 'warn' : 'ok')

const SHORT: Record<UsageWindow['kind'], string> = { '5h': '5h', week: 'sem' }

function parts(v: UsageView): { text: string; level: Level }[] {
  const dim = v.status === 'stale' || v.status === 'expired'
  const kinds: UsageWindow['kind'][] = v.agent === 'claude' ? ['5h', 'week'] : v.windows.map((w) => w.kind)
  return kinds.map((k) => {
    const w = v.windows.find((x) => x.kind === k)
    return { text: `${dim ? '~' : ''}${SHORT[k]} ${w ? `${Math.round(w.percent)}%` : '—'}`, level: w ? levelOf(w.percent) : 'ok' }
  })
}

export function usageChips(app: Pick<AppState, 'usage' | 'accounts'>, now: number): UsageChip[] {
  return app.usage.map((v) => {
    const acc = app.accounts.find((a) => a.id === v.accountIds[0])
    const lines: string[] = []
    if (v.plan) lines.push(`plano ${v.plan}`)
    for (const w of v.windows) lines.push(`${SHORT[w.kind]}: ${Math.round(w.percent)}%${w.resetsAt !== null ? ` · ${formatReset(w.resetsAt, now)}` : ''}`)
    if (v.readAt !== null) lines.push(`lido às ${formatClock(v.readAt)}`)
    if (v.status === 'expired') lines.push('token vencido: abra uma sessão desta conta para atualizar')
    if (v.status === 'stale') lines.push('não foi possível atualizar agora')
    if (v.status === 'unavailable') lines.push('o formato da resposta mudou: uso indisponível')
    const unavailable = v.status === 'unavailable'
    return {
      key: v.loginKey,
      label: acc?.label ?? v.accountIds[0],
      color: acc?.color ?? '#888888',
      parts: unavailable ? [] : parts(v),
      dim: v.status === 'stale' || v.status === 'expired',
      unavailable,
      tooltip: lines.join('\n'),
    }
  })
}

export function accountUsage(app: Pick<AppState, 'usage' | 'usageHints'>, accountId: string): { text: string | null; hint: string | null } {
  const v = app.usage.find((u) => u.accountIds.includes(accountId))
  if (v && v.status !== 'unavailable') return { text: parts(v).map((p) => p.text).join(' · '), hint: null }
  return { text: null, hint: app.usageHints[accountId] ?? null }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/renderer/usage-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Componentes**

`src/renderer/src/components/StatusBar.tsx` — import `import { usageChips } from '../usage-model'`. Antes do `</div>` final do `statusbar`:

```tsx
      <span className="st-spacer" />
      {usageChips(app, Date.now()).map((c) => (
        <span key={c.key} className={`st-usage${c.dim ? ' u-dim' : ''}`} title={c.tooltip}>
          <span style={{ color: c.color }}>{c.label}</span>
          {c.unavailable ? (
            <span className="u-dim">indisponível</span>
          ) : (
            c.parts.map((p, i) => (
              <span key={i} className={p.level === 'bad' ? 'u-bad' : p.level === 'warn' ? 'u-warn' : undefined}>
                {i > 0 ? '· ' : ''}
                {p.text}
              </span>
            ))
          )}
        </span>
      ))}
```

`src/renderer/src/components/NewSessionDialog.tsx` — import `import { accountUsage } from '../usage-model'`. No cartão de conta, depois do `<span className="card-note">{AGENT_LABEL[a.agent]}</span>`:

```tsx
                    {(() => {
                      const u = accountUsage(app, a.id)
                      return u.text ? <span className="card-note">{u.text}</span> : u.hint ? <span className="card-note" title={u.hint}>uso: —</span> : null
                    })()}
```

`src/renderer/src/components/AgentsPanel.tsx` — logo depois do `<input ... placeholder="comando digitado no shell" />`:

```tsx
          <label className="check">
            <input type="checkbox" checked={a.planUsage !== false} onChange={(e) => set(i, { planUsage: e.target.checked })} /> usa o plano (mostrar uso)
          </label>
```

`src/renderer/src/main.tsx` — no `switch` de `window.gt.onEvent`, antes do fechamento:

```ts
    case 'usage.alert':
      window.gt.notify({ paneId: '', title: 'Uso do plano', body: e.text })
      break
```

e troque `window.gt.onReveal((paneId) => revealPane(paneId))` por:

```ts
window.gt.onReveal((paneId) => {
  if (paneId) revealPane(paneId) // aviso de uso não tem painel
})
```

`src/renderer/src/styles.css` — perto das regras `.st-item`:

```css
.st-spacer { flex: 1; }
.st-usage { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.u-warn { color: var(--warn); }
.u-bad { color: var(--error); }
.u-dim { opacity: 0.55; }
```

- [ ] **Step 6: Suíte, typecheck e build**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS e build sem erro.

- [ ] **Step 7: Commit**

```bash
git add src/renderer tests/renderer/usage-model.test.ts
git commit -m "feat(uso): uso do plano na status bar, no ⌘T, na aba Agentes e aviso"
```

---

### Task 8: Teste real com o usuário

**Files:** nenhum (só ajustes se algo divergir, cada um com teste).

- [ ] **Step 1: Rodar isolado**

Run: `GT_HOME=/tmp/gt-uso npm run dev`

Esse `GT_HOME` começa sem agentes: use o assistente ou copie as contas. Peça ao usuário para aprovar o acesso ao Keychain se o macOS pedir.

- [ ] **Step 2: Conferir com o usuário**

1. A barra mostra `misa`, `mslabs`, `weboption-max` e `codex`, sem `weboption`.
2. Os números batem com `/usage` numa sessão de cada conta Claude e com `/status` no Codex (±1 ponto).
3. Tooltips com plano, reset e "lido às".
4. ⌘T mostra o resumo em cada cartão.
5. Aba Agentes: desmarcar "usa o plano" de um agente tira o item da barra ao salvar.
6. Aviso: rode `npx vitest run tests/daemon/usage-monitor.test.ts -t avisa` para lembrar o formato, e confirme com o usuário se ele quer forçar um aviso real (baixar temporariamente `THRESHOLDS` para `[1, 2]` localmente, **sem commitar**) para ver a notificação do macOS.
7. `grep -c "tok\|Bearer" ~/.gerenciador-terminal/daemon.log` → `0`.

- [ ] **Step 3: Registrar o resultado**

Anote no PR (ou no commit final) o que foi conferido e as diferenças encontradas.
