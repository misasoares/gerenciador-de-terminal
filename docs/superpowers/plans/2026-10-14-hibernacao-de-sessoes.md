# Hibernação de sessões ociosas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sessões ociosas há N minutos (padrão 30) e fora de foco têm o agente encerrado (liberando ~250–400 MB cada) e voltam com `--resume` no mesmo terminal quando o usuário as foca.

**Architecture:** o daemon ganha um `Hibernator` (regra pura + orquestração com dependências injetadas) que roda a cada 30 s, manda SIGTERM ao processo do agente e marca o `PaneRecord` como hibernado; o shell do painel continua vivo. O renderer de cada janela avisa o daemon do painel em foco (`pane.focus`); foco num painel hibernado faz o daemon digitar o comando da conta com `--resume <id>` no shell. A interface mostra 💤 no cabeçalho, na sidebar e no painel da máquina, e as Preferências ganham o interruptor e os minutos.

**Tech Stack:** TypeScript, Electron (main/renderer/daemon Node), node-pty, React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-10-14-hibernacao-de-sessoes-design.md`

## Global Constraints

- Padrão: hibernação **ligada**, **30 min**; mínimo 5, máximo 240 (passo 5 na interface).
- Nunca hibernar: status ≠ `idle`/`your-turn`; painel em foco em alguma janela; líder (`paneMeta.leader === true`); dev contratado (`paneMeta.createdBy` definido); agente com shell descendente (`sh|bash|zsh|fish|dash`).
- Checagem no máximo a cada 30 s; espera de saída 10 s após SIGTERM, depois SIGKILL; falha → resfriamento de 30 min.
- `waking` expira em 60 s; zera no `SessionStart`/`SessionEnd`.
- Acordar só digita o comando se o shell estiver no prompt (foreground = o próprio shell); senão só tira o 💤.
- Textos da interface em português: "hibernada há N min", "acordando…", "N sessões hibernadas", "Hibernar sessões ociosas".
- Commits semânticos em português (`feat:`/`fix:`/`test:`/`docs:`), na `main` local, sem push (como as fases anteriores).
- Testes: `npx vitest run <arquivo>`; suíte inteira `npm test`; tipos `npm run typecheck`.

## Review Focus

1. Foco chega durante os 10 s de espera do SIGTERM → a sessão hiberna com o usuário olhando; esperado: acorda na hora (teste na Task 3).
2. Dois `pane.focus` quase juntos para o mesmo painel hibernado (janela + flutuante, foco repetido) → esperado: o comando de retomada é digitado **uma** vez (Task 3).
3. Painel fechado/esquecido enquanto espera o agente sair → esperado: nada é gravado num registro morto (Task 3).
4. Filhos não-shell do agente (servidores MCP em `node`) não podem impedir a hibernação; filho shell impede (Task 2).
5. Daemon reiniciado com sessão hibernada → esperado: vira retomável com o `sessionId`, a conta e o agente da hibernação (Task 4).

---

## File Structure

- Create `src/daemon/hibernator.ts` — regra pura (`shouldHibernate`, `hasShellDescendant`), tipo `Hibernation` e classe `Hibernator` (hibernar, acordar, expirar `waking`).
- Modify `src/shared/settings.ts` — `HibernateSettings`, padrão e normalização.
- Modify `src/daemon/panes.ts` — campos novos no `PaneRecord`, `resumeCommand()`, `applyHook` zera `waking`/`hibernated` no `SessionStart`.
- Modify `src/daemon/server.ts` — `Conn.focusedPaneId`.
- Modify `src/shared/protocol.ts` — `pane.focus`.
- Modify `src/shared/types.ts` — `PaneView.hibernated?`, `PaneView.waking?`.
- Modify `src/daemon/daemon.ts` — instancia o `Hibernator`, timer, `pane.focus`, `buildState`, `save`, `openSessions`, opções de teste.
- Create `src/renderer/src/focus-sync.ts` — `FocusReporter` + `startFocusSync()`.
- Modify `src/renderer/src/store.ts` — exporta `subscribeUi`.
- Modify `src/renderer/src/main.tsx` — chama `startFocusSync()` nas duas janelas.
- Modify `src/renderer/src/header.ts` — `DisplayStatus`, `displayStatus()`, `hibernatedLabel()`, `HeaderView.hibernatedSince`.
- Modify `src/renderer/src/sidebar-model.ts` — status de exibição.
- Modify `src/renderer/src/components/PaneHeader.tsx`, `MachineChip.tsx`, `Preferences.tsx`, `styles.css`; Create `src/renderer/src/components/HibernatePrefs.tsx`.
- Tests: `tests/shared/settings.test.ts`, `tests/daemon/hibernator.test.ts` (novo), `tests/daemon/daemon.test.ts`, `tests/renderer/focus-sync.test.ts` (novo), `tests/renderer/header.test.ts`, `tests/renderer/sidebar-model.test.ts`.

---

### Task 1: Configuração `hibernate`

**Files:**
- Modify: `src/shared/settings.ts` (interface `TerminalSettings`, `DEFAULT_SETTINGS`, `normalizeSettings`)
- Test: `tests/shared/settings.test.ts`

**Interfaces:**
- Produces: `interface HibernateSettings { enabled: boolean; minutes: number }`; `TerminalSettings.hibernate: HibernateSettings`; `DEFAULT_SETTINGS.hibernate = { enabled: true, minutes: 30 }`; `normalizeHibernate(v: unknown): HibernateSettings`.

- [ ] **Step 1: Write the failing test** (no fim de `tests/shared/settings.test.ts`)

```ts
import { DEFAULT_SETTINGS, normalizeHibernate, normalizeSettings } from '../../src/shared/settings'

describe('hibernate', () => {
  it('padrão ligado com 30 min', () => {
    expect(DEFAULT_SETTINGS.hibernate).toEqual({ enabled: true, minutes: 30 })
    expect(normalizeSettings(undefined).hibernate).toEqual({ enabled: true, minutes: 30 })
  })
  it('normaliza valores inválidos e limita a 5–240', () => {
    expect(normalizeHibernate({ enabled: 'sim', minutes: 'x' })).toEqual({ enabled: true, minutes: 30 })
    expect(normalizeHibernate({ enabled: false, minutes: 1 })).toEqual({ enabled: false, minutes: 5 })
    expect(normalizeHibernate({ enabled: true, minutes: 999 })).toEqual({ enabled: true, minutes: 240 })
    expect(normalizeHibernate({ minutes: 47.6 })).toEqual({ enabled: true, minutes: 48 })
    expect(normalizeHibernate(null)).toEqual({ enabled: true, minutes: 30 })
  })
})
```

(Se o arquivo já importa de `../../src/shared/settings`, junte os nomes no import existente em vez de duplicar.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/settings.test.ts`
Expected: FAIL — `normalizeHibernate is not a function` / `hibernate` indefinido.

- [ ] **Step 3: Write minimal implementation** em `src/shared/settings.ts`

Logo acima de `export interface TerminalSettings`:

```ts
/** encerra o agente de sessões ociosas e retoma ao focar */
export interface HibernateSettings {
  enabled: boolean
  /** minutos ociosa (⚪/🔵) e fora de foco até hibernar */
  minutes: number
}
```

Em `TerminalSettings`, depois de `machine: MachineLimits`:

```ts
  /** hibernação de sessões ociosas */
  hibernate: HibernateSettings
```

Em `DEFAULT_SETTINGS`, depois de `machine: {...}`:

```ts
  hibernate: { enabled: true, minutes: 30 },
```

Depois de `normalizeMachineLimits`:

```ts
export function normalizeHibernate(v: unknown): HibernateSettings {
  const d = DEFAULT_SETTINGS.hibernate
  const h = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    enabled: typeof h.enabled === 'boolean' ? h.enabled : d.enabled,
    minutes: typeof h.minutes === 'number' && Number.isFinite(h.minutes) ? clamp(Math.round(h.minutes), 5, 240) : d.minutes,
  }
}
```

Em `normalizeSettings`, depois de `machine: normalizeMachineLimits(v.machine),`:

```ts
    hibernate: normalizeHibernate(v.hibernate),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/shared/settings.test.ts tests/shared/machine-settings.test.ts`
Expected: PASS. Se algum teste existente compara um objeto de settings literal completo, inclua `hibernate: { enabled: true, minutes: 30 }` nele.

- [ ] **Step 5: Commit**

```bash
git add src/shared/settings.ts tests/shared/settings.test.ts
git commit -m "feat(hibernacao): configuração hibernate (ligada, 30 min)"
```

---

### Task 2: Regra pura de hibernação

**Files:**
- Create: `src/daemon/hibernator.ts`
- Test: `tests/daemon/hibernator.test.ts`

**Interfaces:**
- Consumes: `descendants`, `Proc` de `src/daemon/platform/procs.ts`; `SessionStatus`, `AgentKind` de `src/shared/types.ts`.
- Produces:
  - `interface Hibernation { sessionId: string; agent: AgentKind; accountId: string | null; transcriptPath: string | null; since: number }`
  - `interface Candidate { status: SessionStatus | null; statusSince: number; focused: boolean; leader: boolean; hired: boolean; shellBusy: boolean; hibernated: boolean; waking: boolean; cooldownUntil: number }`
  - `shouldHibernate(c: Candidate, now: number, thresholdMs: number): boolean`
  - `hasShellDescendant(procs: Proc[], pid: number): boolean`

- [ ] **Step 1: Write the failing test** — `tests/daemon/hibernator.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { hasShellDescendant, shouldHibernate, type Candidate } from '../../src/daemon/hibernator'
import type { Proc } from '../../src/daemon/platform/procs'

const T = 30 * 60_000
const base: Candidate = { status: 'your-turn', statusSince: 0, focused: false, leader: false, hired: false, shellBusy: false, hibernated: false, waking: false, cooldownUntil: 0 }

describe('shouldHibernate', () => {
  it('ociosa além do limite e fora de foco: hiberna (⚪ e 🔵)', () => {
    expect(shouldHibernate(base, T, T)).toBe(true)
    expect(shouldHibernate({ ...base, status: 'idle' }, T, T)).toBe(true)
  })
  it('antes do limite não hiberna', () => {
    expect(shouldHibernate(base, T - 1, T)).toBe(false)
  })
  it('trabalhando, pedindo permissão ou sem agente não hiberna', () => {
    expect(shouldHibernate({ ...base, status: 'working' }, T, T)).toBe(false)
    expect(shouldHibernate({ ...base, status: 'needs-you' }, T, T)).toBe(false)
    expect(shouldHibernate({ ...base, status: null }, T, T)).toBe(false)
  })
  it('foco, líder, contratado, shell ocupado, já hibernada ou acordando não hiberna', () => {
    for (const k of ['focused', 'leader', 'hired', 'shellBusy', 'hibernated', 'waking'] as const) {
      expect(shouldHibernate({ ...base, [k]: true }, T, T)).toBe(false)
    }
  })
  it('respeita o resfriamento', () => {
    expect(shouldHibernate({ ...base, cooldownUntil: T + 1 }, T, T)).toBe(false)
    expect(shouldHibernate({ ...base, cooldownUntil: T }, T, T)).toBe(true)
  })
})

describe('hasShellDescendant', () => {
  const p = (pid: number, ppid: number, args: string): Proc => ({ pid, ppid, stat: 'S', args })
  it('MCP em node não conta; shell do Bash (mesmo neto) conta', () => {
    const procs = [p(10, 1, 'claude --resume x'), p(11, 10, 'node /x/playwright-mcp/cli.js'), p(12, 10, '/bin/zsh -c source snap.sh && npm run dev'), p(13, 12, 'node server.js')]
    expect(hasShellDescendant(procs, 10)).toBe(true)
    expect(hasShellDescendant(procs.filter((x) => x.pid !== 12 && x.pid !== 13), 10)).toBe(false)
  })
  it('reconhece sh, bash, -zsh e fish; não confunde nomes parecidos', () => {
    for (const a of ['sh -c x', '/bin/bash -lc y', '-zsh', '/opt/homebrew/bin/fish -c z', 'dash']) {
      expect(hasShellDescendant([p(1, 0, 'claude'), p(2, 1, a)], 1)).toBe(true)
    }
    expect(hasShellDescendant([p(1, 0, 'claude'), p(2, 1, 'node /x/shellcheck.js'), p(3, 1, 'zshdb')], 1)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/hibernator.test.ts`
Expected: FAIL — módulo `src/daemon/hibernator` não existe.

- [ ] **Step 3: Write minimal implementation** — `src/daemon/hibernator.ts`

```ts
import type { AgentKind, SessionStatus } from '../shared/types'
import { descendants, type Proc } from './platform/procs'

/** sessão cujo agente foi encerrado para liberar memória; o shell do painel continua vivo */
export interface Hibernation {
  sessionId: string
  agent: AgentKind
  accountId: string | null
  transcriptPath: string | null
  /** epoch ms em que hibernou */
  since: number
}

export interface Candidate {
  status: SessionStatus | null
  statusSince: number
  focused: boolean
  leader: boolean
  hired: boolean
  /** há shell entre os descendentes do agente (comando do Bash/Monitor rodando) */
  shellBusy: boolean
  hibernated: boolean
  waking: boolean
  cooldownUntil: number
}

export function shouldHibernate(c: Candidate, now: number, thresholdMs: number): boolean {
  if (c.status !== 'idle' && c.status !== 'your-turn') return false
  if (now - c.statusSince < thresholdMs) return false
  // líder e devs contratados conversam pelo SendMessage nativo, que só alcança sessões vivas
  if (c.focused || c.leader || c.hired || c.shellBusy || c.hibernated || c.waking) return false
  return now >= c.cooldownUntil
}

// 1º token do comando: sh, bash, zsh, fish ou dash (com caminho ou "-" de shell de login)
const SHELL_RE = /^(\S*\/)?-?(sh|bash|zsh|fish|dash)(\s|$)/

/** a ferramenta Bash do Claude (e os comandos do Codex) sempre rodam dentro de um shell */
export function hasShellDescendant(procs: Proc[], pid: number): boolean {
  return descendants(procs, pid).some((p) => SHELL_RE.test(p.args))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/daemon/hibernator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/hibernator.ts tests/daemon/hibernator.test.ts
git commit -m "feat(hibernacao): regra pura de quando hibernar uma sessão"
```

---

### Task 3: `Hibernator` — hibernar, acordar e expirar

**Files:**
- Modify: `src/daemon/hibernator.ts`
- Modify: `src/daemon/panes.ts` (`PaneRecord`, `create`, `applyHook`, novo `resumeCommand`)
- Test: `tests/daemon/hibernator.test.ts`

**Interfaces:**
- Consumes: Task 2 (`Hibernation`, `shouldHibernate`, `hasShellDescendant`); `findAgent`, `foregroundOf`, `Proc` de `platform/procs.ts`; `buildCommand`, `resumeAccount` de `accounts.ts`.
- Produces:
  - `PaneRecord` ganha `hibernated: Hibernation | null`, `waking: { since: number } | null`, `hibernateCooldownUntil: number`.
  - `PaneManager.resumeCommand(h: Hibernation): string`.
  - `interface HibernatorDeps` (abaixo) e `class Hibernator { tick(): Promise<void>; wake(paneId: string): Promise<boolean> }`.

- [ ] **Step 1: Campos novos no `PaneRecord` e `resumeCommand`** (`src/daemon/panes.ts`)

Import no topo: `import type { Hibernation } from './hibernator'`.

No `interface PaneRecord`, depois de `workspaceId: string`:

```ts
  /** agente encerrado por ociosidade; o shell segue vivo (null = não hibernada) */
  hibernated: Hibernation | null
  /** comando de retomada digitado, esperando o SessionStart */
  waking: { since: number } | null
  /** não tenta hibernar antes disso (falha anterior) */
  hibernateCooldownUntil: number
```

No objeto `rec` de `create()`, depois de `workspaceId: ...`:

```ts
      hibernated: null,
      waking: null,
      hibernateCooldownUntil: 0,
```

Em `applyHook`, logo depois de `rec.claude = reduceSession(...)`:

```ts
    // agente subiu (retomada ou digitado na mão) ou saiu: não está mais hibernada nem acordando
    if (p.hook_event_name === 'SessionStart' || p.hook_event_name === 'SessionEnd') rec.waking = null
    if (p.hook_event_name === 'SessionStart') rec.hibernated = null
```

Novo método público em `PaneManager` (depois de `kill`):

```ts
  /** comando da conta da sessão hibernada com --resume (mesmo --mcp-config das sessões novas) */
  resumeCommand(h: Hibernation): string {
    const accounts = this.d.accounts()
    const account = (h.accountId ? accounts.find((a) => a.id === h.accountId) : undefined) ?? resumeAccount(accounts, h.agent)
    return buildCommand(account, h.sessionId, { mcpConfig: this.d.mcpConfigPath })
  }
```

Run: `npx vitest run tests/daemon/daemon.test.ts tests/daemon/session.test.ts`
Expected: PASS (nada muda de comportamento ainda).

- [ ] **Step 2: Write the failing tests** (acrescente em `tests/daemon/hibernator.test.ts`)

```ts
import { Hibernator, type HibernatorDeps, type Hibernation } from '../../src/daemon/hibernator'
import type { PaneRecord } from '../../src/daemon/panes'
import { EMPTY_INFERENCE } from '../../src/daemon/agent-worktree'
import type { ClaudeSession } from '../../src/shared/types'

const MIN = 60_000

function rec(id: string, claude: Partial<ClaudeSession> | null = {}): PaneRecord {
  return {
    id, seq: 1, cwd: '/p', alive: true, exitCode: null, launchedAccountId: 'misa', accountId: 'misa', configDir: null, claudeArgv: null,
    claude: claude && { sessionId: `s-${id}`, agent: 'claude', status: 'your-turn', statusSince: 0, title: null, transcriptPath: `/t/${id}.jsonl`, ...claude },
    missingPolls: 0, projectPath: null, worktreePath: null, inference: EMPTY_INFERENCE, inferredProjectPath: null,
    agentProcSince: null, lastHookAt: 0, agentHooksMissing: false, workspaceId: 'principal', hibernated: null, waking: null, hibernateCooldownUntil: 0,
  }
}

/** shell 100+i com o agente 200+i; ignoreTerm = agente que não sai com SIGTERM */
function world(recs: PaneRecord[], o: { now?: number; focused?: string[]; extraProcs?: Proc[]; ignoreTerm?: boolean; ignoreKill?: boolean } = {}) {
  const alive = new Set(recs.map((_, i) => 200 + i))
  const signals: [number, string][] = []
  const writes: [string, string][] = []
  let now = o.now ?? 31 * MIN
  const focused = new Set(o.focused ?? [])
  const procs = (): Proc[] => [
    ...recs.map((_, i) => ({ pid: 100 + i, ppid: 1, stat: alive.has(200 + i) ? 'Ss' : 'Ss+', args: '/bin/zsh -il' })),
    ...recs.flatMap((_, i) => (alive.has(200 + i) ? [{ pid: 200 + i, ppid: 100 + i, stat: 'S+', args: 'claude --resume x' }] : [])),
    ...(o.extraProcs ?? []),
  ]
  const deps: HibernatorDeps = {
    records: () => recs,
    shellPid: (id) => 100 + recs.findIndex((r) => r.id === id),
    write: (id, data) => writes.push([id, data]),
    resumeCommand: (h: Hibernation) => `claude --resume ${h.sessionId}`,
    settings: () => ({ enabled: true, minutes: 30 }),
    meta: () => ({ leader: false, hired: false }),
    focused: () => focused,
    onChange: () => {},
    snapshot: async () => procs(),
    signal: (pid, sig) => {
      signals.push([pid, sig])
      if (sig === 'SIGTERM' && !o.ignoreTerm) alive.delete(pid)
      if (sig === 'SIGKILL' && !o.ignoreKill) alive.delete(pid)
    },
    exists: (pid) => alive.has(pid),
    now: () => now,
    sleep: async (ms) => { now += ms },
  }
  return { h: new Hibernator(deps), signals, writes, focused, alive, setNow: (n: number) => (now = n), deps }
}

describe('Hibernator', () => {
  it('hiberna a ociosa: SIGTERM no agente e grava sessão, conta e transcript', async () => {
    const r = rec('a')
    const w = world([r])
    await w.h.tick()
    expect(w.signals).toEqual([[200, 'SIGTERM']])
    expect(r.hibernated).toMatchObject({ sessionId: 's-a', agent: 'claude', accountId: 'misa', transcriptPath: '/t/a.jsonl' })
    expect(r.alive).toBe(true)
  })

  it('desligada, em foco ou com shell descendente não hiberna', async () => {
    const off = world([rec('a')])
    off.deps.settings = () => ({ enabled: false, minutes: 30 })
    await off.h.tick()
    expect(off.signals).toEqual([])
    const foc = world([rec('a')], { focused: ['a'] })
    await foc.h.tick()
    expect(foc.signals).toEqual([])
    const busy = world([rec('a')], { extraProcs: [{ pid: 300, ppid: 200, stat: 'S', args: '/bin/zsh -c npm run dev' }] })
    await busy.h.tick()
    expect(busy.signals).toEqual([])
  })

  it('agente que ignora SIGTERM leva SIGKILL; se nem assim sai, resfria 30 min', async () => {
    const r = rec('a')
    const w = world([r], { ignoreTerm: true })
    await w.h.tick()
    expect(w.signals).toEqual([[200, 'SIGTERM'], [200, 'SIGKILL']])
    expect(r.hibernated).not.toBeNull()

    const r2 = rec('b')
    const w2 = world([r2], { ignoreTerm: true, ignoreKill: true })
    await w2.h.tick()
    expect(r2.hibernated).toBeNull()
    expect(r2.hibernateCooldownUntil).toBeGreaterThan(31 * MIN + 29 * MIN)
  })

  it('atividade durante a espera cancela: sem SIGKILL e sem hibernar', async () => {
    const r = rec('a')
    const w = world([r], { ignoreTerm: true })
    w.deps.sleep = async () => {
      r.claude = { ...r.claude!, status: 'working' }
    }
    await w.h.tick()
    expect(w.signals).toEqual([[200, 'SIGTERM']])
    expect(r.hibernated).toBeNull()
  })

  it('painel fechado durante a espera: não grava nada', async () => {
    const r = rec('a')
    const w = world([r], { ignoreTerm: true })
    w.deps.sleep = async () => {
      r.alive = false
    }
    await w.h.tick()
    expect(r.hibernated).toBeNull()
  })

  it('acorda: digita o comando no shell ocioso, marca waking e corrige a conta', async () => {
    const r = rec('a')
    const w = world([r])
    await w.h.tick()
    r.accountId = null
    expect(await w.h.wake('a')).toBe(true)
    expect(w.writes).toEqual([['a', 'claude --resume s-a\r']])
    expect(r.hibernated).toBeNull()
    expect(r.waking).not.toBeNull()
    expect(r.accountId).toBe('misa')
  })

  it('dois focos juntos digitam o comando uma vez só', async () => {
    const r = rec('a')
    const w = world([r])
    await w.h.tick()
    await Promise.all([w.h.wake('a'), w.h.wake('a')])
    expect(w.writes).toHaveLength(1)
  })

  it('shell ocupado: não digita, só tira o 💤', async () => {
    const r = rec('a')
    const w = world([r], { extraProcs: [{ pid: 400, ppid: 100, stat: 'S+', args: 'vim x' }] })
    await w.h.tick()
    expect(await w.h.wake('a')).toBe(false)
    expect(w.writes).toEqual([])
    expect(r.hibernated).toBeNull()
    expect(r.waking).toBeNull()
  })

  it('foco chega durante a espera: hiberna e acorda em seguida', async () => {
    const r = rec('a')
    const w = world([r], { ignoreTerm: true })
    w.deps.sleep = async () => {
      w.focused.add('a')
    }
    await w.h.tick()
    expect(w.writes).toEqual([['a', 'claude --resume s-a\r']])
    expect(r.hibernated).toBeNull()
    expect(r.waking).not.toBeNull()
  })

  it('waking expira em 60 s', async () => {
    const r = rec('a', null)
    r.waking = { since: 0 }
    const w = world([r], { now: 61_000 })
    await w.h.tick()
    expect(r.waking).toBeNull()
  })
})
```

Ajuste o import de `Proc` no topo do arquivo se ainda não existir (`import type { Proc } from '../../src/daemon/platform/procs'` já está na Task 2).

Observação sobre o teste do foco durante a espera: o agente ignora SIGTERM, então o laço espera; o `sleep` falso adiciona o foco; depois do SIGKILL o agente sai, a hibernação é gravada e, como o painel está em foco, `wake` roda na sequência.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/daemon/hibernator.test.ts`
Expected: FAIL — `Hibernator` não exportado.

- [ ] **Step 4: Write implementation** (acrescente em `src/daemon/hibernator.ts`)

Ajuste o import do topo para:

```ts
import type { AgentKind, SessionStatus } from '../shared/types'
import { descendants, findAgent, foregroundOf, type Proc } from './platform/procs'
import type { PaneRecord } from './panes'
```

E no fim do arquivo:

```ts
export interface HibernatorDeps {
  records(): PaneRecord[]
  /** pid do shell do painel */
  shellPid(id: string): number | undefined
  write(id: string, data: string): void
  resumeCommand(h: Hibernation): string
  settings(): { enabled: boolean; minutes: number }
  /** sobrescreve minutes × 60 000 (testes) */
  thresholdMs?: number
  meta(id: string): { leader: boolean; hired: boolean }
  /** painéis em foco em alguma janela */
  focused(): Set<string>
  onChange(): void
  snapshot(): Promise<Proc[]>
  signal(pid: number, sig: 'SIGTERM' | 'SIGKILL'): void
  exists(pid: number): boolean
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  graceMs?: number
  cooldownMs?: number
  wakingTimeoutMs?: number
}

const STEP_MS = 250

export class Hibernator {
  /** painéis com hibernação ou despertar em andamento */
  private busy = new Set<string>()

  constructor(private d: HibernatorDeps) {}

  private now(): number {
    return (this.d.now ?? Date.now)()
  }

  private sleep(ms: number): Promise<void> {
    return this.d.sleep ? this.d.sleep(ms) : new Promise((res) => setTimeout(res, ms))
  }

  private candidate(r: PaneRecord, shellBusy: boolean): Candidate {
    const m = this.d.meta(r.id)
    return {
      status: r.claude?.status ?? null,
      statusSince: r.claude?.statusSince ?? 0,
      focused: this.d.focused().has(r.id),
      leader: m.leader,
      hired: m.hired,
      shellBusy,
      hibernated: r.hibernated !== null,
      waking: r.waking !== null,
      cooldownUntil: r.hibernateCooldownUntil,
    }
  }

  async tick(): Promise<void> {
    const now = this.now()
    let expired = false
    for (const r of this.d.records()) {
      if (r.waking && now - r.waking.since > (this.d.wakingTimeoutMs ?? 60_000)) {
        r.waking = null
        expired = true
      }
    }
    if (expired) this.d.onChange()
    const s = this.d.settings()
    if (!s.enabled) return
    const threshold = this.d.thresholdMs ?? s.minutes * 60_000
    const pre = this.d.records().filter((r) => r.alive && r.claude && !this.busy.has(r.id) && shouldHibernate(this.candidate(r, false), now, threshold))
    if (pre.length === 0) return
    const procs = await this.d.snapshot()
    if (procs.length === 0) return // ps falhou: não dá para saber se há comando rodando
    await Promise.all(
      pre.map(async (r) => {
        const shell = this.d.shellPid(r.id)
        const agent = shell ? findAgent(procs, shell) : null
        if (!agent) return
        // reconfere logo antes do SIGTERM: o status pode ter mudado enquanto o ps rodava
        if (!shouldHibernate(this.candidate(r, hasShellDescendant(procs, agent.proc.pid)), this.now(), threshold)) return
        await this.hibernate(r, agent.proc.pid)
      }),
    )
  }

  private async hibernate(r: PaneRecord, pid: number): Promise<void> {
    const c = r.claude
    if (!c) return
    this.busy.add(r.id)
    const h: Hibernation = { sessionId: c.sessionId, agent: c.agent, accountId: r.accountId ?? r.launchedAccountId, transcriptPath: c.transcriptPath, since: this.now() }
    const active = () => r.claude?.status === 'working' || r.claude?.status === 'needs-you'
    try {
      this.d.signal(pid, 'SIGTERM')
      const grace = this.d.graceMs ?? 10_000
      for (let waited = 0; waited < grace && this.d.exists(pid); waited += STEP_MS) {
        await this.sleep(STEP_MS)
        if (active() || !r.alive) return
      }
      if (this.d.exists(pid)) {
        this.d.signal(pid, 'SIGKILL')
        await this.sleep(STEP_MS)
        if (this.d.exists(pid)) {
          r.hibernateCooldownUntil = this.now() + (this.d.cooldownMs ?? 30 * 60_000)
          return
        }
      }
      if (!r.alive) return
      r.hibernated = h
      this.d.onChange()
    } finally {
      this.busy.delete(r.id)
    }
    // o usuário focou enquanto o agente saía: acorda já
    if (r.hibernated && this.d.focused().has(r.id)) await this.wake(r.id)
  }

  /** true = digitou o comando de retomada; false = não estava hibernada ou o shell estava ocupado */
  async wake(paneId: string): Promise<boolean> {
    const r = this.d.records().find((x) => x.id === paneId)
    if (!r?.alive || !r.hibernated || this.busy.has(r.id)) return false
    const h = r.hibernated
    r.hibernated = null // antes do await: um 2º foco simultâneo não digita de novo
    this.busy.add(r.id)
    try {
      const shell = this.d.shellPid(r.id)
      const procs = shell ? await this.d.snapshot() : []
      const atPrompt = shell !== undefined && procs.length > 0 && foregroundOf(procs, shell)?.pid === shell
      if (atPrompt) {
        r.launchedAccountId = h.accountId
        r.accountId = h.accountId
        this.d.write(r.id, this.d.resumeCommand(h) + '\r')
        r.waking = { since: this.now() }
      }
      this.d.onChange()
      return atPrompt
    } finally {
      this.busy.delete(r.id)
    }
  }
}
```

Atenção: no laço de espera, o teste "atividade durante a espera" muda o status dentro do `sleep`; por isso a checagem `active()` vem **depois** do `await this.sleep`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/daemon/hibernator.test.ts`
Expected: PASS (todos os casos da Task 2 e 3).

- [ ] **Step 6: Commit**

```bash
git add src/daemon/hibernator.ts src/daemon/panes.ts tests/daemon/hibernator.test.ts
git commit -m "feat(hibernacao): Hibernator encerra o agente ocioso e retoma ao acordar"
```

---

### Task 4: Ligar no daemon (foco, timer, estado, persistência)

**Files:**
- Modify: `src/daemon/server.ts` (`Conn`)
- Modify: `src/shared/protocol.ts` (`ClientRequest`)
- Modify: `src/shared/types.ts` (`PaneView`)
- Modify: `src/daemon/daemon.ts` (`DaemonOptions`, `init`, `stop`, `handle`, `buildState`, `save`, `openSessions`)
- Test: `tests/daemon/daemon.test.ts`

**Interfaces:**
- Consumes: Task 1 (`settings.hibernate`), Task 3 (`Hibernator`, `PaneManager.resumeCommand`, campos do `PaneRecord`).
- Produces: request `{ t: 'pane.focus'; paneId: string | null }`; `PaneView.hibernated?: { since: number } | null`; `PaneView.waking?: boolean`; `DaemonOptions.hibernateThresholdMs?: number`, `DaemonOptions.hibernateCheckMs?: number`.

- [ ] **Step 1: Write the failing tests** (em `tests/daemon/daemon.test.ts`, dentro do `describe` principal, depois do teste "reinício do daemon: painéis vivos viram retomáveis com o mesmo id")

Helper perto de `fakeCodexConv`:

```ts
/** `claude` falso no PATH: imprime os argumentos e espera; sai com SIGTERM */
function fakeAgentEnv(home: string): Record<string, string> {
  const bin = path.join(home, 'fakebin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'claude'), "#!/bin/sh\necho \"fake-claude $*\"\ntrap 'exit 143' TERM\nwhile :; do sleep 0.2; done\n", { mode: 0o755 })
  return { PATH: `${bin}:${process.env.PATH}`, HOME: path.join(home, 'user') }
}
```

Testes:

```ts
  it('hibernação: sessão ociosa hiberna e acorda com --resume ao focar', async () => {
    repo = makeRepo()
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-d-')))
    const { o, app } = await boot({ env: fakeAgentEnv(home), pollMs: 200, hibernateCheckMs: 100, hibernateThresholdMs: 300 }, home)
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: 'misa', cols: 80, rows: 24 })
    const { snapshot } = await app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId })
    await waitFor(() => (snapshot + app.output(paneId)).includes('fake-claude'))
    await hook(o, paneId, { hook_event_name: 'SessionStart', session_id: 'feed-0001', cwd: repo.dir, source: 'startup' })
    await hook(o, paneId, { hook_event_name: 'Stop', session_id: 'feed-0001', cwd: repo.dir })

    const st = await app.waitState((s) => !!s.panes[0]?.hibernated)
    expect(st.panes[0].alive).toBe(true)

    app.client.send({ t: 'pane.focus', paneId })
    await app.waitState((s) => !s.panes[0]?.hibernated && s.panes[0]?.waking === true)
    await waitFor(() => (snapshot + app.output(paneId)).includes('fake-claude --resume feed-0001'))
    await hook(o, paneId, { hook_event_name: 'SessionStart', session_id: 'feed-0001', cwd: repo.dir, source: 'resume' })
    await app.waitState((s) => s.panes[0]?.waking === false && s.panes[0]?.claude?.sessionId === 'feed-0001')
  })

  it('hibernação: painel em foco ou líder não hiberna', async () => {
    repo = makeRepo()
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-d-')))
    const { o, app } = await boot({ env: fakeAgentEnv(home), pollMs: 200, hibernateCheckMs: 100, hibernateThresholdMs: 300 }, home)
    const mk = async () => (await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo!.dir, accountId: 'misa', cols: 80, rows: 24 })).paneId
    const focused = await mk()
    const leader = await mk()
    app.client.send({ t: 'pane.focus', paneId: focused })
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    for (const [id, s] of [[focused, 'f-1'], [leader, 'l-1']]) {
      await hook(o, id, { hook_event_name: 'SessionStart', session_id: s, cwd: repo.dir, source: 'startup' })
      await hook(o, id, { hook_event_name: 'Stop', session_id: s, cwd: repo.dir })
    }
    await new Promise((r) => setTimeout(r, 1500))
    const st = app.state()!
    expect(st.panes.every((p) => !p.hibernated)).toBe(true)
  })

  it('reinício do daemon: sessão hibernada vira retomável com a sessão da hibernação', async () => {
    repo = makeRepo()
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-d-')))
    const first = await boot({ env: fakeAgentEnv(home), pollMs: 200, hibernateCheckMs: 100, hibernateThresholdMs: 300 }, home)
    const { paneId } = await first.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: 'misa', cols: 80, rows: 24 })
    await hook(first.o, paneId, { hook_event_name: 'SessionStart', session_id: 'beef-0002', cwd: repo.dir, source: 'startup' })
    await hook(first.o, paneId, { hook_event_name: 'Stop', session_id: 'beef-0002', cwd: repo.dir })
    await first.app.waitState((s) => !!s.panes[0]?.hibernated)
    first.app.client.close()
    await first.d.stop(true)
    daemons = []

    const second = await boot({}, home)
    const st = await second.app.waitState((s) => s.resumable.length === 1)
    expect(st.resumable[0]).toMatchObject({ paneId, accountId: 'misa', sessionId: 'beef-0002', agent: 'claude' })
  })
```

Os testes usam a conta `misa` (comando `claude`, que o PATH falso resolve para o agente falso); outra conta digitaria um comando inexistente e o poll zeraria a sessão.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/daemon/daemon.test.ts -t "hiberna"`
Expected: FAIL — `pane.focus` desconhecido / `hibernated` indefinido / timeout no `waitState`.

- [ ] **Step 3: Implementation**

`src/daemon/server.ts` — no `interface Conn`, depois de `subscriptions`:

```ts
  /** painel focado nesta janela (null = janela sem foco) */
  focusedPaneId: string | null
```

e no objeto `conn` criado em `startServer`, depois de `subscriptions: new Map(),`:

```ts
      focusedPaneId: null,
```

`src/shared/protocol.ts` — no union `ClientRequest`, depois de `{ t: 'pane.seen'; paneId: string }`:

```ts
  | { t: 'pane.focus'; paneId: string | null }
```

`src/shared/types.ts` — no `interface PaneView`, depois de `agentHooksMissing: boolean`:

```ts
  /** agente encerrado por ociosidade (💤); ausente/null = não */
  hibernated?: { since: number } | null
  /** comando de retomada digitado, esperando o agente subir */
  waking?: boolean
```

`src/daemon/daemon.ts`:

1. Imports: `import { Hibernator } from './hibernator'` e, se ainda não importado, `import { snapshotProcs } from './platform/procs'`.
2. Em `DaemonOptions`, junto de `pollMs?`:

```ts
  /** intervalo da checagem de hibernação (padrão 30 s) */
  hibernateCheckMs?: number
  /** sobrescreve os minutos das Preferências (testes) */
  hibernateThresholdMs?: number
```

3. Campos da classe, junto de `pollTimer`: `private hibernator!: Hibernator` e `private hibernateTimer: NodeJS.Timeout | null = null`.
4. Em `init()`, logo depois de `this.pollTimer = setInterval(...)`:

```ts
    this.hibernator = new Hibernator({
      records: () => this.panes.records(),
      shellPid: (id) => this.panes.host.pid(id),
      write: (id, data) => this.panes.write(id, data),
      resumeCommand: (h) => this.panes.resumeCommand(h),
      settings: () => this.persisted.settings.hibernate,
      thresholdMs: this.o.hibernateThresholdMs,
      meta: (id) => ({ leader: this.persisted.paneMeta[id]?.leader === true, hired: !!this.persisted.paneMeta[id]?.createdBy }),
      focused: () => new Set([...(this.server?.conns ?? [])].flatMap((c) => (c.role === 'app' && c.focusedPaneId ? [c.focusedPaneId] : []))),
      onChange: () => this.changed(),
      snapshot: snapshotProcs,
      signal: (pid, sig) => {
        try {
          process.kill(pid, sig)
        } catch {
          // já saiu
        }
      },
      exists: (pid) => {
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      },
    })
    this.hibernateTimer = setInterval(() => {
      this.hibernator.tick().catch((e) => console.error('hibernação falhou', e))
    }, this.o.hibernateCheckMs ?? 30_000)
```

5. Em `stop()`, junto de `if (this.pollTimer) clearInterval(this.pollTimer)`: `if (this.hibernateTimer) clearInterval(this.hibernateTimer)`.
6. Em `handle()`, depois do `case 'pane.seen'`:

```ts
      case 'pane.focus':
        conn.focusedPaneId = req.paneId
        if (req.paneId) await this.hibernator.wake(req.paneId)
        return null
```

7. Em `buildState`, no `panes: records...map((r) => ({ ... }))`, depois de `agentHooksMissing: r.agentHooksMissing,`:

```ts
        hibernated: r.hibernated ? { since: r.hibernated.since } : null,
        waking: r.waking !== null,
```

8. Em `save()`, troque o `.map(...)` dos painéis por:

```ts
        .map((r) => {
          // hibernada: o agente não está rodando, a sessão a retomar é a da hibernação
          const h = r.hibernated
          return {
            id: r.id,
            cwd: r.cwd,
            accountId: h ? h.accountId : r.accountId,
            sessionId: r.claude?.sessionId ?? h?.sessionId ?? null,
            agent: r.claude?.agent ?? h?.agent ?? 'claude',
            transcriptPath: r.claude?.transcriptPath ?? h?.transcriptPath ?? null,
            workspaceId: r.workspaceId,
          }
        }),
```

9. Em `openSessions` (no `new ConversationIndex`):

```ts
      // hibernada conta como aberta: "Focar" leva ao painel (que acorda) em vez de abrir duplicata
      openSessions: () => new Map(this.panes.records().filter((r) => r.alive && (r.claude || r.hibernated)).map((r) => [r.claude?.sessionId ?? r.hibernated!.sessionId, r.id])),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/daemon/daemon.test.ts`
Expected: PASS (os 3 novos e todos os antigos).

- [ ] **Step 5: Typecheck e commit**

Run: `npm run typecheck`
Expected: sem erros.

```bash
git add src/daemon/server.ts src/shared/protocol.ts src/shared/types.ts src/daemon/daemon.ts tests/daemon/daemon.test.ts
git commit -m "feat(hibernacao): daemon hiberna sessões ociosas e acorda pelo foco da janela"
```

---

### Task 5: Renderer avisa o painel em foco

**Files:**
- Create: `src/renderer/src/focus-sync.ts`
- Modify: `src/renderer/src/store.ts` (exporta `subscribeUi`)
- Modify: `src/renderer/src/main.tsx` (`bootWorkspace` e `bootFloat`)
- Test: `tests/renderer/focus-sync.test.ts`

**Interfaces:**
- Consumes: request `pane.focus` (Task 4); `getUi`, `UiState.focusedPaneId`, `UiState.connected`.
- Produces: `class FocusReporter { report(paneId: string | null, windowFocused: boolean): void; reset(): void }`; `startFocusSync(): void`; `subscribeUi(cb: () => void): () => void`.

- [ ] **Step 1: Write the failing test** — `tests/renderer/focus-sync.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { FocusReporter } from '../../src/renderer/src/focus-sync'

describe('FocusReporter', () => {
  it('manda o painel só com a janela em foco e só quando muda', () => {
    const sent: (string | null)[] = []
    const r = new FocusReporter((id) => sent.push(id))
    r.report('a', true)
    r.report('a', true)
    r.report('a', false)
    r.report('b', false)
    r.report('b', true)
    expect(sent).toEqual(['a', null, 'b'])
  })
  it('reset (conexão nova) repete o último foco', () => {
    const sent: (string | null)[] = []
    const r = new FocusReporter((id) => sent.push(id))
    r.report('a', true)
    r.reset()
    r.report('a', true)
    expect(sent).toEqual(['a', 'a'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/focus-sync.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementation**

`src/renderer/src/store.ts` — logo depois da função `subscribe` (privada):

```ts
/** escuta toda mudança do estado da interface (fora do React) */
export const subscribeUi = subscribe
```

`src/renderer/src/focus-sync.ts`:

```ts
import { getUi, subscribeUi } from './store'

/** foco desta janela para o daemon: só quando muda; janela sem foco conta como nenhum painel */
export class FocusReporter {
  private last: string | null | undefined = undefined

  constructor(private send: (paneId: string | null) => void) {}

  report(paneId: string | null, windowFocused: boolean): void {
    const target = windowFocused ? paneId : null
    if (target === this.last) return
    this.last = target
    this.send(target)
  }

  /** conexão nova com o daemon: o próximo report sempre vai */
  reset(): void {
    this.last = undefined
  }
}

/** o daemon não hiberna o painel em foco e acorda o hibernado quando ele ganha foco */
export function startFocusSync(): void {
  const reporter = new FocusReporter((paneId) => window.gt.send({ t: 'pane.focus', paneId }))
  let connected = getUi().connected
  const push = () => reporter.report(getUi().focusedPaneId, document.hasFocus())
  subscribeUi(() => {
    const now = getUi().connected
    if (now && !connected) reporter.reset()
    connected = now
    push()
  })
  window.addEventListener('focus', push)
  window.addEventListener('blur', push)
  push()
}
```

`src/renderer/src/main.tsx` — import `import { startFocusSync } from './focus-sync'`; em `bootWorkspace()`, logo depois de `window.addEventListener('focus', () => markSeenIfLooking(...))`, chame `startFocusSync()`; em `bootFloat(paneId)`, logo depois de `setUi({ focusedPaneId: paneId })`, chame `startFocusSync()`.

As duas janelas já fazem `setUi({ connected: false })` ao perder o daemon (`main.tsx`), e `connected: true` ao receber estado de novo; é essa transição que dispara o `reset()` e reenvia o foco para a conexão nova.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/renderer/focus-sync.test.ts && npm run typecheck`
Expected: PASS, sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/focus-sync.ts src/renderer/src/store.ts src/renderer/src/main.tsx tests/renderer/focus-sync.test.ts
git commit -m "feat(hibernacao): janelas avisam o daemon do painel em foco"
```

---

### Task 6: Interface (💤, acordando, painel da máquina, Preferências)

**Files:**
- Modify: `src/renderer/src/header.ts`
- Modify: `src/renderer/src/sidebar-model.ts`
- Modify: `src/renderer/src/components/PaneHeader.tsx`, `src/renderer/src/components/MachineChip.tsx`, `src/renderer/src/components/Preferences.tsx`, `src/renderer/src/styles.css`
- Create: `src/renderer/src/components/HibernatePrefs.tsx`
- Test: `tests/renderer/header.test.ts`, `tests/renderer/sidebar-model.test.ts`

**Interfaces:**
- Consumes: `PaneView.hibernated?`, `PaneView.waking?` (Task 4); `HibernateSettings`, `TerminalSettings.hibernate` (Task 1).
- Produces: `type DisplayStatus = SessionStatus | 'shell' | 'hibernated' | 'waking'`; `displayStatus(p)`; `hibernatedLabel(since, now)`; `HeaderView.status: DisplayStatus`; `HeaderView.hibernatedSince: number | null`; `SessionItem.status: DisplayStatus`; `STATUS_DOT` com `hibernated: '💤'`, `waking: '⏳'`.

- [ ] **Step 1: Write the failing tests**

Em `tests/renderer/header.test.ts`:

```ts
import { displayStatus, hibernatedLabel } from '../../src/renderer/src/header'

describe('hibernação no cabeçalho', () => {
  const claude = { sessionId: 's', agent: 'claude' as const, status: 'idle' as const, statusSince: 0, title: null, transcriptPath: null }
  it('status de exibição', () => {
    expect(displayStatus({ claude: null, hibernated: { since: 1 }, waking: false })).toBe('hibernated')
    expect(displayStatus({ claude: null, hibernated: null, waking: true })).toBe('waking')
    expect(displayStatus({ claude, hibernated: null, waking: true })).toBe('idle')
    expect(displayStatus({ claude: null })).toBe('shell')
  })
  it('rótulo do tempo hibernada', () => {
    expect(hibernatedLabel(0, 30_000)).toBe('hibernada agora')
    expect(hibernatedLabel(0, 42 * 60_000)).toBe('hibernada há 42 min')
    expect(hibernatedLabel(0, 130 * 60_000)).toBe('hibernada há 2 h')
  })
})
```

Em `tests/renderer/sidebar-model.test.ts`, um caso que monta um `AppState` mínimo como os testes vizinhos já fazem (reaproveite o fixture/factory do arquivo) com um painel `{ ...pane, claude: null, hibernated: { since: 0 } }` e verifica:

```ts
    expect(buildSidebar(app).outside[0].status).toBe('hibernated')
```

(Se o arquivo não tiver painel fora de projeto no fixture, use o painel dentro do projeto e leia `projects[0].worktrees[0].sessions[0].status`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/header.test.ts tests/renderer/sidebar-model.test.ts`
Expected: FAIL — `displayStatus` não exportado / status `'shell'` em vez de `'hibernated'`.

- [ ] **Step 3: Implementation**

`src/renderer/src/header.ts`:

```ts
/** status mostrado: o da sessão, ou 💤 (agente encerrado por ociosidade) / acordando */
export type DisplayStatus = SessionStatus | 'shell' | 'hibernated' | 'waking'

export function displayStatus(p: Pick<PaneView, 'claude' | 'hibernated' | 'waking'>): DisplayStatus {
  if (p.hibernated) return 'hibernated'
  if (p.waking && !p.claude) return 'waking'
  return p.claude?.status ?? 'shell'
}

export function hibernatedLabel(since: number, now: number): string {
  const min = Math.max(0, Math.floor((now - since) / 60_000))
  if (min < 1) return 'hibernada agora'
  if (min < 60) return `hibernada há ${min} min`
  return `hibernada há ${Math.floor(min / 60)} h`
}
```

No `HeaderView`: troque `status: SessionStatus | 'shell'` por `status: DisplayStatus` e acrescente `hibernatedSince: number | null`. Em `headerView`: `status: displayStatus(pane),` e `hibernatedSince: pane.hibernated?.since ?? null,`.

`src/renderer/src/sidebar-model.ts`: import `displayStatus, type DisplayStatus` de `./header`; em `SessionItem`, `status: DisplayStatus`; em `toItem`, `status: displayStatus(p),`. (`count(s: SessionStatus)` e `worst` continuam iguais: hibernadas não entram na atenção.)

`src/renderer/src/components/PaneHeader.tsx`:

```ts
export const STATUS_DOT = { working: '🟢', 'needs-you': '🟡', 'your-turn': '🔵', idle: '⚪', shell: '', hibernated: '💤', waking: '⏳' } as const
```

Import `hibernatedLabel` de `../header`. No `<span className="ph-fixed">`, logo depois da linha do `ph-status`:

```tsx
          {h.status === 'hibernated' && h.hibernatedSince !== null && (
            <span className="ph-hibernated" title="Agente encerrado por ociosidade; foque o painel para retomar a conversa">
              {hibernatedLabel(h.hibernatedSince, Date.now())}
            </span>
          )}
          {h.status === 'waking' && <span className="ph-hibernated">acordando…</span>}
```

`src/renderer/src/styles.css` (perto das regras `.ph-status`; se não houver, no fim do bloco do cabeçalho do painel):

```css
.ph-hibernated { color: var(--fg-dim); font-size: var(--text-xs); white-space: nowrap; }
```

`src/renderer/src/components/MachineChip.tsx` — no painel, logo depois do `<div className="mp-dim">swap …</div>`, usando a lista `panes` que o componente já lê para `nameOf`:

```tsx
      {(() => {
        const n = panes.filter((p) => p.hibernated).length
        return n > 0 ? <div className="mp-dim">💤 {n === 1 ? '1 sessão hibernada' : `${n} sessões hibernadas`}</div> : null
      })()}
```

`src/renderer/src/components/HibernatePrefs.tsx`:

```tsx
import type { HibernateSettings } from '../../../shared/settings'

export function HibernatePrefs({ value, onChange }: { value: HibernateSettings; onChange: (h: HibernateSettings) => void }) {
  return (
    <>
      <label className="field pref-check">
        <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />
        Hibernar sessões ociosas (encerra o agente para liberar memória e retoma a conversa ao focar)
      </label>
      <div className="field">
        <div className="field-label">HIBERNAR DEPOIS DE {value.minutes} MIN PARADA</div>
        <input type="range" min={5} max={240} step={5} disabled={!value.enabled} value={value.minutes} onChange={(e) => onChange({ ...value, minutes: Number(e.target.value) })} />
      </div>
      <p className="card-note">Nunca hiberna sessão em foco, trabalhando, pedindo permissão, líder 👑, dev contratado ou com comando rodando.</p>
    </>
  )
}
```

`src/renderer/src/components/Preferences.tsx` — import `HibernatePrefs`; troque a linha da aba `machine` por:

```tsx
        <>
          <MachinePrefs value={draft.machine} onChange={(machine) => update({ machine })} />
          <HibernatePrefs value={draft.hibernate} onChange={(hibernate) => update({ hibernate })} />
        </>
```

- [ ] **Step 4: Run tests e typecheck**

Run: `npx vitest run tests/renderer && npm run typecheck`
Expected: PASS, sem erros (se algum `Record<SessionStatus | 'shell', …>` acusar falta das chaves novas, acrescente `hibernated`/`waking` nele).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/header.ts src/renderer/src/sidebar-model.ts src/renderer/src/components/PaneHeader.tsx src/renderer/src/components/MachineChip.tsx src/renderer/src/components/HibernatePrefs.tsx src/renderer/src/components/Preferences.tsx src/renderer/src/styles.css tests/renderer/header.test.ts tests/renderer/sidebar-model.test.ts
git commit -m "feat(hibernacao): 💤 no painel e na sidebar, contagem no painel da máquina e Preferências"
```

---

### Task 7: Verificação final

**Files:** nenhum novo.

- [ ] **Step 1: Suíte completa e tipos**

Run: `npm test && npm run typecheck`
Expected: tudo verde.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: build sem erros.

- [ ] **Step 3: Teste manual (com o usuário)**

Instalar o app segue a memória "Instalar o app só fechado": fechar o app, SIGTERM no daemon, trocar o bundle, abrir e "Retomar todas". **Pergunte ao usuário antes** — o app está em uso com sessões abertas. Com o app novo:
1. Preferências → Máquina: hibernação ligada, ajustar para 5 min.
2. Deixar uma sessão avulsa em 🔵 fora de foco por 5 min; conferir 💤 "hibernada há N min" no cabeçalho e na sidebar, "1 sessão hibernada" no chip da máquina, e com `ps` que o `claude` daquele painel sumiu.
3. Focar o painel: aparece "acordando…", o comando `--resume` é digitado e a conversa volta com o contexto.
4. Conferir que líder 👑, dev contratado e sessão com `npm run dev` rodando pelo Bash não hibernam.
5. Voltar a hibernação para 30 min.
