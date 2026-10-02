# Espaços de trabalho (várias janelas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma janela por espaço de trabalho (projetos, abas, layout e sessões próprios), um daemon só, fechar janela mantém sessões vivas, tela de reabrir com checkbox e "Mover para espaço".

**Architecture:** O daemon guarda `workspaces[]` (projectPaths, layout, resumable) e `workspaceId` em cada sessão; cada conexão `app` se identifica no `hello` e recebe o `AppState` filtrado do seu espaço + um resumo de todos. O processo principal do Electron mantém `Map<workspaceId, { win, link }>` (uma `DaemonLink` por janela) e roteia o IPC por `event.sender`. O renderer quase não muda: cada janela vê um estado "único".

**Tech Stack:** TypeScript, Electron, React, vitest.

**Spec:** `docs/superpowers/specs/2026-10-02-espacos-de-trabalho-design.md`

## Global Constraints

- **NÃO tocar no app instalado nem no daemon real** (`~/.gerenciador-terminal`): o usuário tem agentes rodando. Teste manual só com `GT_HOME=/tmp/gt-espacos npm run dev` (socket próprio).
- Migração: sem `workspaces` no `state.json` → `{ id: 'principal', name: 'Principal', open: true, projectPaths: <todos os projetos>, layout, resumable }`. Painel sem `workspaceId` → `'principal'`. `hello` sem `workspaceId` → `'principal'` (mantém clientes antigos e todos os testes atuais).
- Globais (não mudam por espaço): cadastro `projects` (cor, conta padrão), contas, preferências, `paneMeta`, `filePanes` (poda olha os layouts de **todos** os espaços), `loginDirs`, `claudeProfiles`, `codexHomes`, uso do plano.
- Nome de espaço obrigatório; repetido ganha `" 2"`, `" 3"`…
- Atalho `new-workspace` "Novo espaço de trabalho…": mac `Cmd+Shift+N`, linux `Ctrl+Alt+N`.
- Textos exatos: diálogo `Fechar a janela "<nome>"? As N sessões continuam rodando em segundo plano. Você reabre pelo menu Janela ou pelo Dock.`, botões `Fechar janela` / `Encerrar o espaço também` / `Cancelar`, caixa `não perguntar de novo`; notificação `<nome> fechado · N sessões continuam em segundo plano`; tela `Reabrir espaços de trabalho`, `N sessões rodando` / `sem sessões`, `Abrir selecionados`, `Abrir todos`, `Novo espaço de trabalho…`; menu da sessão `Mover para espaço ▸ <nome>`.
- Nunca duas janelas do mesmo espaço: pedir para abrir um espaço já aberto foca a janela existente.
- Fechar a última janela: no mac o app fica no Dock (clicar no ícone → tela de reabrir); no Linux encerra a interface como hoje.

## Review Focus

1. **Hook de uma sessão chega com a janela do espaço fechada** → estado da sessão atualiza normalmente e a janela mostra certo ao reabrir. Teste na Task 2.
2. **Mesmo projeto em dois espaços, remover de um** → continua no outro e no cadastro. Teste na Task 2.
3. **Duas janelas mandando `layout.save` ao mesmo tempo** → cada uma grava só o seu espaço. Teste na Task 2.
4. **`workspace.end` com painéis de arquivo no layout** → `filePanes` desse espaço não somem sem motivo (só a poda do layout). Teste na Task 3.
5. **App aberto pela primeira vez depois da migração com 1 espaço** → abre direto, sem a tela de reabrir. Teste na Task 4 (`decideStartup`).

---

## Pontos do código (leia antes)

- `src/daemon/persist.ts`: `Persisted`, `defaultPersisted`, `loadPersisted` (padrão de normalização campo a campo).
- `src/daemon/daemon.ts`: `init()` (reconstrói `resumable` a partir de `p.panes`), `save()` (grava `panes` vivos), `changed()` (broadcast: `for (const c of conns) if (c.role === 'app') c.send({ t: 'state', state })`), `buildState()`, `handle()` (`hello`, `state.get`, `project.add/remove/setAccount/setColor`, `layout.save` + poda de `filePanes`, `pane.create`, `resume.dismiss`, `pane.kill`, `daemon.shutdown`).
- `src/daemon/server.ts`: `Conn` (tem `role`, `subscriptions`, `onClose`).
- `src/daemon/panes.ts`: `PaneRecord`, `create(o: CreatePane)`.
- `src/main/daemon-link.ts`: `DaemonLink` (`start`, `request`, `send`, `shutdownDaemon`; faz o `hello` com `{ t: 'hello', role: 'app', version }`).
- `src/main/index.ts`: janela única `win`, handlers `ipcMain` (`gt:request`, `gt:send`, `gt:notify`, `gt:setBadge`, `gt:confirm`, `gt:contextMenu`…), `quitAll`, menu.
- `src/preload/index.ts`: API `window.gt`.
- `src/shared/keybindings.ts`: `ACTIONS`; `src/renderer/src/actions.ts`: `runMenuAction`.
- Helpers de teste: `tests/daemon/daemon.test.ts` (`boot`, `hook`), `tests/helpers/app-client.ts` (`connectApp(socketPath)` faz `hello` sem workspace).

---

### Task 1: Modelo e persistência dos espaços

**Files:** Modify `src/shared/types.ts`, `src/daemon/persist.ts`; Test `tests/daemon/persist.test.ts`

**Interfaces — Produces:**
- `interface Workspace { id: string; name: string; open: boolean; projectPaths: string[]; layout: Layout; resumable: ResumeEntry[] }`
- `interface WorkspaceSummary { id: string; name: string; open: boolean; sessions: number }`
- `AppState.workspaceId: string`, `AppState.workspaces: WorkspaceSummary[]`
- `Persisted.workspaces: Workspace[]`, `Persisted.askOnCloseWindow: boolean`; `PersistedPane.workspaceId?: string`; `ResumeEntry.workspaceId?: string` (não usado na migração, só informativo)
- `migrateWorkspaces(p: Persisted): Persisted` (exportada; idempotente)

- [ ] **Step 1: Teste que falha** — em `tests/daemon/persist.test.ts`:

```ts
  it('migra o estado antigo para o espaço Principal (layout, retomáveis e projetos)', () => {
    const f = path.join(tmp(), 'state.json')
    const layout = { tabs: [{ id: 't', name: 'A', root: { type: 'leaf' as const, paneId: 'p1' } }], activeTabId: 't' }
    fs.writeFileSync(f, JSON.stringify({ version: 1, projects: [{ path: '/r/a', name: 'a', defaultAccountId: null }], layout, resumable: [{ paneId: 'p1', cwd: '/r/a', accountId: null, sessionId: null }], panes: [] }))
    const p = loadPersisted(f)
    expect(p.workspaces).toEqual([{ id: 'principal', name: 'Principal', open: true, projectPaths: ['/r/a'], layout, resumable: [{ paneId: 'p1', cwd: '/r/a', accountId: null, sessionId: null }] }])
    expect(p.askOnCloseWindow).toBe(true)
    expect(migrateWorkspaces(p)).toEqual(p)
  })

  it('estado novo começa com o espaço Principal vazio', () => {
    expect(defaultPersisted().workspaces).toEqual([{ id: 'principal', name: 'Principal', open: true, projectPaths: [], layout: { tabs: [], activeTabId: null }, resumable: [] }])
  })
```

(import `migrateWorkspaces` junto dos outros de `persist`.)

- [ ] **Step 2:** `npx vitest run tests/daemon/persist.test.ts` → FAIL.

- [ ] **Step 3: Implementar**
  - `types.ts`: as duas interfaces acima; em `AppState`: `workspaceId: string` e `workspaces: WorkspaceSummary[]`; em `ResumeEntry`: `workspaceId?: string`.
  - `persist.ts`: `PersistedPane.workspaceId?: string`; `Persisted.workspaces: Workspace[]` e `askOnCloseWindow: boolean`. **Mantenha** `layout` e `resumable` na raiz do tipo (são lidos pela migração e o daemon passa a ignorá-los); no `save` o daemon grava a raiz com os do espaço `principal` para quem fizer downgrade.
  - `defaultPersisted()`: `workspaces: [{ id: 'principal', name: 'Principal', open: true, projectPaths: [], layout: { tabs: [], activeTabId: null }, resumable: [] }]`, `askOnCloseWindow: true`.
  - Função:

```ts
export function migrateWorkspaces(p: Persisted): Persisted {
  if (Array.isArray(p.workspaces) && p.workspaces.length > 0) return p
  return {
    ...p,
    workspaces: [{ id: 'principal', name: 'Principal', open: true, projectPaths: p.projects.map((c) => c.path), layout: p.layout, resumable: p.resumable }],
  }
}
```

  - Em `loadPersisted`, no objeto final: `askOnCloseWindow: parsed.askOnCloseWindow !== false,` e `workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : []`; e devolva `migrateWorkspaces(<objeto>)`. Em `defaultPersisted()` o array já vem preenchido.
  - Ajuste os literais de `AppState` em testes do renderer que o typecheck acusar com `workspaceId: 'principal', workspaces: []`.

- [ ] **Step 4:** `npx vitest run tests/daemon/persist.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5:** `git commit -m "feat(espacos): modelo e migração dos espaços de trabalho"`

---

### Task 2: Daemon com estado por espaço

**Files:** Modify `src/daemon/server.ts`, `src/daemon/panes.ts`, `src/daemon/daemon.ts`, `src/shared/protocol.ts`, `tests/helpers/app-client.ts`; Test `tests/daemon/daemon.test.ts`

**Interfaces — Produces:** `Conn.workspaceId: string`; `hello { …, workspaceId?: string }`; `PaneRecord.workspaceId: string`; `CreatePane.workspaceId?: string`; `connectApp(socketPath, workspaceId?)`.

- [ ] **Step 1: Teste que falha** — `tests/helpers/app-client.ts`: `connectApp(socketPath: string, workspaceId?: string)` passando `workspaceId` no `hello`. Em `daemon.test.ts`:

```ts
  it('espaços: duas janelas veem projetos, sessões e layout separados; mesmo projeto nos dois', async () => {
    repo = makeRepo()
    const { o, app } = await boot()
    const { id } = await app.client.request<{ id: string }>({ t: 'workspace.create', name: 'Outro' })
    const other = await connectApp(o.socketPath, id)
    await app.client.request({ t: 'project.add', path: repo.dir })
    let s2 = await other.waitState((s) => s.workspaceId === id)
    expect(s2.projects).toEqual([])
    await other.client.request({ t: 'project.add', path: repo.dir })
    s2 = await other.waitState((s) => s.projects.length === 1)
    const { paneId } = await other.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await other.waitState((s) => s.panes.some((p) => p.id === paneId))
    expect(app.state()!.panes.some((p) => p.id === paneId)).toBe(false)
    await other.client.request({ t: 'layout.save', layout: { tabs: [{ id: 'x', name: 'X', root: { type: 'leaf', paneId } }], activeTabId: 'x' } })
    await app.client.request({ t: 'layout.save', layout: { tabs: [{ id: 'y', name: 'Y', root: null }], activeTabId: 'y' } })
    expect((await other.client.request<{ layout: { tabs: { id: string }[] } }>({ t: 'state.get' })).layout.tabs[0].id).toBe('x')
    await app.client.request({ t: 'project.remove', path: repo.dir })
    expect((await other.client.request<{ projects: unknown[] }>({ t: 'state.get' })).projects).toHaveLength(1)
    // hook com a janela do espaço fechada: o estado da sessão segue atualizando
    other.client.close()
    await hook(o, paneId, { hook_event_name: 'SessionStart', session_id: 'w1', cwd: repo.dir })
    const again = await connectApp(o.socketPath, id)
    await again.waitState((s) => s.panes.find((p) => p.id === paneId)?.claude?.sessionId === 'w1')
    expect(app.state()!.workspaces.map((w) => w.name).sort()).toEqual(['Outro', 'Principal'])
  })
```

- [ ] **Step 2:** `npx vitest run tests/daemon/daemon.test.ts -t "espaços: duas janelas"` → FAIL.

- [ ] **Step 3: Implementar**
  - `protocol.ts`: `hello` ganha `workspaceId?: string`; novas requisições (implementadas na Task 3, declare já): `workspace.create {name}`, `workspace.rename {id,name}`, `workspace.setOpen {id,open}`, `workspace.end {id}`, `workspace.list`, `pane.moveWorkspace {paneId,to}`. `CreatePane` (`pane.create`) **não** muda de formato.
  - `server.ts`: `Conn.workspaceId: string` iniciado com `'principal'`.
  - `panes.ts`: `PaneRecord.workspaceId: string`; `CreatePane.workspaceId?: string`; em `create`, `workspaceId: o.workspaceId ?? existing?.workspaceId ?? 'principal'`.
  - `daemon.ts`:
    - helper `private ws(id: string): Workspace` (acha em `this.persisted.workspaces`; se não achar, `principal`).
    - `hello`: `conn.workspaceId = req.workspaceId && this.persisted.workspaces.some((w) => w.id === req.workspaceId) ? req.workspaceId : 'principal'`; e o `setImmediate` manda `this.buildState(conn.workspaceId)`. Se `role === 'app'`, marque `ws.open = true` e `this.changed()`.
    - `state.get` → `this.buildState(conn.workspaceId)`.
    - `changed()`: o broadcast vira `for (const c of conns) if (c.role === 'app') c.send({ t: 'state', state: this.buildState(c.workspaceId) })` (monte um cache `Map<wsId, AppState>` dentro do timer para não recalcular por conexão).
    - `buildState(wsId: string)`: `const w = this.ws(wsId)`; `projects` = `w.projectPaths.map((p) => this.registry.get(p)).filter(Boolean)` mapeado como hoje; `panes` = só `r.workspaceId === w.id`; `layout: w.layout`; `resumable: w.resumable`; `workspaceId: w.id`; `workspaces: this.persisted.workspaces.map((x) => ({ id: x.id, name: x.name, open: x.open, sessions: this.panes.records().filter((r) => r.alive && r.workspaceId === x.id).length }))`.
    - `init()`: a reconstrução de `resumable` passa a ser por espaço: para cada `pane` persistido, `const w = ws(pane.workspaceId ?? 'principal')` e põe em `w.resumable` (sem duplicar `paneId`); a raiz `p.resumable` não é mais usada.
    - `save()`: `panes` ganha `workspaceId: r.workspaceId`; grava também `layout`/`resumable` da raiz = os do `principal`.
    - `project.add`: depois do `registry.add`, `if (!w.projectPaths.includes(cfg.path)) w.projectPaths.push(cfg.path)` com `w = this.ws(conn.workspaceId)`; `this.changed()`.
    - `project.remove`: tira de `w.projectPaths`; só chama `this.registry.remove(req.path)` (e `conflicts.delete`) se **nenhum** espaço ainda tiver o caminho.
    - `layout.save`: grava em `this.ws(conn.workspaceId).layout`; a poda de `filePanes` usa os ids de **todos** os `workspaces[].layout`.
    - `pane.create`: `this.panes.create({ ...req2, workspaceId: conn.workspaceId })`; e remove de `this.ws(conn.workspaceId).resumable` o `paneId`.
    - `resume.dismiss`: no `resumable` do espaço da conexão.
    - Onde mais o código lê `this.persisted.layout` ou `this.persisted.resumable` (procure com `grep -n "persisted.layout\|persisted.resumable" src/daemon/daemon.ts`), troque pelo do espaço da conexão ou, sem conexão, percorra todos os espaços.
  - `app-client.ts`: `connectApp(socketPath, workspaceId?)`.
  - **Typecheck:** `AppState` ganhou campos; `buildState` agora exige id — ajuste chamadas.

- [ ] **Step 4:** `npx vitest run tests/daemon/daemon.test.ts && npm test && npm run typecheck` → PASS (todos os testes antigos usam `principal` implicitamente).
- [ ] **Step 5:** `git commit -m "feat(espacos): daemon com projetos, layout e sessões por espaço"`

---

### Task 3: Requisições de espaço

**Files:** Modify `src/daemon/daemon.ts`; Create `src/daemon/workspaces.ts`; Test `tests/daemon/workspaces.test.ts`, `tests/daemon/daemon.test.ts`

**Interfaces — Produces:** `uniqueName(name: string, taken: string[]): string`; handlers `workspace.create` → `{ id }`, `workspace.rename`, `workspace.setOpen`, `workspace.end`, `workspace.list` → `WorkspaceSummary[]`, `pane.moveWorkspace`.

- [ ] **Step 1: Testes que falham**

`tests/daemon/workspaces.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { uniqueName } from '../../src/daemon/workspaces'

describe('uniqueName', () => {
  it('mantém, numera repetidos e recusa vazio', () => {
    expect(uniqueName(' TCHEERP ', ['Principal'])).toBe('TCHEERP')
    expect(uniqueName('Principal', ['Principal'])).toBe('Principal 2')
    expect(uniqueName('Principal', ['Principal', 'Principal 2'])).toBe('Principal 3')
    expect(() => uniqueName('   ', [])).toThrow('nome obrigatório')
  })
})
```

Em `daemon.test.ts`:

```ts
  it('espaços: renomear, encerrar (sessões viram retomáveis do espaço) e mover sessão viva', async () => {
    repo = makeRepo()
    const { o, app } = await boot()
    const { id } = await app.client.request<{ id: string }>({ t: 'workspace.create', name: 'Principal' })
    let list = await app.client.request<{ id: string; name: string }[]>({ t: 'workspace.list' })
    expect(list.find((w) => w.id === id)?.name).toBe('Principal 2')
    await app.client.request({ t: 'workspace.rename', id, name: 'Revisões' })
    const rev = await connectApp(o.socketPath, id)
    await rev.client.request({ t: 'project.add', path: repo.dir })
    const { paneId } = await rev.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await rev.client.request({ t: 'pane.moveWorkspace', paneId, to: 'principal' })
    await app.waitState((s) => s.panes.some((p) => p.id === paneId && p.alive))
    expect(app.state()!.projects.map((p) => p.path)).toContain(repo.dir)
    await rev.client.request({ t: 'pane.moveWorkspace', paneId, to: id })
    await rev.waitState((s) => s.panes.some((p) => p.id === paneId && p.alive))
    await app.client.request({ t: 'workspace.end', id })
    const st = await rev.waitState((s) => s.resumable.some((r) => r.paneId === paneId))
    expect(st.panes.find((p) => p.id === paneId)?.alive ?? false).toBe(false)
    list = await app.client.request({ t: 'workspace.list' })
    expect(list.find((w) => w.id === id)).toMatchObject({ name: 'Revisões', open: false, sessions: 0 })
  })
```

- [ ] **Step 2:** rodar os dois → FAIL.

- [ ] **Step 3: Implementar**

`src/daemon/workspaces.ts`:

```ts
export function uniqueName(name: string, taken: string[]): string {
  const base = name.trim()
  if (!base) throw new Error('nome obrigatório')
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}
```

Em `daemon.ts` (`import { uniqueName } from './workspaces'`, `randomUUID` de `node:crypto`):

```ts
      case 'workspace.create': {
        const name = uniqueName(req.name, this.persisted.workspaces.map((w) => w.name))
        const id = randomUUID()
        this.persisted.workspaces.push({ id, name, open: true, projectPaths: [], layout: { tabs: [], activeTabId: null }, resumable: [] })
        this.changed()
        return { id }
      }
      case 'workspace.rename': {
        const w = this.persisted.workspaces.find((x) => x.id === req.id)
        if (!w) throw new Error(`espaço não encontrado: ${req.id}`)
        w.name = uniqueName(req.name, this.persisted.workspaces.filter((x) => x !== w).map((x) => x.name))
        this.changed()
        return null
      }
      case 'workspace.setOpen': {
        const w = this.persisted.workspaces.find((x) => x.id === req.id)
        if (w) w.open = req.open
        this.changed()
        return null
      }
      case 'workspace.list':
        return this.buildState(conn.workspaceId).workspaces
      case 'workspace.end': {
        const w = this.persisted.workspaces.find((x) => x.id === req.id)
        if (!w) throw new Error(`espaço não encontrado: ${req.id}`)
        for (const r of this.panes.records().filter((x) => x.alive && x.workspaceId === w.id)) {
          if (!w.resumable.some((e) => e.paneId === r.id)) w.resumable.push({ paneId: r.id, cwd: r.cwd, accountId: r.accountId, sessionId: r.claude?.sessionId ?? null, agent: r.claude?.agent ?? 'claude', transcriptPath: r.claude?.transcriptPath ?? null })
          this.panes.kill(r.id)
        }
        w.open = false
        this.changed()
        return null
      }
      case 'pane.moveWorkspace': {
        const rec = this.panes.get(req.paneId)
        const to = this.persisted.workspaces.find((x) => x.id === req.to)
        if (!rec || !to) throw new Error('painel ou espaço não encontrado')
        const from = this.ws(rec.workspaceId)
        rec.workspaceId = to.id
        const strip = (n: LayoutNode | null): LayoutNode | null => (n ? removeLeafFrom(n, rec.id) : null)
        from.layout = { ...from.layout, tabs: from.layout.tabs.map((t) => ({ ...t, root: strip(t.root) })) }
        const tab = to.layout.tabs.find((t) => t.id === to.layout.activeTabId) ?? to.layout.tabs[0]
        if (tab) tab.root = tab.root ? { type: 'split', dir: 'row', sizes: [], children: [tab.root, { type: 'leaf', paneId: rec.id }] } : { type: 'leaf', paneId: rec.id }
        else to.layout = { tabs: [{ id: randomUUID(), name: 'Aba 1', root: { type: 'leaf', paneId: rec.id } }], activeTabId: null }
        if (!to.layout.activeTabId) to.layout.activeTabId = to.layout.tabs[0].id
        const proj = rec.projectPath
        if (proj && !to.projectPaths.includes(proj)) to.projectPaths.push(proj)
        this.changed()
        return null
      }
```

Helper no fim de `daemon.ts`:

```ts
function removeLeafFrom(n: LayoutNode, id: string): LayoutNode | null {
  if (n.type === 'leaf') return n.paneId === id ? null : n
  const children = n.children.map((c) => removeLeafFrom(c, id)).filter((c): c is LayoutNode => c !== null)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { ...n, children, sizes: [] }
}
```

Observação sobre o layout ao mover: cada janela é dona do layout do seu espaço e o grava com `layout.save`. Para não haver disputa:
- **origem:** o renderer tira a folha do próprio layout (`hidePane`) **antes** de pedir `pane.moveWorkspace` (Task 5), então o próximo `layout.save` dela já vem sem o painel;
- **destino:** o renderer aceita o layout que chega do daemon quando ele traz painéis que o layout local não tem (`mergeIncomingLayout`, Task 5); fora isso, continua valendo o layout local.

- [ ] **Step 4:** `npx vitest run tests/daemon/workspaces.test.ts tests/daemon/daemon.test.ts && npm test && npm run typecheck` → PASS.
- [ ] **Step 5:** `git commit -m "feat(espacos): criar, renomear, abrir, encerrar espaço e mover sessão"`

---

### Task 4: Processo principal — várias janelas

**Files:** Create `src/main/workspaces-model.ts`, `src/main/windows.ts`; Modify `src/main/index.ts`, `src/main/daemon-link.ts`, `src/main/menu.ts` (e onde o menu é montado), `src/shared/keybindings.ts`; Test `tests/main/workspaces-model.test.ts`

**Interfaces — Produces:**
- `decideStartup(list: WorkspaceSummary[]): { kind: 'direct'; id: string } | { kind: 'chooser' }` (1 espaço → direto; 0 → direto em `principal`; 2+ → chooser)
- `closeDialogText(name: string, sessions: number): string`; `closedNoticeText(name: string, sessions: number): string`
- `badgeTotal(byWindow: Map<string, string>): string` (soma números; vazio se 0)
- `DaemonLink` aceita `workspaceId?: string` e manda no `hello`.

- [ ] **Step 1: Teste que falha** — `tests/main/workspaces-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { badgeTotal, closeDialogText, closedNoticeText, decideStartup } from '../../src/main/workspaces-model'

const ws = (id: string, open = true, sessions = 0) => ({ id, name: id, open, sessions })

describe('workspaces-model', () => {
  it('início: 1 espaço abre direto; 2+ mostram a tela de reabrir', () => {
    expect(decideStartup([ws('principal')])).toEqual({ kind: 'direct', id: 'principal' })
    expect(decideStartup([])).toEqual({ kind: 'direct', id: 'principal' })
    expect(decideStartup([ws('a'), ws('b', false)])).toEqual({ kind: 'chooser' })
  })
  it('textos do fechar', () => {
    expect(closeDialogText('TCHEERP', 6)).toBe('Fechar a janela "TCHEERP"? As 6 sessões continuam rodando em segundo plano. Você reabre pelo menu Janela ou pelo Dock.')
    expect(closeDialogText('X', 1)).toBe('Fechar a janela "X"? A sessão continua rodando em segundo plano. Você reabre pelo menu Janela ou pelo Dock.')
    expect(closedNoticeText('TCHEERP', 6)).toBe('TCHEERP fechado · 6 sessões continuam em segundo plano')
    expect(closedNoticeText('X', 1)).toBe('X fechado · 1 sessão continua em segundo plano')
  })
  it('badge soma as janelas', () => {
    expect(badgeTotal(new Map([['a', '2'], ['b', ''], ['c', '3']]))).toBe('5')
    expect(badgeTotal(new Map([['a', '']]))).toBe('')
  })
})
```

Confira que `vitest.config.ts` inclui `tests/**/*.test.ts` (inclui `tests/main`).

- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar `workspaces-model.ts` (puro, sem importar `electron`).

- [ ] **Step 4: Janelas** (`src/main/windows.ts` + `index.ts`) — sem teste automatizado; verificação: typecheck, build e teste real.
  - `DaemonLink`: opção `workspaceId?: string`, enviada no `hello` (`{ t: 'hello', role: 'app', version, workspaceId }`).
  - `windows.ts` exporta `class WindowManager` com `Map<string, { win: BrowserWindow; link: DaemonLink; badge: string; askedClose: boolean }>` e:
    - `open(id)`: se já existe, `win.show(); win.focus()`; senão cria `BrowserWindow` (mesmas `webPreferences` de hoje), `loadURL/loadFile` com query `?ws=<id>`, cria `DaemonLink({ socketPath, daemonScript, workspaceId: id, onEvent: (e) => win.webContents.send('gt:event', e) })` e `await link.start()`; título `Gerenciador de Terminal — <nome>` (atualizado a cada `state` recebido: `e.t === 'state'` → `win.setTitle(...)` com `e.state.workspaces.find(w => w.id === id)?.name`); guarda o último resumo `workspaces` para os menus.
    - `byEvent(e: IpcMainEvent | IpcMainInvokeEvent)` → entrada da janela de `e.sender` (`BrowserWindow.fromWebContents(e.sender)`).
    - `close` interceptado: `win.on('close', (ev) => …)` — se `quitting` (encerrar app) deixa fechar; senão `ev.preventDefault()`, conta sessões pelo último resumo; se `sessions > 0 && askOnCloseWindow` mostra `dialog.showMessageBox` com `closeDialogText`, botões `['Fechar janela', 'Encerrar o espaço também', 'Cancelar']`, `checkboxLabel: 'não perguntar de novo'`; marcar a caixa → `link.request({ t: 'settings…' })` **não existe**: grave via nova requisição `workspace.setAskOnClose { ask: false }` (acrescente no daemon, handler de 3 linhas que seta `persisted.askOnCloseWindow` e salva — e um teste no `daemon.test.ts` que confirme o campo no `state.json`). Botão 0: `workspace.setOpen { open: false }`, notificação `closedNoticeText` (se `sessions > 0`), `win.destroy()`. Botão 1: `workspace.end`, `win.destroy()`. Botão 2: nada.
    - `askOnCloseWindow` vem do `AppState` (acrescente `askOnCloseWindow: boolean` ao `AppState` no `buildState`).
    - Badge: `gt:setBadge` grava `badge` da entrada e chama `app.dock?.setBadge(badgeTotal(...))`.
    - `gt:notify` e o clique na notificação: `reveal` na janela da entrada que mandou (já é a janela certa porque o painel é daquele espaço).
  - `index.ts`: troque `win`/`link` únicos pelo `WindowManager`. Todos os `ipcMain.handle/on` usam `manager.byEvent(e)` para achar `link`/`win`. Início:
    1. conexão de serviço (`new DaemonLink({ … onEvent: () => {} })`, `start()`), `request({ t: 'workspace.list' })`;
    2. `decideStartup(list)` → `direct` abre aquele id; `chooser` abre uma janela pequena (480×420, sem `?ws`, com `?view=reopen`);
    3. a janela de reabrir chama `gt:openWorkspaces(ids: string[])` (novo handler: abre cada um e fecha a de reabrir) e `gt:newWorkspace()`.
  - `app.on('activate')` (mac, clique no Dock sem janelas): abre a tela de reabrir (ou direto se só 1).
  - `window-all-closed`: no mac **não** sai; no Linux `app.quit()` como hoje.
  - "Encerrar tudo" (`quitAll`) continua igual, mas antes marca `quitting = true` para o `close` não perguntar.
  - Menu Janela: itens `Novo espaço de trabalho…` (ação `new-workspace`), `Renomear espaço…` (ação `rename-workspace`, vai para o renderer da janela em foco), `Encerrar espaço de trabalho…` (`end-workspace`) e a lista de espaços (✓ abertos; clique → `manager.open(id)`); `app.dock.setMenu(...)` com a lista + "Novo espaço de trabalho…". Remonte quando o resumo mudar.
  - `new-workspace`: o main mostra um prompt de nome. Electron não tem prompt nativo: mande `gt:menu` `'new-workspace'` para a janela em foco, o renderer abre um modal de nome (Task 5) e chama `gt:createWorkspace(name)` (novo handler no main: `link.request({ t: 'workspace.create', name })` e `manager.open(id)`).
  - `keybindings.ts`: ação `{ id: 'new-workspace', label: 'Novo espaço de trabalho…', group: 'app', mac: 'Cmd+Shift+N', linux: 'Ctrl+Alt+N' }`.

- [ ] **Step 5:** `npx vitest run tests/main/workspaces-model.test.ts && npm test && npm run typecheck && npm run build` → PASS.
- [ ] **Step 6:** `git commit -m "feat(espacos): várias janelas no processo principal (abrir, fechar mantendo sessões, menus, Dock, badge)"`

---

### Task 5: Renderer — reabrir, nome, mover sessão

**Files:** Create `src/renderer/src/workspaces-model.ts`, `src/renderer/src/components/ReopenWorkspaces.tsx`, `src/renderer/src/components/WorkspaceNameModal.tsx`; Modify `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx` (ou o ponto de montagem), `src/renderer/src/store.ts`, `src/renderer/src/components/Modals.tsx`, `src/renderer/src/flows.ts`, `src/renderer/src/actions.ts`, `src/preload/index.ts`, `src/shared/bridge.ts`; Test `tests/renderer/workspaces-model.test.ts`

**Interfaces — Produces:** `reopenRows(list: WorkspaceSummary[]): { id: string; name: string; checked: boolean; detail: string }[]` (`checked = open`; `detail` = `N sessões rodando` / `1 sessão rodando` / `sem sessões`); `mergeIncomingLayout(local: Layout, incoming: Layout): Layout` (aceita o do daemon quando ele tem folhas que o local não tem); `window.gt.openWorkspaces(ids)`, `window.gt.createWorkspace(name)`.

- [ ] **Step 1: Teste que falha** — `tests/renderer/workspaces-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mergeIncomingLayout, reopenRows } from '../../src/renderer/src/workspaces-model'

const leaf = (paneId: string) => ({ type: 'leaf' as const, paneId })

describe('workspaces-model (renderer)', () => {
  it('linhas da tela de reabrir', () => {
    expect(reopenRows([{ id: 'a', name: 'TCHEERP', open: true, sessions: 6 }, { id: 'b', name: 'Pessoal', open: false, sessions: 1 }, { id: 'c', name: 'Vazio', open: false, sessions: 0 }])).toEqual([
      { id: 'a', name: 'TCHEERP', checked: true, detail: '6 sessões rodando' },
      { id: 'b', name: 'Pessoal', checked: false, detail: '1 sessão rodando' },
      { id: 'c', name: 'Vazio', checked: false, detail: 'sem sessões' },
    ])
  })
  it('layout do daemon só vence quando traz painel novo (sessão movida para cá)', () => {
    const local = { tabs: [{ id: 't', name: 'A', root: leaf('a') }], activeTabId: 't' }
    const same = { tabs: [{ id: 't', name: 'velho', root: leaf('a') }], activeTabId: 't' }
    const more = { tabs: [{ id: 't', name: 'A', root: { type: 'split' as const, dir: 'row' as const, sizes: [], children: [leaf('a'), leaf('b')] } }], activeTabId: 't' }
    expect(mergeIncomingLayout(local, same)).toBe(local)
    expect(mergeIncomingLayout(local, more)).toBe(more)
  })
})
```

- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar `workspaces-model.ts` (use `leaves` de `./layout`).

- [ ] **Step 4: Interface**
  - `bridge.ts`/`preload`: `openWorkspaces(ids: string[]): Promise<void>` (`ipcRenderer.invoke('gt:openWorkspaces', ids)`), `createWorkspace(name: string): Promise<void>` (`gt:createWorkspace`), `view: new URLSearchParams(location.search).get('view')` (leia no renderer direto se preferir).
  - `main.tsx`: se `view === 'reopen'`, monta só `<ReopenWorkspaces />` (pede `workspace.list` via `window.gt.request`) e não faz o bootstrap normal. No `case 'state'`, troque o merge de layout por `mergeIncomingLayout(s.app.layout, e.state.layout)`.
  - `ReopenWorkspaces.tsx`: título "Reabrir espaços de trabalho", checkboxes por `reopenRows`, botões **Abrir selecionados** (só marcados), **Abrir todos**, link **Novo espaço de trabalho…** (abre `WorkspaceNameModal` e chama `createWorkspace`).
  - `WorkspaceNameModal.tsx` (modal `{ kind: 'workspace-name'; mode: 'create' | 'rename' }` no `store.ts`): campo de nome; criar → `window.gt.createWorkspace(name)`; renomear → `window.gt.request({ t: 'workspace.rename', id: app.workspaceId, name })`.
  - `actions.ts` `runMenuAction`: `new-workspace` → modal create; `rename-workspace` → modal rename; `end-workspace` → `confirm` "Encerrar o espaço <nome>? As N sessões serão encerradas e ficam para retomar." → `workspace.end`.
  - `flows.ts` `sessionMenu`: itens `Mover para espaço ▸ <nome>` para cada outro espaço de `app.workspaces`; ação: tira a folha do layout local (`hidePane(paneId)`) e `window.gt.request({ t: 'pane.moveWorkspace', paneId, to })`.
  - Bootstrap normal: nada muda além do `hello` (feito pelo main).

- [ ] **Step 5:** `npx vitest run tests/renderer/workspaces-model.test.ts && npm test && npm run typecheck && npm run build` → PASS.
- [ ] **Step 6:** `git commit -m "feat(espacos): tela de reabrir, nome do espaço e mover sessão entre espaços"`

---

### Task 6: Teste real (instância isolada)

- [ ] Electron na worktree: `cd node_modules/electron && node install.js` se `dist/` não existir. **Só** `GT_HOME=/tmp/gt-espacos npm run dev` (nunca o app instalado).
- [ ] Com o usuário: criar "TCHEERP" e "Pessoal"; projetos diferentes em cada; mover um para outra mesa do macOS; fechar a janela de um com sessões (diálogo → "Fechar janela" → notificação); reabrir pelo Dock e pelo menu Janela; ⌘Q/Encerrar e reabrir → tela com checkbox, abrir só 1; "Mover para espaço"; mesmo projeto nos dois.
- [ ] Registrar resultado no commit/PR.
