# Janela flutuante — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um painel (sessão, terminal ou arquivo) sai da grade para uma janela do sistema que fica por cima de tudo, opcionalmente em todas as mesas, e volta à grade sem reiniciar.

**Architecture:** O daemon guarda `Workspace.floating` (ids) e as preferências por painel em `paneMeta[id].float`; o resumo dos espaços leva as flutuantes. O processo principal sincroniza janelas `?view=float&ws=&pane=` (uma `DaemonLink` cada) com esse resumo. A janela flutuante monta só o painel e nunca grava layout; a janela do espaço aceita do daemon a folha de um painel encaixado.

**Tech Stack:** TypeScript, Electron, React, vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-janela-flutuante-design.md`

## Global Constraints

- Requisições novas: `float.set { paneId, mode: 'float' | 'dock' | 'hide' }` e `float.prefs { paneId, bounds?, onTop?, allDesks? }`.
- `FloatPrefs = { bounds: Bounds | null; onTop: boolean; allDesks: boolean }`, padrão `{ bounds: null, onTop: true, allDesks: false }`; `Bounds = { x, y, width, height }`.
- Janela: `frame: false`, 640×400 inicial, mínimo 320×180; cascata de 30 px; atraso de gravação de posição 400 ms.
- 📌 → `setAlwaysOnTop(onTop, allDesks ? 'screen-saver' : 'floating')`; 🌐 → `setVisibleOnAllWorkspaces(allDesks, { visibleOnFullScreen: true })`.
- Ação `toggle-float` "Flutuar / encaixar painel": mac `Cmd+Shift+F`, linux `Ctrl+Shift+F`.
- Textos: menu `Flutuar` / `Encaixar`; botões `📌` (title "Por cima de tudo"), `🌐` ("Em todas as mesas"), `⤓` ("Encaixar na grade · ⇧⌘F"), `✕` ("Esconder (a sessão continua rodando)"); sidebar marca `⧉`.
- A janela flutuante **nunca** grava layout (`layout.save`).
- Testes: `npm test`, `npm run typecheck`, `npm run build`; vitest com `rtk proxy npx vitest run --reporter=dot …`; shell do usuário: `builtin cd "<caminho>"`.
- NÃO tocar no app instalado nem no daemon real; teste manual com `GT_HOME=/tmp/gt-flutuante`, app lançado com `nohup … & disown`.

## Review Focus

1. **Duas conexões no mesmo terminal** (grade guardou a entrada do xterm; flutuante desenha): só quem está montado manda `pane.resize`; o encaixe re-ajusta. Verificar no teste real (Task 6).
2. **Revelar um painel flutuante** (sidebar, ⌘J, notificação, "Outros espaços") nunca o põe na grade: foca a flutuante. Teste na Task 4 (`revealTarget`).
3. **Painel de arquivo flutuando** não é podado por `layout.save`. Teste na Task 1.
4. **Flutuante cujo processo saiu / daemon reiniciado**: mostra "terminal encerrado" ou retomar, sem fechar a janela sozinha. Teste real (Task 6).
5. **Espaço não aberto nesta execução** não abre flutuantes ao receber resumo. Teste na Task 2 (`syncFloats`).

---

## Pontos do código (leia antes)

- `src/shared/types.ts`: `Workspace`, `WorkspaceSummary`, `AppState`.
- `src/daemon/persist.ts`: `PaneMetaEntry`, `defaultPersisted`, `migrateWorkspaces`, `loadPersisted`.
- `src/daemon/daemon.ts`: `buildState` (resumo `workspaces`), `layout.save` (poda de `filePanes`), `workspace.create`, `hire()` (`onde`), `ws()`.
- `src/daemon/hire.ts`: `insertBeside(layout, anchorId, newId)` (âncora inexistente → aba ativa, ao lado da última folha).
- `src/main/windows.ts`: `WindowManager` (`open`, `entries`, `linkFor`, `entryOf`, `reveal`, `sendMenu`, `detachAll`, `quitting`), `src/main/index.ts` (`onSummary`, IPC), `src/main/workspaces-model.ts` (funções puras).
- `src/renderer/src/main.tsx` (`bootWorkspace`, `view`), `store.ts` (`updateLayout`), `workspaces-model.ts` (`mergeIncomingLayout`), `actions.ts` (`revealPane`, `hidePane`, `runMenuAction`, `revealNextAttention`), `flows.ts` (`sessionMenu`), `sidebar-model.ts` (`buildSidebar`, `SessionItem`), `components/PaneFrame.tsx`, `PaneHeader.tsx`, `FilePane.tsx`, `Sidebar.tsx`.
- `src/shared/keybindings.ts` (`ACTIONS`), `src/main/menu-template.ts`.

---

### Task 1: Daemon — flutuantes no estado, `float.set`, `float.prefs`, resumo e contratar

**Files:** Modify `src/shared/types.ts`, `src/shared/protocol.ts`, `src/daemon/persist.ts`, `src/daemon/daemon.ts`, `src/mcp/protocol.ts`; Test `tests/daemon/daemon.test.ts`, `tests/daemon/persist.test.ts`

**Interfaces — Produces:**
- `Bounds`, `FloatPrefs`, `FloatSpec = { paneId: string } & FloatPrefs` (types.ts); `DEFAULT_FLOAT: FloatPrefs` (types.ts)
- `Workspace.floating: string[]`; `WorkspaceSummary.floating: FloatSpec[]`; `AppState.floating: string[]` (do espaço da conexão)
- `PaneMetaEntry.float?: FloatPrefs`
- protocolo `float.set`, `float.prefs`

- [ ] **Step 1: Testes que falham** — `persist.test.ts`: estado com `workspaces` sem `floating` carrega com `floating: []`; `defaultPersisted().workspaces[0].floating` é `[]`.

`daemon.test.ts`:

```ts
  it('flutuante: flutuar, encaixar na aba ativa, esconder; prefs lembradas', async () => {
    const { app } = await boot()
    const mk = async () => (await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: '/', accountId: null, cols: 80, rows: 24 })).paneId
    const a = await mk()
    const b = await mk()
    await app.client.request({ t: 'layout.save', layout: { tabs: [{ id: 't', name: 'A', root: { type: 'leaf', paneId: a } }], activeTabId: 't' } })
    await app.client.request({ t: 'float.set', paneId: b, mode: 'float' })
    let st = await app.waitState((s) => s.floating.includes(b))
    expect(st.workspaces.find((w) => w.id === 'principal')!.floating).toEqual([{ paneId: b, bounds: null, onTop: true, allDesks: false }])
    await app.client.request({ t: 'float.prefs', paneId: b, bounds: { x: 10, y: 20, width: 500, height: 300 }, allDesks: true })
    await app.client.request({ t: 'float.set', paneId: b, mode: 'dock' })
    st = await app.waitState((s) => !s.floating.includes(b))
    expect(st.layout.tabs[0].root).toEqual({ type: 'split', dir: 'row', sizes: [], children: [{ type: 'leaf', paneId: a }, { type: 'leaf', paneId: b }] })
    await app.client.request({ t: 'float.set', paneId: b, mode: 'float' })
    st = await app.waitState((s) => s.floating.includes(b))
    expect(st.workspaces[0].floating[0]).toEqual({ paneId: b, bounds: { x: 10, y: 20, width: 500, height: 300 }, onTop: true, allDesks: true })
    // esconder: sai das flutuantes sem mexer na grade (flutuar já tinha tirado a folha)
    const before = st.layout
    expect(JSON.stringify(before)).not.toContain(b)
    await app.client.request({ t: 'float.set', paneId: b, mode: 'hide' })
    st = await app.waitState((s) => !s.floating.includes(b))
    expect(st.layout).toEqual(before)
  })

  it('flutuante: painel de arquivo flutuando não é podado pelo layout.save', async () => {
    const { app } = await boot()
    await app.client.request({ t: 'filepane.set', id: 'file:x', path: '/etc/hosts', mode: 'view' })
    await app.client.request({ t: 'float.set', paneId: 'file:x', mode: 'float' })
    await app.client.request({ t: 'layout.save', layout: { tabs: [], activeTabId: null } })
    const st = await app.client.request<{ filePanes: Record<string, unknown>; floating: string[] }>({ t: 'state.get' })
    expect(st.floating).toEqual(['file:x'])
    expect(st.filePanes['file:x']).toBeTruthy()
  })
```

E um caso de contratar (junto dos testes `contratar:`): com líder marcado, `contratar_dev { nome: 'dev-f', worktree: false, onde: 'flutuante' }` → o dev aparece em `state.floating` e **não** no layout.

- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3: Implementar**
  - `types.ts`:

```ts
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}
/** preferências de janela flutuante, lembradas por painel */
export interface FloatPrefs {
  bounds: Bounds | null
  /** por cima de tudo (📌) */
  onTop: boolean
  /** em todas as mesas (🌐) */
  allDesks: boolean
}
export type FloatSpec = { paneId: string } & FloatPrefs
export const DEFAULT_FLOAT: FloatPrefs = { bounds: null, onTop: true, allDesks: false }
```
  `Workspace.floating: string[]`; `WorkspaceSummary.floating: FloatSpec[]`; `AppState.floating: string[]`.
  - `persist.ts`: `PaneMetaEntry.float?: FloatPrefs`; nos três lugares que montam `Workspace` (`defaultPersisted`, `migrateWorkspaces`) acrescente `floating: []`; em `loadPersisted`, normalize: `workspaces: (Array.isArray(parsed.workspaces) ? parsed.workspaces : []).map((w) => ({ ...w, floating: Array.isArray(w.floating) ? w.floating.filter((x) => typeof x === 'string') : [] }))`.
  - `protocol.ts`: `| { t: 'float.set'; paneId: string; mode: 'float' | 'dock' | 'hide' }` e `| { t: 'float.prefs'; paneId: string; bounds?: Bounds | null; onTop?: boolean; allDesks?: boolean }`.
  - `daemon.ts`:
    - `workspace.create`: `floating: []` no objeto novo.
    - `buildState`: `floating: w.floating`; no resumo, `floating: x.floating.map((paneId) => ({ paneId, ...DEFAULT_FLOAT, ...this.persisted.paneMeta[paneId]?.float }))`.
    - `layout.save`: o conjunto `ids` da poda passa a incluir `...this.persisted.workspaces.flatMap((w) => w.floating)`.
    - método `private floatOwner(paneId: string, connWs: string): Workspace` → espaço do `PaneRecord` se houver, senão o da conexão.
    - handlers:

```ts
      case 'float.set': {
        const w = this.floatOwner(req.paneId, conn.workspaceId)
        for (const x of this.persisted.workspaces) x.floating = x.floating.filter((id) => id !== req.paneId)
        if (req.mode === 'float') {
          w.floating.push(req.paneId)
          // a janela de origem já tirou a folha; aqui garante para quem não tirou (contratar, outra janela)
          w.layout = { ...w.layout, tabs: w.layout.tabs.map((t) => ({ ...t, root: t.root ? removeLeafFrom(t.root, req.paneId) : null })) }
        } else if (req.mode === 'dock') {
          w.layout = insertBeside(w.layout, '', req.paneId)
        }
        this.changed()
        return null
      }
      case 'float.prefs': {
        const cur = this.persisted.paneMeta[req.paneId] ?? { name: null, color: null }
        const f = { ...DEFAULT_FLOAT, ...cur.float }
        if (req.bounds !== undefined) f.bounds = req.bounds
        if (req.onTop !== undefined) f.onTop = req.onTop
        if (req.allDesks !== undefined) f.allDesks = req.allDesks
        this.persisted.paneMeta[req.paneId] = { ...cur, float: f }
        this.changed()
        return null
      }
```
    - `hire()`: se `args.onde === 'flutuante'`, `w.floating.push(id)` em vez de `w.layout = insertBeside(...)`.
  - `src/mcp/protocol.ts`: `onde` aceita `['aba-do-lider', 'flutuante']` (descrição: "flutuante = janela própria por cima de tudo").
  - Ajuste literais de `AppState`/`WorkspaceSummary`/`Workspace` nos testes que o typecheck acusar (`floating: []`).

- [ ] **Step 4:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5:** `git commit -am "feat(flutuante): daemon guarda flutuantes, float.set/float.prefs, resumo e contratar flutuante"`

---

### Task 2: Main — modelo puro (sincronizar, caber na tela, cascata)

**Files:** Create `src/main/float-model.ts`; Test `tests/main/float-model.test.ts`

**Interfaces — Produces:**
- `syncFloats(summary: WorkspaceSummary[], activeWs: Set<string>, openNow: Map<string, FloatSpec>): { open: (FloatSpec & { wsId: string })[]; close: string[]; update: (FloatSpec & { wsId: string })[] }`
- `fitBounds(b: Bounds | null, displays: Bounds[], fallback: Bounds): Bounds` — `null` ou sem interseção ≥ 50 px com algum monitor → `fallback`
- `cascade(base: Bounds, n: number): Bounds` — desloca 30·n em x e y
- `floatHome(workspaceWin: Bounds | null, screen: Bounds, n: number): Bounds` — 640×400 no canto superior direito da janela do espaço (ou da tela), margem 24, cascata `n`

- [ ] **Step 1: Testes que falham** — `tests/main/float-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cascade, fitBounds, floatHome, syncFloats } from '../../src/main/float-model'

const spec = (paneId: string, over = {}) => ({ paneId, bounds: null, onTop: true, allDesks: false, ...over })
const ws = (id: string, floating: ReturnType<typeof spec>[]) => ({ id, name: id, open: true, sessions: 0, attention: 0, tabs: [], hidden: [], floating })

describe('float-model', () => {
  it('sync: abre as que faltam, fecha as que saíram, atualiza prefs; ignora espaço não ativado', () => {
    const summary = [ws('a', [spec('p1'), spec('p2', { onTop: false })]), ws('b', [spec('p3')])]
    const openNow = new Map([['p2', spec('p2')], ['p9', spec('p9')]])
    const r = syncFloats(summary, new Set(['a']), openNow)
    expect(r.open).toEqual([{ ...spec('p1'), wsId: 'a' }])
    expect(r.close).toEqual(['p9'])
    expect(r.update).toEqual([{ ...spec('p2', { onTop: false }), wsId: 'a' }])
  })
  it('fitBounds: fora de qualquer monitor volta ao padrão', () => {
    const screen = { x: 0, y: 0, width: 1440, height: 900 }
    const fb = { x: 100, y: 100, width: 640, height: 400 }
    expect(fitBounds({ x: 3000, y: 100, width: 640, height: 400 }, [screen], fb)).toEqual(fb)
    expect(fitBounds(null, [screen], fb)).toEqual(fb)
    expect(fitBounds({ x: 10, y: 10, width: 640, height: 400 }, [screen], fb)).toEqual({ x: 10, y: 10, width: 640, height: 400 })
  })
  it('cascata e posição inicial no canto superior direito', () => {
    expect(cascade({ x: 0, y: 0, width: 640, height: 400 }, 2)).toEqual({ x: 60, y: 60, width: 640, height: 400 })
    expect(floatHome({ x: 0, y: 0, width: 1440, height: 900 }, { x: 0, y: 0, width: 1440, height: 900 }, 0)).toEqual({ x: 776, y: 24, width: 640, height: 400 })
  })
})
```

- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar `float-model.ts` (puro, sem `electron`):

```ts
import type { Bounds, FloatSpec, WorkspaceSummary } from '../shared/types'

type Placed = FloatSpec & { wsId: string }
const same = (a: FloatSpec, b: FloatSpec) => a.onTop === b.onTop && a.allDesks === b.allDesks

/** o resumo do daemon manda; só espaços ativados nesta execução mostram flutuantes */
export function syncFloats(summary: WorkspaceSummary[], activeWs: Set<string>, openNow: Map<string, FloatSpec>) {
  const want = new Map<string, Placed>()
  for (const w of summary) if (activeWs.has(w.id)) for (const f of w.floating) want.set(f.paneId, { ...f, wsId: w.id })
  const open: Placed[] = []
  const update: Placed[] = []
  for (const [id, f] of want) {
    const cur = openNow.get(id)
    if (!cur) open.push(f)
    else if (!same(cur, f)) update.push(f)
  }
  const close = [...openNow.keys()].filter((id) => !want.has(id))
  return { open, close, update }
}

const overlap = (a: Bounds, b: Bounds) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) >= 50 && Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) >= 50

export function fitBounds(b: Bounds | null, displays: Bounds[], fallback: Bounds): Bounds {
  return b && displays.some((d) => overlap(b, d)) ? b : fallback
}

export function cascade(base: Bounds, n: number): Bounds {
  return { ...base, x: base.x + 30 * n, y: base.y + 30 * n }
}

export function floatHome(workspaceWin: Bounds | null, screen: Bounds, n: number): Bounds {
  const area = workspaceWin ?? screen
  return cascade({ x: area.x + area.width - 640 - 24, y: area.y + 24, width: 640, height: 400 }, n)
}
```

- [ ] **Step 4:** `rtk proxy npx vitest run --reporter=dot tests/main/float-model.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5:** `git add -A && git commit -m "feat(flutuante): modelo puro do main (sincronizar, caber na tela, cascata)"`

---

### Task 3: Main — janelas flutuantes, atalho e IPC

**Files:** Modify `src/main/windows.ts`, `src/main/index.ts`, `src/shared/keybindings.ts`, `src/main/menu-template.ts`, `src/shared/bridge.ts`, `src/preload/index.ts`; Test `tests/main/menu-template.test.ts`

**Interfaces — Consumes:** `syncFloats`, `fitBounds`, `floatHome`, `FloatSpec`, resumo com `floating` (Tasks 1–2). **Produces:** `WindowManager.syncFloats(summary)`, `WindowManager.focusFloat(paneId): boolean`, `WindowManager.activate(wsId)` (marca o espaço como ativado), IPC `gt:focusFloat(paneId)`, `gt:floatPrefs({ paneId, onTop?, allDesks? })`; bridge `focusFloat(paneId): Promise<boolean>`, `floatPrefs(o)`.

- [ ] **Step 1: Teste que falha** — `menu-template.test.ts`: `accelOf(build('mac'), 'Flutuar / encaixar painel')` é `Cmd+Shift+F`; linux `Ctrl+Shift+F`; e o item fica no menu **Sessão**.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** `keybindings.ts`: `{ id: 'toggle-float', label: 'Flutuar / encaixar painel', group: 'sessao', mac: 'Cmd+Shift+F', linux: 'Ctrl+Shift+F' }` depois de `hide-pane`; `menu-template.ts`: `item('toggle-float')` depois de `item('hide-pane')`.
- [ ] **Step 4: Janelas** (sem teste automatizado; verificação: typecheck, build e teste real) — `windows.ts`:
  - `private active = new Set<string>()`; `activate(id)` adiciona; `open(id)` chama `activate(id)`.
  - `private floats = new Map<string, { win: BrowserWindow; link: DaemonLink; spec: FloatSpec; wsId: string; closing: boolean }>()`.
  - `syncFloats(summary: WorkspaceSummary[])`: `const r = syncFloats(summary, this.active, new Map([...this.floats].map(([k, v]) => [k, v.spec])))`; para cada `r.open` → `openFloat(f, n)` com `n` = quantas já abertas sem `bounds` no espaço; `r.close` → `closeFloat(id)`; `r.update` → `applyLevel(win, f)` e guarda `spec`.
  - `openFloat(f, n)`:

```ts
    const wsWin = this.entries.get(f.wsId)?.win
    const primary = screen.getPrimaryDisplay().workArea
    const home = floatHome(wsWin && !wsWin.isDestroyed() ? wsWin.getBounds() : null, primary, n)
    const bounds = fitBounds(f.bounds, screen.getAllDisplays().map((d) => d.workArea), home)
    const win = new BrowserWindow({
      ...bounds,
      minWidth: 320,
      minHeight: 180,
      frame: false,
      backgroundColor: '#1e1e1e',
      title: 'Gerenciador de Terminal — flutuante',
      webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: false },
    })
    applyLevel(win, f)
    const link = new DaemonLink({ socketPath, daemonScript, workspaceId: f.wsId, onEvent: (e) => { if (e.t !== 'usage.alert' && !win.isDestroyed()) win.webContents.send('gt:event', e) } })
    const entry = { win, link, spec: f, wsId: f.wsId, closing: false }
    this.floats.set(f.paneId, entry)
    let t: NodeJS.Timeout | null = null
    const save = () => {
      if (t) clearTimeout(t)
      t = setTimeout(() => !win.isDestroyed() && void link.request({ t: 'float.prefs', paneId: f.paneId, bounds: win.getBounds() }).catch(() => {}), 400)
    }
    win.on('move', save)
    win.on('resize', save)
    win.on('close', (ev) => {
      if (this.quitting || entry.closing) return
      ev.preventDefault()
      void link.request({ t: 'float.set', paneId: f.paneId, mode: 'hide' }).catch(() => {})
    })
    win.on('closed', () => {
      link.close()
      if (this.floats.get(f.paneId) === entry) this.floats.delete(f.paneId)
    })
    this.load(win, { view: 'float', ws: f.wsId, pane: f.paneId })
    void link.start().catch(() => {})
```
  - `applyLevel(win, f)`: `win.setAlwaysOnTop(f.onTop, f.allDesks ? 'screen-saver' : 'floating'); win.setVisibleOnAllWorkspaces(f.allDesks, { visibleOnFullScreen: true })`.
  - `closeFloat(id)`: `entry.closing = true; entry.win.close()`.
  - `focusFloat(paneId)`: se existir, `show(); moveTop(); focus()` e `true`; senão `false`.
  - `entryOf`/`linkFor`: incluir as janelas flutuantes (o `linkFor` de uma flutuante é a `link` dela); `windows()` inclui as flutuantes (para `sendMenu` em foco).
  - `detachAll()`: também as flutuantes.
  - `index.ts`:
    - `onSummary`: depois de guardar o resumo, `manager.syncFloats(list)`.
    - `startup()`: `direct` → `manager.open(id)` já ativa; a tela de reabrir chama `open` em cada um.
    - `ipcMain.handle('gt:focusFloat', (_e, id: string) => manager.focusFloat(id))`.
  - `bridge.ts`/`preload`: `focusFloat(paneId)` → `ipcRenderer.invoke('gt:focusFloat', paneId)`.

- [ ] **Step 5:** `npm test && npm run typecheck && npm run build` → PASS.
- [ ] **Step 6:** `git commit -am "feat(flutuante): janelas flutuantes no processo principal, atalho ⇧⌘F"`

---

### Task 4: Renderer — modelo (encaixe, revelar, sidebar)

**Files:** Modify `src/renderer/src/workspaces-model.ts`, `src/renderer/src/sidebar-model.ts`; Create `src/renderer/src/float-model.ts`; Test `tests/renderer/workspaces-model.test.ts`, `tests/renderer/float-model.test.ts`, `tests/renderer/sidebar-model.test.ts`

**Interfaces — Produces:**
- `mergeIncomingLayout(local, incoming, prevPaneIds, nextPaneIds, docked?: Set<string>)` — `docked` = saiu de `floating` neste estado; folha do daemon para um id em `docked` que o local não tem é "chegada"
- `revealTarget(app: Pick<AppState, 'floating'>, paneId: string): 'float' | 'grid'`
- `SessionItem.floating: boolean`; `hidden` passa a excluir as flutuantes

- [ ] **Step 1: Testes que falham**

```ts
// workspaces-model.test.ts
  it('encaixe: folha do daemon para painel que saiu das flutuantes entra', () => {
    const local = { tabs: [{ id: 't', name: 'A', root: leaf('a') }], activeTabId: 't' }
    const docked = { tabs: [{ id: 't', name: 'A', root: { type: 'split' as const, dir: 'row' as const, sizes: [], children: [leaf('a'), leaf('f')] } }], activeTabId: 't' }
    expect(mergeIncomingLayout(local, docked, new Set(['a', 'f']), new Set(['a', 'f']), new Set(['f']))).toBe(docked)
    expect(mergeIncomingLayout(local, docked, new Set(['a', 'f']), new Set(['a', 'f']))).toBe(local)
  })
```

```ts
// tests/renderer/float-model.test.ts
import { describe, expect, it } from 'vitest'
import { revealTarget } from '../../src/renderer/src/float-model'
describe('revelar painel flutuante', () => {
  it('flutuante → foca a janela; senão → grade', () => {
    expect(revealTarget({ floating: ['p'] }, 'p')).toBe('float')
    expect(revealTarget({ floating: [] }, 'p')).toBe('grid')
  })
})
```

`sidebar-model.test.ts`: um painel vivo, fora do layout e em `app.floating` vira `{ floating: true, hidden: false }`; fora do layout e fora de `floating` → `{ floating: false, hidden: true }`.

- [ ] **Step 2:** rodar → FAIL. **Step 3:**
  - `workspaces-model.ts`: novo parâmetro `docked: Set<string> = new Set()`; `arrived(id) = !mine.has(id) && ((nextPaneIds.has(id) && !prevPaneIds.has(id)) || docked.has(id))`.
  - `float-model.ts`: `export function revealTarget(app: Pick<AppState, 'floating'>, paneId: string): 'float' | 'grid' { return app.floating.includes(paneId) ? 'float' : 'grid' }`.
  - `sidebar-model.ts`: `SessionItem.floating: boolean`; em `toItem`: `const floating = app.floating.includes(p.id)`; `hidden: p.alive && tab === null && !floating`, `floating`.
- [ ] **Step 4:** `npm test && npm run typecheck` → PASS.
- [ ] **Step 5:** `git commit -am "feat(flutuante): modelo do renderer (encaixe, revelar, ⧉ na sidebar)"`

---

### Task 5: Renderer — janela flutuante e controles na grade

**Files:** Create `src/renderer/src/components/FloatView.tsx`; Modify `src/renderer/src/main.tsx`, `store.ts`, `actions.ts`, `flows.ts`, `components/PaneHeader.tsx`, `components/PaneFrame.tsx`, `components/FilePane.tsx`, `components/Sidebar.tsx`, `styles.css`; Test `tests/renderer/store-layout-owner.test.ts`

**Interfaces — Consumes:** Tasks 1, 3, 4. **Produces:** `setLayoutOwner(v: boolean)` (store); `floatPane(id)`, `dockPane(id)`, `hideFloat(id)` (actions); rota `view=float`.

- [ ] **Step 1: Teste que falha** — `tests/renderer/store-layout-owner.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'

const sent: unknown[] = []
beforeEach(() => {
  sent.length = 0
  ;(globalThis as unknown as { window: unknown }).window = { gt: { send: (r: unknown) => sent.push(r) } }
})

describe('dono do layout', () => {
  it('janela flutuante não grava layout', async () => {
    const { setUi, setLayoutOwner, updateLayout } = await import('../../src/renderer/src/store')
    setUi({ app: { layout: { tabs: [], activeTabId: null } } as never })
    setLayoutOwner(false)
    updateLayout(() => ({ tabs: [{ id: 't', name: 'A', root: null }], activeTabId: 't' }))
    expect(sent).toEqual([])
    setLayoutOwner(true)
    updateLayout(() => ({ tabs: [{ id: 't', name: 'A', root: null }], activeTabId: 't' }))
    expect(sent).toHaveLength(1)
  })
})
```

- [ ] **Step 2:** rodar → FAIL. **Step 3:** `store.ts`: `let layoutOwner = true; export function setLayoutOwner(v: boolean): void { layoutOwner = v }`; em `updateLayout`, `if (!app || !layoutOwner) return` no início.
- [ ] **Step 4: Interface**
  - `actions.ts`:
    - `export function floatPane(id: string)`: `hidePane(id)` e `window.gt.request({ t: 'float.set', paneId: id, mode: 'float' }).catch(showError)` (para arquivo, o mesmo).
    - `export function dockPane(id: string)`: `window.gt.request({ t: 'float.set', paneId: id, mode: 'dock' }).catch(showError)`.
    - `export function hideFloat(id: string)`: `float.set hide`.
    - `revealPane(id)`: no começo, `if (getUi().app && revealTarget(getUi().app!, id) === 'float') { void window.gt.focusFloat(id); return }`.
    - `runMenuAction('toggle-float')`: na janela flutuante (`floatPaneId` do módulo, ver abaixo) → `dockPane(floatPaneId)`; na grade → `floatPane(focusedPaneId)` se houver.
  - `main.tsx`:
    - `const floatPaneId = view === 'float' ? new URLSearchParams(location.search).get('pane') : null` (exporte de um módulo `src/renderer/src/view.ts` para `actions.ts` ler).
    - `case 'state'`: calcule `docked = new Set((s.app?.floating ?? []).filter((id) => !e.state.floating.includes(id)))` e passe para `mergeIncomingLayout`.
    - `view === 'float'`: `setLayoutOwner(false)`; registra só `onEvent` (state → `setUi({ app: e.state, connected: true })` + `terminals.applySettings`; `pane.data`; `file.changed`; `disconnected/reconnected`), `onMenu(runMenuAction)`, `state.get`; **sem** notificações, badge ou fechamento automático; monta `<FloatView paneId={floatPaneId} />`.
  - `FloatView.tsx`: `<div className="float-root">` com `<FloatHeader>` (classe `float-header`, `-webkit-app-region: drag`; projeto · ⎇ worktree · nome com 👑 · bolinha via `headerView`; botões `no-drag`: 📌 alterna `onTop`, 🌐 alterna `allDesks` → `window.gt.request({ t: 'float.prefs', paneId, onTop | allDesks })`; ⤓ `dockPane`; ✕ `hideFloat` — arquivo com alteração (`dirtyFiles.has(id)`) pergunta antes com `window.gt.confirm`) e o corpo: arquivo (`isFilePane`) → `<FilePane paneId bare />`; senão `<PaneFrame paneId floating />`. Estados de 📌/🌐 lidos de `app.workspaces.find(w => w.id === app.workspaceId)?.floating.find(f => f.paneId === paneId)`.
  - `PaneFrame`: prop `floating?: boolean` → sem `PaneHeader` (a flutuante tem o seu), sem arrastar/soltar; o resto igual (inclusive "terminal encerrado"/retomar).
  - `FilePane`: prop `bare?: boolean` esconde o próprio cabeçalho/✕ quando na flutuante (o `FloatHeader` cuida).
  - `PaneHeader` (grade): botão `⧉` (title "Flutuar · ⇧⌘F") antes do ✕ → `floatPane(pane.id)`; o cabeçalho de arquivo na grade ganha o mesmo botão.
  - `flows.ts` `sessionMenu`: item `Flutuar` (ou `Encaixar` se `s.floating`) → `floatPane`/`dockPane`.
  - `Sidebar.tsx` `SessionRow`: se `s.floating`, `<span className="sb-tag">⧉</span>`; o clique já vai por `revealPane` (que foca a flutuante).
  - `styles.css`: `.float-root { display: flex; flex-direction: column; height: 100vh; }`, `.float-header { -webkit-app-region: drag; display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px; background: var(--bg-bar); border-bottom: 1px solid var(--border); font-size: 12px; user-select: none; }`, `.float-header button { -webkit-app-region: no-drag; }`, `.float-header .on { color: var(--accent); }`, `.float-body { flex: 1; min-height: 0; display: flex; }`.
- [ ] **Step 5:** `npm test && npm run typecheck && npm run build` → PASS.
- [ ] **Step 6:** `git add -A && git commit -m "feat(flutuante): janela flutuante, ⧉ na grade e na sidebar, flutuar/encaixar"`

---

### Task 6: Teste real (instância isolada)

- [ ] `builtin cd "<worktree>" && GT_HOME=/tmp/gt-flutuante nohup npm run dev > /tmp/gt-flutuante-dev.log 2>&1 & disown`.
- [ ] Com o usuário: flutuar o techlead por cima do Chrome; 🌐 e trocar de mesa; app em tela cheia; ⇧⌘F encaixa; ✕ esconde e a sidebar mostra oculta; ⌘Q e reabrir (posição e opções); fechar a janela do espaço mantém a flutuante; dev contratado com `onde: "flutuante"`; arquivo flutuante (editar, salvar, encaixar); ⌘J para uma sessão flutuante.
- [ ] Registrar o resultado no ledger e no commit de merge.
