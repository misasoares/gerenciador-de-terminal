# Agentes (Claude + Codex), setup e build Linux — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar contas em agentes Claude/Codex configuráveis (assistente + Preferências), fazer os hooks funcionarem no Codex e gerar um AppImage x64 testado num Linux de verdade.

**Architecture:** O tipo `Account` ganha `agent: 'claude' | 'codex'` (o nome interno fica, por compatibilidade com o `state.json`). Os hooks passam a ser instalados por tipo de agente: Claude em `settings.json`, Codex em `hooks.json`. O `gt-hook` recebe o tipo como argumento e responde `{}` ao Codex. O poller reconhece `claude` e `codex`. Na interface, o assistente e a aba "Agentes" das Preferências. O build Linux roda num container `linux/amd64`.

**Tech Stack:** a mesma do projeto; Codex CLI 0.155 (hooks em `~/.codex/hooks.json`); Docker via colima (`electronuserland/builder` / Node 22) para Linux.

**Spec:** `docs/superpowers/specs/2026-09-28-agentes-codex-linux-design.md`

## Global Constraints

- O nome interno continua `Account`/`accountId`; a interface diz "agente".
- Comando registrado para o Claude **inalterado**: `sh -c '[ -x "$0" ] && exec "$0"; cat >/dev/null' "<script>"`.
- Comando do Codex: `sh -c '[ -x "$0" ] && exec "$0" codex; cat >/dev/null; printf "{}"' "<script>"`.
- Eventos do Codex: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`, `Interrupt`, `SessionEnd`.
- Arquivo de hooks do Codex: `$CODEX_HOME/hooks.json`, com padrão `~/.codex/hooks.json`. Só entra na checagem se houver algum agente Codex.
- O app nunca aprova hooks do Codex sozinho (nada de `--dangerously-bypass-hook-trust`).
- Sugestões: Claude → `claude --dangerously-skip-permissions` (cor `#d97757`); Codex → `codex --yolo` (cor `#10a37f`).
- Instalação nova começa com `accounts: []`; contas antigas sem `agent` viram `claude`.
- Rodar testes com `rtk proxy npx vitest run`. Sockets de teste em `os.tmpdir()` (limite de 104 bytes).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Hooks já instalados do usuário não podem ficar "faltando"** depois da mudança: o comando do Claude precisa continuar byte a byte igual. → teste na Task 2.
2. **O `hooks.json` do Codex de quem já tem hooks próprios** precisa manter os deles e criar o arquivo se não existir, sem quebrar se o JSON estiver vazio ou for inválido (inválido → erro, sem sobrescrever). → teste na Task 2.
3. **stdout do hook no Codex** tem que ser exatamente `{}`, inclusive sem daemon, fora do app e com o script ausente. Qualquer outro texto quebra o `Stop` do Codex. → teste na Task 2.
4. **Salvar agentes inválidos** (id repetido, comando vazio, cor fora do formato) precisa ser recusado com mensagem clara, sem corromper o `state.json`. → teste na Task 1.
5. **Processo `codex` como Node** (`node …/bin/codex --yolo`) e o binário nativo filho precisam ser reconhecidos como uma sessão Codex, sem confundir com um arquivo ou pasta chamado "codex" num argumento qualquer. → teste na Task 3.

---

### Task 1: Modelo de agente, sugestões, validação, migração e requisições

**Files:**
- Modify: `src/shared/types.ts` (`Account.agent`, `AgentKind`), `src/shared/protocol.ts`, `src/daemon/accounts.ts`, `src/daemon/persist.ts`, `src/daemon/daemon.ts`, `src/daemon/panes.ts` (chamadas de `detectAccount`)
- Modify (dados de teste): `tests/daemon/accounts.test.ts`, `tests/daemon/persist.test.ts`
- Test: `tests/daemon/agents.test.ts`, `tests/daemon/daemon.test.ts` (casos novos)

**Interfaces:**
- Produces:
  - `type AgentKind = 'claude' | 'codex'`; `Account.agent: AgentKind`
  - `suggestAgents(detected: { claude: boolean; codex: boolean }): Account[]` (sempre devolve os dois; o assistente marca pelo `detected`)
  - `validateAccounts(list: Account[]): string | null` (mensagem de erro ou null)
  - `detectAccount(accounts, agent: AgentKind, configDir, argv)`
  - `migrateAccounts(list: unknown[]): Account[]` (preenche `agent: 'claude'` e campos ausentes)
  - requisições `{ t: 'accounts.save'; accounts: Account[] }` e `{ t: 'agents.detect' }` → `{ claude: boolean; codex: boolean }`
  - `DaemonOptions.detectShell?: string` (teste injeta um shell falso)

- [ ] **Step 1: Testes que falham — `tests/daemon/agents.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { detectAccount, migrateAccounts, suggestAgents, validateAccounts } from '../../src/daemon/accounts'
import type { Account } from '../../src/shared/types'

const acc = (over: Partial<Account>): Account => ({ id: 'x', label: 'X', command: 'x', color: '#111111', agent: 'claude', configDirMatch: [], isDefault: false, settingsMatch: null, pathPrefix: null, ...over })

describe('agentes', () => {
  it('sugere Claude e Codex em modo yolo', () => {
    expect(suggestAgents({ claude: true, codex: true }).map((a) => [a.id, a.agent, a.command, a.isDefault])).toEqual([
      ['claude', 'claude', 'claude --dangerously-skip-permissions', true],
      ['codex', 'codex', 'codex --yolo', true],
    ])
  })

  it('valida id único, campos obrigatórios, cor e tipo', () => {
    expect(validateAccounts([acc({ id: 'a' }), acc({ id: 'b' })])).toBeNull()
    expect(validateAccounts([acc({ id: 'a' }), acc({ id: 'a' })])).toMatch(/repetido/)
    expect(validateAccounts([acc({ id: 'A B' })])).toMatch(/id inválido/)
    expect(validateAccounts([acc({ command: '  ' })])).toMatch(/comando/)
    expect(validateAccounts([acc({ label: '' })])).toMatch(/nome/)
    expect(validateAccounts([acc({ color: 'red' })])).toMatch(/cor/)
    expect(validateAccounts([acc({ agent: 'kimi' as never })])).toMatch(/tipo/)
  })

  it('migra contas antigas para o tipo claude', () => {
    const old = [{ id: 'misa', label: 'misa', command: 'claude', color: '#4fc1ff', configDirMatch: ['1-misa'], isDefault: true, settingsMatch: null, pathPrefix: null }]
    expect(migrateAccounts(old)[0]).toMatchObject({ id: 'misa', agent: 'claude', configDirMatch: ['1-misa'] })
  })

  it('detecção olha só os agentes do mesmo tipo', () => {
    const list = [acc({ id: 'c', agent: 'claude', isDefault: true }), acc({ id: 'x', agent: 'codex', isDefault: true }), acc({ id: 'x2', agent: 'codex', configDirMatch: ['/.codex-trabalho'] })]
    expect(detectAccount(list, 'claude', null, null)).toBe('c')
    expect(detectAccount(list, 'codex', null, null)).toBe('x')
    expect(detectAccount(list, 'codex', '/Users/u/.codex-trabalho', null)).toBe('x2')
  })
})
```

Em `tests/daemon/daemon.test.ts` (antes de `'erros de requisição…'`):
```ts
  it('agentes: salva válidos, recusa inválidos sem mexer no estado, detecta CLIs pelo shell', async () => {
    const shell = path.join(fs.realpathSync(os.tmpdir()), `gt-fake-shell-${process.pid}.sh`)
    fs.writeFileSync(shell, '#!/bin/sh\necho claude\n', { mode: 0o755 })
    const { app } = await boot({ detectShell: shell })
    const claude = { id: 'claude', label: 'Claude', command: 'claude --dangerously-skip-permissions', color: '#d97757', agent: 'claude' as const, configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null }
    await app.client.request({ t: 'accounts.save', accounts: [claude] })
    await app.waitState((s) => s.accounts.length === 1 && s.accounts[0].agent === 'claude')
    await expect(app.client.request({ t: 'accounts.save', accounts: [claude, claude] })).rejects.toThrow('repetido')
    expect(app.state()!.accounts).toHaveLength(1)
    await expect(app.client.request({ t: 'agents.detect' })).resolves.toEqual({ claude: true, codex: false })
  })
```

Em `tests/daemon/persist.test.ts`, troque a expectativa do teste "arquivo ausente" para `expect(p.accounts).toEqual([])` (e remova o import de `DEFAULT_ACCOUNTS` se ficar sem uso).

Em `tests/daemon/accounts.test.ts`: `detectAccount(DEFAULT_ACCOUNTS, X, Y)` vira `detectAccount(DEFAULT_ACCOUNTS, 'claude', X, Y)` em todas as chamadas.

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run tests/daemon/agents.test.ts tests/daemon/daemon.test.ts -t "agentes"`
Expected: FAIL.

- [ ] **Step 3: Tipos e protocolo**

`src/shared/types.ts`: antes de `export interface Account`, acrescente `export type AgentKind = 'claude' | 'codex'`; dentro de `Account`, depois de `color: string`:
```ts
  /** qual CLI este agente abre: define hooks, detecção e tipo mostrado na interface */
  agent: AgentKind
```
`src/shared/protocol.ts`: importe `Account` e acrescente:
```ts
  | { t: 'accounts.save'; accounts: Account[] }
  | { t: 'agents.detect' }
```

- [ ] **Step 4: `src/daemon/accounts.ts`**

- Em cada item de `DEFAULT_ACCOUNTS`, acrescente `agent: 'claude'`. Ele fica só como exemplo e dado de teste; o padrão do `state.json` passa a ser `[]`.
- Troque `detectAccount` por:
```ts
export function detectAccount(accounts: Account[], agent: AgentKind, configDir: string | null, argv: string | null): string | null {
  const own = accounts.filter((a) => a.agent === agent)
  const candidates = configDir ? own.filter((a) => a.configDirMatch.some((m) => configDir.includes(m))) : own.filter((a) => a.isDefault)
  if (candidates.length <= 1) return candidates[0]?.id ?? null
  const bySettings = candidates.find((a) => a.settingsMatch && argv?.includes(a.settingsMatch))
  return (bySettings ?? candidates.find((a) => !a.settingsMatch) ?? candidates[0]).id
}
```
- Acrescente:
```ts
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
    }
  })
}
```
(importe `AgentKind` de `../shared/types`).

- [ ] **Step 5: Persistência — `src/daemon/persist.ts`**

- `defaultPersisted()`: `accounts: []`.
- `loadPersisted`: `accounts: Array.isArray(parsed.accounts) ? migrateAccounts(parsed.accounts) : [],`.
- Remova o import de `DEFAULT_ACCOUNTS` se ficar sem uso; importe `migrateAccounts`.

- [ ] **Step 6: Daemon e painéis**

`src/daemon/daemon.ts`:
- `DaemonOptions` ganha `detectShell?: string`.
- Casos novos no `switch`:
```ts
      case 'accounts.save': {
        const err = validateAccounts(req.accounts)
        if (err) throw new Error(err)
        this.persisted.accounts = req.accounts.map((a) => ({ ...a, configDirMatch: [...a.configDirMatch] }))
        this.hookWarnings = this.checkHookTargets()
        this.changed()
        return null
      }
      case 'agents.detect':
        return this.detectAgents()
```
- Método:
```ts
  private detectAgents(): Promise<{ claude: boolean; codex: boolean }> {
    const shell = this.o.detectShell ?? this.o.shell
    const script = 'command -v claude >/dev/null 2>&1 && echo claude; command -v codex >/dev/null 2>&1 && echo codex; true'
    return new Promise((resolve) => {
      execFile(shell, ['-ilc', script], { timeout: 15_000, env: buildPaneEnv(this.o.env ?? process.env) }, (_err, stdout) => {
        const found = new Set(String(stdout ?? '').split(/\s+/))
        resolve({ claude: found.has('claude'), codex: found.has('codex') })
      })
    })
  }
```
(importe `execFile` de `node:child_process`, e `validateAccounts` de `./accounts`). Até a Task 2, `checkHookTargets()` é `checkProfiles(this.o.userHome, this.hookCmd)`: crie o método com esse corpo e troque as duas chamadas diretas a `checkProfiles` por ele.

`src/daemon/panes.ts`: nas duas chamadas `detectAccount(this.d.accounts(), X, Y)`, passe o tipo: `detectAccount(this.d.accounts(), 'claude', X, Y)`. A Task 3 troca pelo tipo real da sessão.

- [ ] **Step 7: Rodar e ver passar**

Run: `rtk proxy npx vitest run && rtk proxy npm run typecheck`
Expected: verde. Testes do renderer com `Account` literal (se houver) ganham `agent: 'claude'`; o `DEFAULT_ACCOUNTS` já tem.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: agentes Claude/Codex no modelo, validação, migração, salvar e detectar CLIs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Hooks do Codex (script, comando, eventos, arquivo e instalação)

**Files:**
- Modify: `src/daemon/hooks.ts`, `src/daemon/daemon.ts`, `src/shared/protocol.ts` (hook `agent`)
- Test: `tests/daemon/codex-hooks.test.ts`

**Interfaces:**
- Produces:
  - `CLAUDE_HOOK_EVENTS` (a lista atual, renomeada; `HOOK_EVENTS` continua exportado como alias) e `CODEX_HOOK_EVENTS`
  - `hookCommand(scriptPath: string, agent?: AgentKind): string` (claude = o comando atual, inalterado)
  - `mergeHooks(settings, command, events?)`, `hasHooks(settings, command, events?)`, `installHooks(file, command, events?)`
  - `codexHooksFile(userHome: string, env?: NodeJS.ProcessEnv): string`
  - `interface HookTarget { file: string; agent: AgentKind }`; `hookTargets(userHome: string, agents: Set<AgentKind>, env?): HookTarget[]`; `checkTargets(targets: HookTarget[], commandFor: (a: AgentKind) => string): string[]`
  - requisição de hook: `{ t: 'hook'; paneId: string; configDir: string; agent?: AgentKind; payload: HookPayload }`

- [ ] **Step 1: Testes que falham — `tests/daemon/codex-hooks.test.ts`**

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkTargets, CLAUDE_HOOK_EVENTS, CODEX_HOOK_EVENTS, codexHooksFile, hasHooks, hookCommand, hookTargets, installHooks, writeHookScript } from '../../src/daemon/hooks'
import { startServer, type RpcServer } from '../../src/daemon/server'
import type { ClientRequest } from '../../src/shared/protocol'
import { runWithInput } from '../helpers/run'
import { waitFor } from '../helpers/wait'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cx-')))
let server: RpcServer | null = null
afterEach(async () => { await server?.close(); server = null })

describe('comandos por agente', () => {
  it('Claude: comando idêntico ao já instalado; Codex: passa o tipo e devolve {}', () => {
    expect(hookCommand('/h/gt-hook')).toBe(`sh -c '[ -x "$0" ] && exec "$0"; cat >/dev/null' "/h/gt-hook"`)
    expect(hookCommand('/h/gt-hook', 'claude')).toBe(hookCommand('/h/gt-hook'))
    expect(hookCommand('/h/gt-hook', 'codex')).toBe(`sh -c '[ -x "$0" ] && exec "$0" codex; cat >/dev/null; printf "{}"' "/h/gt-hook"`)
  })
  it('eventos do Codex', () => {
    expect(CODEX_HOOK_EVENTS).toEqual(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd'])
    expect(CLAUDE_HOOK_EVENTS).toContain('CwdChanged')
  })
})

describe('stdout do hook no Codex é sempre {}', () => {
  it('fora do app, sem daemon e com o script ausente', async () => {
    const dir = tmp()
    const script = path.join(dir, 'bin', 'gt-hook')
    writeHookScript(script)
    const cmd = hookCommand(script, 'codex')
    const env = { PATH: '/usr/bin:/bin' }
    expect(await runWithInput('/bin/sh', ['-c', cmd], '{}', env)).toMatchObject({ code: 0, stdout: '{}' })
    expect(await runWithInput('/bin/sh', ['-c', cmd], '{}', { ...env, GT_PANE_ID: 'p', GT_SOCKET: path.join(dir, 'x.sock') })).toMatchObject({ code: 0, stdout: '{}' })
    fs.rmSync(script)
    expect(await runWithInput('/bin/sh', ['-c', cmd], '{}', env)).toMatchObject({ code: 0, stdout: '{}' })
    // Claude continua sem imprimir nada
    writeHookScript(script)
    expect(await runWithInput('/bin/sh', ['-c', hookCommand(script)], '{}', env)).toMatchObject({ code: 0, stdout: '' })
  })

  it('entrega ao daemon com agent=codex e configDir do CODEX_HOME', async () => {
    const dir = tmp()
    const script = path.join(dir, 'bin', 'gt-hook')
    writeHookScript(script)
    const sock = path.join(dir, 'd.sock')
    const got: ClientRequest[] = []
    server = await startServer(sock, (req, conn) => { got.push(req); conn.end(); return null })
    const r = await runWithInput('/bin/sh', ['-c', hookCommand(script, 'codex')], JSON.stringify({ hook_event_name: 'Stop', session_id: 's', cwd: '/w' }), {
      PATH: '/usr/bin:/bin', GT_PANE_ID: 'p1', GT_SOCKET: sock, CODEX_HOME: '/u/.codex-trabalho', CLAUDE_CONFIG_DIR: '/nao/usar',
    })
    expect(r).toMatchObject({ code: 0, stdout: '{}' })
    await waitFor(() => got.length === 1)
    expect(got[0]).toEqual({ t: 'hook', paneId: 'p1', configDir: '/u/.codex-trabalho', agent: 'codex', payload: { hook_event_name: 'Stop', session_id: 's', cwd: '/w' } })
  })
})

describe('arquivo de hooks do Codex', () => {
  it('usa CODEX_HOME ou ~/.codex; só entra na lista se houver agente Codex', () => {
    expect(codexHooksFile('/Users/u', {})).toBe('/Users/u/.codex/hooks.json')
    expect(codexHooksFile('/Users/u', { CODEX_HOME: '/x/cx' })).toBe('/x/cx/hooks.json')
    expect(hookTargets('/Users/u', new Set(['claude']), {}).some((t) => t.agent === 'codex')).toBe(false)
    expect(hookTargets('/Users/u', new Set(['claude', 'codex']), {}).filter((t) => t.agent === 'codex').map((t) => t.file)).toEqual(['/Users/u/.codex/hooks.json'])
  })

  it('cria o hooks.json, preserva hooks alheios e recusa JSON inválido', () => {
    const dir = tmp()
    const file = path.join(dir, '.codex', 'hooks.json')
    const cmd = hookCommand('/h/gt-hook', 'codex')
    installHooks(file, cmd, CODEX_HOOK_EVENTS)
    expect(hasHooks(JSON.parse(fs.readFileSync(file, 'utf8')), cmd, CODEX_HOOK_EVENTS)).toBe(true)
    const own = { description: 'meus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'python3 meu.py' }] }] } }
    fs.writeFileSync(file, JSON.stringify(own))
    installHooks(file, cmd, CODEX_HOOK_EVENTS)
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(saved.description).toBe('meus')
    expect(saved.hooks.Stop[0]).toEqual(own.hooks.Stop[0])
    expect(hasHooks(saved, cmd, CODEX_HOOK_EVENTS)).toBe(true)
    fs.writeFileSync(file, '{ quebrado')
    expect(() => installHooks(file, cmd, CODEX_HOOK_EVENTS)).toThrow('não é um JSON válido')
    expect(fs.readFileSync(file, 'utf8')).toBe('{ quebrado')
  })

  it('checkTargets aponta só o que falta, por tipo', () => {
    const home = tmp()
    fs.mkdirSync(path.join(home, '.claude'))
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{}')
    const targets = hookTargets(home, new Set(['claude', 'codex']), {})
    const cmdFor = (a: 'claude' | 'codex') => hookCommand('/h/gt-hook', a)
    expect(checkTargets(targets, cmdFor).sort()).toEqual([path.join(home, '.claude', 'settings.json'), path.join(home, '.codex', 'hooks.json')].sort())
    installHooks(path.join(home, '.codex', 'hooks.json'), cmdFor('codex'), CODEX_HOOK_EVENTS)
    expect(checkTargets(targets, cmdFor)).toEqual([path.join(home, '.claude', 'settings.json')])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run tests/daemon/codex-hooks.test.ts`
Expected: FAIL.

- [ ] **Step 3: `src/daemon/hooks.ts`**

- Renomeie a lista para `CLAUDE_HOOK_EVENTS`, mantenha `export const HOOK_EVENTS = CLAUDE_HOOK_EVENTS` e acrescente:
```ts
export const CODEX_HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd'] as const
```
- `GT_HOOK_SCRIPT` passa a:
```ts
export const GT_HOOK_SCRIPT = `#!/bin/sh
# gerenciador-terminal: repassa o evento do agente (Claude Code ou Codex) ao daemon do app.
# Uso: gt-hook [claude|codex]. Fora do app (sem GT_PANE_ID) ou sem daemon, não faz nada.
# O Codex exige JSON no stdout do Stop: para ele, sempre responde {}.
agent="\${1:-claude}"
done_() { [ "$agent" = codex ] && printf '{}'; exit 0; }
if [ -z "$GT_PANE_ID" ] || [ ! -S "$GT_SOCKET" ]; then
  cat >/dev/null
  done_
fi
if [ "$agent" = codex ]; then dir="\${CODEX_HOME:-}"; else dir="\${CLAUDE_CONFIG_DIR:-}"; fi
cfg=$(printf '%s' "$dir" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
{
  printf '{"id":0,"req":{"t":"hook","paneId":"%s","configDir":"%s","agent":"%s","payload":' "$GT_PANE_ID" "$cfg" "$agent"
  tr -d '\\n\\r'
  printf '}}\\n'
} | nc -U -w 1 "$GT_SOCKET" >/dev/null 2>&1
done_
`
```
- `hookCommand`:
```ts
export function hookCommand(scriptPath: string, agent: AgentKind = 'claude'): string {
  if (agent === 'codex') return `sh -c '[ -x "$0" ] && exec "$0" codex; cat >/dev/null; printf "{}"' "${scriptPath}"`
  return `sh -c '[ -x "$0" ] && exec "$0"; cat >/dev/null' "${scriptPath}"`
}
```
- `mergeHooks(settings, command, events: readonly string[] = CLAUDE_HOOK_EVENTS)`, `hasHooks(settings, command, events: readonly string[] = CLAUDE_HOOK_EVENTS)` e `installHooks(settingsPath, command, events: readonly string[] = CLAUDE_HOOK_EVENTS)` usam `events` no lugar da lista fixa (o `installHooks` repassa ao `mergeHooks`).
- Novas funções:
```ts
export function codexHooksFile(userHome: string, env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.CODEX_HOME || path.join(userHome, '.codex'), 'hooks.json')
}

export interface HookTarget {
  file: string
  agent: AgentKind
}

export function hookTargets(userHome: string, agents: Set<AgentKind>, env: NodeJS.ProcessEnv = process.env): HookTarget[] {
  const out: HookTarget[] = []
  if (agents.has('claude')) for (const f of settingsFiles(userHome)) out.push({ file: f, agent: 'claude' })
  if (agents.has('codex')) out.push({ file: codexHooksFile(userHome, env), agent: 'codex' })
  return out
}

/** arquivos (reais, sem duplicar symlinks) que ainda não têm o hook do app */
export function checkTargets(targets: HookTarget[], commandFor: (a: AgentKind) => string): string[] {
  const seen = new Set<string>()
  const missing: string[] = []
  for (const t of targets) {
    let real = t.file
    try {
      real = fs.realpathSync(t.file)
    } catch {
      // ainda não existe
    }
    if (seen.has(real)) continue
    seen.add(real)
    const events = t.agent === 'codex' ? CODEX_HOOK_EVENTS : CLAUDE_HOOK_EVENTS
    let ok = false
    try {
      ok = hasHooks(JSON.parse(fs.readFileSync(real, 'utf8')), commandFor(t.agent), events)
    } catch {
      ok = false
    }
    if (!ok) missing.push(t.file)
  }
  return missing
}
```
(importe `AgentKind`). `checkProfiles` continua existindo (usado nos testes da fase 1), agora como `checkTargets(hookTargets(userHome, new Set(['claude'])), () => command)`.

- [ ] **Step 4: Daemon**

Em `src/daemon/daemon.ts`:
- `hookCmd` vira `hookCmdFor(agent: AgentKind)`: `hookCommand(this.canonicalHookScript, agent)`.
- `checkHookTargets()`:
```ts
  private agentsInUse(): Set<AgentKind> {
    const set = new Set<AgentKind>(this.persisted.accounts.map((a) => a.agent))
    if (set.size === 0) set.add('claude') // sem agentes ainda: continua cuidando do Claude, como antes
    return set
  }

  private checkHookTargets(): string[] {
    return checkTargets(hookTargets(this.o.userHome, this.agentsInUse(), this.o.env ?? process.env), (a) => this.hookCmdFor(a))
  }
```
- `hooks.install`:
```ts
      case 'hooks.install': {
        const targets = hookTargets(this.o.userHome, this.agentsInUse(), this.o.env ?? process.env)
        const missing = new Set(this.checkHookTargets())
        for (const t of targets) {
          if (!missing.has(t.file)) continue
          installHooks(t.file, this.hookCmdFor(t.agent), t.agent === 'codex' ? CODEX_HOOK_EVENTS : CLAUDE_HOOK_EVENTS)
        }
        this.hookWarnings = this.checkHookTargets()
        this.changed(false)
        return null
      }
```
- `hook`: passe `req.agent ?? 'claude'` para `applyHook` (a assinatura muda na Task 3; até lá, ignore o valor).
- Teste de integração do daemon: no teste existente `'instância com GT_HOME próprio instala o hook no caminho canônico…'`, o comando esperado continua igual. Ele serve de guarda para o Review Focus 1.

`src/shared/protocol.ts`: o hook passa a `{ t: 'hook'; paneId: string; configDir: string; agent?: AgentKind; payload: HookPayload }`.

- [ ] **Step 5: Rodar e ver passar**

Run: `rtk proxy npx vitest run && rtk proxy npm run typecheck`
Expected: verde (inclusive `hooks.test.ts` da fase 1 e o teste do caminho canônico).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: hooks do Codex (script por agente, {} no stdout, hooks.json e instalação)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sessão com tipo de agente, Interrupt, detecção do Codex e aviso de hooks não aprovados

**Files:**
- Modify: `src/shared/types.ts` (`ClaudeSession.agent`, `PaneView.agentHooksMissing`), `src/daemon/session.ts`, `src/daemon/platform/procs.ts`, `src/daemon/panes.ts`, `src/daemon/daemon.ts`
- Modify (literais de teste): testes com `ClaudeSession`/`PaneView` literais
- Test: `tests/daemon/codex-session.test.ts`, `tests/daemon/daemon.test.ts` (casos novos)

**Interfaces:**
- Produces:
  - `ClaudeSession.agent: AgentKind`; `PaneView.agentHooksMissing: boolean`
  - `reduceSession(prev, p, now?, agent?: AgentKind)` — `Interrupt` → `your-turn`; nova sessão guarda `agent`
  - `findAgent(procs, rootPid): { proc: Proc; agent: AgentKind } | null` (`findClaude` continua existindo como atalho)
  - `PaneManager.applyHook(paneId, configDir, p, agent?: AgentKind)`
  - `DaemonOptions.codexHookGraceMs?: number` (padrão 20000)

- [ ] **Step 1: Testes que falham — `tests/daemon/codex-session.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { reduceSession } from '../../src/daemon/session'
import { findAgent, parsePs } from '../../src/daemon/platform/procs'

describe('sessão Codex', () => {
  it('guarda o tipo; Interrupt e Stop viram sua vez; PermissionRequest precisa de você', () => {
    const s = reduceSession(null, { hook_event_name: 'SessionStart', session_id: 'c1', cwd: '/w', source: 'startup' }, 1, 'codex')
    expect(s).toMatchObject({ agent: 'codex', status: 'idle' })
    const w = reduceSession(s, { hook_event_name: 'UserPromptSubmit', session_id: 'c1', cwd: '/w' }, 2, 'codex')
    expect(reduceSession(w, { hook_event_name: 'Interrupt', session_id: 'c1', cwd: '/w' }, 3, 'codex')?.status).toBe('your-turn')
    expect(reduceSession(w, { hook_event_name: 'Stop', session_id: 'c1', cwd: '/w' }, 3, 'codex')?.status).toBe('your-turn')
    expect(reduceSession(w, { hook_event_name: 'PermissionRequest', session_id: 'c1', cwd: '/w' }, 3, 'codex')?.status).toBe('needs-you')
    expect(reduceSession(null, { hook_event_name: 'Stop', session_id: 'x', cwd: '/w' }, 1)?.agent).toBe('claude')
  })
})

describe('findAgent', () => {
  const ps = [
    '  200     1 Ss   -zsh',
    '  300   200 S+   node /Users/u/.nvm/versions/node/v22/bin/codex --yolo',
    '  301   300 S+   /Users/u/.nvm/versions/node/v22/lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex/codex --yolo',
    '  400     1 Ss   -zsh',
    '  401   400 S+   /Users/u/.local/bin/claude --dangerously-skip-permissions',
    '  500     1 Ss   -zsh',
    '  501   500 S+   vim /tmp/codex/notas.md',
    '  502   500 S    grep -r codex src',
  ].join('\n')
  const procs = parsePs(ps)
  it('reconhece o codex (node e binário nativo) e o claude', () => {
    expect(findAgent(procs, 200)).toMatchObject({ agent: 'codex' })
    expect(findAgent(procs, 400)).toMatchObject({ agent: 'claude' })
  })
  it('não confunde pasta/argumento chamado codex', () => {
    expect(findAgent(procs, 500)).toBeNull()
  })
})
```

Em `tests/daemon/daemon.test.ts`:
```ts
  it('Codex: eventos pelo gt-hook viram estados e a sessão registra o tipo', async () => {
    repo = makeRepo()
    const { o, app } = await boot()
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    const codex = (payload: Record<string, unknown>) =>
      runWithInput('/bin/sh', [o.hookScriptPath, 'codex'], JSON.stringify(payload), { PATH: '/usr/bin:/bin', GT_PANE_ID: paneId, GT_SOCKET: o.socketPath })
    const r = await codex({ hook_event_name: 'SessionStart', session_id: 'cx', cwd: repo.dir, source: 'startup' })
    expect(r.stdout).toBe('{}')
    await app.waitState((s) => s.panes[0]?.claude?.agent === 'codex')
    await codex({ hook_event_name: 'UserPromptSubmit', session_id: 'cx', cwd: repo.dir })
    await codex({ hook_event_name: 'Interrupt', session_id: 'cx', cwd: repo.dir })
    await app.waitState((s) => s.panes[0]?.claude?.status === 'your-turn')
  })

  it('Codex rodando sem mandar hooks → agentHooksMissing', async () => {
    repo = makeRepo()
    const bin = path.join(repo.root, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nsleep 30\n', { mode: 0o755 })
    const { app } = await boot({ pollMs: 200, codexHookGraceMs: 600 })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    app.client.send({ t: 'pane.input', paneId, data: `"${path.join(bin, 'codex')}" --yolo\r` })
    await app.waitState((s) => s.panes[0]?.agentHooksMissing === true, 8000)
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run tests/daemon/codex-session.test.ts tests/daemon/daemon.test.ts -t "Codex"`
Expected: FAIL.

- [ ] **Step 3: Tipos**

`ClaudeSession` ganha `agent: AgentKind`; `PaneView` ganha `agentHooksMissing: boolean`.

- [ ] **Step 4: `src/daemon/session.ts`**

- Assinatura `reduceSession(prev, p, now = Date.now(), agent: AgentKind = 'claude')`.
- Na sessão nova (`base` quando `prev` não serve), acrescente `agent`.
- No `switch`, `case 'Stop': case 'StopFailure': case 'Interrupt':` → `withStatus(next, 'your-turn', now)`.

- [ ] **Step 5: `src/daemon/platform/procs.ts`**

```ts
/** codex como programa: 1º token, script rodado por node/sh/bash/zsh, ou o binário nativo do pacote @openai/codex */
const CODEX_RE = /^(\S*\/)?codex(\s|$)|^\S*\b(node|sh|bash|zsh)\s+\S*\/codex(\s|$)|@openai\/codex\//

export function findAgent(procs: Proc[], rootPid: number): { proc: Proc; agent: AgentKind } | null {
  for (const p of descendants(procs, rootPid)) {
    if (CLAUDE_RE.test(p.args)) return { proc: p, agent: 'claude' }
    if (CODEX_RE.test(p.args)) return { proc: p, agent: 'codex' }
  }
  return null
}
```
Mantenha `findClaude` (usado em testes). Linhas como `vim /tmp/codex/notas.md` e `grep -r codex src` não casam, porque o `codex` não é o programa.

No teste de integração, o `codex` falso precisa continuar vivo como `/bin/sh …/codex --yolo`: use `#!/bin/sh\nsleep 30\n` (sem `exec`, que trocaria o processo por `sleep`).

- [ ] **Step 6: Painéis e daemon**

`src/daemon/panes.ts`:
- `PaneRecord` ganha `agentProcSince: number | null` e `lastHookAt: number`.
- `applyHook(paneId, configDir, p, agent: AgentKind = 'claude')`:
  - no começo, `rec.lastHookAt = Date.now()`;
  - `rec.claude = reduceSession(rec.claude, p, Date.now(), agent)`;
  - `detectAccount(this.d.accounts(), agent, configDir, rec.claudeArgv)`;
  - o título (`readTitle`) só roda se `agent === 'claude'`.
- `poll()`: troque `findClaude(procs, pid)` por `const found = findAgent(procs, pid); const claudeProc = found?.proc ?? null`, e:
```ts
      if (found?.agent === 'codex') {
        if (rec.agentProcSince === null) rec.agentProcSince = Date.now()
        const missing = rec.lastHookAt < rec.agentProcSince && Date.now() - rec.agentProcSince > this.d.codexHookGraceMs
        if (missing !== rec.agentHooksMissing) {
          rec.agentHooksMissing = missing
          changed = true
        }
      } else if (rec.agentProcSince !== null || rec.agentHooksMissing) {
        rec.agentProcSince = null
        if (rec.agentHooksMissing) {
          rec.agentHooksMissing = false
          changed = true
        }
      }
```
  (`PaneRecord` ganha `agentHooksMissing: boolean`; `PaneManagerDeps` ganha `codexHookGraceMs: number`). Na detecção de conta pelo argv no poll, passe `found?.agent ?? 'claude'`.
- `create()` inicializa `agentProcSince: null, lastHookAt: 0, agentHooksMissing: false`.

`src/daemon/daemon.ts`:
- `hook`: `await this.panes.applyHook(req.paneId, req.configDir || null, req.payload, req.agent ?? 'claude')`;
- `buildState` inclui `agentHooksMissing: r.agentHooksMissing` nos painéis;
- `PaneManager` recebe `codexHookGraceMs: this.o.codexHookGraceMs ?? 20_000`.

- [ ] **Step 7: Literais de teste**

Onde há `ClaudeSession` literal, acrescente `agent: 'claude'`; onde há `PaneView` literal, `agentHooksMissing: false`.

- [ ] **Step 8: Rodar e ver passar**

Run: `rtk proxy npx vitest run && rtk proxy npm run typecheck`
Expected: verde.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: sessões Codex (tipo, Interrupt, detecção do processo e aviso de hooks não aprovados)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Interface — assistente, aba Agentes, tipo na nova sessão e avisos

**Files:**
- Create: `src/renderer/src/agents-model.ts`, `src/renderer/src/components/SetupWizard.tsx`, `src/renderer/src/components/AgentsPanel.tsx`
- Modify: `src/renderer/src/sidebar-model.ts` (`accountsWithoutHooks` com Codex), `src/renderer/src/store.ts` (`Modal` `setup`), `src/renderer/src/components/Preferences.tsx` (abas), `NewSessionDialog.tsx`, `HooksBanner.tsx`, `Modals.tsx`, `src/renderer/src/main.tsx` (abrir o assistente), `src/renderer/src/actions.ts` (menu), `src/main/menu.ts`, `src/renderer/src/styles.css`
- Test: `tests/renderer/agents-model.test.ts`, `tests/renderer/ui-logic.test.ts` (Codex em `accountsWithoutHooks`)

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `agents-model.ts`: `newAgentDraft(existing: Account[], agent: AgentKind): Account` (id único `claude-2`, `codex-2`…); `AGENT_LABEL: Record<AgentKind, string>` (`Claude`, `Codex`); `hooksMissingPanes(panes: PaneView[]): PaneView[]`
  - `accountsWithoutHooks`: um aviso em `…/hooks.json` do Codex marca todos os agentes Codex
  - `Modal` ganha `{ kind: 'setup' }`; ação de menu `setup`

- [ ] **Step 1: Testes que falham**

`tests/renderer/agents-model.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { hooksMissingPanes, newAgentDraft } from '../../src/renderer/src/agents-model'
import type { Account, PaneView } from '../../src/shared/types'

const acc = (id: string, agent: 'claude' | 'codex'): Account => ({ id, label: id, command: id, color: '#111111', agent, configDirMatch: [], isDefault: false, settingsMatch: null, pathPrefix: null })

describe('agents-model', () => {
  it('rascunho com id único e comando yolo do tipo', () => {
    expect(newAgentDraft([], 'codex')).toMatchObject({ id: 'codex', agent: 'codex', command: 'codex --yolo' })
    expect(newAgentDraft([acc('codex', 'codex')], 'codex').id).toBe('codex-2')
    expect(newAgentDraft([acc('claude', 'claude'), acc('claude-2', 'claude')], 'claude')).toMatchObject({ id: 'claude-3', command: 'claude --dangerously-skip-permissions' })
  })
  it('painéis com Codex sem hooks', () => {
    const p = (id: string, missing: boolean) => ({ id, agentHooksMissing: missing, alive: true }) as PaneView
    expect(hooksMissingPanes([p('a', false), p('b', true)]).map((x) => x.id)).toEqual(['b'])
  })
})
```
Em `tests/renderer/ui-logic.test.ts`, no `describe('contas sem hooks')`:
```ts
  it('hooks.json do Codex sem hooks marca os agentes Codex', () => {
    const accounts = [{ ...DEFAULT_ACCOUNTS[0] }, { id: 'codex', label: 'Codex', command: 'codex --yolo', color: '#10a37f', agent: 'codex' as const, configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null }]
    expect(accountsWithoutHooks({ userHome: '/Users/u', accounts, hookWarnings: ['/Users/u/.codex/hooks.json'] })).toEqual(new Set(['codex']))
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run tests/renderer`
Expected: FAIL.

- [ ] **Step 3: `src/renderer/src/agents-model.ts`**

```ts
import type { Account, AgentKind, PaneView } from '../../shared/types'

export const AGENT_LABEL: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' }
const YOLO: Record<AgentKind, string> = { claude: 'claude --dangerously-skip-permissions', codex: 'codex --yolo' }
const COLOR: Record<AgentKind, string> = { claude: '#d97757', codex: '#10a37f' }

export function newAgentDraft(existing: Account[], agent: AgentKind): Account {
  const ids = new Set(existing.map((a) => a.id))
  let id: string = agent
  for (let n = 2; ids.has(id); n++) id = `${agent}-${n}`
  const first = !existing.some((a) => a.agent === agent)
  return { id, label: id === agent ? AGENT_LABEL[agent] : `${AGENT_LABEL[agent]} ${id.split('-').pop()}`, command: YOLO[agent], color: COLOR[agent], agent, configDirMatch: [], isDefault: first, settingsMatch: null, pathPrefix: null }
}

export function hooksMissingPanes(panes: PaneView[]): PaneView[] {
  return panes.filter((p) => p.alive && p.agentHooksMissing)
}
```

- [ ] **Step 4: `accountsWithoutHooks` com o Codex (`sidebar-model.ts`)**

No laço, antes do `else` final:
```ts
    else if (w.endsWith('/hooks.json')) app.accounts.filter((a) => a.agent === 'codex').forEach((a) => out.add(a.id))
```
E o caso do `settings.json` principal passa a marcar só os agentes Claude: `app.accounts.filter((a) => a.agent === 'claude').forEach(...)`.

- [ ] **Step 5: Assistente — `src/renderer/src/components/SetupWizard.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { Account } from '../../../shared/types'
import { errorMessage } from '../api'
import { AGENT_LABEL } from '../agents-model'
import { setUi, useUi } from '../store'

type Step = 'agents' | 'hooks' | 'codex'

/** 1ª abertura: detecta CLIs, cria agentes yolo, instala hooks e guia o /hooks do Codex */
export function SetupWizard() {
  const app = useUi((s) => s.app)
  const [step, setStep] = useState<Step>('agents')
  const [detected, setDetected] = useState<{ claude: boolean; codex: boolean } | null>(null)
  const [drafts, setDrafts] = useState<(Account & { on: boolean })[]>([])
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void window.gt.request<{ claude: boolean; codex: boolean }>({ t: 'agents.detect' }).then((d) => {
      setDetected(d)
      const existing = app?.accounts ?? []
      const base = existing.length ? existing.map((a) => ({ ...a, on: true })) : suggest(d)
      setDrafts(base)
    })
    // só na abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const close = () => setUi({ modal: null })
  const hasCodex = drafts.some((d) => d.on && d.agent === 'codex')

  const saveAgents = async () => {
    try {
      const accounts = drafts.filter((d) => d.on).map(({ on: _on, ...a }) => a)
      await window.gt.request({ t: 'accounts.save', accounts })
      setMsg(null)
      setStep('hooks')
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) })
    }
  }
  const installHooks = async () => {
    try {
      await window.gt.request({ t: 'hooks.install' })
      setMsg({ ok: true, text: 'Hooks instalados ✓' })
    } catch (e) {
      setMsg({ ok: false, text: `Não consegui instalar: ${errorMessage(e)}` })
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal setup">
        <h3>Configurar agentes</h3>
        {step === 'agents' && (
          <>
            <p className="sb-dim">Escolha quais agentes abrir pelo app. O comando é digitado no seu shell; dá para mudar depois em Preferências → Agentes.</p>
            {!detected && <p className="sb-dim">Procurando claude e codex no seu shell…</p>}
            {drafts.map((d, i) => (
              <div key={d.id} className="setup-agent">
                <label className="check">
                  <input type="checkbox" checked={d.on} onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                  <span style={{ color: d.color }}>{d.label}</span> <span className="sb-dim">({AGENT_LABEL[d.agent]})</span>
                  {detected && !detected[d.agent] && <span className="card-note warn"> não encontrado no shell</span>}
                </label>
                <input className="text-input" value={d.command} onChange={(e) => setDrafts(drafts.map((x, j) => (j === i ? { ...x, command: e.target.value } : x)))} />
              </div>
            ))}
            {msg && <p className={msg.ok ? 'ok' : 'c-bad'}>{msg.text}</p>}
            <div className="modal-actions">
              <button onClick={close}>Depois</button>
              <button className="primary" disabled={!drafts.some((d) => d.on)} onClick={() => void saveAgents()}>
                Salvar e continuar
              </button>
            </div>
          </>
        )}
        {step === 'hooks' && (
          <>
            <p>Os hooks deixam o app ver quando o agente está trabalhando (🟢), precisa de você (🟡) ou terminou (🔵), e em qual worktree ele está.</p>
            <p className="sb-dim">O app acrescenta uma entrada nos arquivos de configuração do Claude/Codex, com backup, sem mexer nos seus hooks.</p>
            {msg && <p className={msg.ok ? 'ok' : 'c-bad'}>{msg.text}</p>}
            <div className="modal-actions">
              <button onClick={() => (hasCodex ? setStep('codex') : close())}>Pular</button>
              {msg?.ok ? (
                <button className="primary" onClick={() => (hasCodex ? setStep('codex') : close())}>
                  {hasCodex ? 'Continuar' : 'Concluir'}
                </button>
              ) : (
                <button className="primary" onClick={() => void installHooks()}>
                  Instalar hooks
                </button>
              )}
            </div>
          </>
        )}
        {step === 'codex' && (
          <>
            <p>
              <strong>Um passo no Codex (uma vez só):</strong> o Codex só roda hooks que você aprovou.
            </p>
            <ol>
              <li>Abra uma sessão Codex pelo app (⌘T).</li>
              <li>
                Digite <code>/hooks</code> e confie no hook do <strong>Gerenciador de Terminal</strong> (gt-hook).
              </li>
              <li>Pronto: os estados 🟢🟡🔵 passam a aparecer nas sessões Codex.</li>
            </ol>
            <p className="sb-dim">Se esquecer, o app mostra um lembrete quando uma sessão Codex rodar sem mandar eventos.</p>
            <div className="modal-actions">
              <button className="primary" onClick={close}>
                Concluir
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function suggest(d: { claude: boolean; codex: boolean }): (Account & { on: boolean })[] {
  return [
    { id: 'claude', label: 'Claude', command: 'claude --dangerously-skip-permissions', color: '#d97757', agent: 'claude', configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null, on: d.claude },
    { id: 'codex', label: 'Codex', command: 'codex --yolo', color: '#10a37f', agent: 'codex', configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null, on: d.codex },
  ]
}
```

- [ ] **Step 6: Aba Agentes — `src/renderer/src/components/AgentsPanel.tsx`**

```tsx
import { useState } from 'react'
import type { Account, AgentKind } from '../../../shared/types'
import { SESSION_COLORS } from '../../../shared/settings'
import { errorMessage } from '../api'
import { AGENT_LABEL, newAgentDraft } from '../agents-model'
import { setUi, useUi } from '../store'

export function AgentsPanel() {
  const saved = useUi((s) => s.app?.accounts ?? [])
  const [list, setList] = useState<Account[]>(saved.map((a) => ({ ...a, configDirMatch: [...a.configDirMatch] })))
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const set = (i: number, patch: Partial<Account>) => setList(list.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= list.length) return
    const next = [...list]
    ;[next[i], next[j]] = [next[j], next[i]]
    setList(next)
  }
  const save = async () => {
    try {
      await window.gt.request({ t: 'accounts.save', accounts: list })
      setMsg({ ok: true, text: 'Agentes salvos ✓' })
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) })
    }
  }
  const reinstall = async () => {
    try {
      await window.gt.request({ t: 'hooks.install' })
      setMsg({ ok: true, text: 'Hooks instalados ✓' })
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) })
    }
  }
  const add = (agent: AgentKind) => setList([...list, newAgentDraft(list, agent)])

  return (
    <div className="agents-panel">
      {list.map((a, i) => (
        <div key={i} className="agent-row">
          <div className="agent-line">
            <select value={a.color} onChange={(e) => set(i, { color: e.target.value })} style={{ color: a.color }} title="Cor">
              {[a.color, ...SESSION_COLORS.map((c) => c.hex).filter((h) => h !== a.color)].map((h) => (
                <option key={h} value={h} style={{ color: h }}>
                  ■ {SESSION_COLORS.find((c) => c.hex === h)?.label ?? h}
                </option>
              ))}
            </select>
            <input className="text-input" value={a.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="Nome" />
            <select value={a.agent} onChange={(e) => set(i, { agent: e.target.value as AgentKind })}>
              <option value="claude">{AGENT_LABEL.claude}</option>
              <option value="codex">{AGENT_LABEL.codex}</option>
            </select>
            <button onClick={() => move(i, -1)} title="Subir">↑</button>
            <button onClick={() => move(i, 1)} title="Descer">↓</button>
            <button onClick={() => setList(list.filter((_, j) => j !== i))} title="Remover">✕</button>
          </div>
          <input className="text-input mono" value={a.command} onChange={(e) => set(i, { command: e.target.value })} placeholder="comando digitado no shell" />
          <button className="sb-mini" onClick={() => setOpen(open === a.id ? null : a.id)}>
            {open === a.id ? '▾' : '▸'} identificação avançada
          </button>
          {open === a.id && (
            <div className="agent-adv">
              <label>
                pasta de config contém ({a.agent === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'}), separado por vírgula
                <input className="text-input mono" value={a.configDirMatch.join(', ')} onChange={(e) => set(i, { configDirMatch: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
              </label>
              <label>
                --settings contém (desempate)
                <input className="text-input mono" value={a.settingsMatch ?? ''} onChange={(e) => set(i, { settingsMatch: e.target.value.trim() || null })} />
              </label>
              <label className="check">
                <input type="checkbox" checked={a.isDefault} onChange={(e) => set(i, { isDefault: e.target.checked })} /> padrão quando a pasta de config não está definida
              </label>
            </div>
          )}
        </div>
      ))}
      <div className="agent-actions">
        <button onClick={() => add('claude')}>+ Claude</button>
        <button onClick={() => add('codex')}>+ Codex</button>
        <span className="ph-spacer" />
        <button onClick={() => void reinstall()}>Reinstalar hooks</button>
        <button onClick={() => setUi({ modal: { kind: 'setup' } })}>Abrir assistente</button>
        <button className="primary" onClick={() => void save()}>
          Salvar agentes
        </button>
      </div>
      {msg && <p className={msg.ok ? 'ok' : 'c-bad'}>{msg.text}</p>}
    </div>
  )
}
```

- [ ] **Step 7: Preferências com abas, nova sessão, faixa, menu e abertura automática**

- `Preferences.tsx`: estado `tab: 'terminal' | 'agents'`, com uma barra de abas no topo (`<div className="pref-tabs">` com dois botões). O conteúdo atual vira a aba Terminal; a aba Agentes renderiza `<AgentsPanel />`. A largura do modal passa a `.modal.prefs { width: 640px; }`.
- `NewSessionDialog.tsx`: no cartão de cada agente, depois do nome, mostrar `<span className="card-note">{AGENT_LABEL[a.agent]}</span>`. O texto do botão principal passa a `Abrir agente ⌘↵`.
- `HooksBanner.tsx`: além do aviso atual, se `hooksMissingPanes(app.panes).length > 0`, mostrar (mesmo estilo, sem botão de instalar): `O Codex não está mandando eventos: abra o Codex, digite /hooks e confie no hook do Gerenciador de Terminal.`
- `store.ts`: `Modal` ganha `| { kind: 'setup' }`. `Modals.tsx`: `if (modal.kind === 'setup') return <SetupWizard />`.
- `menu.ts`: no submenu do app, depois de Preferências, `item('Configurar agentes…', '', 'setup')` (sem atalho: passe `accelerator` vazio e remova a propriedade quando vazia no helper `item`). `actions.ts` → `else if (action === 'setup') setUi({ modal: { kind: 'setup' } })`.
- `main.tsx`: depois do `state.get` inicial, `if (app.accounts.length === 0) setUi({ modal: { kind: 'setup' } })`.
- CSS:
```css
.modal.setup, .modal.prefs { width: 640px; }
.setup-agent { display: flex; flex-direction: column; gap: 4px; padding: 6px 0; border-top: 1px solid var(--border); }
.pref-tabs { display: flex; gap: 4px; margin-bottom: 8px; }
.pref-tabs button.active { background: var(--accent); color: #fff; }
.agents-panel { display: flex; flex-direction: column; gap: 10px; }
.agent-row { display: flex; flex-direction: column; gap: 4px; padding: 8px 0; border-top: 1px solid var(--border); }
.agent-line { display: flex; gap: 6px; align-items: center; }
.agent-line .text-input { flex: 1; }
.agent-adv { display: flex; flex-direction: column; gap: 6px; padding-left: 12px; font-size: 12px; color: var(--fg-dim); }
.agent-adv label { display: flex; flex-direction: column; gap: 2px; }
.agent-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.mono { font-family: Menlo, monospace; font-size: 12px; }
```

- [ ] **Step 8: Rodar, typecheck, build**

Run: `rtk proxy npx vitest run && rtk proxy npm run typecheck && rtk proxy npm run build`
Expected: verde.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: assistente de agentes, aba Agentes nas Preferências e aviso de hooks do Codex

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 10: Verificação por CDP (instância isolada com HOME falso)**

Suba com `GT_HOME=/tmp/gtw` e **`HOME=/tmp/gtw-home`** (com um `.claude/settings.json` vazio), para o assistente não tocar nos arquivos reais:
- o assistente abre sozinho;
- a detecção marca `claude`/`codex` conforme o shell;
- "Salvar e continuar" → `accounts` com os dois;
- "Instalar hooks" cria `/tmp/gtw-home/.codex/hooks.json` e mexe no `settings.json` falso, sem tocar em `~/.codex` nem em `~/.claude` reais (confira os `mtime` antes e depois);
- o passo do Codex aparece.

Screenshot de cada passo.

---

### Task 5: Teste real com o Codex (checkpoint com o usuário) e instalação

**Files:** nenhum (a não ser correções que o teste revelar, cada uma com teste que falhe antes).

- [ ] **Step 1: Empacotar e instalar**

Run: `rtk proxy npm run pack` e verifique a assinatura. Esta atualização **muda o daemon** (protocolo de hook com `agent`), então é preciso reiniciar o daemon:
1. Confira que nenhuma sessão está 🟢 (`state.get`).
2. Feche o app.
3. `daemon.shutdown`.
4. Instale em `/Applications`.
5. Abra o app e retome as sessões que estavam vivas (`pane.create` com `resumeSessionId`), como na instalação da fase 2.
Só faça isso com o aval do usuário no momento.

- [ ] **Step 2: Hooks do Codex na máquina do usuário**

Na aba Agentes, confira os agentes atuais (as 4 contas, tipo Claude) e adicione "Codex" (`codex --yolo`). Salve e clique em "Reinstalar hooks": o `~/.codex/hooks.json` é criado. Confira que o `~/.claude/settings.json` **não mudou** (o comando do Claude é o mesmo).

- [ ] **Step 3: Sessão Codex real (o usuário executa)**

O usuário abre uma sessão Codex pelo ⌘T. Em seguida:
1. O aviso "O Codex não está mandando eventos" aparece depois de ~20 s.
2. O usuário digita `/hooks`, confia no hook do Gerenciador de Terminal, e o aviso some no próximo evento.
3. Mandar um prompt → 🟢; ao terminar → 🔵; clicar → ⚪; Esc durante o trabalho → 🔵.
4. Um comando que peça aprovação → 🟡.
Anote no ledger o que foi observado. Qualquer divergência vira correção com teste.

---

### Task 6: Build Linux (AppImage x64) com testes no container

**Files:**
- Create: `scripts/build-linux.sh`, `scripts/linux-container.sh`
- Modify: `package.json` (`build.linux`, script `pack:linux`), `README.md`

- [ ] **Step 1: Configuração do electron-builder**

No bloco `build` do `package.json`, acrescente:
```json
"linux": { "target": [{ "target": "AppImage", "arch": ["x64"] }], "category": "Development", "artifactName": "gerenciador-de-terminal-${version}-x64.AppImage" }
```
E, nos scripts: `"pack:linux": "sh scripts/build-linux.sh"`.

- [ ] **Step 2: Scripts**

`scripts/linux-container.sh` (roda **dentro** do container):
```sh
#!/bin/sh
# Compila, testa e empacota o AppImage num Linux x64 limpo.
set -eu
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git procps netcat-openbsd lsof python3 make g++ >/dev/null
git config --global --add safe.directory '*'
git config --global user.email build@local
git config --global user.name build
cd /work
rm -rf node_modules
npm ci --no-audit --no-fund
npx vitest run
npx electron-vite build
npx electron-builder --linux AppImage --x64 --publish never
```
`scripts/build-linux.sh` (roda no Mac):
```sh
#!/bin/sh
# Copia o projeto para um diretório temporário (o node_modules do mac não serve) e roda o build num container linux/amd64.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d /tmp/gt-linux.XXXX)
rsync -a --exclude node_modules --exclude out --exclude dist --exclude .superpowers --exclude .vitest "$ROOT/" "$WORK/"
docker run --rm --platform linux/amd64 -v "$WORK":/work -w /work node:22-bookworm sh scripts/linux-container.sh
mkdir -p "$ROOT/dist"
cp "$WORK"/dist/*.AppImage "$ROOT/dist/"
echo "AppImage em: $(ls "$ROOT"/dist/*.AppImage)"
rm -rf "$WORK"
```

- [ ] **Step 3: Rodar o build**

Run: `npm run pack:linux` (a primeira vez baixa a imagem; em arm64 com emulação x64 leva vários minutos).
Expected: a suíte inteira passa **no Linux** e `dist/gerenciador-de-terminal-0.1.0-x64.AppImage` é gerado.
Se algum teste falhar só no Linux, trate como bug (systematic-debugging): corrija no código, com o teste que falhou como prova.

- [ ] **Step 4: README — seção Linux**

```markdown
## Linux (AppImage x64)
    chmod +x gerenciador-de-terminal-*-x64.AppImage
    ./gerenciador-de-terminal-*-x64.AppImage
Na primeira abertura o assistente configura Claude/Codex. Os hooks usam `nc -U`: se a distro não tiver, instale `netcat-openbsd` (Debian/Ubuntu já vêm com ele).
No Codex, confie no hook uma vez com `/hooks`.
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "build: AppImage x64 para Linux com testes num container

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
