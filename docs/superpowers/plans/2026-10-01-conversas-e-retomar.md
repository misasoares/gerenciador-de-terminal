# Navegador de conversas e retomar à prova de falha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Listar e retomar conversas do Claude e do Codex por worktree/projeto, e fazer o "retomar" conferir se a conversa existe antes de digitar o comando.

**Architecture:** Um `ConversationIndex` no daemon lê só o começo/fim dos arquivos de conversa (perfis do Claude em `<perfil>/projects/<pasta>/*.jsonl`, rollouts do Codex em `<CODEX_HOME>/sessions/**`), com cache por tamanho+mtime. O daemon responde `conversations.list` e, no `pane.create` com `resumeSessionId`, localiza o arquivo (falha com `conversation-missing` se não houver) e abre o painel no `cwd` de **início** da conversa. O renderer ganha a janela de conversas, entradas nos menus e o estado "conversa não encontrada".

**Tech Stack:** TypeScript, Electron (electron-vite), React, vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-conversas-e-retomar-design.md`

## Global Constraints

- Nome da pasta do Claude: cada caractere fora de `[A-Za-z0-9-]` vira `-` (conferido em 27/28 pastas reais; a exceção é sessão que mudou de pasta depois de iniciada — o arquivo fica na pasta de **início**).
- Leitura: começo 64 KB (Claude) / 256 KB (Codex, a 1ª linha traz `base_instructions` grandes) e fim 64 KB; no máximo 8 arquivos em paralelo; cache `Map<arquivo, {size, mtimeMs}>`.
- Título exibido: `custom-title` › `ai-title` › primeiros 80 caracteres da 1ª mensagem do usuário (Codex: só a 1ª mensagem). Mensagens que começam com `<` (sistema/contexto) são ignoradas.
- Conversa sem 1ª mensagem e sem título não é listada.
- Retomar: Claude `<comando> --resume <id>`, Codex `<comando> resume <id>` (já em `buildCommand`), no `cwd` de início da conversa.
- Erro do daemon para conversa ausente: mensagem exata `conversation-missing`.
- Textos de interface exatamente: `Conversas desta worktree…`, `Conversas do projeto…`, `Escolher conversa…`, `A conversa salva não foi encontrada`, `lendo conversas…`, `Nenhuma conversa nesta pasta`, `ver o projeto inteiro`, `conta não configurada`, `cadastre o agente na aba Agentes`, `Retomar`, `Focar`.
- Nenhuma dependência nova de npm. Nunca escrever nos arquivos de conversa.

## Review Focus

1. **Mesma conversa em dois perfis** (histórico compartilhado: `~/.claude` e o perfil do mslabs têm os mesmos arquivos) → aparece **uma vez**, com as contas candidatas dos dois perfis somadas. Teste na Task 3.
2. **Sessão que começou na pasta principal e depois foi para uma worktree** → o arquivo está na pasta de início; retomar abre o painel nesse `cwd`, não no atual. Teste na Task 4.
3. **1ª linha do Codex maior que a janela de leitura** (`base_instructions`) → a conversa é ignorada sem erro, o resto da lista sai. Teste na Task 2.
4. **Perfil que não existe mais / pasta sem permissão** → ignorado, a lista sai com o que deu. Teste na Task 3.
5. **Filtro com acento e maiúscula** ("Configuração" encontra "configuracao") → Teste na Task 5.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/shared/types.ts` (mod) | `ConversationInfo`; `ResumeEntry.transcriptPath?` |
| `src/shared/protocol.ts` (mod) | `conversations.list`; `pane.create.transcriptPath?` |
| `src/daemon/conversations/files.ts` (novo) | `projectDirName`, `readHead`, `readTail`, `jsonLines`, `pool` |
| `src/daemon/conversations/claude.ts` (novo) | parse do começo/fim do `.jsonl` do Claude; achar arquivos por pasta e por id |
| `src/daemon/conversations/codex.ts` (novo) | parse do começo do rollout; listar rollouts; achar por id |
| `src/daemon/conversations/index.ts` (novo) | `candidateAccounts`, `ConversationIndex` (list, locate, cache, dedupe) |
| `src/daemon/persist.ts` (mod) | `claudeProfiles`, `codexHomes`, `PersistedPane.transcriptPath?` |
| `src/daemon/daemon.ts` (mod) | perfis aprendidos no hook, `conversations.list`, checagem no `pane.create`, `transcriptPath` salvo |
| `src/renderer/src/conversations-model.ts` (novo) | filtro, título exibido, horário relativo |
| `src/renderer/src/components/ConversationsModal.tsx` (novo) | janela |
| `src/renderer/src/store.ts`, `flows.ts`, `actions.ts`, `components/Modals.tsx`, `PaneFrame.tsx`, `StatusBar.tsx`, `styles.css` (mod) | interface |

---

### Task 1: Arquivos e conversas do Claude

**Files:**
- Create: `src/daemon/conversations/files.ts`, `src/daemon/conversations/claude.ts`
- Test: `tests/daemon/conversations-claude.test.ts`

**Interfaces:**
- Produces:
  - `projectDirName(cwd: string): string`
  - `readHead(file: string, bytes: number): Promise<string>`; `readTail(file: string, bytes: number): Promise<string>`
  - `jsonLines(text: string): Record<string, unknown>[]` (linhas inválidas ignoradas)
  - `pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]>`
  - `interface RawConversation { agent: AgentKind; sessionId: string; file: string; profile: string; startCwd: string | null; title: string | null; firstPrompt: string | null; branch: string | null; lastActivity: number; messages: number }`
  - `readClaudeConversation(file: string, profile: string): Promise<RawConversation | null>`
  - `claudeFilesFor(profile: string, cwd: string): Promise<string[]>`
  - `findClaudeFile(profiles: string[], sessionId: string): Promise<{ file: string; profile: string } | null>`

- [ ] **Step 1: Teste que falha**

`tests/daemon/conversations-claude.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeFilesFor, findClaudeFile, readClaudeConversation } from '../../src/daemon/conversations/claude'
import { jsonLines, pool, projectDirName } from '../../src/daemon/conversations/files'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cv-')))
const line = (o: unknown) => JSON.stringify(o)
const user = (text: unknown, extra: Record<string, unknown> = {}) => line({ type: 'user', message: { role: 'user', content: text }, cwd: '/r/api', gitBranch: 'feat/x', timestamp: '2026-10-01T10:00:00Z', ...extra })

function writeConv(profile: string, cwd: string, id: string, lines: string[]): string {
  const f = path.join(profile, 'projects', projectDirName(cwd), `${id}.jsonl`)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, lines.join('\n') + '\n')
  return f
}

describe('arquivos de conversa', () => {
  it('projectDirName troca tudo fora de [A-Za-z0-9-] por -', () => {
    expect(projectDirName('/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal')).toBe('-Volumes-SSD-MISA-apps-misa-gerenciador-de-terminal')
    expect(projectDirName('/r/api/.claude/worktrees/feat_x')).toBe('-r-api--claude-worktrees-feat-x')
  })

  it.skipIf(!fs.existsSync(path.join(os.homedir(), '.claude', 'projects')))('confere a regra contra pastas reais de ~/.claude/projects', () => {
    const root = path.join(os.homedir(), '.claude', 'projects')
    let checked = 0
    for (const dir of fs.readdirSync(root).slice(0, 60)) {
      const files = fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.jsonl'))
      if (!files.length) continue
      const first = jsonLines(fs.readFileSync(path.join(root, dir, files[0]), 'utf8').slice(0, 65536)).find((o) => typeof o.cwd === 'string')
      if (!first) continue
      checked++
      // a pasta é a do início da sessão: algum cwd do arquivo bate com a regra
      const cwds = jsonLines(fs.readFileSync(path.join(root, dir, files[0]), 'utf8').slice(0, 65536)).map((o) => o.cwd).filter((c): c is string => typeof c === 'string')
      expect(cwds.map(projectDirName)).toContain(dir)
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('jsonLines ignora linha cortada e lixo; pool respeita o limite', async () => {
    expect(jsonLines('{"a":1}\nlixo\n{"b":2}\n{"c":')).toEqual([{ a: 1 }, { b: 2 }])
    let active = 0
    let max = 0
    const out = await pool([1, 2, 3, 4, 5], 2, async (n) => {
      active++
      max = Math.max(max, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10])
    expect(max).toBe(2)
  })
})

describe('conversas do Claude', () => {
  it('lê 1ª mensagem (ignorando sistema), branch, cwd de início, título e mensagens', async () => {
    const p = tmp()
    const f = writeConv(p, '/r/api', 's1', [
      user('<command-name>/clear</command-name>'),
      user('<local-command-stdout>x</local-command-stdout>', { isMeta: true }),
      user([{ type: 'text', text: 'Refatore o login' }]),
      line({ type: 'assistant', message: { role: 'assistant', content: 'ok' } }),
      line({ type: 'ai-title', aiTitle: 'Refatorar login' }),
      user('mais uma', { cwd: '/r/api/.claude/worktrees/x' }),
      line({ type: 'custom-title', customTitle: 'auth' }),
      '{"type":"user","message":',
    ])
    const c = await readClaudeConversation(f, p)
    expect(c).toMatchObject({ agent: 'claude', sessionId: 's1', profile: p, startCwd: '/r/api', firstPrompt: 'Refatore o login', title: 'auth', branch: 'feat/x', messages: 2 })
    expect(c!.lastActivity).toBe(fs.statSync(f).mtimeMs)
  })

  it('sem título usa ai-title; sem mensagem nem título não lista', async () => {
    const p = tmp()
    const a = writeConv(p, '/r/api', 'a', [user('oi'), line({ type: 'ai-title', aiTitle: 'Saudação' })])
    expect((await readClaudeConversation(a, p))?.title).toBe('Saudação')
    const b = writeConv(p, '/r/api', 'b', [line({ type: 'summary', summary: 'x' })])
    expect(await readClaudeConversation(b, p)).toBeNull()
    const vazio = writeConv(p, '/r/api', 'c', [])
    expect(await readClaudeConversation(vazio, p)).toBeNull()
  })

  it('claudeFilesFor lista os .jsonl da pasta; findClaudeFile acha pelo id em qualquer perfil', async () => {
    const p1 = tmp()
    const p2 = tmp()
    writeConv(p1, '/r/api', 'a', [user('oi')])
    const b = writeConv(p2, '/r/outra', 'b', [user('oi')])
    expect((await claudeFilesFor(p1, '/r/api')).map((f) => path.basename(f))).toEqual(['a.jsonl'])
    expect(await claudeFilesFor(p1, '/r/nada')).toEqual([])
    expect(await claudeFilesFor('/nao/existe', '/r/api')).toEqual([])
    expect(await findClaudeFile([p1, p2], 'b')).toEqual({ file: b, profile: p2 })
    expect(await findClaudeFile([p1, p2], 'zzz')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/conversations-claude.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Step 3: Implementar**

`src/daemon/conversations/files.ts`:

```ts
import fs from 'node:fs'

/** nome da pasta que o Claude usa em projects/ para um cwd */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9-]/g, '-')
}

export async function readHead(file: string, bytes: number): Promise<string> {
  const fh = await fs.promises.open(file, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await fh.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } finally {
    await fh.close()
  }
}

export async function readTail(file: string, bytes: number): Promise<string> {
  const fh = await fs.promises.open(file, 'r')
  try {
    const { size } = await fh.stat()
    const len = Math.min(size, bytes)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, size - len)
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

/** objetos JSON de cada linha; linhas inválidas (cortadas, lixo) são ignoradas */
export function jsonLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const l of text.split('\n')) {
    if (!l.startsWith('{')) continue
    try {
      const o = JSON.parse(l)
      if (o && typeof o === 'object') out.push(o as Record<string, unknown>)
    } catch {
      // linha cortada
    }
  }
  return out
}

export async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
```

`src/daemon/conversations/claude.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { AgentKind } from '../../shared/types'
import { jsonLines, projectDirName, readHead, readTail } from './files'

const HEAD = 64 * 1024
const TAIL = 64 * 1024

export interface RawConversation {
  agent: AgentKind
  sessionId: string
  file: string
  profile: string
  /** cwd de início: a pasta onde o arquivo foi gravado e onde o --resume encontra a conversa */
  startCwd: string | null
  title: string | null
  firstPrompt: string | null
  branch: string | null
  lastActivity: number
  /** mensagens do usuário vistas no começo+fim (aproximado em arquivos grandes) */
  messages: number
}

/** texto de uma mensagem do usuário, ou null se for de sistema/ferramenta */
function userText(o: Record<string, unknown>): string | null {
  if (o.type !== 'user' || o.isMeta === true) return null
  const msg = o.message as { role?: unknown; content?: unknown } | undefined
  if (!msg || msg.role !== 'user') return null
  let text: string | null = null
  if (typeof msg.content === 'string') text = msg.content
  else if (Array.isArray(msg.content)) {
    const t = msg.content.find((c) => c && typeof c === 'object' && (c as { type?: unknown }).type === 'text') as { text?: unknown } | undefined
    if (typeof t?.text === 'string') text = t.text
  }
  if (!text) return null
  const trimmed = text.trim()
  return trimmed && !trimmed.startsWith('<') ? trimmed : null
}

export async function readClaudeConversation(file: string, profile: string): Promise<RawConversation | null> {
  let st: fs.Stats
  try {
    st = await fs.promises.stat(file)
  } catch {
    return null
  }
  if (st.size === 0) return null
  const head = jsonLines(await readHead(file, HEAD))
  const tail = st.size > HEAD ? jsonLines(await readTail(file, TAIL)) : []
  const all = [...head, ...tail]
  let startCwd: string | null = null
  let branch: string | null = null
  let firstPrompt: string | null = null
  let custom: string | null = null
  let ai: string | null = null
  let messages = 0
  for (const o of all) {
    if (!startCwd && typeof o.cwd === 'string') startCwd = o.cwd
    if (!branch && typeof o.gitBranch === 'string' && o.gitBranch) branch = o.gitBranch
    if (o.type === 'custom-title' && typeof o.customTitle === 'string') custom = o.customTitle
    if (o.type === 'ai-title' && typeof o.aiTitle === 'string') ai = o.aiTitle
    const t = userText(o)
    if (t) {
      messages++
      if (!firstPrompt) firstPrompt = t
    }
  }
  const title = custom ?? ai
  if (!firstPrompt && !title) return null
  return { agent: 'claude', sessionId: path.basename(file, '.jsonl'), file, profile, startCwd, title, firstPrompt, branch, lastActivity: st.mtimeMs, messages }
}

export async function claudeFilesFor(profile: string, cwd: string): Promise<string[]> {
  const dir = path.join(profile, 'projects', projectDirName(cwd))
  const names = await fs.promises.readdir(dir).catch(() => [] as string[])
  return names.filter((n) => n.endsWith('.jsonl')).sort().map((n) => path.join(dir, n))
}

export async function findClaudeFile(profiles: string[], sessionId: string): Promise<{ file: string; profile: string } | null> {
  for (const profile of profiles) {
    const root = path.join(profile, 'projects')
    const dirs = await fs.promises.readdir(root).catch(() => [] as string[])
    for (const d of dirs) {
      const f = path.join(root, d, `${sessionId}.jsonl`)
      if (fs.existsSync(f)) return { file: f, profile }
    }
  }
  return null
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/daemon/conversations-claude.test.ts`
Expected: PASS (o teste das pastas reais roda só nesta máquina).

- [ ] **Step 5: Commit**

```bash
git add src/daemon/conversations tests/daemon/conversations-claude.test.ts
git commit -m "feat(conversas): leitura das conversas do Claude por pasta e por id"
```

---

### Task 2: Conversas do Codex

**Files:**
- Create: `src/daemon/conversations/codex.ts`
- Test: `tests/daemon/conversations-codex.test.ts`

**Interfaces:**
- Consumes: `RawConversation`, `readHead`, `jsonLines` (Task 1).
- Produces:
  - `readCodexConversation(file: string, home: string): Promise<RawConversation | null>`
  - `codexFiles(home: string): Promise<string[]>` (todos os `rollout-*.jsonl` de `<home>/sessions`)
  - `findCodexFile(homes: string[], sessionId: string): Promise<{ file: string; profile: string } | null>`

- [ ] **Step 1: Teste que falha**

`tests/daemon/conversations-codex.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { codexFiles, findCodexFile, readCodexConversation } from '../../src/daemon/conversations/codex'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cx-')))
const meta = (id: string, cwd: string, extra: Record<string, unknown> = {}) => JSON.stringify({ timestamp: '2026-10-01T10:00:00Z', type: 'session_meta', payload: { id, cwd, git: { branch: 'main' }, base_instructions: 'x', ...extra } })
const userMsg = (text: string) => JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })

function writeRollout(home: string, id: string, lines: string[]): string {
  const f = path.join(home, 'sessions', '2026', '10', '01', `rollout-2026-10-01T10-00-00-${id}.jsonl`)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, lines.join('\n') + '\n')
  return f
}

describe('conversas do Codex', () => {
  it('lê id, cwd, branch e a 1ª mensagem real (ignora contexto entre <>)', async () => {
    const h = tmp()
    const f = writeRollout(h, 'abc', [meta('abc', '/r/api'), userMsg('<environment_context>x</environment_context>'), userMsg('Corrija o build'), userMsg('e os testes')])
    expect(await readCodexConversation(f, h)).toMatchObject({ agent: 'codex', sessionId: 'abc', profile: h, startCwd: '/r/api', firstPrompt: 'Corrija o build', title: null, branch: 'main', messages: 2 })
  })

  it('sem mensagem do usuário, sem session_meta ou 1ª linha maior que a janela: não lista, sem erro', async () => {
    const h = tmp()
    expect(await readCodexConversation(writeRollout(h, 'a', [meta('a', '/r/api')]), h)).toBeNull()
    expect(await readCodexConversation(writeRollout(h, 'b', [userMsg('oi')]), h)).toBeNull()
    const enorme = writeRollout(h, 'c', [meta('c', '/r/api', { base_instructions: 'x'.repeat(300_000) }), userMsg('oi')])
    expect(await readCodexConversation(enorme, h)).toBeNull()
  })

  it('codexFiles lista os rollouts; findCodexFile acha pelo id no nome', async () => {
    const h = tmp()
    const f = writeRollout(h, 'abc-123', [meta('abc-123', '/r/api'), userMsg('oi')])
    fs.writeFileSync(path.join(path.dirname(f), 'outro.txt'), '')
    expect(await codexFiles(h)).toEqual([f])
    expect(await codexFiles('/nao/existe')).toEqual([])
    expect(await findCodexFile(['/nao/existe', h], 'abc-123')).toEqual({ file: f, profile: h })
    expect(await findCodexFile([h], 'zzz')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/conversations-codex.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

`src/daemon/conversations/codex.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { RawConversation } from './claude'
import { jsonLines, readHead } from './files'

const HEAD = 256 * 1024

function userText(o: Record<string, unknown>): string | null {
  const p = o.payload as { type?: unknown; role?: unknown; content?: unknown } | undefined
  if (o.type !== 'response_item' || !p || p.type !== 'message' || p.role !== 'user' || !Array.isArray(p.content)) return null
  const t = p.content.find((c) => c && typeof c === 'object' && (c as { type?: unknown }).type === 'input_text') as { text?: unknown } | undefined
  const text = typeof t?.text === 'string' ? t.text.trim() : ''
  return text && !text.startsWith('<') ? text : null
}

export async function readCodexConversation(file: string, home: string): Promise<RawConversation | null> {
  let st: fs.Stats
  try {
    st = await fs.promises.stat(file)
  } catch {
    return null
  }
  const lines = jsonLines(await readHead(file, HEAD).catch(() => ''))
  const metaLine = lines.find((o) => o.type === 'session_meta')
  const meta = metaLine?.payload as { id?: unknown; cwd?: unknown; git?: { branch?: unknown } } | undefined
  if (!meta || typeof meta.id !== 'string') return null
  let firstPrompt: string | null = null
  let messages = 0
  for (const o of lines) {
    const t = userText(o)
    if (!t) continue
    messages++
    if (!firstPrompt) firstPrompt = t
  }
  if (!firstPrompt) return null
  return {
    agent: 'codex',
    sessionId: meta.id,
    file,
    profile: home,
    startCwd: typeof meta.cwd === 'string' ? meta.cwd : null,
    title: null,
    firstPrompt,
    branch: typeof meta.git?.branch === 'string' ? meta.git.branch : null,
    lastActivity: st.mtimeMs,
    messages,
  }
}

async function dirs(p: string): Promise<string[]> {
  const e = await fs.promises.readdir(p, { withFileTypes: true }).catch(() => [])
  return e.filter((d) => d.isDirectory()).map((d) => d.name).sort()
}

export async function codexFiles(home: string): Promise<string[]> {
  const root = path.join(home, 'sessions')
  const out: string[] = []
  for (const y of await dirs(root))
    for (const m of await dirs(path.join(root, y)))
      for (const d of await dirs(path.join(root, y, m))) {
        const dayDir = path.join(root, y, m, d)
        const names = await fs.promises.readdir(dayDir).catch(() => [] as string[])
        for (const n of names.sort()) if (n.startsWith('rollout-') && n.endsWith('.jsonl')) out.push(path.join(dayDir, n))
      }
  return out
}

export async function findCodexFile(homes: string[], sessionId: string): Promise<{ file: string; profile: string } | null> {
  for (const home of homes) {
    const f = (await codexFiles(home)).find((x) => x.endsWith(`-${sessionId}.jsonl`))
    if (f) return { file: f, profile: home }
  }
  return null
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/daemon/conversations-codex.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/conversations/codex.ts tests/daemon/conversations-codex.test.ts
git commit -m "feat(conversas): leitura dos rollouts do Codex"
```

---

### Task 3: Índice — contas candidatas, cache, dedupe e localizar

**Files:**
- Create: `src/daemon/conversations/index.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/daemon/conversations-index.test.ts`

**Interfaces:**
- Consumes: Tasks 1 e 2.
- Produces:
  - em `src/shared/types.ts`:

```ts
export interface ConversationInfo {
  agent: AgentKind
  sessionId: string
  /** cwd de início: onde a conversa é retomada */
  cwd: string
  title: string
  branch: string | null
  lastActivity: number
  messages: number
  /** contas que podem retomar, na ordem da lista de agentes; [] = conta não configurada */
  accountIds: string[]
  /** painel vivo com esta sessão */
  openPaneId: string | null
}
```

  - `candidateAccounts(accounts: Account[], agent: AgentKind, profile: string, defaultProfile: string, loginDirs: Record<string, string>): string[]`
  - `interface IndexDeps { userHome: string; claudeProfiles: () => string[]; codexHomes: () => string[]; accounts: () => Account[]; loginDirs: () => Record<string, string>; openSessions: () => Map<string, string> }`
  - `class ConversationIndex { constructor(d: IndexDeps); list(paths: string[]): Promise<ConversationInfo[]>; locate(agent: AgentKind, sessionId: string, transcriptPath: string | null): Promise<{ file: string; startCwd: string | null } | null>; profiles(agent: AgentKind): string[] }`
  - `ConversationIndex.reads` (número de arquivos lidos de verdade; para teste do cache)

- [ ] **Step 1: Teste que falha**

`tests/daemon/conversations-index.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConversationIndex, candidateAccounts } from '../../src/daemon/conversations/index'
import { projectDirName } from '../../src/daemon/conversations/files'
import type { Account } from '../../src/shared/types'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ix-')))
const acc = (id: string, over: Partial<Account> = {}): Account => ({ id, label: id, command: id, color: '#111111', agent: 'claude', configDirMatch: [], isDefault: false, settingsMatch: null, pathPrefix: null, ...over })
const user = (text: string, cwd = '/r/api') => JSON.stringify({ type: 'user', message: { role: 'user', content: text }, cwd, timestamp: 't' })

function conv(profile: string, cwd: string, id: string, text = 'oi', fileCwd = cwd): string {
  const f = path.join(profile, 'projects', projectDirName(cwd), `${id}.jsonl`)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, user(text, fileCwd) + '\n')
  return f
}

describe('candidateAccounts', () => {
  const accounts = [
    acc('misa', { isDefault: true, configDirMatch: ['1-misa'] }),
    acc('mslabs', { configDirMatch: ['3-mslabs'] }),
    acc('weboption', { configDirMatch: ['2-web'] }),
    acc('weboption-max', { configDirMatch: ['2-web'] }),
    acc('codex', { agent: 'codex', isDefault: true }),
  ]
  it('perfil compartilhado devolve as duas contas, na ordem da lista', () => {
    expect(candidateAccounts(accounts, 'claude', '/s/2-web', '/h/.claude', {})).toEqual(['weboption', 'weboption-max'])
  })
  it('diretório aprendido (loginDirs) vale mais que configDirMatch; "" é o padrão', () => {
    expect(candidateAccounts(accounts, 'claude', '/h/.claude', '/h/.claude', { mslabs: '' })).toEqual(['misa', 'mslabs'])
    expect(candidateAccounts(accounts, 'claude', '/s/1-misa', '/h/.claude', { misa: '/s/1-misa' })).toEqual(['misa'])
    expect(candidateAccounts(accounts, 'claude', '/h/.claude', '/h/.claude', { misa: '/s/1-misa' })).toEqual([])
  })
  it('Codex padrão e perfil sem conta', () => {
    expect(candidateAccounts(accounts, 'codex', '/h/.codex', '/h/.codex', {})).toEqual(['codex'])
    expect(candidateAccounts(accounts, 'claude', '/s/9-nada', '/h/.claude', {})).toEqual([])
  })
})

describe('ConversationIndex', () => {
  function setup() {
    const home = tmp()
    const p2 = tmp()
    const accounts = [acc('misa', { isDefault: true }), acc('wo', { configDirMatch: [path.basename(p2)] })]
    const open = new Map<string, string>()
    const ix = new ConversationIndex({
      userHome: home,
      claudeProfiles: () => [p2, '/nao/existe'],
      codexHomes: () => [],
      accounts: () => accounts,
      loginDirs: () => ({}),
      openSessions: () => open,
    })
    return { home, p2, ix, open, def: path.join(home, '.claude') }
  }

  it('lista de várias pastas e perfis, mais recente primeiro, com contas e painel aberto', async () => {
    const { p2, ix, open, def } = setup()
    const a = conv(def, '/r/api', 'a', 'primeira')
    conv(p2, '/r/api/wt', 'b', 'na worktree')
    fs.utimesSync(a, 1000, 1000)
    open.set('b', 'pane-b')
    const list = await ix.list(['/r/api', '/r/api/wt'])
    expect(list.map((c) => [c.sessionId, c.title, c.accountIds, c.openPaneId, c.cwd])).toEqual([
      ['b', 'na worktree', ['wo'], 'pane-b', '/r/api/wt'],
      ['a', 'primeira', ['misa'], null, '/r/api'],
    ])
  })

  it('mesma conversa em dois perfis aparece uma vez, com as contas somadas', async () => {
    const { p2, ix, def } = setup()
    conv(def, '/r/api', 'dup')
    conv(p2, '/r/api', 'dup')
    const list = await ix.list(['/r/api'])
    expect(list).toHaveLength(1)
    expect(list[0].accountIds).toEqual(['misa', 'wo'])
  })

  it('título longo da 1ª mensagem é cortado em 80; cache não relê arquivo igual', async () => {
    const { ix, def } = setup()
    conv(def, '/r/api', 'x', 'a'.repeat(200))
    expect((await ix.list(['/r/api']))[0].title).toHaveLength(80)
    const before = ix.reads
    await ix.list(['/r/api'])
    expect(ix.reads).toBe(before)
  })

  it('locate: pelo transcriptPath, pelo id nos perfis, ou null; devolve o cwd de início', async () => {
    const { p2, ix, def } = setup()
    const f = conv(p2, '/r/api', 'mudou', 'oi', '/r/api') // começou em /r/api
    expect(await ix.locate('claude', 'mudou', f)).toEqual({ file: f, startCwd: '/r/api' })
    expect(await ix.locate('claude', 'mudou', '/caminho/velho.jsonl')).toEqual({ file: f, startCwd: '/r/api' })
    expect(await ix.locate('claude', 'nao-existe', null)).toBeNull()
    expect(ix.profiles('claude')).toEqual([def, p2, '/nao/existe'])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/conversations-index.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

Em `src/shared/types.ts`, adicione `ConversationInfo` (bloco do Interfaces acima) no fim do arquivo.

`src/daemon/conversations/index.ts`:

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { Account, AgentKind, ConversationInfo } from '../../shared/types'
import { claudeFilesFor, findClaudeFile, readClaudeConversation, type RawConversation } from './claude'
import { codexFiles, findCodexFile, readCodexConversation } from './codex'
import { pool } from './files'

/** contas que retomam conversas daquele perfil, na ordem da lista de agentes */
export function candidateAccounts(accounts: Account[], agent: AgentKind, profile: string, defaultProfile: string, loginDirs: Record<string, string>): string[] {
  return accounts
    .filter((a) => a.agent === agent)
    .filter((a) => {
      if (a.id in loginDirs) return (loginDirs[a.id] || defaultProfile) === profile
      if (profile === defaultProfile) return a.isDefault || a.configDirMatch.length === 0
      return a.configDirMatch.some((m) => profile.includes(m))
    })
    .map((a) => a.id)
}

export interface IndexDeps {
  userHome: string
  claudeProfiles: () => string[]
  codexHomes: () => string[]
  accounts: () => Account[]
  loginDirs: () => Record<string, string>
  openSessions: () => Map<string, string>
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))]
const title80 = (c: RawConversation) => (c.title ?? c.firstPrompt ?? '').slice(0, 80)

export class ConversationIndex {
  private cache = new Map<string, { size: number; mtimeMs: number; conv: RawConversation | null }>()
  /** arquivos lidos de verdade (para teste do cache) */
  reads = 0

  constructor(private d: IndexDeps) {}

  private defaultProfile(agent: AgentKind): string {
    return path.join(this.d.userHome, agent === 'claude' ? '.claude' : '.codex')
  }

  profiles(agent: AgentKind): string[] {
    const learned = this.d.accounts().filter((a) => a.agent === agent).map((a) => this.d.loginDirs()[a.id]).filter((v): v is string => !!v)
    return uniq([this.defaultProfile(agent), ...(agent === 'claude' ? this.d.claudeProfiles() : this.d.codexHomes()), ...learned])
  }

  private async read(file: string, profile: string, agent: AgentKind): Promise<RawConversation | null> {
    const st = await fs.promises.stat(file).catch(() => null)
    if (!st) return null
    const hit = this.cache.get(file)
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.conv
    this.reads++
    const conv = agent === 'claude' ? await readClaudeConversation(file, profile) : await readCodexConversation(file, profile)
    this.cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, conv })
    return conv
  }

  async list(paths: string[]): Promise<ConversationInfo[]> {
    const jobs: { file: string; profile: string; agent: AgentKind }[] = []
    for (const profile of this.profiles('claude')) for (const p of paths) for (const file of await claudeFilesFor(profile, p)) jobs.push({ file, profile, agent: 'claude' })
    for (const home of this.profiles('codex')) for (const file of await codexFiles(home)) jobs.push({ file, profile: home, agent: 'codex' })
    const raws = (await pool(jobs, 8, (j) => this.read(j.file, j.profile, j.agent))).filter((c): c is RawConversation => c !== null)
    const wanted = new Set(paths)
    const accounts = this.d.accounts()
    const loginDirs = this.d.loginDirs()
    const open = this.d.openSessions()
    const byId = new Map<string, ConversationInfo>()
    for (const c of raws) {
      if (c.agent === 'codex' && (!c.startCwd || !wanted.has(c.startCwd))) continue
      const ids = candidateAccounts(accounts, c.agent, c.profile, this.defaultProfile(c.agent), loginDirs)
      const key = `${c.agent}:${c.sessionId}`
      const prev = byId.get(key)
      if (prev) {
        prev.accountIds = accounts.map((a) => a.id).filter((id) => prev.accountIds.includes(id) || ids.includes(id))
        continue
      }
      byId.set(key, {
        agent: c.agent,
        sessionId: c.sessionId,
        cwd: c.startCwd ?? paths[0],
        title: title80(c),
        branch: c.branch,
        lastActivity: c.lastActivity,
        messages: c.messages,
        accountIds: ids,
        openPaneId: open.get(c.sessionId) ?? null,
      })
    }
    return [...byId.values()].sort((a, b) => b.lastActivity - a.lastActivity)
  }

  async locate(agent: AgentKind, sessionId: string, transcriptPath: string | null): Promise<{ file: string; startCwd: string | null } | null> {
    let found: { file: string; profile: string } | null = null
    if (transcriptPath && fs.existsSync(transcriptPath)) found = { file: transcriptPath, profile: path.dirname(path.dirname(path.dirname(transcriptPath))) }
    if (!found) found = agent === 'claude' ? await findClaudeFile(this.profiles('claude'), sessionId) : await findCodexFile(this.profiles('codex'), sessionId)
    if (!found) return null
    const conv = await this.read(found.file, found.profile, agent)
    return { file: found.file, startCwd: conv?.startCwd ?? null }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/daemon/conversations-index.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/conversations/index.ts src/shared/types.ts tests/daemon/conversations-index.test.ts
git commit -m "feat(conversas): índice com contas candidatas, cache, dedupe e localizar"
```

---

### Task 4: Daemon — perfis aprendidos, `conversations.list`, checagem no retomar

**Files:**
- Modify: `src/shared/types.ts` (`ResumeEntry.transcriptPath?`), `src/shared/protocol.ts`, `src/daemon/persist.ts`, `src/daemon/daemon.ts`
- Test: `tests/daemon/daemon.test.ts`, `tests/daemon/persist.test.ts`

**Interfaces:**
- Consumes: `ConversationIndex` (Task 3).
- Produces:
  - `ClientRequest` `{ t: 'conversations.list'; paths: string[] }` → `ConversationInfo[]`
  - `pane.create` aceita `transcriptPath?: string | null`; com `resumeSessionId` de conversa ausente falha com `conversation-missing`; com conversa achada, o painel abre no `startCwd`.
  - `ResumeEntry.transcriptPath?: string | null`; `PersistedPane.transcriptPath?: string | null`
  - `Persisted.claudeProfiles: string[]`, `Persisted.codexHomes: string[]`

- [ ] **Step 1: Testes que falham**

Em `tests/daemon/persist.test.ts`, no `describe`:

```ts
  it('claudeProfiles e codexHomes têm padrão vazio', () => {
    expect(defaultPersisted()).toMatchObject({ claudeProfiles: [], codexHomes: [] })
  })
```

Em `tests/daemon/daemon.test.ts`:

1. Import no topo: `import { projectDirName } from '../../src/daemon/conversations/files'`.
2. Helpers depois de `function hook(...)`:

```ts
function fakeClaudeConv(o: DaemonOptions, cwd: string, id: string, text = 'oi'): string {
  const f = path.join(o.userHome, '.claude', 'projects', projectDirName(cwd), `${id}.jsonl`)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify({ type: 'user', message: { role: 'user', content: text }, cwd, timestamp: 't' }) + '\n')
  return f
}

function fakeCodexConv(o: DaemonOptions, cwd: string, id: string): string {
  const f = path.join(o.userHome, '.codex', 'sessions', '2026', '10', '01', `rollout-2026-10-01T10-00-00-${id}.jsonl`)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const meta = { type: 'session_meta', payload: { id, cwd } }
  const msg = { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'oi' }] } }
  fs.writeFileSync(f, JSON.stringify(meta) + '\n' + JSON.stringify(msg) + '\n')
  return f
}
```

3. No teste "reinício do daemon" do Claude (o que retoma `abcd-1234` com `claude --resume`), logo depois de `const second = await boot({}, first.home)`, adicione `fakeClaudeConv(second.o, repo.dir, 'abcd-1234')`, e troque a expectativa do `resumable[0]` por:

```ts
    expect(st.resumable[0]).toEqual({ paneId, cwd: repo.dir, accountId: 'misa', sessionId: 'abcd-1234', agent: 'claude', transcriptPath: null })
```

4. No teste do Codex ("sessão Codex sem agente Codex…"), logo depois de `const second = await boot({}, first.home)`, adicione `fakeCodexConv(second.o, repo.dir, 'abcd-1234')`.

5. Novo teste no `describe` principal:

```ts
  it('conversas: lista por pasta, marca painel aberto, recusa conversa ausente e retoma no cwd de início', async () => {
    repo = makeRepo()
    const { o, app } = await boot()
    await app.client.request({ t: 'project.add', path: repo.dir })
    fakeClaudeConv(o, repo.dir, 'velha', 'Corrigir login')
    const wt = path.join(repo.dir, '.claude', 'worktrees', 'x')
    repo.git('worktree', 'add', '-b', 'x', wt)

    const list = await app.client.request<ConversationInfo[]>({ t: 'conversations.list', paths: [repo.dir] })
    expect(list.map((c) => [c.sessionId, c.title, c.accountIds, c.openPaneId])).toEqual([['velha', 'Corrigir login', ['misa'], null]])

    await expect(app.client.request({ t: 'pane.create', cwd: repo.dir, accountId: 'misa', resumeSessionId: 'sumiu', cols: 80, rows: 24 })).rejects.toThrow('conversation-missing')

    // o painel guardava o cwd da worktree, mas a conversa começou na pasta principal
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: wt, accountId: 'misa', resumeSessionId: 'velha', cols: 80, rows: 24 })
    const st = await app.waitState((s) => s.panes.some((p) => p.id === paneId))
    expect(st.panes.find((p) => p.id === paneId)?.cwd).toBe(repo.dir)
    await hook(o, paneId, { hook_event_name: 'SessionStart', session_id: 'velha', cwd: repo.dir, transcript_path: path.join(o.userHome, '.claude', 'projects', projectDirName(repo.dir), 'velha.jsonl') })
    await app.waitState((s) => s.panes.some((p) => p.claude?.sessionId === 'velha'))
    const again = await app.client.request<ConversationInfo[]>({ t: 'conversations.list', paths: [repo.dir] })
    expect(again[0].openPaneId).toBe(paneId)
  })
```

Adicione `ConversationInfo` ao import de tipos do arquivo (ou `import type { ConversationInfo } from '../../src/shared/types'`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/daemon.test.ts tests/daemon/persist.test.ts`
Expected: FAIL (`conversations.list` desconhecido; `claudeProfiles` ausente; retomada sem checagem).

- [ ] **Step 3: Implementar**

`src/shared/types.ts` — em `ResumeEntry`, depois de `agent?`:

```ts
  /** caminho do .jsonl visto no hook (Claude); ajuda a localizar a conversa ao retomar */
  transcriptPath?: string | null
```

`src/shared/protocol.ts`:
- No `pane.create`, depois de `resumeAgent?: AgentKind;` (ou no fim do objeto): `transcriptPath?: string | null;`
- Nova variante: `| { t: 'conversations.list'; paths: string[] }`

`src/daemon/persist.ts`:
- `PersistedPane`: `transcriptPath?: string | null`
- `Persisted`: `claudeProfiles: string[]` e `codexHomes: string[]` (comentário: "CLAUDE_CONFIG_DIR / CODEX_HOME vistos em hooks")
- `defaultPersisted()`: `claudeProfiles: [], codexHomes: [],`
- `loadPersisted`: `claudeProfiles: Array.isArray(parsed.claudeProfiles) ? parsed.claudeProfiles.filter((x) => typeof x === 'string') : [],` e o mesmo para `codexHomes`.

`src/daemon/daemon.ts`:
1. Import: `import { ConversationIndex } from './conversations/index'`
2. Campo: `private conversations!: ConversationIndex`
3. Em `init()`, logo depois de `this.persisted = p` (e depois da criação do `UsageMonitor`, se estiver ali):

```ts
    this.conversations = new ConversationIndex({
      userHome: this.o.userHome,
      claudeProfiles: () => this.persisted.claudeProfiles,
      codexHomes: () => this.persisted.codexHomes,
      accounts: () => this.persisted.accounts,
      loginDirs: () => this.persisted.loginDirs,
      openSessions: () => new Map(this.panes.records().filter((r) => r.alive && r.claude).map((r) => [r.claude!.sessionId, r.id])),
    })
```

4. Na reconstrução do `resumable` em `init()`, troque `byId.set(pane.id, { paneId: pane.id, cwd: pane.cwd, accountId: pane.accountId, sessionId: pane.sessionId, agent: pane.agent ?? 'claude' })` por:

```ts
    for (const pane of p.panes) byId.set(pane.id, { paneId: pane.id, cwd: pane.cwd, accountId: pane.accountId, sessionId: pane.sessionId, agent: pane.agent ?? 'claude', transcriptPath: pane.transcriptPath ?? null })
```

5. Em `save()`, no `.map((r) => ({ ... }))` dos painéis, acrescente `transcriptPath: r.claude?.transcriptPath ?? null`.
6. No `case 'hook':`, logo depois do `await this.panes.applyHook(...)`:

```ts
        if (req.configDir) {
          const list = (req.agent ?? 'claude') === 'codex' ? this.persisted.codexHomes : this.persisted.claudeProfiles
          if (!list.includes(req.configDir)) {
            list.push(req.configDir)
            this.changed()
          }
        }
```

7. Troque o `case 'pane.create':` por:

```ts
      case 'pane.create': {
        let req2 = req
        if (req.resumeSessionId) {
          const found = await this.conversations.locate(req.resumeAgent ?? 'claude', req.resumeSessionId, req.transcriptPath ?? null)
          if (!found) throw new Error('conversation-missing')
          // o --resume só acha a conversa na pasta onde ela começou
          if (found.startCwd) req2 = { ...req, cwd: found.startCwd }
        }
        const rec = this.panes.create(req2)
        this.persisted.resumable = this.persisted.resumable.filter((r) => r.paneId !== rec.id)
        this.changed()
        return { paneId: rec.id }
      }
```

8. Novo case (perto de `agents.detect`):

```ts
      case 'conversations.list':
        return this.conversations.list(req.paths)
```

- [ ] **Step 4: Rodar e ver passar (e a suíte toda)**

Run: `npx vitest run tests/daemon/daemon.test.ts tests/daemon/persist.test.ts && npm test && npm run typecheck`
Expected: PASS em tudo.

- [ ] **Step 5: Commit**

```bash
git add src/shared src/daemon tests/daemon
git commit -m "feat(conversas): daemon lista conversas, aprende perfis e confere a conversa antes de retomar"
```

---

### Task 5: Modelo do renderer — filtro, horário relativo

**Files:**
- Create: `src/renderer/src/conversations-model.ts`
- Test: `tests/renderer/conversations-model.test.ts`

**Interfaces:**
- Consumes: `ConversationInfo` (Task 3).
- Produces:
  - `normalize(s: string): string` (minúsculas, sem acento)
  - `filterConversations(list: ConversationInfo[], q: string): ConversationInfo[]`
  - `relativeTime(ms: number, now: number): string`
  - `isMissing(e: unknown): boolean` (erro `conversation-missing`)

- [ ] **Step 1: Teste que falha**

`tests/renderer/conversations-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { filterConversations, isMissing, normalize, relativeTime } from '../../src/renderer/src/conversations-model'
import type { ConversationInfo } from '../../src/shared/types'

const c = (sessionId: string, title: string, branch: string | null = null): ConversationInfo => ({ agent: 'claude', sessionId, cwd: '/r', title, branch, lastActivity: 0, messages: 1, accountIds: [], openPaneId: null })

describe('conversations-model', () => {
  it('filtro sem acento e sem diferenciar maiúsculas, também pela branch', () => {
    const list = [c('a', 'Configuração do login'), c('b', 'build quebrado', 'feat/agenda-google'), c('c', 'outra')]
    expect(normalize('ÇÃo')).toBe('cao')
    expect(filterConversations(list, 'configuracao').map((x) => x.sessionId)).toEqual(['a'])
    expect(filterConversations(list, 'AGENDA').map((x) => x.sessionId)).toEqual(['b'])
    expect(filterConversations(list, '  ')).toHaveLength(3)
  })

  it('horário relativo', () => {
    const now = new Date(2026, 9, 1, 15, 0).getTime()
    expect(relativeTime(now - 20_000, now)).toBe('agora')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('há 5 min')
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe('há 2 h')
    expect(relativeTime(new Date(2026, 8, 30, 14, 10).getTime(), now)).toBe('ontem 14:10')
    expect(relativeTime(new Date(2026, 8, 20, 9, 5).getTime(), now)).toBe('20/09 09:05')
  })

  it('isMissing reconhece o erro do daemon', () => {
    expect(isMissing(new Error('conversation-missing'))).toBe(true)
    expect(isMissing(new Error('outra coisa'))).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/renderer/conversations-model.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

`src/renderer/src/conversations-model.ts`:

```ts
import type { ConversationInfo } from '../../shared/types'
import { errorMessage } from './api'

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function filterConversations(list: ConversationInfo[], q: string): ConversationInfo[] {
  const n = normalize(q.trim())
  if (!n) return list
  return list.filter((c) => normalize(`${c.title} ${c.branch ?? ''}`).includes(n))
}

const pad = (n: number) => String(n).padStart(2, '0')

export function relativeTime(ms: number, now: number): string {
  const diff = now - ms
  if (diff < 60_000) return 'agora'
  if (diff < 3_600_000) return `há ${Math.floor(diff / 60_000)} min`
  const d = new Date(ms)
  const today = new Date(now)
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) return `há ${Math.floor(diff / 3_600_000)} h`
  const yesterday = new Date(now - 86_400_000)
  if (d.toDateString() === yesterday.toDateString()) return `ontem ${clock}`
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${clock}`
}

export function isMissing(e: unknown): boolean {
  return errorMessage(e).includes('conversation-missing')
}
```

Confira que `errorMessage` existe em `src/renderer/src/api.ts` (é usado em `store.ts`); se o import puxar o `window`, mova `isMissing` para usar `e instanceof Error ? e.message : String(e)`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/renderer/conversations-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/conversations-model.ts tests/renderer/conversations-model.test.ts
git commit -m "feat(conversas): modelo do renderer (filtro, horário relativo, erro de conversa ausente)"
```

---

### Task 6: Interface — janela, menus, sessão perdida e "Retomar todas"

**Files:**
- Create: `src/renderer/src/components/ConversationsModal.tsx`
- Modify: `src/renderer/src/store.ts`, `src/renderer/src/actions.ts`, `src/renderer/src/flows.ts`, `src/renderer/src/components/Modals.tsx`, `src/renderer/src/components/PaneFrame.tsx`, `src/renderer/src/components/StatusBar.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: Tasks 4 e 5.
- Produces:
  - `Modal` ganha `{ kind: 'conversations'; paths: string[]; title: string; accountId?: string | null; replacePaneId?: string; projectPaths?: string[] }`
  - `UiState.missingResume: string[]` (paneIds cuja conversa não foi encontrada)
  - `openNewPane` aceita `transcriptPath?: string | null`
  - `openConversations(o: { paths: string[]; title: string; accountId?: string | null; replacePaneId?: string; projectPaths?: string[] }): void`
  - `resumeConversation(c: ConversationInfo, accountId: string, replacePaneId?: string): Promise<void>`

Não há teste automatizado de componente React neste projeto (só modelos puros); a verificação é typecheck, build e o teste real da Task 7.

- [ ] **Step 1: Store e ações**

`src/renderer/src/store.ts`:
- No tipo `Modal`, nova variante:

```ts
  | { kind: 'conversations'; paths: string[]; title: string; accountId?: string | null; replacePaneId?: string; projectPaths?: string[] }
```

- Em `UiState`: `missingResume: string[]` e, no estado inicial, `missingResume: []`.

`src/renderer/src/actions.ts` — em `openNewPane`, acrescente `transcriptPath?: string | null` ao tipo do parâmetro e passe `transcriptPath: o.transcriptPath ?? null` no `pane.create`.

- [ ] **Step 2: Fluxos**

`src/renderer/src/flows.ts`:

1. Imports: `import type { ConversationInfo } from '../../shared/types'` (junto do import de tipos existente) e `import { isMissing } from './conversations-model'`.
2. Novas funções (perto de `resumeAll`):

```ts
export function openConversations(o: { paths: string[]; title: string; accountId?: string | null; replacePaneId?: string; projectPaths?: string[] }): void {
  setUi({ modal: { kind: 'conversations', ...o } })
}

export async function resumeConversation(c: ConversationInfo, accountId: string, replacePaneId?: string): Promise<void> {
  try {
    await openNewPane({ paneId: replacePaneId, cwd: c.cwd, accountId, resumeSessionId: c.sessionId, resumeAgent: c.agent })
    setUi((s) => ({ modal: null, missingResume: s.missingResume.filter((id) => id !== replacePaneId) }))
  } catch (e) {
    showError(e)
  }
}

/** abre a janela de conversas para um painel cuja conversa sumiu */
export function chooseConversationFor(paneId: string): void {
  const app = getUi().app
  const r = app?.resumable.find((x) => x.paneId === paneId)
  if (!r) return
  const project = app?.projects.find((p) => p.worktrees.some((w) => r.cwd === w.path || r.cwd.startsWith(w.path + '/')))
  openConversations({
    paths: [r.cwd],
    title: project ? `${project.name.toUpperCase()} · ${tildifyHome(r.cwd)}` : tildifyHome(r.cwd),
    accountId: r.accountId,
    replacePaneId: paneId,
    projectPaths: project?.worktrees.map((w) => w.path),
  })
}

function tildifyHome(p: string): string {
  const home = getUi().app?.userHome ?? ''
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p
}
```

3. Troque `resumeAll` por:

```ts
export async function resumeAll(): Promise<void> {
  const missing: string[] = []
  for (const r of getUi().app?.resumable ?? []) {
    try {
      await openNewPane({ paneId: r.paneId, cwd: r.cwd, accountId: r.accountId, resumeSessionId: r.sessionId ?? undefined, resumeAgent: r.agent, transcriptPath: r.transcriptPath ?? null })
    } catch (e) {
      if (isMissing(e)) missing.push(r.paneId)
      else showError(e)
    }
  }
  setUi({ missingResume: missing })
}
```

4. Em `worktreeMenu`, adicione ao array do menu, depois de `{ id: 'shell', label: 'Terminal comum' },`:

```ts
    { id: 'conv', label: 'Conversas desta worktree…' },
```

e no tratamento:

```ts
  else if (choice === 'conv') openConversations({ paths: [w.path], title: `${p.name.toUpperCase()} ⎇ ${w.label}`, projectPaths: p.worktrees.map((x) => x.path) })
```

5. Em `projectMenu`, adicione antes de `{ id: 'conflicts', ... }`:

```ts
    { id: 'conv', label: 'Conversas do projeto…' },
```

e no tratamento (antes do `if (choice === 'conflicts')`):

```ts
    if (choice === 'conv') return openConversations({ paths: p.worktrees.map((w) => w.path), title: `${p.name.toUpperCase()} · projeto inteiro` })
```

(`WorktreeItem` já tem `path` e `label`; `ProjectItem` tem `worktrees`.)

- [ ] **Step 3: Janela**

`src/renderer/src/components/ConversationsModal.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import type { ConversationInfo } from '../../../shared/types'
import { revealPane } from '../actions'
import { AGENT_LABEL } from '../agents-model'
import { filterConversations, relativeTime } from '../conversations-model'
import { openConversations, resumeConversation } from '../flows'
import { setUi, useUi } from '../store'

type Props = { paths: string[]; title: string; accountId?: string | null; replacePaneId?: string; projectPaths?: string[] }

export function ConversationsModal({ paths, title, accountId, replacePaneId, projectPaths }: Props) {
  const accounts = useUi((s) => s.app?.accounts ?? [])
  const [list, setList] = useState<ConversationInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [chosen, setChosen] = useState<Record<string, string>>({})

  useEffect(() => {
    setList(null)
    window.gt
      .request<ConversationInfo[]>({ t: 'conversations.list', paths })
      .then(setList)
      .catch((e) => setError(String(e)))
  }, [paths.join('\n')])

  const shown = useMemo(() => filterConversations(list ?? [], q), [list, q])
  const close = () => setUi({ modal: null })
  const accountFor = (c: ConversationInfo) => chosen[c.sessionId] ?? (accountId && c.accountIds.includes(accountId) ? accountId : c.accountIds[0])
  const act = (c: ConversationInfo | undefined) => {
    if (!c) return
    if (c.openPaneId) {
      close()
      revealPane(c.openPaneId)
      return
    }
    const acc = accountFor(c)
    if (acc) void resumeConversation(c, acc, replacePaneId)
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal conv-modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'ArrowDown') setSel((i) => Math.min(i + 1, shown.length - 1))
          if (e.key === 'ArrowUp') setSel((i) => Math.max(i - 1, 0))
          if (e.key === 'Enter') act(shown[sel])
        }}
      >
        <h3>Conversas · {title}</h3>
        <input className="text-input" autoFocus placeholder="filtrar por título, mensagem ou branch" value={q} onChange={(e) => { setQ(e.target.value); setSel(0) }} />
        {error && <p className="c-bad">{error}</p>}
        {!list && !error && <p className="sb-dim">lendo conversas…</p>}
        {list && shown.length === 0 && (
          <p className="sb-dim">
            Nenhuma conversa nesta pasta.{' '}
            {projectPaths && projectPaths.length > paths.length && (
              <button className="ph-link" onClick={() => openConversations({ paths: projectPaths, title: `${title} · projeto inteiro`, accountId, replacePaneId })}>
                ver o projeto inteiro
              </button>
            )}
          </p>
        )}
        <div className="conv-list">
          {shown.map((c, i) => {
            const acc = accountFor(c)
            return (
              <div key={`${c.agent}:${c.sessionId}`} className={`conv-row${i === sel ? ' selected' : ''}`} onMouseEnter={() => setSel(i)} onDoubleClick={() => act(c)}>
                <span className="conv-agent">{AGENT_LABEL[c.agent]}</span>
                <span className="conv-title" title={c.title}>{c.title}</span>
                <span className="conv-meta">
                  {paths.length > 1 && <>{c.cwd.split('/').pop()} · </>}
                  {c.branch && <>⎇ {c.branch} · </>}
                  {relativeTime(c.lastActivity, Date.now())} · {c.messages} msg
                </span>
                {c.accountIds.length > 1 ? (
                  <select value={acc} onChange={(e) => setChosen({ ...chosen, [c.sessionId]: e.target.value })} onClick={(e) => e.stopPropagation()}>
                    {c.accountIds.map((id) => (
                      <option key={id} value={id}>{accounts.find((a) => a.id === id)?.label ?? id}</option>
                    ))}
                  </select>
                ) : (
                  <span className="conv-account">{acc ? (accounts.find((a) => a.id === acc)?.label ?? acc) : <span title="cadastre o agente na aba Agentes">conta não configurada</span>}</span>
                )}
                <button className="primary" disabled={!c.openPaneId && !acc} onClick={() => act(c)}>
                  {c.openPaneId ? 'Focar' : 'Retomar'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

`src/renderer/src/components/Modals.tsx` — import `import { ConversationsModal } from './ConversationsModal'` e, junto das outras linhas `if (modal.kind === …)`:

```tsx
  if (modal.kind === 'conversations') return <ConversationsModal {...modal} />
```

`src/renderer/src/styles.css` — no fim:

```css
.conv-modal { width: min(860px, 92vw); }
.conv-list { max-height: 60vh; overflow-y: auto; margin-top: 8px; }
.conv-row { display: grid; grid-template-columns: 56px 1fr auto auto auto; gap: 10px; align-items: center; padding: 6px 8px; border-radius: 4px; }
.conv-row.selected { background: color-mix(in srgb, var(--accent) 18%, transparent); }
.conv-agent { font-size: 11px; color: var(--fg-dim); }
.conv-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conv-meta, .conv-account { font-size: 11.5px; color: var(--fg-dim); white-space: nowrap; }
```

- [ ] **Step 4: Sessão perdida e status bar**

`src/renderer/src/components/PaneFrame.tsx`:
1. Imports: `import { chooseConversationFor } from '../flows'` e `import { isMissing } from '../conversations-model'`.
2. Novo seletor: `const missing = useUi((s) => s.missingResume.includes(paneId))`.
3. Troque a função `resume` por:

```tsx
  const resume = () => {
    if (!resumable) return
    openNewPane({ paneId, cwd: resumable.cwd, accountId: resumable.accountId, resumeSessionId: resumable.sessionId ?? undefined, resumeAgent: resumable.agent, transcriptPath: resumable.transcriptPath ?? null }).catch((e) => {
      if (isMissing(e)) setUi((s) => ({ missingResume: [...s.missingResume.filter((id) => id !== paneId), paneId] }))
      else showError(e)
    })
  }
```

4. No bloco `.pane-dead`, troque o título e os botões para: quando `missing`, título `A conversa salva não foi encontrada` e botões **Escolher conversa…** (`onClick={() => chooseConversationFor(paneId)}`, classe `primary`) e **Descartar** (o existente); senão, o conteúdo atual.

`src/renderer/src/components/StatusBar.tsx` — imports `import { chooseConversationFor } from '../flows'` e, dentro do componente, `const missing = useUi((s) => s.missingResume)`. Depois do bloco de `app.resumable.length > 0`:

```tsx
      {missing.length > 0 && (
        <span className="st-item warn">
          {missing.length === 1 ? '1 conversa não encontrada' : `${missing.length} conversas não encontradas`}{' '}
          <button className="st-btn" onClick={() => chooseConversationFor(missing[0])}>
            Escolher
          </button>
        </span>
      )}
```

Se `setUi` não aceitar função atualizadora, use `setUi({ missingResume: [...getUi().missingResume.filter((id) => id !== paneId), paneId] })` (e o mesmo em `resumeConversation`).

- [ ] **Step 5: Typecheck, suíte e build**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS e build sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat(conversas): janela de conversas, menus, sessão perdida com escolher conversa e aviso no Retomar todas"
```

---

### Task 7: Teste real com o usuário

**Files:** nenhum (ajustes que surgirem entram com teste próprio).

- [ ] **Step 1: Abrir isolado**

O Electron precisa estar baixado na worktree: `node node_modules/electron/install.js` (dentro de `node_modules/electron`) se `node_modules/electron/dist` não existir. Rodar em segundo plano: `GT_HOME=/tmp/gt-conversas npm run dev`.

- [ ] **Step 2: Conferir com o usuário**

1. Adicionar o projeto TCHEERP; clique direito na worktree principal → **Conversas desta worktree…**: aparecem as conversas do Claude e do Codex, mais recentes primeiro, com conta.
2. **Retomar** uma conversa antiga: o painel abre e a conversa continua (sem "No conversation found").
3. Uma conversa que já está aberta mostra **Focar**.
4. **Conversas do projeto…** lista todas as worktrees.
5. Perfil compartilhado (weboption/weboption-max): o seletor de conta aparece.

- [ ] **Step 3: Registrar**

Anotar no PR/commit final o que foi conferido e as diferenças.
