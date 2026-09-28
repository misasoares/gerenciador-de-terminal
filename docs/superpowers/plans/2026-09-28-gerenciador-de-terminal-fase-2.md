# Gerenciador de Terminal — Fase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar a fase 2: estado 🔵 "sua vez", aviso de atenção em abas, Dock e notificações, ⌘J, análise de conflitos entre worktrees, personalização (nome, cor, tema, fonte), ⌘K e os 8 ajustes adiados da fase 1.

**Architecture:** O daemon continua sendo a fonte da verdade (estado da sessão, "visto", conflitos, metadados de painel, preferências). O renderer calcula tudo o que é apresentação com funções puras testáveis (`attention.ts`, `search.ts`, `themes.ts`). O processo principal do Electron cuida só do que é do sistema (notificação, badge do Dock, menu). A análise de conflitos usa `git merge-tree --write-tree` sobre "tips" de cada worktree; tips de worktrees com alterações locais são commits soltos criados com índice temporário.

**Tech Stack:** a mesma da fase 1 (Electron 44, electron-vite 5, React 19, TypeScript 5.9, node-pty, xterm 6, Vitest 5), git 2.50 (`merge-tree --write-tree`).

**Spec:** `docs/superpowers/specs/2026-09-28-gerenciador-de-terminal-fase-2-design.md` (base: spec e plano da fase 1).

## Global Constraints

- Estados: `working` 🟢, `needs-you` 🟡, `your-turn` 🔵, `idle` ⚪. 🟡 = permissão ou opções; 🔵 = fim de turno ou interrupção esperando resposta, até o painel ser focado com a janela ativa.
- A notificação só dispara na **transição** para 🟡/🔵, e só se `!janelaFocada || !painelVisívelNaAbaAtiva`.
- ⌘J: `needs-you` antes de `your-turn`, `statusSince` crescente, volta ao início depois do último.
- A análise de conflitos **nunca** altera worktree, índice, stash ou branch. No máximo 4 comandos git em paralelo, timeout de 30 s. A reanálise automática só roda em projetos já analisados, 5 s depois da última mudança.
- `PROTOCOL_VERSION = 2`; `hello` compara também o `buildId`.
- Rodar testes com `rtk proxy npx vitest run …` (o hook RTK reescreve o vitest).
- Unix socket no macOS: caminho de até 104 bytes. Nos testes, criar sockets em `os.tmpdir()`.
- Textos de interface em português. Todo commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **O retrato de worktree com alterações não pode tocar no índice real** (`git add` do usuário) nem criar refs. Uma falha no meio precisa apagar o índice temporário. → teste na Task 4 (compara `git status` e `git stash list` antes e depois).
2. **Enxurrada de notificações:** sessões que alternam 🟢→🔵→🟢 rapidamente, ou reconexão (estado inteiro chegando de novo), não podem notificar em massa. Só conta transição entre dois estados vistos pelo mesmo renderer. O primeiro estado depois de conectar não notifica. → teste na Task 2.
3. **Custo da análise com ~20 worktrees:** worktrees iguais à main, ou pares com tips iguais, não podem virar comandos git. → teste na Task 4 (conta as chamadas).
4. **Esperar o prompt não pode travar a digitação do comando:** um shell que nunca imprime nada ainda recebe o comando depois de 5 s. → teste na Task 10.
5. **Nome da sessão com caracteres especiais** (acento, emoji, aspas) aparece igual no cabeçalho, na sidebar e na notificação, e sobrevive a reiniciar o daemon. → teste na Task 7.

---

## Estrutura de arquivos (novos e alterados)

```
src/shared/
  types.ts        + your-turn, statusSince, ConflictReport, PaneView.name/color, TerminalSettings, AppState.settings, RemoveCheck.ignoredFiles
  protocol.ts     + pane.seen, pane.meta, pane.detach, conflicts.analyze, settings.save; pane.attach.seq; pane.data.seq; hello.buildId; PROTOCOL_VERSION 2
  build.ts        (novo) BUILD_ID
  bridge.ts       + notify, setBadge, onReveal
src/daemon/
  session.ts      Stop → your-turn; statusSince; markSeen
  panes.ts        markSeen, meta, espera do prompt
  daemon.ts       novas requisições, conflitos, meta, settings, seq
  conflicts.ts    (novo) snapshotTip, parseMergeTree, analyzeConflicts
  lock.ts         (novo) acquireLock
  title.ts        leitor incremental
  worktree-remove.ts  ignorados, prune pontual, `--`
  hooks.ts        nc -w 1
  git/run.ts      code + env
  git/monitor.ts  onChange(path)
  persist.ts      paneMeta, settings
  main.ts         trava do daemon
src/main/
  index.ts        notify, badge, reveal, ⌘J/⌘K/⌘,
  daemon-link.ts  buildId
  menu.ts         ⌘J, ⌘K, ⌘,
src/preload/index.ts
src/renderer/src/
  attention.ts    (novo) puras: estado de atenção, fila ⌘J, abas, Dock, notificar
  search.ts       (novo) puras: itens e busca do ⌘K
  themes.ts       (novo) presets de tema e padrões
  conflicts-model.ts (novo) puras: conflitos por worktree
  store.ts, actions.ts, terminals.ts, header.ts, sidebar-model.ts, main.tsx, App.tsx, styles.css
  components/ HooksBanner.tsx (novo), ConflictsModal.tsx (novo), Preferences.tsx (novo), Palette.tsx (novo),
              PaneHeader.tsx, PaneFrame.tsx, Workspace.tsx, Sidebar.tsx, StatusBar.tsx, Modals.tsx
electron.vite.config.ts, vitest.config.ts   define __BUILD_ID__
```

---

### Task 1: Estado 🔵 "sua vez", `statusSince` e `pane.seen` no daemon

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/protocol.ts`, `src/daemon/session.ts`, `src/daemon/panes.ts`, `src/daemon/daemon.ts`
- Modify (ajuste dos testes existentes ao novo tipo/estado): `tests/daemon/session.test.ts`, `tests/daemon/daemon.test.ts`, `tests/daemon/review-fixes.test.ts`, `tests/renderer/header.test.ts`, `tests/renderer/sidebar-model.test.ts`, `tests/renderer/ui-logic.test.ts`
- Test: `tests/daemon/session-v2.test.ts`

**Interfaces:**
- Produces:
  - `type SessionStatus = 'working' | 'needs-you' | 'your-turn' | 'idle'`
  - `ClaudeSession.statusSince: number`
  - `reduceSession(prev: ClaudeSession | null, p: HookPayload, now?: number): ClaudeSession | null`
  - `markSeen(s: ClaudeSession | null, now?: number): ClaudeSession | null`
  - `PaneManager.markSeen(paneId: string): void`
  - requisição `{ t: 'pane.seen'; paneId: string }`

- [ ] **Step 1: Teste que falha — `tests/daemon/session-v2.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { markSeen, reduceSession } from '../../src/daemon/session'
import type { ClaudeSession, HookPayload } from '../../src/shared/types'

const ev = (hook_event_name: string, extra: Partial<HookPayload> = {}): HookPayload => ({ hook_event_name, session_id: 's1', cwd: '/p', ...extra })
const run = (events: [HookPayload, number][]) => events.reduce<ClaudeSession | null>((s, [e, t]) => reduceSession(s, e, t), null)

describe('estado 🔵 sua vez', () => {
  it('Stop e StopFailure viram your-turn', () => {
    expect(run([[ev('UserPromptSubmit'), 1], [ev('Stop'), 2]])?.status).toBe('your-turn')
    expect(run([[ev('UserPromptSubmit'), 1], [ev('StopFailure'), 2]])?.status).toBe('your-turn')
  })

  it('idle_prompt vira your-turn, a não ser que já tenha sido visto', () => {
    const working = run([[ev('UserPromptSubmit'), 1]])
    expect(reduceSession(working, ev('Notification', { notification_type: 'idle_prompt' }), 2)?.status).toBe('your-turn')
    const seen = markSeen(run([[ev('UserPromptSubmit'), 1], [ev('Stop'), 2]]), 3)
    expect(seen?.status).toBe('idle')
    expect(reduceSession(seen, ev('Notification', { notification_type: 'idle_prompt' }), 4)?.status).toBe('idle')
  })

  it('statusSince muda só quando o estado muda', () => {
    const a = run([[ev('UserPromptSubmit'), 10], [ev('PreToolUse', { tool_name: 'Bash' }), 20], [ev('PostToolUse'), 30]])
    expect(a).toMatchObject({ status: 'working', statusSince: 10 })
    expect(reduceSession(a, ev('Stop'), 40)).toMatchObject({ status: 'your-turn', statusSince: 40 })
  })

  it('markSeen só mexe em your-turn', () => {
    const turn = run([[ev('UserPromptSubmit'), 1], [ev('Stop'), 2]])
    expect(markSeen(turn, 5)).toMatchObject({ status: 'idle', statusSince: 5 })
    const perm = run([[ev('PermissionRequest'), 1]])
    expect(markSeen(perm, 5)).toBe(perm)
    expect(markSeen(null, 5)).toBeNull()
  })
})
```

Adicione ao fim de `tests/daemon/daemon.test.ts`, dentro do `describe('Daemon', …)`, antes do teste `'erros de requisição voltam como mensagem'`:
```ts
  it('pane.seen transforma 🔵 em ⚪', async () => {
    repo = makeRepo()
    const { o, app } = await boot()
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await hook(o, paneId, { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: repo.dir })
    await hook(o, paneId, { hook_event_name: 'Stop', session_id: 's1', cwd: repo.dir })
    await app.waitState((s) => s.panes[0]?.claude?.status === 'your-turn')
    await app.client.request({ t: 'pane.seen', paneId })
    await app.waitState((s) => s.panes[0]?.claude?.status === 'idle')
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run tests/daemon/session-v2.test.ts tests/daemon/daemon.test.ts`
Expected: FAIL (`markSeen` não existe; Stop dá `idle`).

- [ ] **Step 3: Tipos e protocolo**

`src/shared/types.ts`: troque
```ts
export type SessionStatus = 'working' | 'needs-you' | 'idle'
```
por
```ts
export type SessionStatus = 'working' | 'needs-you' | 'your-turn' | 'idle'
```
e em `ClaudeSession` acrescente depois de `status: SessionStatus`:
```ts
  /** epoch ms da última mudança de status */
  statusSince: number
```

`src/shared/protocol.ts`: em `ClientRequest`, depois da linha `| { t: 'pane.forget'; paneId: string }`, acrescente:
```ts
  | { t: 'pane.seen'; paneId: string }
```

- [ ] **Step 4: `src/daemon/session.ts` (substituir o arquivo)**

```ts
import type { ClaudeSession, HookPayload, SessionStatus } from '../shared/types'

const NEEDS_YOU_NOTIFICATIONS = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input'])

function withStatus(s: ClaudeSession, status: SessionStatus, now: number): ClaudeSession {
  return s.status === status ? s : { ...s, status, statusSince: now }
}

export function reduceSession(prev: ClaudeSession | null, p: HookPayload, now = Date.now()): ClaudeSession | null {
  const ev = p.hook_event_name
  if (ev === 'SessionEnd') return null
  const base: ClaudeSession =
    prev && prev.sessionId === p.session_id
      ? prev
      : { sessionId: p.session_id, status: 'idle', statusSince: now, title: null, transcriptPath: null }
  const next: ClaudeSession = { ...base, transcriptPath: p.transcript_path ?? base.transcriptPath }

  switch (ev) {
    case 'SessionStart':
      return p.source === 'compact' ? next : withStatus(next, 'idle', now)
    case 'UserPromptSubmit':
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return withStatus(next, 'working', now)
    case 'PreToolUse':
      return withStatus(next, p.tool_name === 'AskUserQuestion' ? 'needs-you' : 'working', now)
    case 'PermissionRequest':
      return withStatus(next, 'needs-you', now)
    case 'Notification':
      // Esc/Ctrl+C não dispara Stop; o idle_prompt (~60s parado) avisa que é a vez do usuário
      if (p.notification_type === 'idle_prompt') return next.status === 'idle' ? next : withStatus(next, 'your-turn', now)
      return NEEDS_YOU_NOTIFICATIONS.has(p.notification_type ?? '') ? withStatus(next, 'needs-you', now) : next
    case 'Stop':
    case 'StopFailure':
      return withStatus(next, 'your-turn', now)
    default:
      return next
  }
}

/** o usuário focou o painel: 🔵 vira ⚪; os outros estados não mudam */
export function markSeen(s: ClaudeSession | null, now = Date.now()): ClaudeSession | null {
  if (!s || s.status !== 'your-turn') return s
  return { ...s, status: 'idle', statusSince: now }
}
```

- [ ] **Step 5: `PaneManager.markSeen` e o handler**

Em `src/daemon/panes.ts`, troque a importação `import { reduceSession } from './session'` por:
```ts
import { markSeen, reduceSession } from './session'
```
e adicione o método logo depois de `forget(id: string): void { … }`:
```ts
  markSeen(id: string): void {
    const r = this.recs.get(id)
    if (!r) return
    const next = markSeen(r.claude)
    if (next === r.claude) return
    r.claude = next
    this.d.onChange()
  }
```

Em `src/daemon/daemon.ts`, no `switch (req.t)` do `handle`, depois do caso `'pane.forget'`, acrescente:
```ts
      case 'pane.seen':
        this.panes.markSeen(req.paneId)
        return null
```

- [ ] **Step 6: Ajustar os testes existentes ao novo tipo e ao novo estado**

- `tests/daemon/session.test.ts`: no teste `'ciclo normal de um turno'`, troque a última expectativa `toBe('idle')` por `toBe('your-turn')`. No teste `'evento sem SessionStart cria a sessão'`, troque o objeto esperado por `{ sessionId: 's1', status: 'working', statusSince: expect.any(Number), title: null, transcriptPath: '/t.jsonl' }`.
- `tests/daemon/daemon.test.ts`: no teste `'hooks: sessão, estado, …'`, troque `await app.waitState((s) => s.panes[0]?.claude?.status === 'idle')` (logo depois do hook `Stop`) por `… === 'your-turn')`.
- `tests/daemon/review-fixes.test.ts`: no teste `'idle_prompt volta para ocioso'`, troque `toBe('idle')` por `toBe('your-turn')` e renomeie para `'idle_prompt depois de Esc vira sua vez'`.
- `tests/renderer/header.test.ts`, `tests/renderer/sidebar-model.test.ts`, `tests/renderer/ui-logic.test.ts`: onde há objetos `ClaudeSession` literais (`{ sessionId: 's', status: …, title: null, transcriptPath: null }`), acrescente `statusSince: 0`.

- [ ] **Step 7: Rodar e ver passar**

Run: `rtk proxy npx vitest run && rtk proxy npm run typecheck`
Expected: tudo verde.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: estado 🔵 sua vez, statusSince e pane.seen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Lógica pura de atenção (abas, fila do ⌘J, Dock, notificações)

**Files:**
- Create: `src/renderer/src/attention.ts`
- Modify: `src/renderer/src/sidebar-model.ts` (resumo e pior estado com 🔵)
- Modify: `tests/renderer/sidebar-model.test.ts`, `tests/renderer/ui-logic.test.ts` (resumo novo)
- Test: `tests/renderer/attention.test.ts`

**Interfaces:**
- Consumes: `PaneView`, `Layout` (Task 1 atualizou `ClaudeSession`); `leaves` (layout.ts).
- Produces:
  - `type Attn = 'needs-you' | 'your-turn'`
  - `attentionOf(p: PaneView): Attn | null`
  - `tabAttention(layout: Layout, panes: PaneView[]): Record<string, Attn>` — só abas **não ativas**
  - `attentionQueue(panes: PaneView[]): string[]`
  - `nextInQueue(queue: string[], currentId: string | null): string | null`
  - `dockBadge(panes: PaneView[]): string`
  - `interface Notice { paneId: string; kind: Attn }`
  - `noticesFor(prev: PaneView[] | null, next: PaneView[], ctx: { windowFocused: boolean; visible: Set<string> }): Notice[]`
  - `sidebar-model`: `ProjectItem.summary` ganha `yourTurn: number`; `worst` passa a ordenar `needs-you > your-turn > working > idle`

- [ ] **Step 1: Teste que falha — `tests/renderer/attention.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { attentionQueue, dockBadge, nextInQueue, noticesFor, tabAttention } from '../../src/renderer/src/attention'
import type { Layout, PaneView, SessionStatus } from '../../src/shared/types'

const pane = (id: string, status: SessionStatus | null, since = 0, alive = true): PaneView => ({
  id, seq: 1, cwd: '/p', alive, exitCode: null, accountId: null, projectPath: null, worktreePath: null,
  claude: status ? { sessionId: id, status, statusSince: since, title: null, transcriptPath: null } : null,
})
const layout: Layout = {
  tabs: [
    { id: 't1', name: 'A', root: { type: 'leaf', paneId: 'a' } },
    { id: 't2', name: 'B', root: { type: 'split', dir: 'row', sizes: [], children: [{ type: 'leaf', paneId: 'b' }, { type: 'leaf', paneId: 'c' }] } },
    { id: 't3', name: 'C', root: { type: 'leaf', paneId: 'd' } },
  ],
  activeTabId: 't1',
}

describe('bolinha da aba', () => {
  it('só abas não ativas; 🟡 vence 🔵', () => {
    const panes = [pane('a', 'needs-you'), pane('b', 'your-turn'), pane('c', 'needs-you'), pane('d', 'your-turn')]
    expect(tabAttention(layout, panes)).toEqual({ t2: 'needs-you', t3: 'your-turn' })
  })
  it('trabalhando/ocioso não acende', () => {
    expect(tabAttention(layout, [pane('b', 'working'), pane('d', 'idle')])).toEqual({})
  })
})

describe('fila do ⌘J', () => {
  const panes = [pane('a', 'your-turn', 5), pane('b', 'needs-you', 9), pane('c', 'needs-you', 3), pane('d', 'your-turn', 1), pane('e', 'working', 0), pane('f', 'needs-you', 0, false)]
  it('🟡 antes de 🔵, mais antiga primeiro, ignora mortos', () => {
    expect(attentionQueue(panes)).toEqual(['c', 'b', 'd', 'a'])
  })
  it('próxima a partir da atual, com volta ao início', () => {
    const q = ['c', 'b', 'd', 'a']
    expect(nextInQueue(q, null)).toBe('c')
    expect(nextInQueue(q, 'b')).toBe('d')
    expect(nextInQueue(q, 'a')).toBe('c')
    expect(nextInQueue(q, 'zzz')).toBe('c')
    expect(nextInQueue([], 'a')).toBeNull()
  })
})

describe('Dock', () => {
  it('conta 🟡 e 🔵 vivos; vazio quando zero', () => {
    expect(dockBadge([pane('a', 'needs-you'), pane('b', 'your-turn'), pane('c', 'working'), pane('d', 'needs-you', 0, false)])).toBe('2')
    expect(dockBadge([pane('a', 'idle')])).toBe('')
  })
})

describe('notificações', () => {
  const ctx = (windowFocused: boolean, visible: string[]) => ({ windowFocused, visible: new Set(visible) })
  it('só na transição para 🟡/🔵', () => {
    expect(noticesFor([pane('a', 'working')], [pane('a', 'your-turn')], ctx(false, []))).toEqual([{ paneId: 'a', kind: 'your-turn' }])
    expect(noticesFor([pane('a', 'your-turn')], [pane('a', 'your-turn')], ctx(false, []))).toEqual([])
    expect(noticesFor([pane('a', 'your-turn')], [pane('a', 'needs-you')], ctx(false, []))).toEqual([{ paneId: 'a', kind: 'needs-you' }])
  })
  it('não notifica se a janela está focada e o painel visível', () => {
    expect(noticesFor([pane('a', 'working')], [pane('a', 'needs-you')], ctx(true, ['a']))).toEqual([])
    expect(noticesFor([pane('a', 'working')], [pane('a', 'needs-you')], ctx(true, ['b']))).toEqual([{ paneId: 'a', kind: 'needs-you' }])
    expect(noticesFor([pane('a', 'working')], [pane('a', 'needs-you')], ctx(false, ['a']))).toEqual([{ paneId: 'a', kind: 'needs-you' }])
  })
  it('primeiro estado depois de conectar e painel novo não notificam', () => {
    expect(noticesFor(null, [pane('a', 'needs-you')], ctx(false, []))).toEqual([])
    expect(noticesFor([], [pane('a', 'needs-you')], ctx(false, []))).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run tests/renderer/attention.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: `src/renderer/src/attention.ts`**

```ts
import type { Layout, PaneView } from '../../shared/types'
import { leaves } from './layout'

export type Attn = 'needs-you' | 'your-turn'

export function attentionOf(p: PaneView): Attn | null {
  if (!p.alive) return null
  const s = p.claude?.status
  return s === 'needs-you' || s === 'your-turn' ? s : null
}

const rank = (a: Attn) => (a === 'needs-you' ? 0 : 1)

/** abas não ativas com algum painel esperando o usuário; 🟡 vence 🔵 */
export function tabAttention(layout: Layout, panes: PaneView[]): Record<string, Attn> {
  const byId = new Map(panes.map((p) => [p.id, p]))
  const out: Record<string, Attn> = {}
  for (const t of layout.tabs) {
    if (t.id === layout.activeTabId) continue
    for (const id of leaves(t.root)) {
      const p = byId.get(id)
      const a = p ? attentionOf(p) : null
      if (a && (!out[t.id] || rank(a) < rank(out[t.id]))) out[t.id] = a
    }
  }
  return out
}

/** ⌘J: 🟡 antes de 🔵, mais antiga primeiro */
export function attentionQueue(panes: PaneView[]): string[] {
  return panes
    .filter((p) => attentionOf(p))
    .sort((x, y) => rank(attentionOf(x)!) - rank(attentionOf(y)!) || x.claude!.statusSince - y.claude!.statusSince)
    .map((p) => p.id)
}

export function nextInQueue(queue: string[], currentId: string | null): string | null {
  if (queue.length === 0) return null
  const i = currentId ? queue.indexOf(currentId) : -1
  return i < 0 ? queue[0] : queue[(i + 1) % queue.length]
}

export function dockBadge(panes: PaneView[]): string {
  const n = panes.filter((p) => attentionOf(p)).length
  return n > 0 ? String(n) : ''
}

export interface Notice {
  paneId: string
  kind: Attn
}

/** transições para 🟡/🔵 que o usuário não está vendo; prev null = primeiro estado depois de conectar */
export function noticesFor(prev: PaneView[] | null, next: PaneView[], ctx: { windowFocused: boolean; visible: Set<string> }): Notice[] {
  if (!prev) return []
  const before = new Map(prev.map((p) => [p.id, attentionOf(p)]))
  const out: Notice[] = []
  for (const p of next) {
    if (!before.has(p.id)) continue
    const now = attentionOf(p)
    if (!now || now === before.get(p.id)) continue
    if (ctx.windowFocused && ctx.visible.has(p.id)) continue
    out.push({ paneId: p.id, kind: now })
  }
  return out
}
```

- [ ] **Step 4: Resumo e pior estado com 🔵 — `src/renderer/src/sidebar-model.ts`**

Troque na interface `ProjectItem`:
```ts
  summary: { working: number; needsYou: number; idle: number }
```
por
```ts
  summary: { working: number; needsYou: number; yourTurn: number; idle: number }
```
e, dentro de `buildSidebar`, troque as duas linhas de `summary`/`worst` por:
```ts
      summary: { working: count('working'), needsYou: count('needs-you'), yourTurn: count('your-turn'), idle: count('idle') },
      worst: count('needs-you') ? 'needs-you' : count('your-turn') ? 'your-turn' : count('working') ? 'working' : count('idle') ? 'idle' : null,
```

Atualize `tests/renderer/sidebar-model.test.ts`: `expect(m.projects[0].summary).toEqual({ working: 1, needsYou: 1, yourTurn: 0, idle: 0 })`.

- [ ] **Step 5: Rodar e ver passar**

Run: `rtk proxy npx vitest run && rtk proxy npm run typecheck`
Expected: verde (o `Summary` da sidebar ainda não mostra 🔵; isso entra na Task 3).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: lógica de atenção (abas, fila do ⌘J, Dock, notificações)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Atenção na interface (🔵, abas, Dock, notificações, ⌘J, faixa de hooks)

**Files:**
- Modify: `src/shared/bridge.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/menu.ts`
- Modify: `src/renderer/src/main.tsx`, `src/renderer/src/actions.ts`, `src/renderer/src/terminals.ts`
- Modify: `src/renderer/src/components/PaneHeader.tsx`, `PaneFrame.tsx`, `Workspace.tsx`, `Sidebar.tsx`, `StatusBar.tsx`, `App.tsx`, `src/renderer/src/styles.css`
- Create: `src/renderer/src/components/HooksBanner.tsx`
- Test: verificação por CDP (Step 9) — a lógica foi testada na Task 2.

**Interfaces:**
- Consumes: `attention.ts` (Task 2), `pane.seen` (Task 1).
- Produces:
  - `GtApi.notify(o: { paneId: string; title: string; body: string }): void`, `GtApi.setBadge(text: string): void`, `GtApi.onReveal(cb: (paneId: string) => void): () => void`
  - ação de menu `next-attention` (⌘J)
  - `markSeenIfLooking(paneId: string | null): void` em `actions.ts`

- [ ] **Step 1: Ponte (bridge + preload + main)**

`src/shared/bridge.ts`, dentro de `GtApi`, antes de `pathForFile`:
```ts
  notify(o: { paneId: string; title: string; body: string }): void
  setBadge(text: string): void
  onReveal(cb: (paneId: string) => void): () => void
```

`src/preload/index.ts`, dentro de `api`, antes de `pathForFile`:
```ts
  notify: (o) => ipcRenderer.send('gt:notify', o),
  setBadge: (text: string) => ipcRenderer.send('gt:setBadge', text),
  onReveal: (cb) => {
    const l = (_e: unknown, id: string) => cb(id)
    ipcRenderer.on('gt:reveal', l)
    return () => ipcRenderer.removeListener('gt:reveal', l)
  },
```

`src/main/index.ts`: troque a importação do electron por
```ts
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from 'electron'
```
e acrescente os handlers junto dos outros `ipcMain`:
```ts
ipcMain.on('gt:notify', (_e, o: { paneId: string; title: string; body: string }) => {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: o.title, body: o.body, silent: false })
  n.on('click', () => {
    if (!win) createWindow()
    win?.show()
    win?.focus()
    win?.webContents.send('gt:reveal', o.paneId)
  })
  n.show()
})
ipcMain.on('gt:setBadge', (_e, text: string) => {
  app.dock?.setBadge(text)
})
```

`src/main/menu.ts`, no submenu `'Sessão'`, depois de `item('Esconder painel', 'CmdOrCtrl+W', 'hide-pane'),`:
```ts
        item('Próxima que precisa de mim', 'CmdOrCtrl+J', 'next-attention'),
```

- [ ] **Step 2: Ações — `src/renderer/src/actions.ts`**

Acrescente ao topo:
```ts
import { attentionQueue, nextInQueue } from './attention'
```
e as funções (antes de `runMenuAction`):
```ts
/** o usuário está olhando para o painel: janela focada e painel em foco → 🔵 vira ⚪ no daemon */
export function markSeenIfLooking(paneId: string | null): void {
  if (!paneId || !document.hasFocus()) return
  const p = getUi().app?.panes.find((x) => x.id === paneId)
  if (p?.claude?.status === 'your-turn') window.gt.send({ t: 'pane.seen', paneId })
}

export function revealNextAttention(): void {
  const ui = getUi()
  const next = nextInQueue(attentionQueue(ui.app?.panes ?? []), ui.focusedPaneId)
  if (next) revealPane(next)
}
```
Em `focusPane`, depois de `setUi({ focusedPaneId: paneId })`, acrescente `markSeenIfLooking(paneId)`.
Em `runMenuAction`, antes do ramo `else if (action === 'new-tab')`, acrescente:
```ts
  else if (action === 'next-attention') revealNextAttention()
```

`src/renderer/src/terminals.ts`: no listener de foco do textarea, troque
```ts
    term.textarea?.addEventListener('focus', () => setUi({ focusedPaneId: paneId }))
```
por
```ts
    term.textarea?.addEventListener('focus', () => {
      setUi({ focusedPaneId: paneId })
      void import('./actions').then((a) => a.markSeenIfLooking(paneId))
    })
```
(import dinâmico para não criar ciclo `actions` ↔ `terminals`).

- [ ] **Step 3: Notificações, Dock e "visto" — `src/renderer/src/main.tsx`**

Troque o caso `'state'` do `onEvent` por:
```ts
    case 'state': {
      const prev = getUi().app
      setUi((s) => ({ app: s.app ? { ...e.state, layout: s.app.layout } : e.state, connected: true }))
      onStateArrived(prev?.panes ?? null)
      break
    }
```
e acrescente, antes de `window.gt.onEvent(…)`:
```ts
let seenFirstState = false

function visiblePaneIds(): Set<string> {
  const app = getUi().app
  const tab = app?.layout.tabs.find((t) => t.id === app.layout.activeTabId)
  return new Set(leaves(tab?.root ?? null))
}

function onStateArrived(prevPanes: PaneView[] | null): void {
  const app = getUi().app
  if (!app) return
  window.gt.setBadge(dockBadge(app.panes))
  const notices = noticesFor(seenFirstState ? prevPanes : null, app.panes, { windowFocused: document.hasFocus(), visible: visiblePaneIds() })
  seenFirstState = true
  for (const n of notices) {
    const p = app.panes.find((x) => x.id === n.paneId)
    if (!p) continue
    const h = headerView(p, app)
    const who = p.name ?? p.claude?.title ?? `sessão ${p.seq}`
    window.gt.notify({
      paneId: p.id,
      title: `${h.project.toUpperCase()} · ⎇ ${h.worktree}`,
      body: `${who} — ${n.kind === 'needs-you' ? 'pedindo permissão' : 'terminou, sua vez'}`,
    })
  }
  // olhando para o painel quando ele virou 🔵: já conta como visto
  markSeenIfLooking(getUi().focusedPaneId)
}

window.addEventListener('focus', () => markSeenIfLooking(getUi().focusedPaneId))
window.gt.onReveal((paneId) => revealPane(paneId))
```
com as importações:
```ts
import type { AppState, PaneView } from '../../shared/types'
import { markSeenIfLooking, revealPane, runMenuAction } from './actions'
import { dockBadge, noticesFor } from './attention'
import { headerView } from './header'
import { leaves } from './layout'
import { getUi, setUi, showError } from './store'
```
Observação: `p.name` só existe a partir da Task 7. Até lá, use `p.claude?.title ?? \`sessão ${p.seq}\``; na Task 7 volte a incluir `p.name ??` na frente.

- [ ] **Step 4: 🔵 nos pontos, no contorno e no resumo**

`src/renderer/src/components/PaneHeader.tsx`: troque
```ts
export const STATUS_DOT = { working: '🟢', 'needs-you': '🟡', idle: '⚪', shell: '' } as const
```
por
```ts
export const STATUS_DOT = { working: '🟢', 'needs-you': '🟡', 'your-turn': '🔵', idle: '⚪', shell: '' } as const
```

`src/renderer/src/components/PaneFrame.tsx`: troque
```ts
  const needsYou = pane?.claude?.status === 'needs-you'
  const cls = ['pane', focused && 'focused', needsYou && 'needs-you', flashing && 'flash-outline'].filter(Boolean).join(' ')
```
por
```ts
  const status = pane?.claude?.status
  const cls = ['pane', focused && 'focused', status === 'needs-you' && 'needs-you', status === 'your-turn' && 'your-turn', flashing && 'flash-outline']
    .filter(Boolean)
    .join(' ')
```
e no `onMouseDown` troque `setUi({ focusedPaneId: paneId })` por `focusPane(paneId)` (importe `focusPane` de `../actions`).

`src/renderer/src/components/Sidebar.tsx`, componente `Summary`, acrescente depois da linha do 🟡:
```tsx
      {s.yourTurn > 0 && <span>🔵{s.yourTurn}</span>}
```

`src/renderer/src/styles.css`, acrescente:
```css
.pane.your-turn { outline: 2px solid #3b82f6; outline-offset: -2px; }
.tab-dot { width: 8px; height: 8px; border-radius: 50%; }
.tab-dot.needs-you { background: var(--amber); box-shadow: 0 0 6px var(--amber); }
.tab-dot.your-turn { background: #3b82f6; box-shadow: 0 0 6px #3b82f6; }
```

- [ ] **Step 5: Bolinha na aba — `src/renderer/src/components/Workspace.tsx`**

No `TabBar`, leia os painéis e calcule a atenção:
```tsx
function TabBar({ layout }: { layout: Layout }) {
  const panes = useUi((s) => s.app?.panes)
  const attn = useMemo(() => tabAttention(layout, panes ?? []), [layout, panes])
```
(importe `useMemo` de `react` e `tabAttention` de `../attention`), e depois do `<span>{t.name}</span>` / input:
```tsx
          {attn[t.id] && <span className={`tab-dot ${attn[t.id]}`} title={attn[t.id] === 'needs-you' ? 'precisa de você' : 'sua vez'} />}
```

- [ ] **Step 6: Faixa de hooks — `src/renderer/src/components/HooksBanner.tsx`**

```tsx
import { useState } from 'react'
import { errorMessage } from '../api'
import { useUi } from '../store'

/** enquanto faltar hook, não dá para fechar; depois de instalar, confirma e some */
export function HooksBanner() {
  const warnings = useUi((s) => s.app?.hookWarnings)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const install = async () => {
    try {
      await window.gt.request({ t: 'hooks.install' })
      setResult({ ok: true, text: 'Hooks instalados ✓ — reinicie as sessões do Claude abertas (/exit e claude-… --continue).' })
      setTimeout(() => setResult(null), 12_000)
    } catch (e) {
      setResult({ ok: false, text: `Não consegui instalar: ${errorMessage(e)}` })
    }
  }

  if (result?.ok) return <div className="hooks-banner ok">{result.text}</div>
  if (!warnings || warnings.length === 0) return null
  return (
    <div className="hooks-banner">
      <strong>Os hooks do Claude não estão instalados.</strong> Sem eles o app não mostra 🟢🟡🔵 nem percebe a troca de worktree.
      <span className="sb-dim"> ({warnings.join(', ')})</span>
      <button className="primary" onClick={() => void install()}>
        Instalar hooks
      </button>
      {result && !result.ok && <span className="hooks-error">{result.text}</span>}
    </div>
  )
}
```
CSS:
```css
.hooks-banner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 12px; background: #4b3d10; color: #ffe08a; border-bottom: 1px solid #6b5616; }
.hooks-banner.ok { background: #1e3a24; color: #b5f0c0; }
.hooks-error { color: var(--error); }
```
`App.tsx`: dentro de `<main className="main">`, antes de `<Workspace …/>`, acrescente `<HooksBanner />` (importe).
`StatusBar.tsx`: remova o bloco `{labels.length > 0 && !dismissed.hooks && (…)}`, e as variáveis `noHooks`/`labels` e o import de `accountsWithoutHooks`, que deixam de ser usados.

- [ ] **Step 7: Typecheck, testes e build**

Run: `rtk proxy npm run typecheck && rtk proxy npx vitest run && rtk proxy npm run build`
Expected: verde.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: 🔵 na interface, bolinha nas abas, Dock, notificações, ⌘J e faixa de hooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Verificação por CDP**

Suba uma instância isolada (`GT_HOME=/tmp/gtr ./node_modules/.bin/electron . --remote-debugging-port=9333`), crie 2 abas com um painel cada, marque o painel da aba 2 como 🔵 enviando hooks `UserPromptSubmit` → `Stop` pelo `gt-hook` (como no seed da fase 1) e confira no DOM:
- a aba 2 tem `.tab-dot.your-turn`;
- a faixa `.hooks-banner` aparece (GT_HOME isolado não tem hooks);
- clicar no painel da aba 2 (depois de trocar de aba) leva o estado a `idle` via `state.get`.
Encerre a instância e o daemon dela.

---

### Task 4: Núcleo da análise de conflitos (retratos + merge-tree)

**Files:**
- Modify: `src/daemon/git/run.ts` (código de saída + env extra)
- Modify: `src/shared/types.ts` (`ConflictReport`)
- Create: `src/daemon/conflicts.ts`
- Test: `tests/daemon/conflicts.test.ts`

**Interfaces:**
- Produces:
  - `GitResult.code: number | null`; `git(cwd, args, timeoutMs?, extraEnv?: Record<string, string>)`
  - `interface ConflictReport { analyzedAt: number; running: boolean; comparisons: number; vsMain: { worktreePath: string; files: string[]; dirty: boolean }[]; pairs: { a: string; b: string; files: string[]; dirty: boolean }[]; cleanPairs: number; errors: { worktreePath: string; message: string }[] }`
  - `interface Tip { worktreePath: string; tip: string; dirty: boolean }`
  - `snapshotTip(worktreePath: string): Promise<Tip>`
  - `parseMergeTree(code: number | null, stdout: string): { conflict: boolean; files: string[] } | { error: true }`
  - `analyzeConflicts(mainPath: string, worktrees: WorktreeInfo[], concurrency?: number): Promise<Omit<ConflictReport, 'running'>>`

- [ ] **Step 1: Teste que falha — `tests/daemon/conflicts.test.ts`**

```ts
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { analyzeConflicts, parseMergeTree, snapshotTip } from '../../src/daemon/conflicts'
import { listWorktrees } from '../../src/daemon/resolve'
import { makeRepo, type TestRepo } from '../helpers/repo'

let repo: TestRepo | null = null
afterEach(() => { repo?.cleanup(); repo = null })

function setup() {
  repo = makeRepo()
  repo.write('f.txt', 'linha 1\nlinha 2\nlinha 3\n')
  repo.git('add', '.')
  repo.git('commit', '-m', 'base')
  const wt = (name: string) => {
    const p = path.join(repo!.root, `wt ${name}`)
    repo!.git('worktree', 'add', '-b', name, p)
    return p
  }
  const g = (p: string, ...args: string[]) => repo!.git('-C', p, ...args)
  const a = wt('a'), b = wt('b'), c = wt('c'), d = wt('d'), e = wt('e')
  fs.writeFileSync(path.join(a, 'f.txt'), 'linha 1\nA mudou\nlinha 3\n'); g(a, 'commit', '-qam', 'a')
  fs.writeFileSync(path.join(b, 'f.txt'), 'linha 1\nB mudou\nlinha 3\n'); g(b, 'commit', '-qam', 'b')
  // c fica igual à main
  fs.writeFileSync(path.join(d, 'novo.txt'), 'da d\n') // só local, não commitado
  fs.writeFileSync(path.join(e, 'novo.txt'), 'da e\n'); g(e, 'add', '.'); g(e, 'commit', '-qm', 'e')
  return { a, b, c, d, e, g }
}

describe('parseMergeTree', () => {
  it('limpo, conflito e erro', () => {
    expect(parseMergeTree(0, 'abc123\n')).toEqual({ conflict: false, files: [] })
    expect(parseMergeTree(1, 'abc123\nsrc/a.ts\nsrc/a.ts\npackage.json\n')).toEqual({ conflict: true, files: ['src/a.ts', 'package.json'] })
    expect(parseMergeTree(128, '')).toEqual({ error: true })
  })
})

describe('snapshotTip', () => {
  it('limpa usa o HEAD; com alterações cria commit solto sem mexer no índice, stash ou refs', async () => {
    const { c, d, g } = setup()
    expect(await snapshotTip(c)).toMatchObject({ dirty: false, tip: g(c, 'rev-parse', 'HEAD').trim() })

    fs.writeFileSync(path.join(d, 'staged.txt'), 's\n')
    g(d, 'add', 'staged.txt') // o usuário tinha algo no índice
    const before = { status: g(d, 'status', '--porcelain'), cached: g(d, 'diff', '--cached', '--name-only'), refs: g(d, 'for-each-ref'), stash: g(d, 'stash', 'list') }
    const tip = await snapshotTip(d)
    expect(tip.dirty).toBe(true)
    expect(g(d, 'cat-file', '-t', tip.tip).trim()).toBe('commit')
    expect(g(d, 'ls-tree', '-r', '--name-only', tip.tip)).toContain('novo.txt')
    expect({ status: g(d, 'status', '--porcelain'), cached: g(d, 'diff', '--cached', '--name-only'), refs: g(d, 'for-each-ref'), stash: g(d, 'stash', 'list') }).toEqual(before)
  })
})

describe('analyzeConflicts', () => {
  it('acha conflito entre worktrees que não conflitam com a main, inclusive por alteração local, e pula as iguais à main', async () => {
    const { a, b, c, d, e } = setup()
    const r = await listWorktrees(repo!.dir)
    if (!r.ok) throw new Error(r.error)
    const rep = await analyzeConflicts(repo!.dir, r.worktrees)
    expect(rep.errors).toEqual([])
    expect(rep.vsMain.every((v) => v.files.length === 0)).toBe(true)
    expect(rep.vsMain.map((v) => v.worktreePath).sort()).toEqual([a, b, c, d, e].sort())
    const pairs = rep.pairs.map((p) => [[p.a, p.b].sort().join(' | '), p.files, p.dirty])
    expect(pairs).toContainEqual([[a, b].sort().join(' | '), ['f.txt'], false])
    expect(pairs).toContainEqual([[d, e].sort().join(' | '), ['novo.txt'], true])
    expect(rep.pairs).toHaveLength(2)
    // 4 contra a main (c é igual) + 6 pares entre a, b, d, e
    expect(rep.comparisons).toBe(10)
    expect(rep.cleanPairs).toBe(4)
  })

  it('worktree com pasta apagada é ignorada; erro de uma não derruba a análise', async () => {
    const { a } = setup()
    fs.rmSync(a, { recursive: true, force: true })
    const r = await listWorktrees(repo!.dir)
    if (!r.ok) throw new Error(r.error)
    const rep = await analyzeConflicts(repo!.dir, r.worktrees)
    expect(rep.vsMain.map((v) => v.worktreePath)).not.toContain(a)
    expect(rep.pairs.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run tests/daemon/conflicts.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: `src/daemon/git/run.ts` (substituir)**

```ts
import { execFile } from 'node:child_process'

export interface GitResult {
  ok: boolean
  /** código de saída; null se o processo não terminou normalmente (timeout, sinal) */
  code: number | null
  stdout: string
  stderr: string
}

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  // status em segundo plano não pode segurar o index.lock enquanto o Claude usa git
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C',
}

export function git(cwd: string, args: string[], timeoutMs = 5000, extraEnv: Record<string, string> = {}): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...GIT_ENV, ...extraEnv } },
      (err, stdout, stderr) => {
        const errText = String(stderr) || (err ? err.message : '')
        const code = !err ? 0 : typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : null
        resolve({ ok: !err, code, stdout: String(stdout), stderr: errText })
      },
    )
  })
}
```

- [ ] **Step 4: `ConflictReport` em `src/shared/types.ts`**

Acrescente ao fim do arquivo:
```ts
export interface ConflictReport {
  analyzedAt: number
  running: boolean
  /** quantos merge-tree foram executados */
  comparisons: number
  /** toda worktree não principal analisada; files vazio = sem conflito com a main */
  vsMain: { worktreePath: string; files: string[]; dirty: boolean }[]
  /** só os pares em conflito */
  pairs: { a: string; b: string; files: string[]; dirty: boolean }[]
  cleanPairs: number
  errors: { worktreePath: string; message: string }[]
}
```

- [ ] **Step 5: `src/daemon/conflicts.ts`**

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ConflictReport, WorktreeInfo } from '../shared/types'
import { git } from './git/run'

const WIP_ENV = {
  GIT_AUTHOR_NAME: 'gerenciador-terminal',
  GIT_AUTHOR_EMAIL: 'gt@localhost',
  GIT_COMMITTER_NAME: 'gerenciador-terminal',
  GIT_COMMITTER_EMAIL: 'gt@localhost',
}
const TIMEOUT = 30_000
let counter = 0

export interface Tip {
  worktreePath: string
  tip: string
  dirty: boolean
}

const firstLine = (s: string) => s.trim().split('\n')[0] ?? ''

/**
 * Retrato da worktree: HEAD se limpa; senão um commit solto com tudo (inclui arquivos novos, respeita .gitignore),
 * montado num índice temporário — o índice real, o stash e as refs não são tocados.
 */
export async function snapshotTip(worktreePath: string): Promise<Tip> {
  const head = await git(worktreePath, ['rev-parse', 'HEAD'])
  if (!head.ok) throw new Error(firstLine(head.stderr) || 'git rev-parse falhou')
  const headSha = head.stdout.trim()
  const st = await git(worktreePath, ['status', '--porcelain'])
  if (!st.ok) throw new Error(firstLine(st.stderr) || 'git status falhou')
  if (!st.stdout.trim()) return { worktreePath, tip: headSha, dirty: false }

  const idx = path.join(os.tmpdir(), `gt-idx-${process.pid}-${++counter}`)
  const env = { ...WIP_ENV, GIT_INDEX_FILE: idx }
  try {
    for (const args of [['read-tree', 'HEAD'], ['add', '-A']]) {
      const r = await git(worktreePath, args, TIMEOUT, env)
      if (!r.ok) throw new Error(`git ${args[0]}: ${firstLine(r.stderr)}`)
    }
    const tree = await git(worktreePath, ['write-tree'], TIMEOUT, env)
    if (!tree.ok) throw new Error(`git write-tree: ${firstLine(tree.stderr)}`)
    const commit = await git(worktreePath, ['commit-tree', tree.stdout.trim(), '-p', headSha, '-m', 'gerenciador-terminal: alterações locais'], TIMEOUT, env)
    if (!commit.ok) throw new Error(`git commit-tree: ${firstLine(commit.stderr)}`)
    return { worktreePath, tip: commit.stdout.trim(), dirty: true }
  } finally {
    fs.rmSync(idx, { force: true })
    fs.rmSync(`${idx}.lock`, { force: true })
  }
}

/** saída de `git merge-tree --write-tree --name-only --no-messages`: 1ª linha = tree; demais = arquivos em conflito */
export function parseMergeTree(code: number | null, stdout: string): { conflict: boolean; files: string[] } | { error: true } {
  if (code === 0) return { conflict: false, files: [] }
  if (code !== 1) return { error: true }
  const files = [...new Set(stdout.split('\n').slice(1).map((l) => l.trim()).filter(Boolean))]
  return { conflict: true, files }
}

async function mergeTree(cwd: string, a: string, b: string): Promise<string[]> {
  const r = await git(cwd, ['merge-tree', '--write-tree', '--name-only', '--no-messages', a, b], TIMEOUT)
  const p = parseMergeTree(r.code, r.stdout)
  if ('error' in p) throw new Error(firstLine(r.stderr) || `git merge-tree saiu com ${r.code}`)
  return p.files
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  })
  await Promise.all(workers)
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function analyzeConflicts(mainPath: string, worktrees: WorktreeInfo[], concurrency = 4): Promise<Omit<ConflictReport, 'running'>> {
  const live = worktrees.filter((w) => !w.prunable)
  const errors: ConflictReport['errors'] = []
  const tips = new Map<string, Tip>()
  await pool(live, concurrency, async (w) => {
    try {
      tips.set(w.path, await snapshotTip(w.path))
    } catch (e) {
      errors.push({ worktreePath: w.path, message: message(e) })
    }
  })

  const main = live.find((w) => w.isMain)
  const base = main ? tips.get(main.path) : undefined
  if (!base) {
    return { analyzedAt: Date.now(), comparisons: 0, vsMain: [], pairs: [], cleanPairs: 0, errors: errors.length ? errors : [{ worktreePath: mainPath, message: 'worktree principal não analisada' }] }
  }

  const others = live.filter((w) => !w.isMain && tips.has(w.path)).map((w) => tips.get(w.path)!)
  const vsMain = others.map((t) => ({ worktreePath: t.worktreePath, files: [] as string[], dirty: t.dirty || base.dirty }))
  // igual à main não conflita com nada que a própria main não conflitaria: fica fora dos pares
  const changed = others.filter((t) => t.tip !== base.tip)
  type Job = { kind: 'main'; t: Tip } | { kind: 'pair'; x: Tip; y: Tip }
  const jobs: Job[] = changed.map((t) => ({ kind: 'main', t }))
  let totalPairs = 0
  for (let i = 0; i < changed.length; i++) {
    for (let j = i + 1; j < changed.length; j++) {
      totalPairs++
      if (changed[i].tip !== changed[j].tip) jobs.push({ kind: 'pair', x: changed[i], y: changed[j] })
    }
  }

  const pairs: ConflictReport['pairs'] = []
  let comparisons = 0
  await pool(jobs, concurrency, async (job) => {
    comparisons++
    try {
      if (job.kind === 'main') {
        const files = await mergeTree(mainPath, base.tip, job.t.tip)
        vsMain.find((v) => v.worktreePath === job.t.worktreePath)!.files = files
      } else {
        const files = await mergeTree(mainPath, job.x.tip, job.y.tip)
        if (files.length) pairs.push({ a: job.x.worktreePath, b: job.y.worktreePath, files, dirty: job.x.dirty || job.y.dirty })
      }
    } catch (e) {
      const who = job.kind === 'main' ? job.t.worktreePath : `${job.x.worktreePath} ↔ ${job.y.worktreePath}`
      errors.push({ worktreePath: who, message: message(e) })
    }
  })

  return { analyzedAt: Date.now(), comparisons, vsMain, pairs, cleanPairs: totalPairs - pairs.length, errors }
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `rtk proxy npx vitest run tests/daemon/conflicts.test.ts && rtk proxy npx vitest run && rtk proxy npm run typecheck`
Expected: verde.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: análise de conflitos entre worktrees com merge-tree e retrato das alterações locais

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Conflitos no daemon (requisição, estado e reanálise automática)

**Files:**
- Modify: `src/shared/types.ts` (`ProjectView.conflicts`), `src/shared/protocol.ts`
- Modify: `src/daemon/git/monitor.ts` (`onChange(path?)`), `src/daemon/daemon.ts`
- Test: `tests/daemon/daemon.test.ts` (novo caso)

**Interfaces:**
- Consumes: `analyzeConflicts` (Task 4).
- Produces:
  - `ProjectView.conflicts: ConflictReport | null`
  - requisição `{ t: 'conflicts.analyze'; projectPath: string }`
  - `DaemonOptions.conflictsDebounceMs?: number` (padrão 5000)
  - `GitMonitor` passa a chamar `onChange(path)` quando o status de uma worktree muda

- [ ] **Step 1: Teste que falha (em `tests/daemon/daemon.test.ts`, antes de `'erros de requisição…'`)**

```ts
  it('conflitos: analisa sob demanda e reanalisa sozinho quando uma worktree muda', async () => {
    repo = makeRepo()
    repo.write('f.txt', 'x\n'); repo.git('add', '.'); repo.git('commit', '-m', 'f')
    const a = path.join(repo.root, 'wt a'), b = path.join(repo.root, 'wt b')
    repo.git('worktree', 'add', '-b', 'a', a)
    repo.git('worktree', 'add', '-b', 'b', b)
    fs.writeFileSync(path.join(a, 'f.txt'), 'A\n')
    const { app } = await boot({ gitPollMs: 300, conflictsDebounceMs: 200 })
    await app.client.request({ t: 'project.add', path: repo.dir })
    await app.client.request({ t: 'conflicts.analyze', projectPath: repo.dir })
    let st = await app.waitState((s) => !!s.projects[0]?.conflicts && !s.projects[0].conflicts.running)
    expect(st.projects[0].conflicts!.pairs).toEqual([])
    // b passa a mexer na mesma linha, sem commitar: a reanálise automática precisa pegar
    fs.writeFileSync(path.join(b, 'f.txt'), 'B\n')
    st = await app.waitState((s) => (s.projects[0]?.conflicts?.pairs.length ?? 0) === 1, 15_000)
    expect(st.projects[0].conflicts!.pairs[0]).toMatchObject({ files: ['f.txt'], dirty: true })
  })
```
e acrescente `conflictsDebounceMs: 5000,` ao objeto retornado por `opts()` desse arquivo (o teste acima sobrescreve com 200).

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run tests/daemon/daemon.test.ts -t conflitos`
Expected: FAIL (tipo/requisição inexistentes).

- [ ] **Step 3: Tipos e protocolo**

`src/shared/types.ts`, em `ProjectView`, acrescente `conflicts: ConflictReport | null`.
`src/shared/protocol.ts`, em `ClientRequest`, acrescente `| { t: 'conflicts.analyze'; projectPath: string }`.

- [ ] **Step 4: `GitMonitor` avisa qual worktree mudou**

Em `src/daemon/git/monitor.ts`, troque a assinatura do construtor para `private onChange: (path?: string) => void` e, em `refreshNow`, troque a última linha `this.onChange()` por `this.onChange(p)`.

- [ ] **Step 5: Daemon**

Em `src/daemon/daemon.ts`:
- importe `import { analyzeConflicts } from './conflicts'` e `import type { AppState, ConflictReport } from '../shared/types'`;
- em `DaemonOptions`, acrescente `conflictsDebounceMs?: number`;
- campos novos:
```ts
  private conflicts = new Map<string, ConflictReport>()
  private conflictTimers = new Map<string, NodeJS.Timeout>()
  private conflictRerun = new Set<string>()
```
- troque a criação do monitor por:
```ts
    this.monitor = new GitMonitor((p) => {
      if (p) this.onWorktreeChanged(p)
      this.changed(false)
    }, { pollMs: this.o.gitPollMs ?? 10_000, debounceMs: 300 })
```
- métodos novos:
```ts
  private onWorktreeChanged(worktreePath: string): void {
    const project = this.registry.list().find((c) => this.registry.worktrees(c.path).some((w) => w.path === worktreePath))
    if (!project || !this.conflicts.has(project.path)) return // só reanalisa o que já foi analisado
    clearTimeout(this.conflictTimers.get(project.path))
    this.conflictTimers.set(
      project.path,
      setTimeout(() => {
        this.conflictTimers.delete(project.path)
        void this.analyzeConflicts(project.path)
      }, this.o.conflictsDebounceMs ?? 5000),
    )
  }

  private async analyzeConflicts(projectPath: string): Promise<void> {
    if (!this.registry.get(projectPath)) throw new Error(`projeto não encontrado: ${projectPath}`)
    const prev = this.conflicts.get(projectPath)
    if (prev?.running) {
      this.conflictRerun.add(projectPath)
      return
    }
    this.conflicts.set(projectPath, { ...(prev ?? { analyzedAt: 0, comparisons: 0, vsMain: [], pairs: [], cleanPairs: 0, errors: [] }), running: true })
    this.changed(false)
    try {
      const report = await analyzeConflicts(projectPath, this.registry.worktrees(projectPath))
      if (this.stopping) return
      this.conflicts.set(projectPath, { ...report, running: false })
    } catch (e) {
      this.conflicts.set(projectPath, { ...(prev ?? { analyzedAt: Date.now(), comparisons: 0, vsMain: [], pairs: [], cleanPairs: 0 }), running: false, errors: [{ worktreePath: projectPath, message: e instanceof Error ? e.message : String(e) }] })
    }
    this.changed(false)
    if (this.conflictRerun.delete(projectPath)) void this.analyzeConflicts(projectPath)
  }
```
- em `buildState`, no objeto de cada projeto, acrescente `conflicts: this.conflicts.get(c.path) ?? null,`;
- em `stop()`, depois de `this.monitor.stop()`, acrescente `for (const t of this.conflictTimers.values()) clearTimeout(t)`;
- no `switch` do `handle`, acrescente:
```ts
      case 'conflicts.analyze':
        void this.analyzeConflicts(req.projectPath).catch((e) => console.error('análise de conflitos falhou', e))
        return null
```
- em `project.remove`, depois de `this.registry.remove(req.path)`, acrescente `this.conflicts.delete(req.path)`.

- [ ] **Step 6: Rodar e ver passar**

Run: `rtk proxy npx vitest run && rtk proxy npm run typecheck`
Expected: verde. (Testes do renderer que montam `ProjectView` à mão precisam de `conflicts: null` — acrescente onde o typecheck apontar.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: conflitos no daemon com reanálise automática

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Conflitos na interface (sidebar, menu e modal)

**Files:**
- Create: `src/renderer/src/conflicts-model.ts`, `src/renderer/src/components/ConflictsModal.tsx`
- Modify: `src/renderer/src/store.ts` (`Modal` ganha `conflicts`), `src/renderer/src/flows.ts`, `src/renderer/src/components/Sidebar.tsx`, `src/renderer/src/components/Modals.tsx`, `src/renderer/src/styles.css`
- Test: `tests/renderer/conflicts-model.test.ts`

**Interfaces:**
- Consumes: `ConflictReport` (Tasks 4–5).
- Produces:
  - `conflictPartners(report: ConflictReport | null, worktreePath: string, labelOf: (path: string) => string): string[]`
  - `Modal` ganha `{ kind: 'conflicts'; projectPath: string }`
  - `analyzeConflictsFlow(projectPath: string): void` em `flows.ts`

- [ ] **Step 1: Teste que falha — `tests/renderer/conflicts-model.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { conflictPartners } from '../../src/renderer/src/conflicts-model'
import type { ConflictReport } from '../../src/shared/types'

const rep: ConflictReport = {
  analyzedAt: 1, running: false, comparisons: 5, cleanPairs: 2, errors: [],
  vsMain: [{ worktreePath: '/w/a', files: [], dirty: false }, { worktreePath: '/w/c', files: ['x.ts'], dirty: false }],
  pairs: [{ a: '/w/a', b: '/w/b', files: ['f.ts'], dirty: false }, { a: '/w/c', b: '/w/a', files: ['g.ts'], dirty: true }],
}
const label = (p: string) => p.split('/').pop()!

describe('conflictPartners', () => {
  it('lista main e as outras worktrees em conflito', () => {
    expect(conflictPartners(rep, '/w/a', label)).toEqual(['b', 'c'])
    expect(conflictPartners(rep, '/w/c', label)).toEqual(['main', 'a'])
    expect(conflictPartners(rep, '/w/z', label)).toEqual([])
    expect(conflictPartners(null, '/w/a', label)).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run tests/renderer/conflicts-model.test.ts`
Expected: FAIL.

- [ ] **Step 3: `src/renderer/src/conflicts-model.ts`**

```ts
import type { ConflictReport } from '../../shared/types'

/** com quem esta worktree conflita: 'main' primeiro, depois as outras worktrees */
export function conflictPartners(report: ConflictReport | null, worktreePath: string, labelOf: (path: string) => string): string[] {
  if (!report) return []
  const out: string[] = []
  if (report.vsMain.some((v) => v.worktreePath === worktreePath && v.files.length > 0)) out.push('main')
  for (const p of report.pairs) {
    if (p.a === worktreePath) out.push(labelOf(p.b))
    else if (p.b === worktreePath) out.push(labelOf(p.a))
  }
  return out
}
```

- [ ] **Step 4: Estado, fluxo e modal**

`src/renderer/src/store.ts`, no tipo `Modal`, acrescente `| { kind: 'conflicts'; projectPath: string }`.

`src/renderer/src/flows.ts`, acrescente:
```ts
export function analyzeConflictsFlow(projectPath: string): void {
  setUi({ modal: { kind: 'conflicts', projectPath } })
  window.gt.request({ t: 'conflicts.analyze', projectPath }).catch(showError)
}
```
e, em `projectMenu`, antes do separador, acrescente o item `{ id: 'conflicts', label: 'Analisar conflitos entre worktrees…' }` com o tratamento `else if (choice === 'conflicts') analyzeConflictsFlow(p.path)`.

`src/renderer/src/components/ConflictsModal.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { worktreeLabel } from '../header'
import { setUi, showError, useUi } from '../store'

function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `há ${s} s`
  const m = Math.round(s / 60)
  return m < 60 ? `há ${m} min` : `há ${Math.round(m / 60)} h`
}

export function ConflictsModal({ projectPath }: { projectPath: string }) {
  const project = useUi((s) => s.app?.projects.find((p) => p.path === projectPath))
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])
  if (!project) return null
  const rep = project.conflicts
  const label = (p: string) => {
    const w = project.worktrees.find((x) => x.path === p)
    return w ? worktreeLabel(w) : (p.split('/').pop() ?? p)
  }
  const close = () => setUi({ modal: null })
  const rerun = () => window.gt.request({ t: 'conflicts.analyze', projectPath }).catch(showError)

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal conflicts" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <div className="conflicts-head">
          <h3>Conflitos · {project.name.toUpperCase()}</h3>
          <span className="sb-dim">{rep?.running ? 'analisando…' : rep ? `analisado ${ago(rep.analyzedAt, now)} · ${rep.comparisons} comparações` : ''}</span>
          <button onClick={() => void rerun()} disabled={rep?.running} title="Analisar de novo">
            ↻
          </button>
        </div>
        {!rep || (rep.running && rep.analyzedAt === 0) ? (
          <p className="sb-dim">Analisando as worktrees…</p>
        ) : (
          <>
            <div className="field-label">CONTRA A MAIN</div>
            <div className="conflicts-main">
              {rep.vsMain.map((v) => (
                <div key={v.worktreePath} className={v.files.length ? 'c-bad' : 'c-ok'}>
                  {v.files.length ? '⚠' : '✓'} {label(v.worktreePath)}
                  {v.files.length > 0 && <span className="c-files">: {v.files.join(', ')}</span>}
                  {v.dirty && v.files.length > 0 && <span className="c-dirty">inclui alterações não commitadas</span>}
                </div>
              ))}
            </div>
            <div className="field-label">ENTRE WORKTREES</div>
            {rep.pairs.length === 0 ? (
              <p className="ok">✓ Nenhum par em conflito</p>
            ) : (
              rep.pairs.map((p) => (
                <div key={`${p.a}|${p.b}`} className="c-pair">
                  <div className="c-bad">
                    ⚠ {label(p.a)} ↔ {label(p.b)}
                    {p.dirty && <span className="c-dirty">inclui alterações não commitadas</span>}
                  </div>
                  <div className="c-files">{p.files.join(', ')}</div>
                  <div className="sb-dim">
                    Se mergear {label(p.a)} primeiro, {label(p.b)} vai conflitar (e vice-versa).
                  </div>
                </div>
              ))
            )}
            <p className="sb-dim">Sem conflito: {rep.cleanPairs} {rep.cleanPairs === 1 ? 'par' : 'pares'}</p>
            {rep.errors.map((e) => (
              <p key={e.worktreePath} className="c-bad">
                não analisada: {label(e.worktreePath)} — {e.message}
              </p>
            ))}
          </>
        )}
        <div className="modal-actions">
          <button className="primary" autoFocus onClick={close}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
```

`src/renderer/src/components/Modals.tsx`: logo depois de `if (!modal || !app) return null`, acrescente:
```tsx
  if (modal.kind === 'conflicts') return <ConflictsModal projectPath={modal.projectPath} />
```
(importe `ConflictsModal`).

- [ ] **Step 5: Sidebar**

Em `src/renderer/src/components/Sidebar.tsx`:
- importe `conflictPartners` e `analyzeConflictsFlow`, e leia `const projectsView = app.projects` dentro de `Tree`;
- na linha do projeto, depois do nome, acrescente:
```tsx
              <button
                className="sb-mini sb-conflicts"
                title="Analisar conflitos entre worktrees"
                onClick={(e) => {
                  e.stopPropagation()
                  analyzeConflictsFlow(p.path)
                }}
              >
                ⇄
              </button>
```
- na linha da worktree, depois do nome, calcule e mostre o ⚠:
```tsx
                    {(() => {
                      const view = projectsView.find((x) => x.path === p.path)
                      const partners = conflictPartners(view?.conflicts ?? null, w.path, (path) => view?.worktrees.find((x) => x.path === path)?.path.split('/').pop() ?? path)
                      return partners.length > 0 ? (
                        <span
                          className="sb-conflict"
                          title={`conflita com: ${partners.join(', ')}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setUi({ modal: { kind: 'conflicts', projectPath: p.path } })
                          }}
                        >
                          ⚠
                        </span>
                      ) : null
                    })()}
```
(importe `setUi` de `../store`).

CSS (acrescentar em `styles.css`):
```css
.sb-conflict { color: #f97316; cursor: pointer; }
.sb-conflicts { margin-left: 4px; }
.modal.conflicts { width: 620px; }
.conflicts-head { display: flex; align-items: center; gap: 10px; }
.conflicts-head h3 { flex: 1; }
.conflicts-main { display: flex; flex-direction: column; gap: 4px; }
.c-ok { color: #89d185; }
.c-bad { color: #f97316; }
.c-files { font-family: Menlo, monospace; font-size: 11.5px; color: var(--fg); }
.c-dirty { margin-left: 8px; font-size: 10.5px; color: var(--warn); border: 1px solid var(--warn); border-radius: 3px; padding: 0 4px; }
.c-pair { display: flex; flex-direction: column; gap: 2px; padding: 6px 0; border-top: 1px solid var(--border); }
```

- [ ] **Step 6: Rodar, typecheck, build**

Run: `rtk proxy npx vitest run && rtk proxy npm run typecheck && rtk proxy npm run build`
Expected: verde.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: conflitos entre worktrees na sidebar e no modal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Verificação por CDP**

Com uma instância isolada e um repositório de teste com o cenário da Task 4, clique em ⇄ no projeto e confira no DOM: o modal lista os pares `a ↔ b` (`f.txt`) e `d ↔ e` (`novo.txt`, selo "inclui alterações não commitadas") e as worktrees `a`, `b`, `d` e `e` ganham `.sb-conflict`. Tire um screenshot para registro.

---

### Task 7: Nome/cor por sessão e preferências no daemon

**Files:**
- Create: `src/shared/settings.ts`
- Modify: `src/shared/types.ts`, `src/shared/protocol.ts`, `src/daemon/persist.ts`, `src/daemon/daemon.ts`
- Modify (literais de teste): testes que montam `PaneView`/`AppState` à mão (`tests/renderer/*.test.ts`)
- Test: `tests/shared/settings.test.ts`, `tests/daemon/daemon.test.ts` (novos casos)

**Interfaces:**
- Produces:
  - `PaneView.name: string | null`, `PaneView.color: string | null`
  - `interface TerminalSettings { theme: ThemeId; fontFamily: string; fontSize: number; lineHeight: number }`; `AppState.settings: TerminalSettings`
  - `THEME_IDS = ['vscode-dark', 'one-dark', 'dracula', 'solarized-dark', 'github-dark', 'nord'] as const`; `type ThemeId`
  - `DEFAULT_SETTINGS: TerminalSettings`; `normalizeSettings(s: Partial<TerminalSettings> | undefined): TerminalSettings`
  - `SESSION_COLORS: { id: string; label: string; hex: string }[]` (8 cores)
  - requisições `{ t: 'pane.meta'; paneId: string; name?: string | null; color?: string | null }` e `{ t: 'settings.save'; settings: TerminalSettings }`
  - `Persisted.paneMeta: Record<string, { name: string | null; color: string | null }>`, `Persisted.settings: TerminalSettings`

- [ ] **Step 1: Testes que falham**

`tests/shared/settings.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings, SESSION_COLORS, THEME_IDS } from '../../src/shared/settings'

describe('preferências', () => {
  it('padrões e limites', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ fontSize: 99, lineHeight: 0.2 })).toMatchObject({ fontSize: 24, lineHeight: 1 })
    expect(normalizeSettings({ fontSize: 3, lineHeight: 9 })).toMatchObject({ fontSize: 10, lineHeight: 1.6 })
    expect(normalizeSettings({ theme: 'inexistente' as never }).theme).toBe('vscode-dark')
    expect(normalizeSettings({ fontFamily: '   ' }).fontFamily).toBe(DEFAULT_SETTINGS.fontFamily)
  })
  it('6 temas e 8 cores com hex válido', () => {
    expect(THEME_IDS).toHaveLength(6)
    expect(SESSION_COLORS).toHaveLength(8)
    for (const c of SESSION_COLORS) expect(c.hex).toMatch(/^#[0-9a-f]{6}$/)
  })
})
```

Em `tests/daemon/daemon.test.ts`, antes de `'erros de requisição…'`:
```ts
  it('nome e cor da sessão: especiais, persistem após reinício e validam cor', async () => {
    repo = makeRepo()
    const first = await boot()
    const { paneId } = await first.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    const name = 'Revisão "PR #12" 🚀'
    await first.app.client.request({ t: 'pane.meta', paneId, name, color: '#3b82f6' })
    await first.app.waitState((s) => s.panes[0]?.name === name && s.panes[0]?.color === '#3b82f6')
    await expect(first.app.client.request({ t: 'pane.meta', paneId, color: 'red; drop' })).rejects.toThrow('cor inválida')
    await first.app.client.request({ t: 'pane.meta', paneId, name: '   ' })
    await first.app.waitState((s) => s.panes[0]?.name === null)
    await first.app.client.request({ t: 'pane.meta', paneId, name })
    await first.app.client.request({ t: 'settings.save', settings: { theme: 'dracula', fontFamily: 'JetBrains Mono', fontSize: 99, lineHeight: 1.3 } })
    await first.app.waitState((s) => s.settings.theme === 'dracula' && s.settings.fontSize === 24)
    await new Promise((r) => setTimeout(r, 400))
    first.app.client.close()
    await first.d.stop(true)
    daemons = []
    const second = await boot({}, first.home)
    const st = await second.app.waitState((s) => s.resumable.length === 1)
    expect(st.settings).toMatchObject({ theme: 'dracula', fontFamily: 'JetBrains Mono', fontSize: 24 })
    // o painel retomado com o mesmo id recupera nome e cor
    await second.app.client.request({ t: 'pane.create', paneId, cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await second.app.waitState((s) => s.panes[0]?.name === name && s.panes[0]?.color === '#3b82f6')
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run tests/shared/settings.test.ts tests/daemon/daemon.test.ts -t "preferências|nome e cor"`
Expected: FAIL.

- [ ] **Step 3: `src/shared/settings.ts`**

```ts
export const THEME_IDS = ['vscode-dark', 'one-dark', 'dracula', 'solarized-dark', 'github-dark', 'nord'] as const
export type ThemeId = (typeof THEME_IDS)[number]

export interface TerminalSettings {
  theme: ThemeId
  fontFamily: string
  fontSize: number
  lineHeight: number
}

export const DEFAULT_SETTINGS: TerminalSettings = {
  theme: 'vscode-dark',
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: 13,
  lineHeight: 1.2,
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export function normalizeSettings(s: Partial<TerminalSettings> | undefined): TerminalSettings {
  const v = s ?? {}
  return {
    theme: THEME_IDS.includes(v.theme as ThemeId) ? (v.theme as ThemeId) : DEFAULT_SETTINGS.theme,
    fontFamily: typeof v.fontFamily === 'string' && v.fontFamily.trim() ? v.fontFamily.trim() : DEFAULT_SETTINGS.fontFamily,
    fontSize: typeof v.fontSize === 'number' && Number.isFinite(v.fontSize) ? clamp(Math.round(v.fontSize), 10, 24) : DEFAULT_SETTINGS.fontSize,
    lineHeight: typeof v.lineHeight === 'number' && Number.isFinite(v.lineHeight) ? clamp(Math.round(v.lineHeight * 10) / 10, 1, 1.6) : DEFAULT_SETTINGS.lineHeight,
  }
}

export const SESSION_COLORS = [
  { id: 'vermelho', label: 'vermelho', hex: '#ef4444' },
  { id: 'laranja', label: 'laranja', hex: '#f97316' },
  { id: 'amarelo', label: 'amarelo', hex: '#eab308' },
  { id: 'verde', label: 'verde', hex: '#22c55e' },
  { id: 'petroleo', label: 'azul-petróleo', hex: '#14b8a6' },
  { id: 'azul', label: 'azul', hex: '#3b82f6' },
  { id: 'roxo', label: 'roxo', hex: '#a855f7' },
  { id: 'rosa', label: 'rosa', hex: '#ec4899' },
]
```

- [ ] **Step 4: Tipos e protocolo**

`src/shared/types.ts`: importe `import type { TerminalSettings } from './settings'` e reexporte com `export type { TerminalSettings } from './settings'`. Em `PaneView`, acrescente `name: string | null` e `color: string | null`. Em `AppState`, acrescente `settings: TerminalSettings`.

`src/shared/protocol.ts`: importe `TerminalSettings` e acrescente a `ClientRequest`:
```ts
  | { t: 'pane.meta'; paneId: string; name?: string | null; color?: string | null }
  | { t: 'settings.save'; settings: TerminalSettings }
```

- [ ] **Step 5: Persistência — `src/daemon/persist.ts`**

- Importe `import { DEFAULT_SETTINGS, normalizeSettings, type TerminalSettings } from '../shared/settings'`.
- Em `Persisted`, acrescente `paneMeta: Record<string, { name: string | null; color: string | null }>` e `settings: TerminalSettings`.
- Em `defaultPersisted()`, acrescente `paneMeta: {},` e `settings: { ...DEFAULT_SETTINGS },`.
- Em `loadPersisted`, no objeto retornado, acrescente `paneMeta: parsed.paneMeta ?? {},` e `settings: normalizeSettings(parsed.settings),`.

- [ ] **Step 6: Daemon**

Em `src/daemon/daemon.ts`:
- importe `normalizeSettings` de `../shared/settings`;
- em `buildState`, no `map` de painéis, acrescente:
```ts
        name: this.persisted.paneMeta[r.id]?.name ?? null,
        color: this.persisted.paneMeta[r.id]?.color ?? null,
```
e, no objeto de estado, `settings: this.persisted.settings,`;
- no `switch`:
```ts
      case 'pane.meta': {
        const cur = this.persisted.paneMeta[req.paneId] ?? { name: null, color: null }
        const next = { ...cur }
        if (req.name !== undefined) next.name = req.name === null ? null : req.name.trim().slice(0, 60) || null
        if (req.color !== undefined) {
          if (req.color !== null && !/^#[0-9a-fA-F]{6}$/.test(req.color)) throw new Error(`cor inválida: ${req.color}`)
          next.color = req.color
        }
        this.persisted.paneMeta[req.paneId] = next
        this.changed()
        return null
      }
      case 'settings.save':
        this.persisted.settings = normalizeSettings(req.settings)
        this.changed()
        return null
```
- nos casos `'pane.forget'` e `'resume.dismiss'`, acrescente `delete this.persisted.paneMeta[req.paneId]`.

- [ ] **Step 7: Literais dos testes do renderer**

Onde os testes montam `PaneView` à mão (`tests/renderer/header.test.ts`, `sidebar-model.test.ts`, `ui-logic.test.ts`, `attention.test.ts`, `focus.test.ts`), acrescente `name: null, color: null` na fábrica `pane(...)`. Onde montam `AppState` (`sidebar-model.test.ts`, `ui-logic.test.ts`), acrescente `settings: DEFAULT_SETTINGS` (importando de `../../src/shared/settings`).

- [ ] **Step 8: Rodar e ver passar**

Run: `rtk proxy npx vitest run && rtk proxy npm run typecheck`
Expected: verde.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: nome/cor por sessão e preferências do terminal no daemon

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Personalização na interface (renomear, cor, temas, Preferências)

**Files:**
- Create: `src/renderer/src/themes.ts`, `src/renderer/src/components/Preferences.tsx`
- Modify: `src/renderer/src/header.ts`, `src/renderer/src/sidebar-model.ts`, `src/renderer/src/terminals.ts`, `src/renderer/src/store.ts`, `src/renderer/src/flows.ts`, `src/renderer/src/main.tsx`, `src/renderer/src/components/PaneHeader.tsx`, `Sidebar.tsx`, `Modals.tsx`, `src/renderer/src/styles.css`, `src/main/menu.ts`
- Test: `tests/renderer/themes.test.ts`, `tests/renderer/header.test.ts` (campo `label`), `tests/renderer/sidebar-model.test.ts` (nome vence título)

**Interfaces:**
- Consumes: Task 7.
- Produces:
  - `THEMES: Record<ThemeId, { label: string; xterm: ITheme }>`
  - `HeaderView.label: string` (nome > título > "sessão N"/"terminal N")
  - `sessionLabel(p)` passa a preferir `p.name`
  - `terminals.applySettings(s: TerminalSettings): void`
  - `UiState.renamingPaneId: string | null`; `Modal` ganha `{ kind: 'preferences' }`
  - ação de menu `preferences` (⌘,)

- [ ] **Step 1: Testes que falham**

`tests/renderer/themes.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { THEMES } from '../../src/renderer/src/themes'
import { THEME_IDS } from '../../src/shared/settings'

const KEYS = ['background', 'foreground', 'cursor', 'selectionBackground', 'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white', 'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'] as const

describe('temas', () => {
  it('um tema completo para cada id', () => {
    expect(Object.keys(THEMES).sort()).toEqual([...THEME_IDS].sort())
    for (const id of THEME_IDS) for (const k of KEYS) expect(THEMES[id].xterm[k], `${id}.${k}`).toMatch(/^#[0-9a-f]{6}$/i)
  })
})
```
Em `tests/renderer/header.test.ts`, no primeiro teste o objeto esperado ganha `label: 'sessão 1'`. Acrescente:
```ts
  it('nome vence o título, que vence o rótulo padrão', () => {
    const base = pane({ claude: { sessionId: 's', status: 'idle', statusSince: 0, title: 'Refatorar auth', transcriptPath: null } })
    expect(headerView(base, app).label).toBe('Refatorar auth')
    expect(headerView({ ...base, name: 'backend' }, app).label).toBe('backend')
    expect(headerView(pane({}), app).label).toBe('terminal 1')
  })
```
Em `tests/renderer/sidebar-model.test.ts`, acrescente:
```ts
  it('nome dado pelo usuário vence o título', () => {
    expect(sessionLabel(pane('p8', { name: 'revisão', claude: claude('idle', 'Título') }))).toBe('revisão')
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run tests/renderer`
Expected: FAIL (`themes` inexistente; `label` ausente; nome ignorado).

- [ ] **Step 3: `src/renderer/src/themes.ts`**

```ts
import type { ITheme } from '@xterm/xterm'
import type { ThemeId } from '../../shared/settings'

export const THEMES: Record<ThemeId, { label: string; xterm: ITheme }> = {
  'vscode-dark': { label: 'VS Code Dark', xterm: { background: '#1e1e1e', foreground: '#cccccc', cursor: '#aeafad', selectionBackground: '#264f78', black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510', blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5', brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543', brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#e5e5e5' } },
  'one-dark': { label: 'One Dark', xterm: { background: '#282c34', foreground: '#abb2bf', cursor: '#528bff', selectionBackground: '#3e4451', black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf', brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff' } },
  dracula: { label: 'Dracula', xterm: { background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a', black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2', brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff' } },
  'solarized-dark': { label: 'Solarized Dark', xterm: { background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: '#073642', black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5', brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#859900', brightYellow: '#b58900', brightBlue: '#268bd2', brightMagenta: '#6c71c4', brightCyan: '#2aa198', brightWhite: '#fdf6e3' } },
  'github-dark': { label: 'GitHub Dark', xterm: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#58a6ff', selectionBackground: '#264f78', black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4', brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341', brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc' } },
  nord: { label: 'Nord', xterm: { background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selectionBackground: '#434c5e', black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0', brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4' } },
}
```

- [ ] **Step 4: Rótulo — `header.ts` e `sidebar-model.ts`**

`src/renderer/src/header.ts`: acrescente `label: string` em `HeaderView` e, no objeto retornado por `headerView`:
```ts
    label: pane.name ?? pane.claude?.title ?? (pane.claude ? `sessão ${pane.seq}` : `terminal ${pane.seq}`),
```
`src/renderer/src/sidebar-model.ts`, em `sessionLabel`, depois da linha do `!p.alive`, acrescente `if (p.name) return p.name`.

- [ ] **Step 5: Aplicar preferências nos terminais — `src/renderer/src/terminals.ts`**

- Troque a constante `OPTIONS` para não fixar tema e fonte:
```ts
const BASE_OPTIONS = {
  scrollback: 10_000,
  cursorBlink: true,
  macOptionIsMeta: false, // ⌥ digita caracteres do layout (teclas mortas, ç, etc.)
  allowProposedApi: true,
}
let current: TerminalSettings = DEFAULT_SETTINGS

function optionsFor(s: TerminalSettings) {
  return { fontFamily: s.fontFamily, fontSize: s.fontSize, lineHeight: s.lineHeight, theme: THEMES[s.theme].xterm }
}
```
- Em `ensure`, crie o terminal com `new Terminal({ ...BASE_OPTIONS, ...optionsFor(current) })`.
- Acrescente o método na classe:
```ts
  applySettings(s: TerminalSettings): void {
    current = s
    document.documentElement.style.setProperty('--term-bg', THEMES[s.theme].xterm.background ?? '#1e1e1e')
    for (const [id, e] of this.entries) {
      Object.assign(e.term.options, optionsFor(s))
      this.fit(id)
    }
  }
```
- Importe `DEFAULT_SETTINGS, type TerminalSettings` de `../../shared/settings` e `THEMES` de `./themes`.
- CSS: `.term-container { background: var(--term-bg, #1e1e1e); }`.

`src/renderer/src/main.tsx`: no caso `'state'`, depois do `setUi`, acrescente:
```ts
      if (JSON.stringify(e.state.settings) !== JSON.stringify(prev?.settings)) terminals.applySettings(e.state.settings)
```
e, no `.then` do `state.get` inicial, `terminals.applySettings(app.settings)`. Volte a usar `p.name ?? p.claude?.title ?? …` no corpo da notificação (nota da Task 3).

- [ ] **Step 6: Renomear e cor — estado, cabeçalho, menu, sidebar**

`src/renderer/src/store.ts`: `UiState` ganha `renamingPaneId: string | null` (inicial `null`); `Modal` ganha `| { kind: 'preferences' }`.

`src/renderer/src/components/PaneHeader.tsx`: depois do bloco da worktree, mostre o rótulo ou o campo de edição:
```tsx
      {renaming ? (
        <input
          className="ph-rename"
          autoFocus
          defaultValue={pane.name ?? ''}
          placeholder={h.label}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setUi({ renamingPaneId: null })
          }}
          onBlur={(e) => {
            if (getUi().renamingPaneId === pane.id) window.gt.send({ t: 'pane.meta', paneId: pane.id, name: e.target.value })
            setUi({ renamingPaneId: null })
          }}
        />
      ) : (
        <span className="ph-label" title="Duplo clique para renomear" onDoubleClick={() => setUi({ renamingPaneId: pane.id })}>
          {h.label}
        </span>
      )}
```
com `const renaming = useUi((s) => s.renamingPaneId === pane.id)` e os imports `getUi, setUi`. No `div` raiz do cabeçalho, acrescente `style={pane.color ? { boxShadow: \`inset 0 3px 0 ${pane.color}\` } : undefined}`.

`src/renderer/src/flows.ts`, em `sessionMenu`, na lista para sessões vivas, antes de `{ id: 'kill', … }`:
```ts
          { id: 'rename', label: 'Renomear…' },
          { id: 'color:', label: 'Cor: nenhuma' },
          ...SESSION_COLORS.map((c) => ({ id: `color:${c.hex}`, label: `Cor: ${c.label}` })),
          { id: '-', label: '' },
```
e os tratamentos:
```ts
  else if (choice === 'rename') {
    revealPane(s.paneId)
    setUi({ renamingPaneId: s.paneId })
  } else if (choice?.startsWith('color:')) window.gt.request({ t: 'pane.meta', paneId: s.paneId, color: choice.slice(6) || null }).catch(showError)
```
(importe `SESSION_COLORS` de `../../shared/settings`).

`src/renderer/src/sidebar-model.ts`: `SessionItem` ganha `color: string | null`, preenchido com `p.color` em `toItem`.
`src/renderer/src/components/Sidebar.tsx`, em `SessionRow`, antes do rótulo:
```tsx
      {s.color && <span className="sb-color" style={{ background: s.color }} />}
```

CSS:
```css
.ph-label { font-weight: 600; max-width: 260px; overflow: hidden; text-overflow: ellipsis; cursor: text; }
.ph-rename { width: 180px; background: #3c3c3c; color: var(--fg); border: 1px solid var(--accent); border-radius: 3px; font: inherit; }
.sb-color { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
```

- [ ] **Step 7: Preferências (⌘,) — `src/renderer/src/components/Preferences.tsx`**

```tsx
import { useState } from 'react'
import { normalizeSettings, THEME_IDS, type TerminalSettings } from '../../../shared/settings'
import { THEMES } from '../themes'
import { setUi, showError, useUi } from '../store'

export function Preferences() {
  const saved = useUi((s) => s.app?.settings)
  const [draft, setDraft] = useState<TerminalSettings | null>(saved ?? null)
  if (!saved || !draft) return null
  const update = (patch: Partial<TerminalSettings>) => {
    const next = normalizeSettings({ ...draft, ...patch })
    setDraft(next)
    window.gt.request({ t: 'settings.save', settings: next }).catch(showError)
  }
  const close = () => setUi({ modal: null })
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h3>Preferências</h3>
        <div className="field">
          <div className="field-label">TEMA DO TERMINAL</div>
          <select value={draft.theme} onChange={(e) => update({ theme: e.target.value as TerminalSettings['theme'] })}>
            {THEME_IDS.map((id) => (
              <option key={id} value={id}>
                {THEMES[id].label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <div className="field-label">FONTE</div>
          <input className="text-input" defaultValue={draft.fontFamily} onBlur={(e) => update({ fontFamily: e.target.value })} />
        </div>
        <div className="field">
          <div className="field-label">TAMANHO · {draft.fontSize}px</div>
          <input type="range" min={10} max={24} value={draft.fontSize} onChange={(e) => update({ fontSize: Number(e.target.value) })} />
        </div>
        <div className="field">
          <div className="field-label">ALTURA DE LINHA · {draft.lineHeight.toFixed(1)}</div>
          <input type="range" min={1} max={1.6} step={0.1} value={draft.lineHeight} onChange={(e) => update({ lineHeight: Number(e.target.value) })} />
        </div>
        <div className="modal-actions">
          <button className="primary" autoFocus onClick={close}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
```
CSS: `.text-input { background: #3c3c3c; color: var(--fg); border: 1px solid #555; border-radius: 4px; padding: 5px; font: inherit; }`.
`Modals.tsx`: `if (modal.kind === 'preferences') return <Preferences />` (logo após o caso `conflicts`).
`src/main/menu.ts`: no submenu do app, depois de `{ role: 'about', label: 'Sobre' },`, acrescente `{ type: 'separator' }, item('Preferências…', 'CmdOrCtrl+,', 'preferences'),`.
`actions.ts`, em `runMenuAction`: `else if (action === 'preferences') setUi({ modal: { kind: 'preferences' } })`.

- [ ] **Step 8: Rodar, typecheck, build**

Run: `rtk proxy npx vitest run && rtk proxy npm run typecheck && rtk proxy npm run build`
Expected: verde.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: renomear e colorir sessões, temas e preferências do terminal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: ⌘K — busca rápida

**Files:**
- Create: `src/renderer/src/search.ts`, `src/renderer/src/components/Palette.tsx`
- Modify: `src/renderer/src/store.ts` (`Modal` `palette`), `src/renderer/src/actions.ts`, `src/renderer/src/components/Modals.tsx`, `src/main/menu.ts`, `src/renderer/src/styles.css`
- Test: `tests/renderer/search.test.ts`

**Interfaces:**
- Produces:
  - `interface PaletteItem { kind: 'session' | 'worktree' | 'project'; id: string; label: string; detail: string; projectPath: string | null; worktreePath: string | null }`
  - `normalize(s: string): string`, `fuzzyScore(query: string, text: string): number | null` (menor = melhor)
  - `buildPaletteItems(app: AppState): PaletteItem[]`, `searchPalette(items: PaletteItem[], query: string, limit?: number): PaletteItem[]`
  - ação de menu `palette` (⌘K)

- [ ] **Step 1: Teste que falha — `tests/renderer/search.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { buildPaletteItems, fuzzyScore, normalize, searchPalette } from '../../src/renderer/src/search'
import { DEFAULT_ACCOUNTS } from '../../src/daemon/accounts'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import type { AppState } from '../../src/shared/types'

const app: AppState = {
  protocolVersion: 2, userHome: '/u', accounts: DEFAULT_ACCOUNTS, resumable: [], hookWarnings: [], settings: DEFAULT_SETTINGS,
  layout: { tabs: [], activeTabId: null },
  projects: [{ path: '/r/tcheerp', name: 'tcheerp', defaultAccountId: null, error: null, fetchError: null, conflicts: null, worktrees: [
    { path: '/r/tcheerp', head: null, branch: 'main', isMain: true, locked: false, prunable: false, git: null },
    { path: '/r/tcheerp/.claude/worktrees/custo-hora', head: null, branch: 'docs/custo', isMain: false, locked: false, prunable: false, git: null },
  ] }],
  panes: [
    { id: 'p1', seq: 1, cwd: '/r/tcheerp', alive: true, exitCode: null, accountId: 'weboption', name: null, color: null, projectPath: '/r/tcheerp', worktreePath: '/r/tcheerp/.claude/worktrees/custo-hora',
      claude: { sessionId: 's', status: 'idle', statusSince: 0, title: 'Revisão da ação de custo', transcriptPath: null } },
    { id: 'p2', seq: 2, cwd: '/r', alive: false, exitCode: 0, accountId: null, name: null, color: null, projectPath: null, worktreePath: null, claude: null },
  ],
}

describe('busca do ⌘K', () => {
  it('ignora acentos e maiúsculas; aceita subsequência', () => {
    expect(normalize('Revisão AÇÃO')).toBe('revisao acao')
    expect(fuzzyScore('acao', 'Revisão da ação')).not.toBeNull()
    expect(fuzzyScore('cstho', 'custo-hora')).not.toBeNull()
    expect(fuzzyScore('xyz', 'custo-hora')).toBeNull()
    expect(fuzzyScore('custo', 'custo-hora')!).toBeLessThan(fuzzyScore('cstho', 'custo-hora')!)
  })

  it('itens: sessões vivas, worktrees e projetos', () => {
    const items = buildPaletteItems(app)
    expect(items.map((i) => [i.kind, i.label])).toEqual([
      ['session', 'Revisão da ação de custo'],
      ['worktree', 'principal'],
      ['worktree', 'custo-hora'],
      ['project', 'TCHEERP'],
    ])
    expect(items[0].detail).toBe('TCHEERP · ⎇ custo-hora · weboption')
  })

  it('ordena por relevância, rótulo antes do detalhe', () => {
    const items = buildPaletteItems(app)
    expect(searchPalette(items, 'custo').map((i) => i.label)).toEqual(['custo-hora', 'Revisão da ação de custo'])
    expect(searchPalette(items, '')).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run tests/renderer/search.test.ts`
Expected: FAIL.

- [ ] **Step 3: `src/renderer/src/search.ts`**

```ts
import type { AppState } from '../../shared/types'
import { worktreeLabel } from './header'
import { sessionLabel } from './sidebar-model'

export interface PaletteItem {
  kind: 'session' | 'worktree' | 'project'
  id: string
  label: string
  detail: string
  projectPath: string | null
  worktreePath: string | null
}

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

/** subsequência; pontuação = início da 1ª letra + buracos entre letras (menor = melhor). Trecho contíguo ganha bônus. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = normalize(query).replace(/\s+/g, '')
  const t = normalize(text)
  if (!q) return 0
  const contiguous = t.indexOf(q)
  if (contiguous >= 0) return contiguous * 0.01
  let ti = 0
  let first = -1
  let gaps = 0
  let last = -1
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    if (first < 0) first = found
    if (last >= 0) gaps += found - last - 1
    last = found
    ti = found + 1
  }
  return 1 + first * 0.01 + gaps
}

export function buildPaletteItems(app: AppState): PaletteItem[] {
  const items: PaletteItem[] = []
  for (const p of app.panes.filter((x) => x.alive)) {
    const project = app.projects.find((x) => x.path === p.projectPath)
    const wt = project?.worktrees.find((w) => w.path === p.worktreePath)
    const account = app.accounts.find((a) => a.id === p.accountId)
    const detail = [project ? project.name.toUpperCase() : 'fora de projeto', wt ? `⎇ ${worktreeLabel(wt)}` : null, account?.label].filter(Boolean).join(' · ')
    items.push({ kind: 'session', id: p.id, label: sessionLabel(p), detail, projectPath: p.projectPath, worktreePath: p.worktreePath })
  }
  for (const project of app.projects) {
    for (const w of project.worktrees.filter((x) => !x.prunable)) {
      items.push({ kind: 'worktree', id: w.path, label: worktreeLabel(w), detail: project.name.toUpperCase(), projectPath: project.path, worktreePath: w.path })
    }
  }
  for (const project of app.projects) {
    items.push({ kind: 'project', id: project.path, label: project.name.toUpperCase(), detail: project.path, projectPath: project.path, worktreePath: null })
  }
  return items
}

export function searchPalette(items: PaletteItem[], query: string, limit = 30): PaletteItem[] {
  if (!query.trim()) return items.slice(0, limit)
  const scored: { item: PaletteItem; score: number }[] = []
  for (const item of items) {
    const byLabel = fuzzyScore(query, item.label)
    const byDetail = fuzzyScore(query, item.detail)
    const score = byLabel !== null ? byLabel : byDetail !== null ? byDetail + 100 : null
    if (score !== null) scored.push({ item, score })
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map((s) => s.item)
}
```

- [ ] **Step 4: Paleta — `src/renderer/src/components/Palette.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { openNewSessionDialog, revealPane } from '../actions'
import { buildPaletteItems, searchPalette, type PaletteItem } from '../search'
import { getUi, setUi, useUi } from '../store'

const KIND = { session: 'sessão', worktree: 'worktree', project: 'projeto' } as const

function run(item: PaletteItem): void {
  setUi({ modal: null })
  if (item.kind === 'session') return revealPane(item.id)
  if (item.kind === 'worktree') return openNewSessionDialog(item.projectPath ?? undefined, item.worktreePath ?? undefined)
  const first = getUi().app?.panes.find((p) => p.alive && p.projectPath === item.projectPath)
  if (first) revealPane(first.id)
  else openNewSessionDialog(item.projectPath ?? undefined)
}

export function Palette() {
  const app = useUi((s) => s.app)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const items = useMemo(() => (app ? buildPaletteItems(app) : []), [app])
  const results = useMemo(() => searchPalette(items, q), [items, q])
  const close = () => setUi({ modal: null })
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder="Buscar sessão, worktree ou projeto…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setSel(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, results.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)) }
            else if (e.key === 'Enter' && results[sel]) run(results[sel])
          }}
        />
        <div className="palette-list">
          {results.map((item, i) => (
            <div key={`${item.kind}:${item.id}`} className={`palette-item${i === sel ? ' sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => run(item)}>
              <span className="palette-kind">{KIND[item.kind]}</span>
              <span className="palette-label">{item.label}</span>
              <span className="palette-detail">{item.detail}</span>
            </div>
          ))}
          {results.length === 0 && <div className="palette-empty">Nada encontrado</div>}
        </div>
      </div>
    </div>
  )
}
```
CSS:
```css
.palette-backdrop { place-items: start center; padding-top: 12vh; }
.palette { width: 560px; background: var(--bg-bar); border: 1px solid #3c3c3c; border-radius: 8px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5); overflow: hidden; }
.palette-input { width: 100%; border: 0; border-bottom: 1px solid var(--border); background: transparent; color: var(--fg); font: inherit; font-size: 14px; padding: 12px 14px; outline: none; }
.palette-list { max-height: 50vh; overflow-y: auto; }
.palette-item { display: flex; align-items: baseline; gap: 10px; padding: 7px 14px; cursor: pointer; }
.palette-item.sel { background: #04395e; }
.palette-kind { font-size: 10px; color: var(--fg-dim); width: 60px; flex-shrink: 0; text-transform: uppercase; }
.palette-label { font-weight: 600; white-space: nowrap; }
.palette-detail { color: var(--fg-dim); font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.palette-empty { padding: 12px 14px; color: var(--fg-dim); }
```
`store.ts`: `Modal` ganha `| { kind: 'palette' }`. `Modals.tsx`: `if (modal.kind === 'palette') return <Palette />`.
`menu.ts`, submenu `'Sessão'`, depois do ⌘J: `item('Buscar…', 'CmdOrCtrl+K', 'palette'),`.
`actions.ts`, em `runMenuAction`: `else if (action === 'palette') setUi({ modal: { kind: 'palette' } })`.
Atualize a lista `SHORTCUTS` em `EmptyState.tsx` para incluir `['⌘J', 'próxima que precisa de mim']`, `['⌘K', 'buscar']` e `['⌘,', 'preferências']`.

- [ ] **Step 5: Rodar, typecheck, build**

Run: `rtk proxy npx vitest run && rtk proxy npm run typecheck && rtk proxy npm run build`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: ⌘K busca rápida de sessões, worktrees e projetos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Ajustes do daemon (sequência do attach, título incremental, remoção de worktree, espera do prompt, trava, hook, buildId)

**Files:**
- Create: `src/daemon/lock.ts`, `src/shared/build.ts`
- Modify: `src/shared/protocol.ts`, `src/shared/types.ts` (`RemoveCheck.ignoredFiles`), `src/daemon/server.ts`, `src/daemon/daemon.ts`, `src/daemon/panes.ts`, `src/daemon/title.ts`, `src/daemon/worktree-remove.ts`, `src/daemon/hooks.ts`, `src/daemon/main.ts`, `src/main/daemon-link.ts`, `electron.vite.config.ts`, `vitest.config.ts`
- Test: `tests/daemon/adjustments.test.ts`, `tests/daemon/daemon.test.ts` (novos casos), `tests/daemon/worktree-remove.test.ts` (novos casos), `tests/daemon/hooks.test.ts` (novo caso), `tests/main/daemon-link.test.ts` (novo caso)

**Interfaces:**
- Produces:
  - `PROTOCOL_VERSION = 2`; `hello` responde `{ protocolVersion: number; buildId: string }`
  - `pane.attach` ganha `seq?: number`; `ServerMessage` `pane.data` ganha `seq: number`; requisição `{ t: 'pane.detach'; paneId: string }`
  - `Conn.subscriptions: Map<string, number>` (paneId → seq)
  - `BridgeEvent` `version-mismatch` passa a `{ t: 'version-mismatch'; daemon: string; app: string }`
  - `BUILD_ID: string`
  - `createTitleReader(): (file: string) => Promise<string | null>`
  - `RemoveCheck.ignoredFiles: string[]`
  - `acquireLock(lockPath: string): boolean`, `releaseLock(lockPath: string): void`

- [ ] **Step 1: Testes que falham**

`tests/daemon/adjustments.test.ts`:
```ts
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireLock, releaseLock } from '../../src/daemon/lock'
import { createTitleReader } from '../../src/daemon/title'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-a-')))

describe('título incremental', () => {
  it('acompanha o que é acrescentado, inclusive com UTF-8 partido entre gravações', async () => {
    const f = path.join(tmp(), 't.jsonl')
    const read = createTitleReader()
    fs.writeFileSync(f, JSON.stringify({ type: 'ai-title', aiTitle: 'Primeiro' }) + '\n')
    expect(await read(f)).toBe('Primeiro')
    const line = Buffer.from(JSON.stringify({ type: 'custom-title', customTitle: 'ação 🚀' }) + '\n')
    const cut = line.indexOf(Buffer.from('ç')) + 1 // no meio do "ç"
    fs.appendFileSync(f, line.subarray(0, cut))
    expect(await read(f)).toBe('Primeiro')
    fs.appendFileSync(f, line.subarray(cut))
    expect(await read(f)).toBe('ação 🚀')
    expect(await read(path.join(tmp(), 'nao-existe.jsonl'))).toBeNull()
  })
})

describe('trava do daemon', () => {
  it('pega a trava livre; recusa se o dono está vivo; recupera trava de processo morto', async () => {
    const dir = tmp()
    const lock = path.join(dir, 'daemon.lock')
    expect(acquireLock(lock)).toBe(true)
    releaseLock(lock)
    expect(fs.existsSync(lock)).toBe(false)

    const alive = spawn('/bin/sleep', ['10'])
    fs.writeFileSync(lock, String(alive.pid))
    expect(acquireLock(lock)).toBe(false)
    alive.kill()
    await new Promise((r) => alive.on('exit', r))
    expect(acquireLock(lock)).toBe(true)
    expect(fs.readFileSync(lock, 'utf8')).toBe(String(process.pid))
  })
})
```

Em `tests/daemon/daemon.test.ts` (antes de `'erros de requisição…'`):
```ts
  it('attach com sequência: dados levam o seq do último attach; detach para o envio', async () => {
    repo = makeRepo()
    const { app } = await boot()
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await new Promise((r) => setTimeout(r, 500)) // o prompt inicial do sh sai antes de qualquer assinatura
    const seqs: number[] = []
    app.client.onMessage((m) => { if (m.t === 'pane.data' && m.paneId === paneId) seqs.push(m.seq) })
    await app.client.request({ t: 'pane.attach', paneId, seq: 1 })
    await app.client.request({ t: 'pane.attach', paneId, seq: 2 })
    app.client.send({ t: 'pane.input', paneId, data: 'echo um\r' })
    await app.waitState(() => seqs.length > 0)
    expect(new Set(seqs)).toEqual(new Set([2]))
    await app.client.request({ t: 'pane.detach', paneId })
    const n = seqs.length
    app.client.send({ t: 'pane.input', paneId, data: 'echo dois\r' })
    await new Promise((r) => setTimeout(r, 500))
    expect(seqs.length).toBe(n)
  })

  it('comando da conta espera o prompt, e sai mesmo se o shell nunca imprimir nada', async () => {
    repo = makeRepo()
    const slow = await boot({ shellArgs: ['-c', 'sleep 1; printf "PRONTO\\n"; exec cat'] })
    const a = await slow.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: 'mslabs', cols: 80, rows: 24 })
    const snap = await slow.app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId: a.paneId })
    await slow.app.waitState(() => (snap.snapshot + slow.app.output(a.paneId)).includes('claude-mslabs'), 8000)
    const all = snap.snapshot + slow.app.output(a.paneId)
    expect(all.indexOf('PRONTO')).toBeGreaterThanOrEqual(0)
    expect(all.indexOf('PRONTO')).toBeLessThan(all.indexOf('claude-mslabs'))

    const mute = await boot({ shellArgs: ['-c', 'exec cat'] })
    const b = await mute.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: 'mslabs', cols: 80, rows: 24 })
    const snapB = await mute.app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId: b.paneId })
    await mute.app.waitState(() => (snapB.snapshot + mute.app.output(b.paneId)).includes('claude-mslabs'), 8000)
  }, 20_000)

  it('hello informa a versão do protocolo e o buildId', async () => {
    const { o } = await boot()
    const c = await RpcClient.connect(o.socketPath)
    await expect(c.request({ t: 'hello', role: 'app', version: 2 })).resolves.toEqual({ protocolVersion: 2, buildId: 'test' })
    c.close()
  })
```
(importe `RpcClient` de `../../src/shared/rpc-client` no topo do arquivo).

Em `tests/daemon/worktree-remove.test.ts`, acrescente:
```ts
describe('ajustes da remoção', () => {
  it('lista ignorados relevantes (sem node_modules/dist)', async () => {
    const { wt } = await setup()
    fs.writeFileSync(path.join(wt.path, '.gitignore'), '.env\nnode_modules/\ndist/\n')
    repo!.git('-C', wt.path, 'add', '.gitignore'); repo!.git('-C', wt.path, 'commit', '-qm', 'ignore')
    fs.writeFileSync(path.join(wt.path, '.env'), 'SEGREDO=1\n')
    fs.mkdirSync(path.join(wt.path, 'node_modules', 'x'), { recursive: true }); fs.writeFileSync(path.join(wt.path, 'node_modules', 'x', 'i.js'), '')
    fs.mkdirSync(path.join(wt.path, 'dist')); fs.writeFileSync(path.join(wt.path, 'dist', 'b.js'), '')
    const c = await checkRemove({ mainPath: repo!.dir, worktree: wt, mainBranch: 'main', hasOpenSession: false })
    expect(c.ignoredFiles).toEqual(['.env'])
  })

  it('arquivo com o nome da branch principal não quebra a checagem', async () => {
    const { wt } = await setup()
    repo!.write('main', 'arquivo chamado main\n'); repo!.git('add', 'main'); repo!.git('commit', '-qm', 'arquivo main')
    fs.writeFileSync(path.join(wt.path, 'a.txt'), '1'); repo!.git('-C', wt.path, 'add', '.'); repo!.git('-C', wt.path, 'commit', '-qm', 'a')
    const c = await checkRemove({ mainPath: repo!.dir, worktree: wt, mainBranch: 'main', hasOpenSession: false })
    expect(c.unpushedCommits).toHaveLength(1)
  })

  it('prunable: remove só a escolhida', async () => {
    const { wt } = await setup('wt um')
    const outra = path.join(repo!.root, 'wt dois')
    repo!.git('worktree', 'add', '-b', 'dois', outra)
    fs.rmSync(wt.path, { recursive: true, force: true })
    fs.rmSync(outra, { recursive: true, force: true })
    const r = await listWorktrees(repo!.dir)
    const alvo = r.ok ? r.worktrees.find((w) => w.path === wt.path)! : wt
    await removeWorktree({ mainPath: repo!.dir, worktree: alvo, force: false, deleteBranch: false })
    const depois = await listWorktrees(repo!.dir)
    expect(depois.ok && depois.worktrees.map((w) => w.path)).toEqual([repo!.dir, outra])
  })
})
```

Em `tests/daemon/hooks.test.ts`, dentro de `describe('script gt-hook', …)`:
```ts
  it('daemon travado (não fecha a conexão): o hook desiste em ~1 s', async () => {
    const { dir, script } = setup()
    const sock = path.join(dir, 'd.sock')
    server = await startServer(sock, () => new Promise(() => {}))
    const r = await runWithInput('/bin/sh', [script], '{}', { PATH: '/usr/bin:/bin', GT_PANE_ID: 'p1', GT_SOCKET: sock })
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(r.ms).toBeLessThan(1600)
  })
```

Em `tests/main/daemon-link.test.ts`:
```ts
describe('aviso de versão', () => {
  it('buildId diferente dispara version-mismatch', async () => {
    const { DaemonLink } = await import('../../src/main/daemon-link')
    const p = sock()
    server = await startServer(p, () => ({ protocolVersion: 2, buildId: 'outro-build' }))
    const events: { t: string }[] = []
    const link = new DaemonLink({ socketPath: p, daemonScript: '/nao/usado', onEvent: (e) => events.push(e), spawnDaemon: () => {} })
    await link.start()
    expect(events).toContainEqual({ t: 'version-mismatch', daemon: 'v2 · outro-build', app: 'v2 · test' })
    await link.shutdownDaemon(false)
  })
})
```
Ajuste o teste I5 desse arquivo para responder `{ protocolVersion: 2, buildId: 'test' }` nos dois servidores (e esperar `toEqual({ protocolVersion: 2, buildId: 'test' })` no `state.get`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run tests/daemon tests/main`
Expected: FAIL nos casos novos.

- [ ] **Step 3: `BUILD_ID`**

`src/shared/build.ts`:
```ts
declare const __BUILD_ID__: string | undefined

/** gerado no build (commit + horário); 'dev' fora do bundle, 'test' no vitest */
export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev'
```
`electron.vite.config.ts`: no topo,
```ts
import { execSync } from 'node:child_process'

const commit = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'sem-git'
  }
})()
const BUILD_ID = `${commit}-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}`
```
e, no bloco `main`, acrescente `define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },`.
`vitest.config.ts`: `export default defineConfig({ define: { __BUILD_ID__: JSON.stringify('test') }, test: { … } })`.

- [ ] **Step 4: Protocolo e servidor**

`src/shared/protocol.ts`:
- `export const PROTOCOL_VERSION = 2`;
- `pane.attach` → `{ t: 'pane.attach'; paneId: string; cols?: number; rows?: number; seq?: number }`;
- acrescente `| { t: 'pane.detach'; paneId: string }`;
- `pane.data` → `{ t: 'pane.data'; paneId: string; data: string; seq: number }`;
- `version-mismatch` → `{ t: 'version-mismatch'; daemon: string; app: string }`.

`src/daemon/server.ts`: `subscriptions: Map<string, number>` na interface `Conn`, e `subscriptions: new Map()` na criação.

- [ ] **Step 5: Daemon (hello, attach, detach, remoção)**

Em `src/daemon/daemon.ts`:
- importe `BUILD_ID` de `../shared/build`;
- `hello` retorna `{ protocolVersion: PROTOCOL_VERSION, buildId: BUILD_ID }`;
- em `onData` (PaneManager deps): `for (const c of this.server?.conns ?? []) { const seq = c.subscriptions.get(id); if (seq !== undefined) c.send({ t: 'pane.data', paneId: id, data, seq }) }`;
- `pane.attach`: troque `conn.subscriptions.add(req.paneId)` por `conn.subscriptions.set(req.paneId, req.seq ?? 0)`;
- novo caso:
```ts
      case 'pane.detach':
        conn.subscriptions.delete(req.paneId)
        return null
```

`src/main/daemon-link.ts`: importe `BUILD_ID`; troque a checagem do hello por:
```ts
    const hello = await client.request<{ protocolVersion: number; buildId?: string }>({ t: 'hello', role: 'app', version: PROTOCOL_VERSION })
```
(dentro do try já existente) e, depois de `this.client = client`:
```ts
    if (hello.protocolVersion !== PROTOCOL_VERSION || hello.buildId !== BUILD_ID) {
      this.o.onEvent({ t: 'version-mismatch', daemon: `v${hello.protocolVersion} · ${hello.buildId ?? '?'}`, app: `v${PROTOCOL_VERSION} · ${BUILD_ID}` })
    }
```
(remova a checagem antiga). No renderer, `UiState.versionMismatch` passa a `{ daemon: string; app: string } | null`, e o `StatusBar` mostra `ⓘ daemon {vm.daemon} · app {vm.app}`.

- [ ] **Step 6: Título incremental — `src/daemon/title.ts` (substituir)**

```ts
import fs from 'node:fs'

interface Cursor {
  offset: number
  rest: Buffer
  custom: string | null
  ai: string | null
}

function scan(c: Cursor, chunk: Buffer): void {
  const buf = c.rest.length ? Buffer.concat([c.rest, chunk]) : chunk
  const end = buf.lastIndexOf(0x0a)
  if (end < 0) {
    c.rest = buf
    return
  }
  c.rest = Buffer.from(buf.subarray(end + 1))
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    if (line.includes('"type":"custom-title"')) {
      try {
        const o = JSON.parse(line) as { customTitle?: unknown }
        if (typeof o.customTitle === 'string') c.custom = o.customTitle
      } catch {
        // linha quebrada
      }
    } else if (line.includes('"type":"ai-title"')) {
      try {
        const o = JSON.parse(line) as { aiTitle?: unknown }
        if (typeof o.aiTitle === 'string') c.ai = o.aiTitle
      } catch {
        // linha quebrada
      }
    }
  }
}

/** lê só o que foi acrescentado desde a última chamada para aquele arquivo */
export function createTitleReader(): (file: string) => Promise<string | null> {
  const cursors = new Map<string, Cursor>()
  return async (file) => {
    let size: number
    try {
      size = (await fs.promises.stat(file)).size
    } catch {
      return null
    }
    let c = cursors.get(file)
    if (!c || size < c.offset) c = { offset: 0, rest: Buffer.alloc(0), custom: null, ai: null }
    if (size > c.offset) {
      const fh = await fs.promises.open(file, 'r')
      try {
        const chunk = Buffer.alloc(size - c.offset)
        const { bytesRead } = await fh.read(chunk, 0, chunk.length, c.offset)
        scan(c, chunk.subarray(0, bytesRead))
        c.offset += bytesRead
      } finally {
        await fh.close()
      }
    }
    cursors.set(file, c)
    return c.custom ?? c.ai
  }
}

/** leitura avulsa (compatível com a fase 1) */
export async function readTitle(file: string): Promise<string | null> {
  return createTitleReader()(file)
}
```
Em `src/daemon/panes.ts`, crie um leitor por instância (`private readTitle = createTitleReader()`) e troque a chamada `readTitle(rec.claude.transcriptPath)` por `this.readTitle(rec.claude.transcriptPath)` (import `createTitleReader` no lugar de `readTitle`).

- [ ] **Step 7: Espera do prompt — `src/daemon/panes.ts`**

- Campo novo: `private pendingCommands = new Map<string, { command: string; quiet: NodeJS.Timeout | null; max: NodeJS.Timeout }>()`.
- No construtor, troque o `data` do `PtyHost` por:
```ts
      data: (id, data) => {
        this.onPtyOutput(id)
        d.onData(id, data)
      },
```
- Em `create`, troque `if (command) this.host.write(id, command + '\r')` por:
```ts
    if (command) {
      // espera o shell mostrar o prompt (primeira saída + 300ms de silêncio), no máximo 5s
      this.pendingCommands.set(id, { command, quiet: null, max: setTimeout(() => this.flushCommand(id), 5000) })
    }
```
- Métodos:
```ts
  private onPtyOutput(id: string): void {
    const p = this.pendingCommands.get(id)
    if (!p) return
    if (p.quiet) clearTimeout(p.quiet)
    p.quiet = setTimeout(() => this.flushCommand(id), 300)
  }

  private flushCommand(id: string): void {
    const p = this.pendingCommands.get(id)
    if (!p) return
    this.pendingCommands.delete(id)
    if (p.quiet) clearTimeout(p.quiet)
    clearTimeout(p.max)
    this.host.write(id, p.command + '\r')
  }
```
- Em `exit` do `PtyHost` e em `forget`, limpe a pendência: `const p = this.pendingCommands.get(id); if (p) { clearTimeout(p.max); if (p.quiet) clearTimeout(p.quiet); this.pendingCommands.delete(id) }`.
- Os testes existentes que esperam `claude-mslabs`/`--resume` já usam `waitState` e continuam valendo, porque o comando chega até 5 s depois.

- [ ] **Step 8: Remoção de worktree — `src/daemon/worktree-remove.ts`**

- `RemoveCheck` (em `types.ts`) ganha `ignoredFiles: string[]`.
- Em `checkRemove`, depois de calcular `dirtyFiles`:
```ts
  let ignoredFiles: string[] = []
  if (!w.prunable) {
    const ig = await git(w.path, ['status', '--ignored', '--porcelain'])
    if (ig.ok) {
      ignoredFiles = lines(ig.stdout)
        .filter((l) => l.startsWith('!! '))
        .map((l) => l.slice(3))
        .filter((p) => !HEAVY.test(p))
    }
  }
```
com `const HEAVY = /(^|\/)(node_modules|dist|build|\.next|vendor|\.cache|coverage|\.turbo|target)(\/|$)/` no topo, e inclua `ignoredFiles` no objeto retornado.
- No `git log`, termine os argumentos com `'--'`: `const args = ['log', '--oneline', '--max-count=20', tip, '--not', '--remotes']; if (o.mainBranch && o.mainBranch !== w.branch) args.push(o.mainBranch); args.push('--')`.
- Em `removeWorktree`, troque o ramo `prunable` por uma remoção pontual:
```ts
  if (w.prunable) {
    const common = await git(o.mainPath, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    if (!common.ok) throw new Error(common.stderr.trim() || 'git rev-parse falhou')
    const adminRoot = path.join(common.stdout.trim(), 'worktrees')
    const target = path.join(w.path, '.git')
    const admin = fs.existsSync(adminRoot)
      ? fs.readdirSync(adminRoot).find((d) => {
          try {
            return fs.readFileSync(path.join(adminRoot, d, 'gitdir'), 'utf8').trim() === target
          } catch {
            return false
          }
        })
      : undefined
    if (!admin) throw new Error(`registro da worktree não encontrado: ${w.path}`)
    fs.rmSync(path.join(adminRoot, admin), { recursive: true, force: true })
  } else {
```
(importe `fs` e `path`).
- `Modals.tsx` (modal de remoção): some `c.ignoredFiles.length` ao aviso, com a linha `⚠ N arquivos ignorados pelo git serão apagados: .env, …` (até 8 nomes). O botão diz "Remover mesmo assim" quando há ignorados. O `force` continua dependendo só de alterações e commits.

- [ ] **Step 9: Hook e trava**

`src/daemon/hooks.ts`: no `GT_HOOK_SCRIPT`, troque `nc -U -w 2` por `nc -U -w 1`.

`src/daemon/lock.ts`:
```ts
import fs from 'node:fs'

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** trava exclusiva com o pid do dono; recupera trava deixada por processo que já morreu */
export function acquireLock(lockPath: string): boolean {
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' })
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
  const owner = Number(fs.readFileSync(lockPath, 'utf8').trim())
  if (owner && owner !== process.pid && isAlive(owner)) return false
  fs.rmSync(lockPath, { force: true })
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' })
    return true
  } catch {
    return false
  }
}

export function releaseLock(lockPath: string): void {
  try {
    if (fs.readFileSync(lockPath, 'utf8').trim() === String(process.pid)) fs.rmSync(lockPath)
  } catch {
    // já não existe
  }
}
```
`src/daemon/main.ts`: depois do `alreadyRunning`, acrescente:
```ts
  const lockPath = path.join(home, 'daemon.lock')
  if (!acquireLock(lockPath)) {
    console.log('outro daemon está iniciando; saindo')
    process.exit(0)
  }
  process.on('exit', () => releaseLock(lockPath))
```

- [ ] **Step 10: Rodar e ver passar**

Run: `rtk proxy npx vitest run && rtk proxy npm run typecheck`
Expected: verde.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "fix: ajustes adiados do daemon (seq do attach, título incremental, remoção de worktree, espera do prompt, trava, hook, buildId)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Ajustes do renderer (sequência, dispose e reload)

**Files:**
- Modify: `src/renderer/src/terminals.ts`, `src/renderer/src/main.tsx`, `src/renderer/src/actions.ts`
- Test: verificação por CDP (Step 4). A regra do seq foi testada no daemon (Task 10).

**Interfaces:**
- Consumes: `pane.attach.seq`, `pane.data.seq`, `pane.detach` (Task 10).
- Produces: `terminals.onData(paneId, data, seq)`, `terminals.dispose(paneId)`.

- [ ] **Step 1: `src/renderer/src/terminals.ts`**

- `Entry` ganha `seq: number` (inicial 0), e há um contador de módulo `let nextSeq = 0`.
- Em `attach`, antes do request: `const seq = ++nextSeq; e.seq = seq`. Envie `seq` no `pane.attach`. Depois do await, se `e.seq !== seq` (outro attach começou), retorne sem escrever.
- `onData(paneId, data, seq)`: ignore quando `seq !== e.seq`.
- Novo método:
```ts
  dispose(paneId: string): void {
    const e = this.entries.get(paneId)
    if (!e) return
    this.entries.delete(paneId)
    window.gt.send({ t: 'pane.detach', paneId })
    e.term.dispose()
    e.el.remove()
  }
```

- [ ] **Step 2: Ligações**

`src/renderer/src/main.tsx`: `case 'pane.data': terminals.onData(e.paneId, e.data, e.seq)`.
`src/renderer/src/actions.ts`, em `closeDeadPane`, acrescente `terminals.dispose(paneId)` antes dos `send`.

- [ ] **Step 3: Typecheck, testes, build e commit**

Run: `rtk proxy npm run typecheck && rtk proxy npx vitest run && rtk proxy npm run build`
Expected: verde.
```bash
git add -A
git commit -m "fix: renderer descarta dados de attach antigo e libera terminais descartados

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Verificação por CDP**

Numa instância isolada, abra um terminal e rode `seq 1 50`. Recarregue o renderer via CDP (`Page.reload`) e, pelo DOM, confira que o texto `50` aparece **uma** vez na última tela do painel (`.xterm-rows`).

---

### Task 12: Empacotar, instalar e checklist

**Files:**
- Modify: `README.md` (atalhos novos, conflitos, preferências)

- [ ] **Step 1: README**

Na seção "Atalhos", troque a linha por:
```
⌘T nova sessão · ⌘D / ⇧⌘D dividir · ⌘W esconder · ⌘J próxima que precisa de mim · ⌘K buscar · ⌘, preferências · ⇧⌘T nova aba · ⌘1…9 abas · ⌥⌘+setas foco · ⌘B sidebar
```
e acrescente uma seção:
```markdown
## Estados e avisos
🟢 trabalhando · 🟡 precisa de você (permissão/opções) · 🔵 sua vez (terminou e espera resposta) · ⚪ ocioso.
Abas não ativas ganham uma bolinha quando algo nelas espera você; o Dock mostra o total; o macOS notifica quando você não está vendo.

## Conflitos entre worktrees
Botão ⇄ no projeto: compara cada worktree com a main e com cada outra (inclui alterações não commitadas), sem mexer em nada.
```

- [ ] **Step 2: Pacote e instalação**

Run: `rtk proxy npm run pack && codesign --verify --deep --strict "dist/mac-arm64/Gerenciador de Terminal.app"`
Expected: pacote gerado e assinatura válida.
Run: `rm -rf "/Applications/Gerenciador de Terminal.app" && cp -R "dist/mac-arm64/Gerenciador de Terminal.app" /Applications/`

- [ ] **Step 3: Commit e push**

```bash
git add -A
git commit -m "docs: README da fase 2

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 4: Checklist manual do usuário**

O `PROTOCOL_VERSION` mudou, então o app novo vai avisar que o daemon é de outra versão. Use "Reiniciar daemon quando eu quiser" e depois "Retomar todas". Então confira:
1. Claude termina um turno com pergunta → 🔵 no cabeçalho, na sidebar e na aba (se estiver em outra aba) → clicar no painel → ⚪.
2. Com o app em segundo plano, uma sessão pede permissão → notificação do macOS → clique leva ao painel. O Dock mostra o número.
3. ⌘J percorre as sessões que esperam você, 🟡 antes de 🔵.
4. ⇄ num projeto com worktrees → modal com pares e arquivos; editar um arquivo numa worktree faz a lista se atualizar sozinha.
5. Renomear (duplo clique no nome), colorir (botão direito), ⌘, para trocar tema e fonte, ⌘K para buscar.
6. ⌘R (Exibir → Recarregar) não duplica a saída de nenhum terminal.
