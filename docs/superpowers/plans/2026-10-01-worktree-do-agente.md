# Worktree real do agente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deduzir pela atividade de escrita (hooks `PreToolUse`) em qual worktree o agente trabalha e usar essa como worktree efetiva do painel.

**Architecture:** Funções puras em `src/daemon/agent-worktree.ts` (`writtenPaths`, `worktreeOf`, `nextInference`). O `PaneManager` mantém por painel o estado da dedução, atualiza em cada `PreToolUse` e zera em `SessionStart`/`SessionEnd`/mudança de cwd/worktree removida. O daemon publica `worktreePath`/`projectPath` efetivos e `shellWorktreePath`/`worktreeInferred`; todo o renderer já lê `worktreePath`, só o cabeçalho ganha a marca.

**Tech Stack:** TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-worktree-do-agente-design.md`

## Global Constraints

- Escrita = `PreToolUse` com Edit/Write/MultiEdit (`file_path`), NotebookEdit (`notebook_path`), Bash (`git -C`, `cd`, `>`/`>>`, variáveis do próprio comando resolvidas) ou ferramenta desconhecida com `file_path`/`path` que não seja de leitura (`Read`, `Grep`, `Glob`, `LS`, `WebFetch`, `WebSearch`).
- Troca com **2** escritas seguidas na mesma worktree diferente da efetiva; escrita na efetiva zera o candidato.
- Reset: `SessionStart`, `SessionEnd`, mudança de cwd (hook ou poller), worktree deduzida que sumiu.
- Hooks de subagente (`agent_id`) contam.
- Cabeçalho: "⎇ <worktree> ·" e tooltip `o agente está editando em <worktree>; o shell está em <worktree do shell>`.
- `PaneView.shellWorktreePath?` e `PaneView.worktreeInferred?` opcionais (evita mexer em todos os literais de teste).

## Review Focus

1. **Worktree `/r/api2` ao lado de `/r/api`** → um arquivo em `/r/api2/x` não pode cair em `/r/api` (fronteira `/`). Teste na Task 1.
2. **Remover a worktree deduzida** com a sessão aberta → painel volta para a do shell, sem apontar para pasta inexistente. Teste na Task 2.
3. **Comando com `cd` relativo** (`cd ../dev2 && …`) → resolvido pelo cwd do shell. Teste na Task 1.
4. **Sessão com shell numa pasta fora de projeto** escrevendo numa worktree cadastrada → passa a pertencer àquele projeto. Teste na Task 2.
5. **Escrever de volta na worktree do shell duas vezes** → desfaz a dedução. Teste na Task 1.

---

### Task 1: Funções puras de dedução

**Files:**
- Create: `src/daemon/agent-worktree.ts`
- Test: `tests/daemon/agent-worktree.test.ts`

**Interfaces:**
- Produces:
  - `writtenPaths(p: HookPayload, cwd: string, home: string): string[]` (caminhos absolutos normalizados)
  - `worktreeOf(path: string, worktrees: string[]): string | null`
  - `interface InferenceState { inferred: string | null; candidate: { path: string; count: number } | null }`
  - `EMPTY_INFERENCE: InferenceState`
  - `nextInference(s: InferenceState, hit: string, shellWorktree: string | null): InferenceState`

- [ ] **Step 1: Teste que falha**

`tests/daemon/agent-worktree.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EMPTY_INFERENCE, nextInference, worktreeOf, writtenPaths } from '../../src/daemon/agent-worktree'
import type { HookPayload } from '../../src/shared/types'

const pre = (tool_name: string, tool_input: Record<string, unknown>): HookPayload => ({ hook_event_name: 'PreToolUse', session_id: 's', cwd: '/r/api', tool_name, tool_input })
const W = (p: HookPayload) => writtenPaths(p, '/r/api', '/Users/u')

describe('writtenPaths', () => {
  it('Edit/Write/MultiEdit/NotebookEdit', () => {
    expect(W(pre('Edit', { file_path: '/r/wt/a.ts' }))).toEqual(['/r/wt/a.ts'])
    expect(W(pre('Write', { file_path: 'src/b.ts' }))).toEqual(['/r/api/src/b.ts'])
    expect(W(pre('MultiEdit', { file_path: '~/x/c.md' }))).toEqual(['/Users/u/x/c.md'])
    expect(W(pre('NotebookEdit', { notebook_path: '/r/wt/n.ipynb' }))).toEqual(['/r/wt/n.ipynb'])
  })

  it('Bash: git -C, cd relativo, redirecionamento e variáveis do próprio comando', () => {
    const real = 'W=/Users/misael/Documents/weboption/.worktrees/tcheerp/dev2; git -C $W status --short | head -3; git -C $W fetch origin && git -C $W switch -c fix/434 origin/develop 2>&1 | tail -1'
    expect(W(pre('Bash', { command: real }))).toEqual(['/Users/misael/Documents/weboption/.worktrees/tcheerp/dev2'])
    expect(W(pre('Bash', { command: 'cd ../dev2 && npm test' }))).toEqual(['/r/dev2'])
    expect(W(pre('Bash', { command: 'echo x > /r/wt/out.txt; echo y >> "/r/wt/b c.txt"' }))).toEqual(['/r/wt/out.txt', '/r/wt/b c.txt'])
    expect(W(pre('Bash', { command: 'D="/r/wt"; git -C "${D}" add -A' }))).toEqual(['/r/wt'])
  })

  it('não conta leituras nem variáveis indefinidas; só PreToolUse', () => {
    expect(W(pre('Read', { file_path: '/r/wt/a.ts' }))).toEqual([])
    expect(W(pre('Grep', { path: '/r/wt' }))).toEqual([])
    expect(W(pre('Bash', { command: 'cat /r/wt/a.ts | head' }))).toEqual([])
    expect(W(pre('Bash', { command: 'git -C $NAO_DEFINIDA status' }))).toEqual([])
    expect(W({ ...pre('Edit', { file_path: '/r/wt/a.ts' }), hook_event_name: 'PostToolUse' })).toEqual([])
  })

  it('ferramenta desconhecida (Codex) com file_path/path conta; ../ é normalizado', () => {
    expect(W(pre('apply_patch', { path: '/r/wt/x/../y.ts' }))).toEqual(['/r/wt/y.ts'])
  })
})

describe('worktreeOf', () => {
  const wts = ['/r/api', '/r/api/.claude/worktrees/x', '/r/api2']
  it('maior prefixo com fronteira /', () => {
    expect(worktreeOf('/r/api/src/a.ts', wts)).toBe('/r/api')
    expect(worktreeOf('/r/api/.claude/worktrees/x/a.ts', wts)).toBe('/r/api/.claude/worktrees/x')
    expect(worktreeOf('/r/api2/a.ts', wts)).toBe('/r/api2')
    expect(worktreeOf('/r/api', wts)).toBe('/r/api')
    expect(worktreeOf('/outro/a.ts', wts)).toBeNull()
  })
})

describe('nextInference', () => {
  it('1 escrita não troca; 2 seguidas trocam; intercalada zera; voltar 2x para a do shell desfaz', () => {
    let s = nextInference(EMPTY_INFERENCE, '/wt/dev2', '/main')
    expect(s).toEqual({ inferred: null, candidate: { path: '/wt/dev2', count: 1 } })
    s = nextInference(s, '/wt/dev2', '/main')
    expect(s).toEqual({ inferred: '/wt/dev2', candidate: null })
    s = nextInference(s, '/wt/dev2', '/main')
    expect(s).toEqual({ inferred: '/wt/dev2', candidate: null })
    s = nextInference(s, '/main', '/main')
    expect(s.inferred).toBe('/wt/dev2')
    s = nextInference(s, '/wt/dev1', '/main')
    expect(s).toEqual({ inferred: '/wt/dev2', candidate: { path: '/wt/dev1', count: 1 } })
    s = nextInference(nextInference(s, '/main', '/main'), '/main', '/main')
    expect(s).toEqual({ inferred: null, candidate: null })
  })
  it('escrita na efetiva zera o candidato', () => {
    const s = nextInference({ inferred: null, candidate: { path: '/wt/dev2', count: 1 } }, '/main', '/main')
    expect(s).toEqual({ inferred: null, candidate: null })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/agent-worktree.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

`src/daemon/agent-worktree.ts`:

```ts
import path from 'node:path'
import type { HookPayload } from '../shared/types'

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite', 'Task', 'AskUserQuestion'])

function normalize(p: string, cwd: string, home: string): string {
  const expanded = p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p
  return path.resolve(cwd, expanded)
}

const unquote = (s: string) => s.replace(/^(['"])(.*)\1$/, '$2')

/** caminhos de um comando shell que indicam onde ele mexe: git -C, cd, > e >> (variáveis do próprio comando resolvidas) */
function bashTargets(command: string): string[] {
  const vars = new Map<string, string>()
  for (const m of command.matchAll(/(?:^|[;&|\n]\s*)([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s;&|]+)/g)) vars.set(m[1], unquote(m[2]))
  let undefinedVar = false
  const expand = (s: string) =>
    unquote(s).replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, n: string) => {
      const v = vars.get(n)
      if (v === undefined) undefinedVar = true
      return v ?? ''
    })
  const out: string[] = []
  const take = (raw: string) => {
    undefinedVar = false
    const v = expand(raw)
    if (!undefinedVar && v) out.push(v)
  }
  const arg = `("[^"]*"|'[^']*'|[^\\s;&|<>]+)`
  for (const m of command.matchAll(new RegExp(`\\bgit\\s+-C\\s+${arg}`, 'g'))) take(m[1])
  for (const m of command.matchAll(new RegExp(`(?:^|[;&|\\n]\\s*)cd\\s+${arg}`, 'g'))) take(m[1])
  for (const m of command.matchAll(new RegExp(`(?<![0-9&])>>?\\s*${arg}`, 'g'))) {
    if (!/^&?\d$/.test(m[1]) && m[1] !== '/dev/null') take(m[1])
  }
  return out
}

export function writtenPaths(p: HookPayload, cwd: string, home: string): string[] {
  if (p.hook_event_name !== 'PreToolUse') return []
  const tool = typeof p.tool_name === 'string' ? p.tool_name : ''
  const input = (p.tool_input ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : null)
  let raw: string[] = []
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') raw = [str('file_path')].filter((x): x is string => !!x)
  else if (tool === 'NotebookEdit') raw = [str('notebook_path')].filter((x): x is string => !!x)
  else if (tool === 'Bash') raw = bashTargets(str('command') ?? '')
  else if (!READ_TOOLS.has(tool)) raw = [str('file_path') ?? str('path')].filter((x): x is string => !!x)
  return [...new Set(raw.map((r) => normalize(r, cwd, home)))]
}

export function worktreeOf(p: string, worktrees: string[]): string | null {
  let best: string | null = null
  for (const w of worktrees) if ((p === w || p.startsWith(w + '/')) && (!best || w.length > best.length)) best = w
  return best
}

export interface InferenceState {
  inferred: string | null
  candidate: { path: string; count: number } | null
}

export const EMPTY_INFERENCE: InferenceState = { inferred: null, candidate: null }

/** troca com 2 escritas seguidas na mesma worktree diferente da efetiva; escrita na efetiva zera o candidato */
export function nextInference(s: InferenceState, hit: string, shellWorktree: string | null): InferenceState {
  const effective = s.inferred ?? shellWorktree
  if (hit === effective) return { inferred: s.inferred, candidate: null }
  if (s.candidate?.path === hit) {
    if (s.candidate.count + 1 >= 2) return { inferred: hit === shellWorktree ? null : hit, candidate: null }
    return { inferred: s.inferred, candidate: { path: hit, count: s.candidate.count + 1 } }
  }
  return { inferred: s.inferred, candidate: { path: hit, count: 1 } }
}
```

Confira se `HookPayload` tem `tool_input`; se não, acrescente em `src/shared/types.ts` (dentro de `HookPayload`): `tool_input?: Record<string, unknown>` (o índice `[key: string]: unknown` já aceita, mas o tipo explícito ajuda).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/daemon/agent-worktree.test.ts`
Expected: PASS. Se algum caso de Bash falhar, ajuste as regex (não o teste).

- [ ] **Step 5: Commit**

```bash
git add src/daemon/agent-worktree.ts src/shared/types.ts tests/daemon/agent-worktree.test.ts
git commit -m "feat(worktree-agente): dedução pura de onde o agente escreve"
```

---

### Task 2: Dedução no daemon e worktree efetiva no estado

**Files:**
- Modify: `src/daemon/panes.ts`, `src/daemon/daemon.ts`, `src/shared/types.ts`
- Test: `tests/daemon/daemon.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `PaneView.shellWorktreePath?: string | null`; `PaneView.worktreeInferred?: boolean`; `PaneView.worktreePath`/`projectPath` efetivos; `PaneManager.effectiveWorktree(r: PaneRecord): string | null`.

- [ ] **Step 1: Teste que falha**

Em `tests/daemon/daemon.test.ts`, novo teste no `describe` principal:

```ts
  it('worktree do agente: 2 escritas em outra worktree viram a efetiva; SessionStart volta; worktree removida volta', async () => {
    repo = makeRepo()
    const wt = path.join(repo.dir, '.claude', 'worktrees', 'dev2')
    repo.git('worktree', 'add', '-b', 'dev2', wt)
    const { o, app } = await boot()
    await app.client.request({ t: 'project.add', path: repo.dir })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await app.waitState((s) => s.panes.some((p) => p.id === paneId && p.worktreePath === repo!.dir))
    const base = { session_id: 's1', cwd: repo.dir }
    await hook(o, paneId, { ...base, hook_event_name: 'SessionStart', source: 'startup' })
    await hook(o, paneId, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `W="${wt}"; git -C "$W" status` } })
    let st = await app.waitState((s) => s.panes[0]?.claude?.sessionId === 's1')
    expect(st.panes[0]).toMatchObject({ worktreePath: repo.dir })
    await hook(o, paneId, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(wt, 'a.ts') } })
    st = await app.waitState((s) => s.panes[0]?.worktreeInferred === true)
    expect(st.panes[0]).toMatchObject({ worktreePath: wt, shellWorktreePath: repo.dir, projectPath: repo.dir })

    await hook(o, paneId, { ...base, hook_event_name: 'SessionStart', source: 'clear' })
    await app.waitState((s) => s.panes[0]?.worktreeInferred === false && s.panes[0]?.worktreePath === repo!.dir)

    for (let i = 0; i < 2; i++) await hook(o, paneId, { ...base, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(wt, `b${i}.ts`) } })
    await app.waitState((s) => s.panes[0]?.worktreePath === wt)
    repo.git('worktree', 'remove', '--force', wt)
    await app.waitState((s) => s.panes[0]?.worktreePath === repo!.dir && s.panes[0]?.worktreeInferred === false, 15_000)
  })
```

(O repositório de teste tem espaço no nome — "meu projeto" —, por isso o `W` vai entre aspas.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/daemon.test.ts -t "worktree do agente"`
Expected: FAIL (`worktreeInferred` ausente).

- [ ] **Step 3: Implementar**

`src/shared/types.ts` — em `PaneView`, depois de `worktreePath`:

```ts
  /** worktree da pasta do shell (worktreePath é a efetiva: a deduzida pela escrita do agente, se houver) */
  shellWorktreePath?: string | null
  /** worktreePath veio da dedução pelas escritas do agente */
  worktreeInferred?: boolean
```

`src/daemon/panes.ts`:
1. Imports: `import os from 'node:os'` (se ainda não houver) e `import { EMPTY_INFERENCE, nextInference, worktreeOf, writtenPaths, type InferenceState } from './agent-worktree'`.
2. Em `PaneRecord`, depois de `worktreePath`:

```ts
  /** dedução da worktree em que o agente escreve (quando difere da do shell) */
  inference: InferenceState
  /** projeto da worktree deduzida */
  inferredProjectPath: string | null
```

3. No objeto criado em `create`, depois de `worktreePath: null,`: `inference: EMPTY_INFERENCE, inferredProjectPath: null,`.
4. Métodos novos na classe (perto de `relocate`):

```ts
  effectiveWorktree(r: PaneRecord): string | null {
    return r.inference.inferred ?? r.worktreePath
  }

  effectiveProject(r: PaneRecord): string | null {
    return r.inference.inferred ? r.inferredProjectPath : r.projectPath
  }

  private resetInference(rec: PaneRecord): boolean {
    const had = rec.inference.inferred !== null || rec.inference.candidate !== null
    rec.inference = EMPTY_INFERENCE
    rec.inferredProjectPath = null
    return had
  }

  private allWorktrees(): { path: string; project: string }[] {
    return this.d.registry.list().flatMap((c) => this.d.registry.worktrees(c.path).filter((w) => !w.prunable).map((w) => ({ path: w.path, project: c.path })))
  }

  private inferFromHook(rec: PaneRecord, p: HookPayload): boolean {
    const paths = writtenPaths(p, rec.cwd, os.homedir())
    if (paths.length === 0) return false
    const wts = this.allWorktrees()
    const before = rec.inference.inferred
    for (const target of paths) {
      const hit = worktreeOf(target, wts.map((w) => w.path))
      if (hit) rec.inference = nextInference(rec.inference, hit, rec.worktreePath)
    }
    if (rec.inference.inferred === before) return false
    rec.inferredProjectPath = wts.find((w) => w.path === rec.inference.inferred)?.project ?? null
    return true
  }
```

5. Em `applyHook`:
   - logo depois de `rec.claude = reduceSession(...)`:

```ts
    const ev0 = p.hook_event_name
    if (ev0 === 'SessionStart' || ev0 === 'SessionEnd') this.resetInference(rec)
```

   - no bloco de mudança de cwd, troque por:

```ts
    if (p.cwd && p.cwd !== rec.cwd && !p.agent_id) {
      rec.cwd = p.cwd
      this.resetInference(rec)
      await this.relocate(rec)
    }
    if (this.inferFromHook(rec, p)) this.d.onChange()
```

   - na linha do `GIT_HINT_EVENTS`, troque `rec.worktreePath` por `this.effectiveWorktree(rec)` (as duas ocorrências da linha):

```ts
    const eff = this.effectiveWorktree(rec)
    if (eff && GIT_HINT_EVENTS.has(ev)) this.d.onGitHint(eff)
```

6. No poller, onde há `rec.cwd = cwd` seguido de `await this.relocate(rec)`, insira `this.resetInference(rec)` entre os dois.
7. Em `relocate`, logo no início (antes de `const cwd = rec.cwd`), valide a deduzida:

```ts
    if (rec.inference.inferred && !this.allWorktrees().some((w) => w.path === rec.inference.inferred)) {
      this.resetInference(rec)
      this.d.onChange()
    }
```

   (o daemon já chama `relocateAll` quando a lista de worktrees muda; confira em `daemon.ts`: se o refresh periódico de worktrees **não** chama `relocateAll`, acrescente em `ProjectRegistry`'s `onChange` → `this.panes.relocateAll()` — no `init()`, o `new ProjectRegistry(p.projects, () => this.changed())` passa a `() => { this.changed(); void this.panes?.relocateAll() }` — e registre a decisão no ledger.)

`src/daemon/daemon.ts` — em `buildState()`, no mapeamento dos painéis, troque `projectPath: r.projectPath,` e `worktreePath: r.worktreePath,` por:

```ts
        projectPath: this.panes.effectiveProject(r),
        worktreePath: this.panes.effectiveWorktree(r),
        shellWorktreePath: r.worktreePath,
        worktreeInferred: r.inference.inferred !== null,
```

e em `checkRemove`, troque `r.worktreePath === p` por `(r.worktreePath === p || this.panes.effectiveWorktree(r) === p)`.

- [ ] **Step 4: Rodar e ver passar (e a suíte)**

Run: `npx vitest run tests/daemon/daemon.test.ts -t "worktree do agente" && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(worktree-agente): daemon deduz a worktree pelas escritas e publica a efetiva"
```

---

### Task 3: Marca no cabeçalho

**Files:**
- Modify: `src/renderer/src/header.ts`, `src/renderer/src/components/PaneHeader.tsx`
- Test: `tests/renderer/header.test.ts`

**Interfaces:**
- Consumes: `PaneView.worktreeInferred`, `PaneView.shellWorktreePath` (Task 2).
- Produces: `HeaderView.worktreeInferred: boolean`; `HeaderView.shellWorktree: string | null` (rótulo da worktree do shell).

- [ ] **Step 1: Teste que falha**

Em `tests/renderer/header.test.ts`:
- No teste que usa `toEqual` com o objeto completo do `headerView`, acrescente `worktreeInferred: false, shellWorktree: null,` ao objeto esperado.
- Novo teste no `describe('headerView')`:

```ts
  it('worktree deduzida: marca e rótulo da worktree do shell', () => {
    const h = headerView(pane({ worktreePath: '/r/api/.claude/worktrees/auth', shellWorktreePath: '/r/api', worktreeInferred: true }), app)
    expect(h).toMatchObject({ worktree: 'auth', worktreeInferred: true, shellWorktree: 'principal' })
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/renderer/header.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/renderer/src/header.ts`:
- Em `HeaderView`: `worktreeInferred: boolean` e `shellWorktree: string | null`.
- Em `headerView`, no objeto retornado:

```ts
    worktreeInferred: !!pane.worktreeInferred,
    shellWorktree: pane.worktreeInferred
      ? (() => {
          const sw = project?.worktrees.find((w) => w.path === pane.shellWorktreePath)
          return sw ? worktreeLabel(sw) : pane.shellWorktreePath ? tildify(pane.shellWorktreePath, app.userHome) : null
        })()
      : null,
```

`src/renderer/src/components/PaneHeader.tsx` — no `<span className={\`ph-block ph-worktree…\`}>`, troque o conteúdo `⎇ {h.worktree}` por:

```tsx
⎇ {h.worktree}
{h.worktreeInferred ? ' ·' : ''}
```

e adicione ao span `title={h.worktreeInferred ? \`o agente está editando em ${h.worktree}; o shell está em ${h.shellWorktree ?? 'outra pasta'}\` : undefined}`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/renderer/header.test.ts && npm test && npm run typecheck && npm run build`
Expected: PASS e build ok.

- [ ] **Step 5: Commit**

```bash
git add src/renderer tests/renderer
git commit -m "feat(worktree-agente): cabeçalho marca a worktree deduzida"
```

---

### Task 4: Teste real com o usuário

- [ ] Instância isolada (`GT_HOME=/tmp/gt-worktree npm run dev`, Electron baixado na worktree), projeto com uma worktree extra; sessão Claude no principal pedindo para editar arquivos na worktree por caminho absoluto → cabeçalho "⎇ <wt> ·", sidebar com a sessão dentro da worktree; `/clear` volta para a principal. Registrar o resultado.
