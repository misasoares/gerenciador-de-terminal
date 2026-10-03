# Contratar sessões (MCP do líder) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma sessão marcada como líder cria, lista, renomeia e encerra sessões do Claude pelo MCP `gerenciador-terminal`, cada uma com nome, conta, worktree própria e prompt inicial, na aba do líder.

**Architecture:** `gt-mcp.js` (servidor MCP stdio, sem dependências, empacotado junto com `daemon.js`) repassa `tools/call` ao daemon pelo `GT_SOCKET` como `{ t: 'mcp.call', callerPaneId, tool, args }`. O daemon grava `<home>/mcp.json` no início e toda sessão Claude aberta pelo app recebe `--mcp-config`; a permissão (líder) e o teto são conferidos no daemon.

**Tech Stack:** TypeScript, Electron (ELECTRON_RUN_AS_NODE), node-pty, vitest, git.

**Spec:** `docs/superpowers/specs/2026-10-03-contratar-sessoes-design.md`

## Global Constraints

- Servidor MCP chamado `gerenciador-terminal`; ferramentas `criar_sessao`, `listar_sessoes`, `renomear_sessao`, `encerrar_sessao`.
- Nenhuma dependência npm nova (MCP via JSON-RPC à mão, uma mensagem JSON por linha).
- `mcp.json` = `{ "mcpServers": { "gerenciador-terminal": { "command": <nodeBinary>, "args": [<mcpScriptPath>], "env": { "ELECTRON_RUN_AS_NODE": "1" } } } }`, regravado a cada início do daemon.
- Toda sessão **Claude** aberta pelo app (nova ou retomada) recebe ` --mcp-config '<home>/mcp.json'`; Codex não muda.
- Sessão criada pelo líder: ` -n '<nome>'` e prompt como ` "$(cat '<home>/prompts/<paneId>.txt')"`.
- Citação de shell com aspas simples: `'` vira `'"'"'`.
- Nome de sessão válido: `/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/`; repetido ganha `-2`, `-3`…
- Worktree em `<projeto>/.claude/worktrees/<nome>`, branch `<base>-<nome>`; base padrão = branch atual do líder.
- Teto `settings.maxHiredPerLeader` (padrão 10, entre 1 e 50) de sessões vivas com `createdBy === líder`.
- Textos exatos: `esta sessão não é líder; peça ao usuário para marcá-la no menu da sessão` · `limite de N sessões atingido; encerre alguma ou aumente o limite nas preferências` · `fora do Gerenciador de Terminal` · `Gerenciador de Terminal não está rodando` · menu `Pode contratar sessões (líder)` · prefs `MÁXIMO DE SESSÕES POR LÍDER`.
- Testes: `npm test`, `npm run typecheck`, `npm run build`. Saída do vitest: `rtk proxy npx vitest run --reporter=dot …`. Shell do usuário: `builtin cd "<caminho>"`.
- NÃO tocar no app instalado nem no daemon real; teste manual só com `GT_HOME=/tmp/gt-contratar npm run dev`.

## Review Focus

1. **Caminho com espaço** (`/Volumes/SSD MISA/…`) em `--mcp-config`, na pasta da worktree e no arquivo do prompt → o comando roda no shell sem quebrar. Teste na Task 1 (roda o texto citado num `/bin/sh` de verdade).
2. **Prompt com aspas, `$`, crase, quebra de linha e acento** → chega intacto (vai por arquivo). Teste na Task 1 (`"$(cat …)"` num shell real).
3. **Líder em HEAD solto ou fora de git pedindo worktree** → erro claro, nenhuma sessão criada e nada no layout. Teste na Task 4.
4. **`encerrar_sessao` numa sessão que o líder não criou** → recusa; a sessão segue viva. Teste na Task 4.
5. **Comando de conta que é função do shell e não repassa argumentos** → fora do alcance do app; a resposta de `criar_sessao` traz `comando` para o líder (e o usuário) verem o que foi rodado. Teste na Task 4 (campo `comando` presente).

---

## Pontos do código (leia antes)

- `src/daemon/accounts.ts`: `buildCommand(account, resumeSessionId?)`.
- `src/daemon/panes.ts`: `CreatePane`, `PaneManagerDeps`, `PaneManager.create` (monta `command = buildCommand(...)` e agenda `flushCommand`), `effectiveProject(r)`, `effectiveWorktree(r)`, `kill(id)`.
- `src/daemon/persist.ts`: `Persisted.paneMeta: Record<string, { name: string | null; color: string | null }>`.
- `src/shared/settings.ts`: `TerminalSettings`, `DEFAULT_SETTINGS`, `normalizeSettings`.
- `src/daemon/daemon.ts`: `DaemonOptions`, `init()`, `buildState(wsId)` (mapeia `panes`), `handle()` (switch de requisições), `ws(id)`, `changed()`, `leafIds()`; `this.registry.worktrees(project)` devolve `WorktreeInfo[]` com `branch` sem `refs/heads/`; `this.registry.refresh(project)`.
- `src/daemon/git/run.ts`: `git(cwd, args, timeoutMs?)` → `{ ok, code, stdout, stderr }`.
- `src/daemon/workspaces.ts`: `uniqueName(name, taken)` (sufixo com espaço — **não** serve aqui; a Task 4 tem o seu com hífen).
- `src/shared/rpc-client.ts`: `RpcClient.connect(socketPath)`, `request<T>(req)`, `close()`.
- `src/daemon/server.ts`: `startServer(socketPath, handler)` (para testes do `gt-mcp`).
- `src/renderer/src/flows.ts`: `sessionMenu(s)`; `src/renderer/src/sidebar-model.ts`: `sessionLabel(p)`; `src/renderer/src/header.ts:52` (rótulo do cabeçalho); `src/renderer/src/components/Preferences.tsx`.
- Testes do daemon: `tests/daemon/daemon.test.ts` (`boot(extra, home?)`, `hook`, `makeRepo()`, `app.output(paneId)`, `waitFor`).

---

### Task 1: Citação de shell e comando do Claude com MCP, nome e prompt

**Files:**
- Create: `src/daemon/shell-quote.ts`
- Modify: `src/daemon/accounts.ts` (`buildCommand`)
- Test: `tests/daemon/shell-quote.test.ts`, `tests/daemon/accounts.test.ts`

**Interfaces — Produces:**
- `shq(s: string): string`
- `buildCommand(account: Account, resumeSessionId?: string, extra?: { mcpConfig?: string | null; name?: string; promptFile?: string }): string`

- [ ] **Step 1: Testes que falham** — `tests/daemon/shell-quote.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { shq } from '../../src/daemon/shell-quote'

const sh = (script: string) => execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8' })

describe('shq', () => {
  it('cita para o shell sem perder nada', () => {
    expect(shq("it's")).toBe(`'it'"'"'s'`)
    for (const s of ['/Volumes/SSD MISA/a b', `aspas "duplas" e 'simples'`, 'cifrão $HOME e crase `id`', 'ação ñ 🚀', '']) {
      expect(sh(`printf %s ${shq(s)}`)).toBe(s)
    }
  })
  it('prompt por arquivo chega intacto pelo "$(cat …)"', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt q '))
    const f = path.join(dir, 'p.txt')
    const prompt = `linha 1 "aspas" 'simples'\nlinha 2 $HOME \`id\` ação`
    fs.writeFileSync(f, prompt)
    expect(sh(`printf %s "$(cat ${shq(f)})"`)).toBe(prompt)
  })
})
```

Em `tests/daemon/accounts.test.ts`, dentro de `describe('buildCommand')`:

```ts
  it('Claude: --mcp-config, -n e prompt por arquivo, citados', () => {
    const mslabs = DEFAULT_ACCOUNTS.find((a) => a.id === 'mslabs')!
    expect(buildCommand(mslabs, undefined, { mcpConfig: '/Volumes/SSD MISA/h/mcp.json', name: 'dev-1', promptFile: '/p/a b.txt' })).toBe(
      `claude-mslabs --mcp-config '/Volumes/SSD MISA/h/mcp.json' -n 'dev-1' "$(cat '/p/a b.txt')"`,
    )
    expect(buildCommand(mslabs, '6f574752-bb4d-4ff2-8ed1-bb685dce78ed', { mcpConfig: '/h/mcp.json' })).toBe(
      `claude-mslabs --resume 6f574752-bb4d-4ff2-8ed1-bb685dce78ed --mcp-config '/h/mcp.json'`,
    )
  })
  it('Codex ignora os extras do Claude', () => {
    const codex = { ...DEFAULT_ACCOUNTS[0], id: 'codex', agent: 'codex' as const, command: 'codex --yolo' }
    expect(buildCommand(codex, undefined, { mcpConfig: '/h/mcp.json', name: 'dev-1', promptFile: '/p.txt' })).toBe('codex --yolo')
  })
```

- [ ] **Step 2:** `rtk proxy npx vitest run --reporter=dot tests/daemon/shell-quote.test.ts tests/daemon/accounts.test.ts` → FAIL (módulo `shell-quote` ausente; `buildCommand` sem extras).

- [ ] **Step 3: Implementar** — `src/daemon/shell-quote.ts`:

```ts
/** aspas simples para o shell: nada dentro é interpretado; ' vira '"'"' */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`
}
```

Em `src/daemon/accounts.ts` (`import { shq } from './shell-quote'`), troque `buildCommand` por:

```ts
export interface CommandExtras {
  /** --mcp-config do Gerenciador (só Claude) */
  mcpConfig?: string | null
  /** -n: nome de exibição da sessão (o SendMessage acha por ele) */
  name?: string
  /** arquivo com o prompt inicial: vai como "$(cat …)" para aspas e quebras chegarem intactas */
  promptFile?: string
}

export function buildCommand(account: Account, resumeSessionId?: string, extra: CommandExtras = {}): string {
  let cmd = account.command
  if (resumeSessionId) {
    if (!SESSION_ID_RE.test(resumeSessionId)) throw new Error(`session id inválido: ${resumeSessionId}`)
    // Claude: --resume <id>; Codex: subcomando (codex --yolo resume <id>)
    cmd = account.agent === 'codex' ? `${cmd} resume ${resumeSessionId}` : `${cmd} --resume ${resumeSessionId}`
  }
  if (account.agent !== 'claude') return cmd
  if (extra.mcpConfig) cmd += ` --mcp-config ${shq(extra.mcpConfig)}`
  if (extra.name) cmd += ` -n ${shq(extra.name)}`
  if (extra.promptFile) cmd += ` "$(cat ${shq(extra.promptFile)})"`
  return cmd
}
```

- [ ] **Step 4:** mesmo comando do Step 2 → PASS; `npm run typecheck` → sem erros.
- [ ] **Step 5:** `git commit -am "feat(contratar): citação de shell e comando do Claude com MCP, nome e prompt"` (inclua o arquivo novo com `git add`).

---

### Task 2: Servidor MCP `gt-mcp` (protocolo, stdio e ligação com o daemon)

**Files:**
- Create: `src/mcp/protocol.ts`, `src/mcp/daemon-call.ts`, `src/mcp/server.ts`
- Modify: `electron.vite.config.ts` (entrada `gt-mcp`)
- Test: `tests/mcp/protocol.test.ts`, `tests/mcp/daemon-call.test.ts`

**Interfaces — Produces:**
- `TOOLS: { name: string; description: string; inputSchema: object }[]`
- `type CallDaemon = (tool: string, args: Record<string, unknown>) => Promise<unknown>`
- `handleMessage(msg: unknown, call: CallDaemon): Promise<object | null>`
- `serveLines(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, call: CallDaemon): void`
- `makeDaemonCall(env: Record<string, string | undefined>): CallDaemon` — manda `{ t: 'mcp.call', callerPaneId, tool, args }`
- Protocolo (declarado na Task 3): `{ t: 'mcp.call'; callerPaneId: string; tool: string; args: Record<string, unknown> }`

- [ ] **Step 1: Testes que falham** — `tests/mcp/protocol.test.ts`:

```ts
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { handleMessage, serveLines, TOOLS } from '../../src/mcp/protocol'

const noCall = async () => {
  throw new Error('não deveria chamar')
}

describe('gt-mcp: protocolo', () => {
  it('initialize ecoa a versão pedida e se apresenta', async () => {
    const r = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, noCall)
    expect(r).toEqual({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'gerenciador-terminal', version: '1.0.0' } } })
  })
  it('notificação não tem resposta; método desconhecido dá -32601', async () => {
    expect(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, noCall)).toBeNull()
    expect(await handleMessage({ jsonrpc: '2.0', id: 2, method: 'x/y' }, noCall)).toMatchObject({ id: 2, error: { code: -32601 } })
  })
  it('tools/list traz as 4 ferramentas', async () => {
    const r = (await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, noCall)) as { result: { tools: { name: string }[] } }
    expect(r.result.tools.map((t) => t.name)).toEqual(['criar_sessao', 'listar_sessoes', 'renomear_sessao', 'encerrar_sessao'])
    expect(TOOLS[0].inputSchema).toMatchObject({ type: 'object', required: ['nome'] })
  })
  it('tools/call repassa e devolve texto; erro vira isError', async () => {
    const seen: unknown[] = []
    const ok = await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'listar_sessoes', arguments: {} } }, async (tool, args) => {
      seen.push([tool, args])
      return [{ nome: 'dev-1' }]
    })
    expect(seen).toEqual([['listar_sessoes', {}]])
    expect(ok).toEqual({ jsonrpc: '2.0', id: 4, result: { content: [{ type: 'text', text: JSON.stringify([{ nome: 'dev-1' }], null, 2) }] } })
    const bad = await handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'criar_sessao', arguments: { nome: 'x' } } }, async () => {
      throw new Error('esta sessão não é líder; peça ao usuário para marcá-la no menu da sessão')
    })
    expect(bad).toEqual({ jsonrpc: '2.0', id: 5, result: { content: [{ type: 'text', text: 'esta sessão não é líder; peça ao usuário para marcá-la no menu da sessão' }], isError: true } })
  })
  it('stdio: uma mensagem JSON por linha, resposta por linha', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const lines: string[] = []
    output.on('data', (c) => lines.push(...String(c).split('\n').filter(Boolean)))
    serveLines(input, output, noCall)
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n')
    await new Promise((r) => setTimeout(r, 50))
    expect(JSON.parse(lines[0]).result.tools).toHaveLength(4)
  })
})
```

`tests/mcp/daemon-call.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeDaemonCall } from '../../src/mcp/daemon-call'
import { startServer, type RpcServer } from '../../src/daemon/server'

let server: RpcServer | null = null
afterEach(async () => {
  await server?.close()
  server = null
})
const sock = () => path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-mcp-'))), 'd.sock')

describe('gt-mcp: ligação com o daemon', () => {
  it('repassa com o GT_PANE_ID de quem chamou', async () => {
    const p = sock()
    const got: unknown[] = []
    server = await startServer(p, (req) => {
      got.push(req)
      return { ok: true }
    })
    const call = makeDaemonCall({ GT_SOCKET: p, GT_PANE_ID: 'pane-1' })
    await expect(call('listar_sessoes', { a: 1 })).resolves.toEqual({ ok: true })
    expect(got).toEqual([{ t: 'mcp.call', callerPaneId: 'pane-1', tool: 'listar_sessoes', args: { a: 1 } }])
  })
  it('fora do app e sem daemon: erros claros', async () => {
    await expect(makeDaemonCall({})('listar_sessoes', {})).rejects.toThrow('fora do Gerenciador de Terminal')
    await expect(makeDaemonCall({ GT_SOCKET: sock(), GT_PANE_ID: 'p' })('listar_sessoes', {})).rejects.toThrow('Gerenciador de Terminal não está rodando')
  })
})
```

- [ ] **Step 2:** `rtk proxy npx vitest run --reporter=dot tests/mcp` → FAIL (módulos ausentes).

- [ ] **Step 3: Implementar** — `src/mcp/protocol.ts`:

```ts
/** MCP mínimo (stdio, uma mensagem JSON por linha): initialize, ping, tools/list, tools/call */
export type CallDaemon = (tool: string, args: Record<string, unknown>) => Promise<unknown>

const str = (description: string) => ({ type: 'string', description })

export const TOOLS = [
  {
    name: 'criar_sessao',
    description:
      'Abre uma nova sessão do Claude no Gerenciador de Terminal, na aba desta sessão, como se o usuário tivesse aberto: com nome (o SendMessage acha por ele), conta, worktree git própria e prompt inicial. Só funciona se o usuário marcou esta sessão como líder.',
    inputSchema: {
      type: 'object',
      properties: {
        nome: str('nome da sessão, ex.: dev-1 (letras, números, ponto, hífen, sublinhado)'),
        prompt: str('primeira mensagem enviada à sessão'),
        conta: str('conta do agente (id ou rótulo); padrão: a desta sessão'),
        worktree: { type: 'boolean', description: 'criar worktree git nova em .claude/worktrees/<nome> (padrão true)' },
        base: str('branch de partida da worktree; padrão: a branch atual desta sessão'),
        onde: { type: 'string', enum: ['aba-do-lider'], description: 'onde a sessão aparece (padrão aba-do-lider)' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'listar_sessoes',
    description: 'Lista as sessões do espaço de trabalho desta sessão: nome, status (trabalhando, pedindo-permissao, sua-vez, ocioso, terminal), conta, pasta, branch e se foi criada por esta sessão.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'renomear_sessao',
    description: 'Renomeia uma sessão do espaço desta sessão.',
    inputSchema: { type: 'object', properties: { nome: str('nome atual'), novo_nome: str('novo nome') }, required: ['nome', 'novo_nome'] },
  },
  {
    name: 'encerrar_sessao',
    description: 'Encerra uma sessão criada por esta sessão. A worktree fica (o usuário remove pela sidebar).',
    inputSchema: { type: 'object', properties: { nome: str('nome da sessão') }, required: ['nome'] },
  },
]

interface Msg {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
}

export async function handleMessage(raw: unknown, call: CallDaemon): Promise<object | null> {
  const msg = (raw ?? {}) as Msg
  if (msg.id === undefined || msg.id === null) return null // notificação
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result })
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'gerenciador-terminal', version: '1.0.0' },
      })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: TOOLS })
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>
      try {
        const r = await call(name, args)
        return reply({ content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] })
      } catch (e) {
        return reply({ content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true })
      }
    }
    default:
      return { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `método desconhecido: ${msg.method}` } }
  }
}

export function serveLines(input: NodeJS.ReadableStream, output: NodeJS.WritableStream, call: CallDaemon): void {
  let buf = ''
  input.setEncoding?.('utf8')
  input.on('data', (chunk: string | Buffer) => {
    buf += String(chunk)
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON inválido' } }) + '\n')
        continue
      }
      void handleMessage(parsed, call).then((r) => {
        if (r) output.write(JSON.stringify(r) + '\n')
      })
    }
  })
}
```

`src/mcp/daemon-call.ts`:

```ts
import { RpcClient } from '../shared/rpc-client'
import type { CallDaemon } from './protocol'

/** cada chamada abre uma conexão curta com o daemon (o MCP fica parado a maior parte do tempo) */
export function makeDaemonCall(env: Record<string, string | undefined>): CallDaemon {
  return async (tool, args) => {
    const callerPaneId = env.GT_PANE_ID
    const socket = env.GT_SOCKET
    if (!callerPaneId || !socket) throw new Error('fora do Gerenciador de Terminal')
    let client: RpcClient
    try {
      client = await RpcClient.connect(socket)
    } catch {
      throw new Error('Gerenciador de Terminal não está rodando')
    }
    try {
      return await client.request({ t: 'mcp.call', callerPaneId, tool, args })
    } finally {
      client.close()
    }
  }
}
```

`src/mcp/server.ts`:

```ts
import { makeDaemonCall } from './daemon-call'
import { serveLines } from './protocol'

// roda com o binário do app (ELECTRON_RUN_AS_NODE=1), lançado pelo Claude via --mcp-config
serveLines(process.stdin, process.stdout, makeDaemonCall(process.env))
```

`electron.vite.config.ts`, em `main.build.rollupOptions.input`, acrescente: `'gt-mcp': resolve(__dirname, 'src/mcp/server.ts'),`.

Observação: o `request` do `RpcClient` só aceita `ClientRequest`; o tipo `mcp.call` entra no protocolo na Task 3. Para esta task compilar sozinha, declare-o já em `src/shared/protocol.ts`:
`  | { t: 'mcp.call'; callerPaneId: string; tool: string; args: Record<string, unknown> }`.

- [ ] **Step 4:** `rtk proxy npx vitest run --reporter=dot tests/mcp && npm run typecheck && npm run build && ls out/main/gt-mcp.js` → PASS e o arquivo existe.
- [ ] **Step 5:** `git add src/mcp tests/mcp electron.vite.config.ts src/shared/protocol.ts && git commit -m "feat(contratar): servidor MCP gt-mcp (stdio, sem dependências)"`

---

### Task 3: Daemon — config do MCP, `--mcp-config` em toda sessão Claude e marca de líder

**Files:**
- Modify: `src/daemon/persist.ts`, `src/shared/settings.ts`, `src/shared/types.ts`, `src/shared/protocol.ts`, `src/daemon/panes.ts`, `src/daemon/daemon.ts`
- Test: `tests/daemon/daemon.test.ts`, `tests/shared/settings.test.ts`

**Interfaces — Produces:**
- `PaneMetaEntry { name: string | null; color: string | null; leader?: boolean; createdBy?: string }` (exportada de `persist.ts`); `Persisted.paneMeta: Record<string, PaneMetaEntry>`
- `TerminalSettings.maxHiredPerLeader: number` (padrão 10, 1–50)
- `PaneView.leader: boolean`, `PaneView.createdBy: string | null`
- `DaemonOptions.mcpScriptPath?: string` (padrão `path.join(__dirname, 'gt-mcp.js')`), `DaemonOptions.nodeBinary?: string` (padrão `process.execPath`)
- `PaneManagerDeps.mcpConfigPath: string | null`; `CreatePane.agentName?: string`, `CreatePane.promptFile?: string`
- requisição `pane.setLeader { paneId: string; leader: boolean }`
- `Daemon` privado: `mcpConfigPath` = `path.join(o.home, 'mcp.json')`; `promptsDir` = `path.join(o.home, 'prompts')`

- [ ] **Step 1: Testes que falham** — `tests/shared/settings.test.ts`:

```ts
  it('máximo de sessões por líder: padrão 10, entre 1 e 50', () => {
    expect(normalizeSettings(undefined).maxHiredPerLeader).toBe(10)
    expect(normalizeSettings({ maxHiredPerLeader: 0 }).maxHiredPerLeader).toBe(1)
    expect(normalizeSettings({ maxHiredPerLeader: 99 }).maxHiredPerLeader).toBe(50)
    expect(normalizeSettings({ maxHiredPerLeader: 7.4 }).maxHiredPerLeader).toBe(7)
  })
```

(importe `normalizeSettings` se o arquivo ainda não importa.)

`tests/daemon/daemon.test.ts`:

```ts
  it('contratar: grava mcp.json e toda sessão Claude recebe --mcp-config', async () => {
    const { o, app } = await boot({ nodeBinary: '/bin/app-x', mcpScriptPath: '/opt/app/gt-mcp.js' })
    const cfg = JSON.parse(fs.readFileSync(path.join(o.home, 'mcp.json'), 'utf8'))
    expect(cfg).toEqual({ mcpServers: { 'gerenciador-terminal': { command: '/bin/app-x', args: ['/opt/app/gt-mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1' } } } })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: o.userHome, accountId: 'mslabs', cols: 200, rows: 24 })
    await waitFor(() => (app.output(paneId).includes('--mcp-config') ? true : null), 8000)
    expect(app.output(paneId)).toContain(`claude-mslabs --mcp-config '${path.join(o.home, 'mcp.json')}'`)
  })

  it('contratar: marca de líder aparece no estado e sobrevive a reiniciar o daemon', async () => {
    const first = await boot()
    const { paneId } = await first.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: first.o.userHome, accountId: null, cols: 80, rows: 24 })
    await first.app.client.request({ t: 'pane.setLeader', paneId, leader: true })
    await first.app.waitState((s) => s.panes.find((p) => p.id === paneId)?.leader === true)
    await first.d.stop(true)
    daemons = daemons.filter((x) => x !== first.d)
    const second = await boot({}, first.home)
    await second.app.client.request({ t: 'pane.create', paneId, cwd: first.o.userHome, accountId: null, cols: 80, rows: 24 })
    const st = await second.app.waitState((s) => s.panes.some((p) => p.id === paneId))
    expect(st.panes.find((p) => p.id === paneId)).toMatchObject({ leader: true, createdBy: null })
  })
```

- [ ] **Step 2:** `rtk proxy npx vitest run --reporter=dot tests/shared/settings.test.ts tests/daemon/daemon.test.ts -t "máximo de sessões|contratar"` → FAIL.

- [ ] **Step 3: Implementar**
  - `settings.ts`: em `TerminalSettings`, `/** teto de sessões vivas criadas por um líder pelo MCP */ maxHiredPerLeader: number`; em `DEFAULT_SETTINGS`, `maxHiredPerLeader: 10`; em `normalizeSettings`, `maxHiredPerLeader: typeof v.maxHiredPerLeader === 'number' && Number.isFinite(v.maxHiredPerLeader) ? clamp(Math.round(v.maxHiredPerLeader), 1, 50) : DEFAULT_SETTINGS.maxHiredPerLeader,`. Ajuste literais de `TerminalSettings` que o typecheck acusar.
  - `persist.ts`:

```ts
export interface PaneMetaEntry {
  name: string | null
  color: string | null
  /** pode contratar sessões pelo MCP (marcado pelo usuário) */
  leader?: boolean
  /** paneId do líder que criou esta sessão pelo MCP */
  createdBy?: string
}
```
  e `paneMeta: Record<string, PaneMetaEntry>`.
  - `types.ts` (`PaneView`): `/** pode contratar sessões (👑) */ leader: boolean` e `/** líder que criou esta sessão pelo MCP */ createdBy: string | null`. Ajuste literais de `PaneView` em testes do renderer que o typecheck acusar com `leader: false, createdBy: null`.
  - `protocol.ts`: `| { t: 'pane.setLeader'; paneId: string; leader: boolean }`.
  - `panes.ts`: `PaneManagerDeps.mcpConfigPath: string | null`; `CreatePane` ganha `/** -n do Claude */ agentName?: string` e `/** prompt inicial (arquivo) */ promptFile?: string`; em `create`, `const command = account ? buildCommand(account, o.resumeSessionId, { mcpConfig: this.d.mcpConfigPath, name: o.agentName, promptFile: o.promptFile }) : null`.
  - `daemon.ts`:
    - `DaemonOptions`: `/** script do gt-mcp (padrão: ao lado do daemon.js) */ mcpScriptPath?: string` e `/** binário que roda o gt-mcp (padrão: o do app, com ELECTRON_RUN_AS_NODE) */ nodeBinary?: string`.
    - getters: `private get mcpConfigPath(): string { return path.join(this.o.home, 'mcp.json') }` e `private get promptsDir(): string { return path.join(this.o.home, 'prompts') }`.
    - em `init()`, logo depois de `writeHookScript(...)`:

```ts
    // config do MCP regravada a cada início: no AppImage o caminho de montagem muda
    fs.writeFileSync(
      this.mcpConfigPath,
      JSON.stringify({ mcpServers: { 'gerenciador-terminal': { command: this.o.nodeBinary ?? process.execPath, args: [this.o.mcpScriptPath ?? path.join(__dirname, 'gt-mcp.js')], env: { ELECTRON_RUN_AS_NODE: '1' } } } }, null, 2),
    )
    // prompts iniciais de sessões do daemon anterior: nenhuma está viva agora
    fs.rmSync(this.promptsDir, { recursive: true, force: true })
```
    (`import fs from 'node:fs'` no topo.)
    - no `new PaneManager({...})`: `mcpConfigPath: this.mcpConfigPath,`.
    - `buildState`, no mapeamento de `panes`: `leader: this.persisted.paneMeta[r.id]?.leader === true,` e `createdBy: this.persisted.paneMeta[r.id]?.createdBy ?? null,`.
    - `handle()`:

```ts
      case 'pane.setLeader': {
        const cur = this.persisted.paneMeta[req.paneId] ?? { name: null, color: null }
        this.persisted.paneMeta[req.paneId] = { ...cur, leader: req.leader || undefined }
        this.changed()
        return null
      }
```
    - em `pane.meta`, preserve `leader`/`createdBy` (o `next = { ...cur }` já preserva; confira).
    - em `pane.forget`, apague também `fs.rmSync(path.join(this.promptsDir, `${req.paneId}.txt`), { force: true })`.

- [ ] **Step 4:** `rtk proxy npx vitest run --reporter=dot tests/shared tests/daemon && npm run typecheck` → PASS.
- [ ] **Step 5:** `git commit -am "feat(contratar): daemon grava mcp.json, toda sessão Claude recebe --mcp-config, marca de líder"`

---

### Task 4: Daemon — as ferramentas (`mcp.call`)

**Files:**
- Create: `src/daemon/hire.ts`
- Modify: `src/daemon/daemon.ts`
- Test: `tests/daemon/hire.test.ts`, `tests/daemon/daemon.test.ts`

**Interfaces — Consumes:** `buildCommand`/`shq` (Task 1), `mcp.call` (Task 2), `PaneMetaEntry`, `maxHiredPerLeader`, `CreatePane.agentName/promptFile`, `promptsDir` (Task 3).
**Produces:**
- `checkName(n: string): string` (aparado; lança `nome inválido: use letras, números, ponto, hífen ou sublinhado (até 40)`)
- `uniqueDash(name: string, taken: string[]): string` (`dev-1` → `dev-1-2` → `dev-1-3`)
- `pickAccount(accounts: Account[], wanted: unknown, fallbackId: string | null): Account` (id ou rótulo, sem diferenciar maiúsculas; lança `conta desconhecida: X (contas: a, b)`)
- `statusName(r: { alive: boolean; claude: { status: SessionStatus } | null }): 'trabalhando' | 'pedindo-permissao' | 'sua-vez' | 'ocioso' | 'terminal'`
- `insertBeside(layout: Layout, anchorId: string, newId: string): Layout`
- resposta de `criar_sessao`: `{ nome, pasta, branch: string | null, conta, comando }`

- [ ] **Step 1: Testes que falham** — `tests/daemon/hire.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_ACCOUNTS } from '../../src/daemon/accounts'
import { checkName, insertBeside, pickAccount, statusName, uniqueDash } from '../../src/daemon/hire'

const leaf = (paneId: string) => ({ type: 'leaf' as const, paneId })

describe('hire', () => {
  it('nome: válido, aparado; inválido recusa', () => {
    expect(checkName(' dev-1 ')).toBe('dev-1')
    for (const bad of ['', '-x', 'a b', 'a/b', 'x'.repeat(41)]) expect(() => checkName(bad)).toThrow('nome inválido')
  })
  it('repetido ganha -2, -3', () => {
    expect(uniqueDash('dev-1', [])).toBe('dev-1')
    expect(uniqueDash('dev-1', ['dev-1'])).toBe('dev-1-2')
    expect(uniqueDash('dev-1', ['dev-1', 'dev-1-2'])).toBe('dev-1-3')
  })
  it('conta por id ou rótulo; sem conta, a do líder; desconhecida lista as válidas', () => {
    expect(pickAccount(DEFAULT_ACCOUNTS, 'MSLABS', 'misa').id).toBe('mslabs')
    expect(pickAccount(DEFAULT_ACCOUNTS, undefined, 'weboption-max').id).toBe('weboption-max')
    expect(() => pickAccount(DEFAULT_ACCOUNTS, 'nada', 'misa')).toThrow('conta desconhecida: nada (contas: misa, mslabs, weboption, weboption-max)')
  })
  it('status em português', () => {
    expect(statusName({ alive: true, claude: { status: 'needs-you' } })).toBe('pedindo-permissao')
    expect(statusName({ alive: true, claude: { status: 'your-turn' } })).toBe('sua-vez')
    expect(statusName({ alive: true, claude: { status: 'working' } })).toBe('trabalhando')
    expect(statusName({ alive: true, claude: { status: 'idle' } })).toBe('ocioso')
    expect(statusName({ alive: true, claude: null })).toBe('terminal')
  })
  it('nova folha entra ao lado, na aba do líder', () => {
    const one = { tabs: [{ id: 't', name: 'A', root: leaf('L') }, { id: 'u', name: 'B', root: leaf('z') }], activeTabId: 'u' }
    expect(insertBeside(one, 'L', 'd1').tabs[0].root).toEqual({ type: 'split', dir: 'row', sizes: [], children: [leaf('L'), leaf('d1')] })
    const two = insertBeside(insertBeside(one, 'L', 'd1'), 'L', 'd2')
    expect(two.tabs[0].root).toEqual({ type: 'split', dir: 'row', sizes: [], children: [leaf('L'), leaf('d1'), leaf('d2')] })
    expect(two.activeTabId).toBe('u')
    // líder fora de qualquer aba: aba ativa
    expect(insertBeside(one, 'X', 'd1').tabs[1].root).toEqual({ type: 'split', dir: 'row', sizes: [], children: [leaf('z'), leaf('d1')] })
    // sem abas: cria uma
    const empty = insertBeside({ tabs: [], activeTabId: null }, 'X', 'd1')
    expect(empty.tabs).toHaveLength(1)
    expect(empty.tabs[0].root).toEqual(leaf('d1'))
    expect(empty.activeTabId).toBe(empty.tabs[0].id)
  })
})
```

`tests/daemon/daemon.test.ts`:

```ts
  async function leaderIn(repoDir: string) {
    const b = await boot()
    await b.app.client.request({ t: 'project.add', path: repoDir })
    const { paneId } = await b.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repoDir, accountId: 'mslabs', cols: 80, rows: 24 })
    await b.app.waitState((s) => s.panes.find((p) => p.id === paneId)?.projectPath === repoDir)
    await b.app.client.request({ t: 'layout.save', layout: { tabs: [{ id: 't', name: 'Lider', root: { type: 'leaf', paneId } }], activeTabId: 't' } })
    const call = (tool: string, args: Record<string, unknown>) => b.app.client.request<Record<string, unknown>>({ t: 'mcp.call', callerPaneId: paneId, tool, args })
    return { ...b, leader: paneId, call }
  }

  it('contratar: só o líder cria; worktree, nome, conta, prompt e aba do líder', async () => {
    repo = makeRepo()
    const { o, app, leader, call } = await leaderIn(repo.dir)
    await expect(call('criar_sessao', { nome: 'dev-1' })).rejects.toThrow('esta sessão não é líder')
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    const base = repo.git('rev-parse', '--abbrev-ref', 'HEAD').trim()
    const r = await call('criar_sessao', { nome: 'dev-1', prompt: `faça "X" e 'Y'`, conta: 'weboption-max' })
    const dir = path.join(repo.dir, '.claude', 'worktrees', 'dev-1')
    expect(r).toMatchObject({ nome: 'dev-1', pasta: dir, branch: `${base}-dev-1`, conta: 'weboption-max' })
    expect(String(r.comando)).toContain(`-n 'dev-1'`)
    expect(fs.existsSync(dir)).toBe(true)
    const st = await app.waitState((s) => s.panes.some((p) => p.name === 'dev-1'))
    const dev = st.panes.find((p) => p.name === 'dev-1')!
    expect(dev).toMatchObject({ cwd: dir, accountId: 'weboption-max', createdBy: leader, leader: false })
    expect(fs.readFileSync(path.join(o.home, 'prompts', `${dev.id}.txt`), 'utf8')).toBe(`faça "X" e 'Y'`)
    expect((await app.client.request<{ layout: { tabs: { root: unknown }[] } }>({ t: 'state.get' })).layout.tabs[0].root).toEqual({
      type: 'split', dir: 'row', sizes: [], children: [{ type: 'leaf', paneId: leader }, { type: 'leaf', paneId: dev.id }],
    })
    // repetido: nome, pasta e branch ganham -2
    const r2 = await call('criar_sessao', { nome: 'dev-1', worktree: false })
    expect(r2).toMatchObject({ nome: 'dev-1-2', pasta: repo.dir, branch: null, conta: 'mslabs' })
    const r3 = await call('criar_sessao', { nome: 'dev-1-2' })
    expect(r3).toMatchObject({ nome: 'dev-1-2-2', branch: `${base}-dev-1-2-2` })
  })

  it('contratar: teto, listar, renomear e encerrar só as criadas', async () => {
    repo = makeRepo()
    const { app, leader, call } = await leaderIn(repo.dir)
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    const s0 = (await app.client.request<{ settings: Record<string, unknown> }>({ t: 'state.get' })).settings
    await app.client.request({ t: 'settings.save', settings: { ...s0, maxHiredPerLeader: 1 } })
    await call('criar_sessao', { nome: 'dev-1', worktree: false })
    await expect(call('criar_sessao', { nome: 'dev-2', worktree: false })).rejects.toThrow('limite de 1 sessões atingido; encerre alguma ou aumente o limite nas preferências')
    const { paneId: mine } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await app.client.request({ t: 'pane.meta', paneId: mine, name: 'minha' })
    const list = (await call('listar_sessoes', {})) as unknown as { nome: string; criadaPorMim: boolean; status: string }[]
    expect(list.find((x) => x.nome === 'dev-1')).toMatchObject({ criadaPorMim: true })
    expect(list.find((x) => x.nome === 'minha')).toMatchObject({ criadaPorMim: false, status: 'terminal' })
    await call('renomear_sessao', { nome: 'dev-1', novo_nome: 'dev-a' })
    await expect(call('encerrar_sessao', { nome: 'minha' })).rejects.toThrow('só encerra sessões criadas por esta sessão')
    await call('encerrar_sessao', { nome: 'dev-a' })
    await app.waitState((s) => s.panes.find((p) => p.name === 'dev-a')?.alive === false)
    expect(app.state()!.panes.find((p) => p.id === mine)?.alive).toBe(true)
  })

  it('contratar: líder em HEAD solto pedindo worktree → erro e nada criado', async () => {
    repo = makeRepo()
    const { app, leader, call } = await leaderIn(repo.dir)
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    repo.git('checkout', '--detach')
    await waitFor(async () => ((await app.client.request<{ projects: { worktrees: { branch: string | null }[] }[] }>({ t: 'state.get' })).projects[0].worktrees[0].branch === null ? true : null), 8000)
    await expect(call('criar_sessao', { nome: 'dev-1' })).rejects.toThrow('HEAD solto')
    expect(app.state()!.panes.some((p) => p.name === 'dev-1')).toBe(false)
  })
```

(Confira o helper `makeRepo` em `tests/helpers/repo.ts`: ele expõe `dir` e `git(...args)`; se `git` devolver `string`, use como acima. `waitFor` aceita função async? Veja `tests/helpers/wait.ts`; se não aceitar, troque o predicado por `app.state()!.projects[0].worktrees[0].branch === null ? true : null`.)

- [ ] **Step 2:** `rtk proxy npx vitest run --reporter=dot tests/daemon/hire.test.ts tests/daemon/daemon.test.ts -t "hire|contratar"` → FAIL.

- [ ] **Step 3: Implementar** — `src/daemon/hire.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { Account, Layout, LayoutNode, SessionStatus } from '../shared/types'

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/

/** nome vira pasta, branch e nome de exibição (SendMessage): só caracteres seguros */
export function checkName(n: string): string {
  const v = n.trim()
  if (!NAME_RE.test(v)) throw new Error('nome inválido: use letras, números, ponto, hífen ou sublinhado (até 40)')
  return v
}

export function uniqueDash(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name
  let i = 2
  while (taken.includes(`${name}-${i}`)) i++
  return `${name}-${i}`
}

export function pickAccount(accounts: Account[], wanted: unknown, fallbackId: string | null): Account {
  const claude = accounts.filter((a) => a.agent === 'claude')
  if (typeof wanted === 'string' && wanted.trim()) {
    const w = wanted.trim().toLowerCase()
    const hit = claude.find((a) => a.id.toLowerCase() === w || a.label.toLowerCase() === w)
    if (!hit) throw new Error(`conta desconhecida: ${wanted} (contas: ${claude.map((a) => a.id).join(', ')})`)
    return hit
  }
  const own = claude.find((a) => a.id === fallbackId) ?? claude.find((a) => a.isDefault) ?? claude[0]
  if (!own) throw new Error('nenhuma conta do Claude configurada')
  return own
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
```

Em `daemon.ts` (`import { checkName, insertBeside, pickAccount, statusName, uniqueDash } from './hire'`, `import { git } from './git/run'`, `import { buildCommand } from './accounts'` — confira se já importado):

```ts
      case 'mcp.call':
        return this.mcpCall(req.callerPaneId, req.tool, req.args ?? {})
```

Métodos privados:

```ts
  /** ferramentas do MCP do líder; o espaço é o do líder */
  private async mcpCall(callerId: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
    const caller = this.panes.records().find((r) => r.id === callerId && r.alive)
    if (!caller) throw new Error('sessão de origem não encontrada')
    const meta = this.persisted.paneMeta
    const w = this.ws(caller.workspaceId)
    const inWs = () => this.panes.records().filter((r) => r.alive && r.workspaceId === w.id)
    const byName = (n: unknown) => {
      const r = inWs().find((x) => meta[x.id]?.name === String(n ?? ''))
      if (!r) throw new Error(`sessão não encontrada neste espaço: ${String(n ?? '')}`)
      return r
    }
    if (tool === 'listar_sessoes') {
      return inWs().map((r) => {
        const wt = this.panes.effectiveWorktree(r)
        const project = this.panes.effectiveProject(r)
        const branch = project && wt ? (this.registry.worktrees(project).find((x) => x.path === wt)?.branch ?? null) : null
        return { nome: meta[r.id]?.name ?? `sessão ${r.seq}`, status: statusName(r), conta: r.accountId, pasta: r.cwd, branch, criadaPorMim: meta[r.id]?.createdBy === caller.id, eu: r.id === caller.id }
      })
    }
    if (meta[caller.id]?.leader !== true) throw new Error('esta sessão não é líder; peça ao usuário para marcá-la no menu da sessão')
    if (tool === 'renomear_sessao') {
      const r = byName(args.nome)
      const novo = uniqueDash(checkName(String(args.novo_nome ?? '')), inWs().filter((x) => x !== r).map((x) => meta[x.id]?.name ?? ''))
      meta[r.id] = { ...(meta[r.id] ?? { name: null, color: null }), name: novo }
      this.changed()
      return { nome: novo }
    }
    if (tool === 'encerrar_sessao') {
      const r = byName(args.nome)
      if (meta[r.id]?.createdBy !== caller.id) throw new Error('só encerra sessões criadas por esta sessão')
      this.panes.kill(r.id)
      return { encerrada: meta[r.id]?.name }
    }
    if (tool === 'criar_sessao') return this.hire(caller, w, args)
    throw new Error(`ferramenta desconhecida: ${tool}`)
  }

  private async hire(caller: PaneRecord, w: Workspace, args: Record<string, unknown>) {
    const meta = this.persisted.paneMeta
    const max = this.persisted.settings.maxHiredPerLeader
    const live = this.panes.records().filter((r) => r.alive)
    if (live.filter((r) => meta[r.id]?.createdBy === caller.id).length >= max) throw new Error(`limite de ${max} sessões atingido; encerre alguma ou aumente o limite nas preferências`)
    const name = uniqueDash(checkName(String(args.nome ?? '')), live.filter((r) => r.workspaceId === w.id).map((r) => meta[r.id]?.name ?? ''))
    const account = pickAccount(this.persisted.accounts, args.conta, caller.accountId)
    let cwd = caller.cwd
    let branch: string | null = null
    if (args.worktree !== false) {
      const project = this.panes.effectiveProject(caller)
      if (!project) throw new Error('a sessão líder não está num repositório git conhecido; use worktree: false')
      const wtPath = this.panes.effectiveWorktree(caller)
      const own = this.registry.worktrees(project).find((x) => x.path === wtPath)
      const base = typeof args.base === 'string' && args.base.trim() ? args.base.trim() : own?.branch
      if (!base) throw new Error('a sessão líder está sem branch (HEAD solto); passe base explícita ou use worktree: false')
      const refs = await git(project, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
      branch = uniqueDash(`${base}-${name}`, refs.stdout.split('\n').filter(Boolean))
      const parent = path.join(project, '.claude', 'worktrees')
      const dirName = uniqueDash(name, fs.existsSync(parent) ? fs.readdirSync(parent) : [])
      cwd = path.join(parent, dirName)
      const r = await git(project, ['worktree', 'add', '-b', branch, cwd, base], 60_000)
      if (!r.ok) throw new Error(`git worktree add falhou: ${r.stderr.trim()}`)
      await this.registry.refresh(project)
    }
    const id = randomUUID()
    let promptFile: string | undefined
    if (typeof args.prompt === 'string' && args.prompt) {
      fs.mkdirSync(this.promptsDir, { recursive: true, mode: 0o700 })
      promptFile = path.join(this.promptsDir, `${id}.txt`)
      fs.writeFileSync(promptFile, args.prompt, { mode: 0o600 })
    }
    meta[id] = { name, color: null, createdBy: caller.id }
    this.panes.create({ paneId: id, cwd, accountId: account.id, cols: 120, rows: 30, workspaceId: w.id, agentName: name, promptFile })
    w.layout = insertBeside(w.layout, caller.id, id)
    this.changed()
    return { nome: name, pasta: cwd, branch, conta: account.id, comando: buildCommand(account, undefined, { mcpConfig: this.mcpConfigPath, name, promptFile }) }
  }
```

(importe `PaneRecord` de `./panes` e `Workspace` de `../shared/types` se faltarem.)

- [ ] **Step 4:** `rtk proxy npx vitest run --reporter=dot tests/daemon && npm test && npm run typecheck` → PASS.
- [ ] **Step 5:** `git add -A && git commit -m "feat(contratar): ferramentas criar, listar, renomear e encerrar sessão no daemon"`

---

### Task 5: Interface — marcar líder, 👑 e preferência do teto

**Files:**
- Modify: `src/renderer/src/flows.ts`, `src/renderer/src/sidebar-model.ts`, `src/renderer/src/header.ts`, `src/renderer/src/components/Preferences.tsx`
- Test: `tests/renderer/header.test.ts` (já testa `headerView`; importe também `sessionLabel` de `../../src/renderer/src/sidebar-model`)

**Interfaces — Consumes:** `PaneView.leader`, `pane.setLeader`, `settings.maxHiredPerLeader` (Task 3).
**Produces:** `sessionLabel(p)` e o rótulo de `headerView` com `👑 ` na frente quando `p.leader`.

- [ ] **Step 1: Teste que falha** — junto dos testes de `sessionLabel`:

```ts
  it('líder ganha 👑 na sidebar e no cabeçalho', () => {
    const p = { ...pane, alive: true, name: 'Techlead', leader: true }
    expect(sessionLabel(p)).toBe('👑 Techlead')
    expect(headerView(p, app).label).toBe('👑 Techlead')
    expect(sessionLabel({ ...p, leader: false })).toBe('Techlead')
  })
```

(use o `pane`/`app` de exemplo que o arquivo já define; ajuste os nomes se forem outros.)

- [ ] **Step 2:** rodar o arquivo → FAIL.
- [ ] **Step 3: Implementar**
  - `sidebar-model.ts`, `sessionLabel`: depois do `if (!p.alive)`, `const crown = p.leader ? '👑 ' : ''` e prefixe os retornos de nome/título/sessão/terminal com `crown`.
  - `header.ts:52`: `label: (pane.leader ? '👑 ' : '') + (pane.name ?? …)` mantendo o resto da expressão.
  - **Atenção:** o campo de renomear do `PaneHeader` usa `pane.name` (sem a coroa); nada muda lá.
  - `flows.ts`, `sessionMenu`, no ramo `s.alive`, antes de `{ id: 'kill', … }`: `{ id: 'leader', label: `${pane?.leader ? '✓ ' : ''}Pode contratar sessões (líder)` }` com `const pane = getUi().app?.panes.find((p) => p.id === s.paneId)` no topo; no fim: `else if (choice === 'leader') window.gt.request({ t: 'pane.setLeader', paneId: s.paneId, leader: !pane?.leader }).catch(showError)`.
  - `Preferences.tsx`, aba Terminal, depois da caixa do git:

```tsx
        <div className="field">
          <div className="field-label">MÁXIMO DE SESSÕES POR LÍDER · {draft.maxHiredPerLeader}</div>
          <input type="range" min={1} max={50} value={draft.maxHiredPerLeader} onChange={(e) => update({ maxHiredPerLeader: Number(e.target.value) })} />
        </div>
```

- [ ] **Step 4:** `npm test && npm run typecheck && npm run build` → PASS.
- [ ] **Step 5:** `git commit -am "feat(contratar): marcar líder no menu da sessão, 👑 e teto nas preferências"`

---

### Task 6: Pacote Linux com o MCP e teste real

**Files:**
- Modify: `scripts/build-linux.sh` (checagem pós-instalação)

- [ ] **Step 1:** em `scripts/build-linux.sh`, a variável `CHECK` passa a também rodar o `gt-mcp` instalado e conferir a resposta ao `initialize`:

```sh
CHECK='command -v git && command -v nc && command -v ps && ls /opt/*/gerenciador-de-terminal \
  && APP=$(ls -d /opt/*/ | head -1) \
  && echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}" | ELECTRON_RUN_AS_NODE=1 timeout 20 "$APP/gerenciador-de-terminal" "$APP/resources/app.asar/out/main/gt-mcp.js" | grep -q gerenciador-terminal \
  && echo INSTALACAO-OK'
```

(Confira antes, com `npx asar list dist/linux-unpacked/resources/app.asar | grep gt-mcp` ou `ls dist/mac-arm64/*.app/Contents/Resources`, o caminho real do `gt-mcp.js` dentro do pacote e ajuste `"$APP/resources/app.asar/out/main/gt-mcp.js"`. Se o app não usa asar, o caminho é `resources/app/out/main/gt-mcp.js`. O daemon usa `path.join(__dirname, 'gt-mcp.js')`, que resolve dentro do asar — o Electron em modo Node lê arquivos do asar.)

- [ ] **Step 2:** `sh scripts/build-linux.sh` → as três linhas `INSTALACAO-OK` e os pacotes em `dist/`.
- [ ] **Step 3:** `git commit -am "build(linux): instalação limpa confere que o gt-mcp responde"`
- [ ] **Step 4: Teste real (instância isolada):** `builtin cd "<worktree>" && GT_HOME=/tmp/gt-contratar npm run dev`. Com o usuário: abrir uma sessão Claude num repositório git, marcar "Pode contratar sessões (líder)", pedir "contrata 3 devs para X, Y e Z"; conferir 3 painéis `dev-1..3` na aba do líder, worktrees em `.claude/worktrees/`, prompts recebidos, e o `SendMessage` do líder chegando ao `dev-1` pelo nome. **Atenção:** a instância isolada grava `/tmp/gt-contratar/mcp.json`; o Claude real das contas não é alterado.
