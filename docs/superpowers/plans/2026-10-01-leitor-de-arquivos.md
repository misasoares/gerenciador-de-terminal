# Leitor e editor de arquivos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Painel de arquivo (CodeMirror 6, `.md` renderizado) aberto por ⌘+clique em caminho no terminal, ⌘P ou menu da worktree, salvando com proteção contra sobrescrever mudança feita por fora.

**Architecture:** O daemon lê/salva/vigia/lista arquivos (`src/daemon/files.ts`) e guarda `{ path, mode }` de cada painel de arquivo em `filePanes` (como faz com `paneMeta`). O layout continua só com folhas `{ type: 'leaf', paneId }`; ids `file:<uuid>` viram `FilePane` no `Workspace`. Um detector puro acha caminhos nas linhas do terminal; o xterm sublinha os que existem.

**Tech Stack:** TypeScript, Electron (electron-vite), React, xterm.js, CodeMirror 6, marked, DOMPurify, vitest.

**Spec:** `docs/superpowers/specs/2026-10-01-leitor-de-arquivos-design.md`

## Global Constraints

- Desvio da spec (decidido no plano): `{ path, mode }` fica em `Persisted.filePanes` / `AppState.filePanes` no daemon, **não** em `Layout.files` — várias funções de layout recriam o objeto sem campos extras e perderiam os arquivos. O daemon remove entradas cujo id saiu do layout a cada `layout.save`.
- Ids de painel de arquivo: `file:<uuid>`; `isFilePane(id)` é a única regra.
- Limite de leitura: 2 MB (`file-too-large`); binário = byte nulo nos primeiros 8 KB (`file-binary`); ausente = `file-missing`; conflito ao salvar = `file-changed` (mensagens exatas).
- Lista do ⌘P: `git ls-files -co --exclude-standard` + `.env*` ignorados (pathspecs `.env*` e `*/.env*`); sem git, varredura pulando `node_modules`, `.git`, `dist`, `out`, `build`; limite 20 000 com `truncated: true`.
- Atalho novo `open-file` "Abrir arquivo…": mac `Cmd+P`, linux `Ctrl+Shift+P`. Link de arquivo no terminal ativa com ⌘ (mac) ou Ctrl (linux).
- `.md` abre em `view`; os demais em `edit`. Quebra de linha CRLF é preservada ao salvar.
- Textos exatos: `Abrir arquivo…`, `● não salvo`, `Visualizar`, `Editar`, `O arquivo mudou no disco`, `Recarregar`, `Manter o meu`, `atualizado do disco`, `Não dá para abrir este arquivo aqui`, `Abrir no app padrão`, `Mostrar no Finder`, `Arquivo não encontrado`, `Salvar mesmo assim`, `Fechar`, `Descartar as alterações em <nome>?`, `lista parcial`.
- Dependências novas (só estas): `codemirror`, `@codemirror/language`, `@codemirror/lang-markdown`, `@codemirror/lang-json`, `@codemirror/lang-yaml`, `@codemirror/lang-javascript`, `@codemirror/legacy-modes`, `marked`, `dompurify`.

## Review Focus

1. **Mesmo arquivo aberto duas vezes** (⌘+clique de novo no mesmo caminho) → foca o painel que já existe, não abre outro. Teste na Task 4 (`findFilePane`).
2. **Agente reescreve o arquivo por "renomear por cima"** (escrita atômica de vários editores/ferramentas) → o aviso de mudança ainda chega (o watcher vigia a pasta, não o inode). Teste na Task 2.
3. **Salvar um arquivo apagado depois de aberto** → recria o arquivo (e pastas), sem erro. Teste na Task 1.
4. **URL com cara de caminho no terminal** (`https://github.com/a/b.md`) → não vira link de arquivo. Teste na Task 3.
5. **`.env` com CRLF** → salvar mantém `\r\n`. Teste na Task 4 (`lineSeparator`).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/daemon/files.ts` (novo) | `readFile`, `writeFile`, `listFiles`, `existing`, `FileWatcher` |
| `src/daemon/server.ts` (mod) | `Conn.onClose` |
| `src/daemon/persist.ts`, `daemon.ts` (mod) | `filePanes`, requisições `file.*` e `filepane.*`, poda no `layout.save` |
| `src/shared/types.ts`, `protocol.ts`, `keybindings.ts` (mod) | tipos, mensagens, ação `open-file` |
| `src/renderer/src/file-links.ts` (novo) | `findPathCandidates` (puro) |
| `src/renderer/src/file-model.ts` (novo) | `isFilePane`, `languageFor`, `lineSeparator`, `insertFileLeaf`, `findFilePane`, `pickerRoot` (puro) |
| `src/renderer/src/file-events.ts` (novo) | pub/sub de `file.changed` |
| `src/renderer/src/file-link-provider.ts` (novo) | `registerLinkProvider` do xterm |
| `src/renderer/src/components/FilePane.tsx`, `FilePicker.tsx` (novos) | painel e ⌘P |
| `src/renderer/src/actions.ts`, `flows.ts`, `header.ts`, `store.ts`, `main.tsx`, `terminals.ts`, `components/Workspace.tsx`, `components/Modals.tsx`, `styles.css` (mod) | ligação |

---

### Task 1: Ler, salvar, listar e conferir arquivos (daemon)

**Files:**
- Create: `src/daemon/files.ts`
- Test: `tests/daemon/files.test.ts`

**Interfaces:**
- Produces:
  - `MAX_BYTES = 2 * 1024 * 1024`
  - `interface FileContent { content: string; mtimeMs: number; size: number }`
  - `readFile(p: string): Promise<FileContent>` (erros `file-missing`, `file-too-large`, `file-binary`)
  - `writeFile(p: string, content: string, expectedMtimeMs: number | null): Promise<{ mtimeMs: number }>` (erro `file-changed`)
  - `listFiles(root: string, limit?: number): Promise<{ files: string[]; truncated: boolean }>` (caminhos relativos a `root`, ordenados)
  - `existing(cwd: string, paths: string[]): Promise<{ path: string; abs: string }[]>`

- [ ] **Step 1: Teste que falha**

`tests/daemon/files.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { existing, listFiles, MAX_BYTES, readFile, writeFile } from '../../src/daemon/files'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-f-')))
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' })

describe('arquivos', () => {
  it('lê conteúdo e mtime; erros de ausente, grande e binário', async () => {
    const d = tmp()
    fs.writeFileSync(path.join(d, 'a.env'), 'X=1\n')
    const r = await readFile(path.join(d, 'a.env'))
    expect(r).toMatchObject({ content: 'X=1\n', size: 4 })
    expect(typeof r.mtimeMs).toBe('number')
    await expect(readFile(path.join(d, 'nada'))).rejects.toThrow('file-missing')
    await expect(readFile(d)).rejects.toThrow('file-missing')
    fs.writeFileSync(path.join(d, 'big'), Buffer.alloc(MAX_BYTES + 1, 97))
    await expect(readFile(path.join(d, 'big'))).rejects.toThrow('file-too-large')
    fs.writeFileSync(path.join(d, 'bin'), Buffer.from([1, 2, 0, 3]))
    await expect(readFile(path.join(d, 'bin'))).rejects.toThrow('file-binary')
  })

  it('salva com checagem de mtime; força com null; preserva permissão; recria arquivo apagado', async () => {
    const d = tmp()
    const f = path.join(d, '.env')
    fs.writeFileSync(f, 'A=1\n')
    fs.chmodSync(f, 0o600)
    const { mtimeMs } = await readFile(f)
    fs.utimesSync(f, new Date(), new Date(Date.now() + 5000)) // outro programa mexeu
    await expect(writeFile(f, 'A=2\n', mtimeMs)).rejects.toThrow('file-changed')
    const w = await writeFile(f, 'A=2\n', null)
    expect(fs.readFileSync(f, 'utf8')).toBe('A=2\n')
    expect(fs.statSync(f).mode & 0o777).toBe(0o600)
    expect(w.mtimeMs).toBe(fs.statSync(f).mtimeMs)
    fs.rmSync(f)
    await writeFile(f, 'A=3\n', w.mtimeMs) // apagado depois de aberto: recria
    expect(fs.readFileSync(f, 'utf8')).toBe('A=3\n')
    await writeFile(path.join(d, 'novo', 'pasta', 'x.md'), '# x', null)
    expect(fs.existsSync(path.join(d, 'novo', 'pasta', 'x.md'))).toBe(true)
  })

  it('lista do git: versionados, não adicionados e .env ignorados; sem node_modules', async () => {
    const d = tmp()
    git(d, 'init', '-q')
    fs.writeFileSync(path.join(d, '.gitignore'), '.env*\nnode_modules/\n')
    fs.writeFileSync(path.join(d, 'a.txt'), '')
    git(d, 'add', '.')
    git(d, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'a')
    fs.writeFileSync(path.join(d, 'b.txt'), '')
    fs.writeFileSync(path.join(d, '.env'), '')
    fs.mkdirSync(path.join(d, 'sub'))
    fs.writeFileSync(path.join(d, 'sub', '.env.local'), '')
    fs.mkdirSync(path.join(d, 'node_modules'))
    fs.writeFileSync(path.join(d, 'node_modules', 'x.js'), '')
    expect(await listFiles(d)).toEqual({ files: ['.env', '.gitignore', 'a.txt', 'b.txt', 'sub/.env.local'], truncated: false })
  })

  it('sem git: varre pulando pastas pesadas; respeita o limite', async () => {
    const d = tmp()
    for (const f of ['a.md', 'z/b.md', 'node_modules/n.js', 'dist/d.js', '.git/c']) {
      fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true })
      fs.writeFileSync(path.join(d, f), '')
    }
    expect(await listFiles(d)).toEqual({ files: ['a.md', 'z/b.md'], truncated: false })
    expect(await listFiles(d, 1)).toEqual({ files: ['a.md'], truncated: true })
  })

  it('existing resolve relativos pelo cwd e devolve só arquivos que existem', async () => {
    const d = tmp()
    fs.mkdirSync(path.join(d, 'docs'))
    fs.writeFileSync(path.join(d, 'docs', 'r.md'), '')
    expect(await existing(d, ['docs/r.md', 'docs', 'nada.md', path.join(d, 'docs', 'r.md')])).toEqual([
      { path: 'docs/r.md', abs: path.join(d, 'docs', 'r.md') },
      { path: path.join(d, 'docs', 'r.md'), abs: path.join(d, 'docs', 'r.md') },
    ])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/files.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

`src/daemon/files.ts`:

```ts
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const MAX_BYTES = 2 * 1024 * 1024
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build'])

export interface FileContent {
  content: string
  mtimeMs: number
  size: number
}

export async function readFile(p: string): Promise<FileContent> {
  let st: fs.Stats
  try {
    st = await fs.promises.stat(p)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('file-missing')
    throw e
  }
  if (!st.isFile()) throw new Error('file-missing')
  if (st.size > MAX_BYTES) throw new Error('file-too-large')
  const buf = await fs.promises.readFile(p)
  if (buf.subarray(0, 8192).includes(0)) throw new Error('file-binary')
  return { content: buf.toString('utf8'), mtimeMs: st.mtimeMs, size: st.size }
}

/** grava no próprio arquivo (preserva modo e dono); com expectedMtimeMs, recusa se mudou no disco */
export async function writeFile(p: string, content: string, expectedMtimeMs: number | null): Promise<{ mtimeMs: number }> {
  const st = await fs.promises.stat(p).catch(() => null)
  if (st && expectedMtimeMs !== null && st.mtimeMs !== expectedMtimeMs) throw new Error('file-changed')
  if (!st) await fs.promises.mkdir(path.dirname(p), { recursive: true })
  await fs.promises.writeFile(p, content)
  return { mtimeMs: (await fs.promises.stat(p)).mtimeMs }
}

function gitLines(root: string, args: string[]): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', root, ...args], { maxBuffer: 64 * 1024 * 1024, timeout: 15_000 }, (err, stdout) => {
      resolve(err ? null : String(stdout).split('\0').filter(Boolean))
    })
  })
}

async function walk(root: string, limit: number): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = []
  const stack = ['']
  while (stack.length) {
    const rel = stack.pop()!
    const entries = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) stack.push(r)
      } else if (e.isFile()) files.push(r)
    }
  }
  files.sort()
  return { files: files.slice(0, limit), truncated: files.length > limit }
}

export async function listFiles(root: string, limit = 20_000): Promise<{ files: string[]; truncated: boolean }> {
  const tracked = await gitLines(root, ['ls-files', '-co', '--exclude-standard', '-z'])
  if (!tracked) return walk(root, limit)
  const envs = (await gitLines(root, ['ls-files', '-oi', '--exclude-standard', '-z', '--', '.env*', '*/.env*'])) ?? []
  const all = [...new Set([...tracked, ...envs])].sort()
  return { files: all.slice(0, limit), truncated: all.length > limit }
}

export async function existing(cwd: string, paths: string[]): Promise<{ path: string; abs: string }[]> {
  const out: { path: string; abs: string }[] = []
  for (const p of paths) {
    const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p)
    const st = await fs.promises.stat(abs).catch(() => null)
    if (st?.isFile()) out.push({ path: p, abs })
  }
  return out
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/daemon/files.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/files.ts tests/daemon/files.test.ts
git commit -m "feat(arquivos): ler, salvar, listar e conferir arquivos no daemon"
```

---

### Task 2: Vigiar arquivos, protocolo e `filePanes` no daemon

**Files:**
- Modify: `src/daemon/files.ts`, `src/daemon/server.ts`, `src/daemon/persist.ts`, `src/daemon/daemon.ts`, `src/shared/types.ts`, `src/shared/protocol.ts`, `tests/helpers/app-client.ts`
- Test: `tests/daemon/files.test.ts`, `tests/daemon/daemon.test.ts`, `tests/daemon/persist.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `class FileWatcher<S> { constructor(notify: (path: string, mtimeMs: number | null, subs: S[]) => void, debounceMs?: number); watch(path: string, sub: S): void; unwatch(path: string, sub: S): void; unwatchAll(sub: S): void; stop(): void }`
  - `Conn.onClose(fn: () => void): void`
  - `FilePaneMeta = { path: string; mode: 'view' | 'edit' }`; `AppState.filePanes: Record<string, FilePaneMeta>`; `Persisted.filePanes`
  - Requisições: `file.read {path}` → `FileContent`; `file.write {path, content, expectedMtimeMs}` → `{mtimeMs}`; `file.list {root}`; `file.exists {cwd, paths}`; `file.watch {path}`; `file.unwatch {path}`; `filepane.set {id, path, mode}`
  - Evento: `{ t: 'file.changed'; path: string; mtimeMs: number | null }`
  - `connectApp(...).fileEvents(): { path: string; mtimeMs: number | null }[]`

- [ ] **Step 1: Testes que falham**

Em `tests/daemon/files.test.ts`, import `FileWatcher` junto dos outros e adicione:

```ts
describe('FileWatcher', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
  it('avisa mudança, troca por renomear, remoção; para no unwatch', async () => {
    const d = tmp()
    const f = path.join(d, 'r.md')
    fs.writeFileSync(f, 'a')
    const got: [string, number | null, string[]][] = []
    const w = new FileWatcher<string>((p, m, subs) => got.push([p, m, subs]), 30)
    w.watch(f, 'conn-1')
    await wait(50)
    fs.writeFileSync(f, 'b')
    await wait(150)
    expect(got.at(-1)?.[0]).toBe(f)
    expect(got.at(-1)?.[1]).toBe(fs.statSync(f).mtimeMs)
    expect(got.at(-1)?.[2]).toEqual(['conn-1'])
    const before = got.length
    fs.writeFileSync(path.join(d, '.tmp'), 'c')
    fs.renameSync(path.join(d, '.tmp'), f) // escrita atômica de outro programa
    await wait(150)
    expect(got.length).toBeGreaterThan(before)
    fs.rmSync(f)
    await wait(150)
    expect(got.at(-1)?.[1]).toBeNull()
    w.unwatchAll('conn-1')
    const n = got.length
    fs.writeFileSync(f, 'd')
    await wait(150)
    expect(got.length).toBe(n)
    w.stop()
  })
})
```

Em `tests/daemon/persist.test.ts`, no `describe`:

```ts
  it('filePanes tem padrão vazio', () => {
    expect(defaultPersisted()).toMatchObject({ filePanes: {} })
  })
```

Em `tests/helpers/app-client.ts`: `const fileEvents: { path: string; mtimeMs: number | null }[] = []`; no `onMessage`, `if (m.t === 'file.changed') fileEvents.push({ path: m.path, mtimeMs: m.mtimeMs })`; no retorno, `fileEvents: () => fileEvents,`.

Em `tests/daemon/daemon.test.ts`, novo teste:

```ts
  it('arquivos: ler, salvar, listar, vigiar e filePanes podado pelo layout', async () => {
    repo = makeRepo()
    const { app } = await boot()
    const f = path.join(repo.dir, '.env')
    fs.writeFileSync(f, 'A=1\n')
    const r = await app.client.request<{ content: string; mtimeMs: number }>({ t: 'file.read', path: f })
    expect(r.content).toBe('A=1\n')
    await app.client.request({ t: 'file.write', path: f, content: 'A=2\n', expectedMtimeMs: r.mtimeMs })
    expect(fs.readFileSync(f, 'utf8')).toBe('A=2\n')
    await expect(app.client.request({ t: 'file.write', path: f, content: 'x', expectedMtimeMs: 1 })).rejects.toThrow('file-changed')
    const list = await app.client.request<{ files: string[] }>({ t: 'file.list', root: repo.dir })
    expect(list.files).toContain('.env')
    expect(await app.client.request({ t: 'file.exists', cwd: repo.dir, paths: ['.env', 'nada'] })).toEqual([{ path: '.env', abs: f }])

    await app.client.request({ t: 'file.watch', path: f })
    await new Promise((r) => setTimeout(r, 50))
    fs.writeFileSync(f, 'A=3\n')
    await waitFor(() => app.fileEvents().some((e) => e.path === f))

    await app.client.request({ t: 'filepane.set', id: 'file:1', path: f, mode: 'edit' })
    await app.waitState((s) => s.filePanes['file:1']?.path === f)
    await app.client.request({ t: 'layout.save', layout: { tabs: [{ id: 't', name: 'A', root: { type: 'leaf', paneId: 'file:1' } }], activeTabId: 't' } })
    expect((await app.client.request<{ filePanes: Record<string, unknown> }>({ t: 'state.get' })).filePanes['file:1']).toBeTruthy()
    await app.client.request({ t: 'layout.save', layout: { tabs: [{ id: 't', name: 'A', root: null }], activeTabId: 't' } })
    await app.waitState((s) => !s.filePanes['file:1'])
  })
```

(`waitFor` já é importado no arquivo; se não for, `import { waitFor } from '../helpers/wait'`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/files.test.ts tests/daemon/persist.test.ts tests/daemon/daemon.test.ts`
Expected: FAIL (`FileWatcher` não existe; `filePanes` ausente; requisições desconhecidas).

- [ ] **Step 3: Implementar**

Ao fim de `src/daemon/files.ts`:

```ts
interface Watch<S> {
  watcher: fs.FSWatcher | null
  subs: Set<S>
  timer: NodeJS.Timeout | null
}

/** vigia a PASTA do arquivo (sobrevive a "renomear por cima") e avisa quem assinou o caminho */
export class FileWatcher<S> {
  private w = new Map<string, Watch<S>>()

  constructor(private notify: (path: string, mtimeMs: number | null, subs: S[]) => void, private debounceMs = 150) {}

  watch(p: string, sub: S): void {
    let entry = this.w.get(p)
    if (!entry) {
      entry = { watcher: null, subs: new Set(), timer: null }
      const e = entry
      try {
        const base = path.basename(p)
        e.watcher = fs.watch(path.dirname(p), (_ev, name) => {
          if (name && name.toString() !== base) return
          if (e.timer) clearTimeout(e.timer)
          e.timer = setTimeout(() => {
            e.timer = null
            fs.promises
              .stat(p)
              .then((st) => st.mtimeMs, () => null)
              .then((m) => this.notify(p, m, [...e.subs]))
          }, this.debounceMs)
        })
        e.watcher.on('error', () => {})
      } catch {
        // pasta inexistente: sem vigilância (o painel mostra "Arquivo não encontrado")
      }
      this.w.set(p, entry)
    }
    entry.subs.add(sub)
  }

  unwatch(p: string, sub: S): void {
    const e = this.w.get(p)
    if (!e) return
    e.subs.delete(sub)
    if (e.subs.size === 0) this.drop(p, e)
  }

  unwatchAll(sub: S): void {
    for (const [p, e] of this.w) {
      e.subs.delete(sub)
      if (e.subs.size === 0) this.drop(p, e)
    }
  }

  stop(): void {
    for (const [p, e] of this.w) this.drop(p, e)
  }

  private drop(p: string, e: Watch<S>): void {
    if (e.timer) clearTimeout(e.timer)
    e.watcher?.close()
    this.w.delete(p)
  }
}
```

`src/daemon/server.ts`:
- Em `Conn`: `onClose(fn: () => void): void`
- No `createServer`, antes de `const conn`: `const closers: (() => void)[] = []`; no objeto `conn`: `onClose: (fn) => { closers.push(fn) },`; no `sock.on('close', …)`, depois de `sockets.delete(sock)`: `for (const fn of closers) fn()`.

`src/shared/types.ts` (fim do arquivo):

```ts
export interface FilePaneMeta {
  path: string
  mode: 'view' | 'edit'
}
```

e em `AppState`: `filePanes: Record<string, FilePaneMeta>`.

`src/shared/protocol.ts`:
- Import `FilePaneMeta` junto dos tipos.
- `ClientRequest` ganha:

```ts
  | { t: 'file.read'; path: string }
  | { t: 'file.write'; path: string; content: string; expectedMtimeMs: number | null }
  | { t: 'file.list'; root: string }
  | { t: 'file.exists'; cwd: string; paths: string[] }
  | { t: 'file.watch'; path: string }
  | { t: 'file.unwatch'; path: string }
  | { t: 'filepane.set'; id: string; path: string; mode: FilePaneMeta['mode'] }
```

- `ServerMessage` ganha `| { t: 'file.changed'; path: string; mtimeMs: number | null }`.

`src/daemon/persist.ts`: `Persisted.filePanes: Record<string, FilePaneMeta>` (import do tipo); `defaultPersisted()` → `filePanes: {}`; `loadPersisted` → `filePanes: parsed.filePanes && typeof parsed.filePanes === 'object' ? parsed.filePanes : {},`.

`src/daemon/daemon.ts`:
1. Imports: `import { existing, FileWatcher, listFiles, readFile, writeFile } from './files'` e `type Conn` já vem de `./server`.
2. Campo: `private fileWatcher!: FileWatcher<Conn>`
3. Em `init()`, depois de `this.persisted = p`:

```ts
    this.fileWatcher = new FileWatcher<Conn>((path, mtimeMs, subs) => {
      for (const c of subs) c.send({ t: 'file.changed', path, mtimeMs })
    })
```

4. Em `stop()`, depois de `this.monitor.stop()`: `this.fileWatcher.stop()`.
5. Em `buildState()`: `filePanes: this.persisted.filePanes,`.
6. Novos `case` em `handle`:

```ts
      case 'file.read':
        return readFile(req.path)
      case 'file.write':
        return writeFile(req.path, req.content, req.expectedMtimeMs)
      case 'file.list':
        return listFiles(req.root)
      case 'file.exists':
        return existing(req.cwd, req.paths)
      case 'file.watch':
        if (!this.watchedConns.has(conn)) {
          this.watchedConns.add(conn)
          conn.onClose(() => {
            this.fileWatcher.unwatchAll(conn)
            this.watchedConns.delete(conn)
          })
        }
        this.fileWatcher.watch(req.path, conn)
        return null
      case 'file.unwatch':
        this.fileWatcher.unwatch(req.path, conn)
        return null
      case 'filepane.set':
        if (!req.id.startsWith('file:')) throw new Error(`id inválido: ${req.id}`)
        this.persisted.filePanes[req.id] = { path: req.path, mode: req.mode }
        this.changed()
        return null
```

com o campo `private watchedConns = new Set<Conn>()` (limpo no `onClose` de cada conexão).

7. No `case 'layout.save':`, depois de `this.persisted.layout = req.layout`:

```ts
        const ids = new Set(req.layout.tabs.flatMap((t) => leafIds(t.root)))
        for (const id of Object.keys(this.persisted.filePanes)) if (!ids.has(id)) delete this.persisted.filePanes[id]
```

e, no fim do arquivo (fora da classe):

```ts
function leafIds(n: LayoutNode | null): string[] {
  if (!n) return []
  return n.type === 'leaf' ? [n.paneId] : n.children.flatMap(leafIds)
}
```

(importe `LayoutNode` de `../shared/types`).

Atualize os literais de `AppState` em testes do renderer que o typecheck acusar com `filePanes: {}`.

- [ ] **Step 4: Rodar e ver passar (e a suíte)**

Run: `npx vitest run tests/daemon/files.test.ts tests/daemon/persist.test.ts tests/daemon/daemon.test.ts && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon src/shared tests
git commit -m "feat(arquivos): vigiar arquivos, requisições file.* e filePanes no daemon"
```

---

### Task 3: Detector de caminhos no texto do terminal

**Files:**
- Create: `src/renderer/src/file-links.ts`
- Test: `tests/renderer/file-links.test.ts`

**Interfaces:**
- Produces: `interface PathCandidate { text: string; path: string; line: number | null; start: number; end: number }` (`start`/`end` = índices na linha, `end` exclusivo, cobrindo `text`); `findPathCandidates(line: string): PathCandidate[]`

- [ ] **Step 1: Teste que falha**

`tests/renderer/file-links.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { findPathCandidates } from '../../src/renderer/src/file-links'

const paths = (s: string) => findPathCandidates(s).map((c) => [c.path, c.line])

describe('findPathCandidates', () => {
  it('relativo, absoluto, :N e :N:M', () => {
    expect(paths('O relatório parcial está em .private/revisao-interna/frente-a-projetos.md.')).toEqual([['.private/revisao-interna/frente-a-projetos.md', null]])
    expect(paths('erro em src/app.ts:42 e /Users/u/x/y.json:3:7')).toEqual([['src/app.ts', 42], ['/Users/u/x/y.json', 3]])
  })
  it('.env sozinho, ./x e nome com extensão conhecida', () => {
    expect(paths('edite o .env, depois ./scripts/run e README.md')).toEqual([['.env', null], ['./scripts/run', null], ['README.md', null]])
  })
  it('pontuação final e parênteses', () => {
    expect(paths('(veja docs/a.md), docs/b.md: ok; docs/c.md!')).toEqual([['docs/a.md', null], ['docs/b.md', null], ['docs/c.md', null]])
  })
  it('caminho com espaço entre aspas', () => {
    expect(paths('abra "/Volumes/SSD MISA/x/notas.md" agora')).toEqual([['/Volumes/SSD MISA/x/notas.md', null]])
  })
  it('ignora URL, versão, e.g. e palavras soltas', () => {
    expect(paths('https://github.com/a/b.md www.x.com/a.md v1.2.3 1.2.3 e.g. i.e. ok')).toEqual([])
  })
  it('start/end cobrem o texto, incluindo :N', () => {
    const line = 'x src/app.ts:42 y'
    const [c] = findPathCandidates(line)
    expect(line.slice(c.start, c.end)).toBe('src/app.ts:42')
    expect(c.text).toBe('src/app.ts:42')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/renderer/file-links.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

`src/renderer/src/file-links.ts`:

```ts
export interface PathCandidate {
  text: string
  path: string
  line: number | null
  start: number
  end: number
}

const EXT = /\.(md|mdx|txt|env|json|jsonc|ya?ml|toml|ini|cfg|conf|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|zsh|bash|sql|html|css|scss|xml|csv|log|lock|gradle|properties|dart|vue|svelte|tf)$/i
const TRAIL = /[.,:;)!?\]}>'"]+$/
const LEAD = /^[(\[{<'"]+/

function looksLikePath(p: string): boolean {
  if (!p || /^[.\/]+$/.test(p)) return false
  if (/:\/\//.test(p) || /^www\./i.test(p)) return false
  if (/^v?\d+(\.\d+)+$/i.test(p)) return false
  if (/^(e\.g|i\.e|etc)\.?$/i.test(p)) return false
  const base = p.split('/').pop() ?? p
  if (/^\.env(\..+)?$/.test(base)) return true
  if (p.includes('/') && /[A-Za-z0-9_]/.test(base)) return true
  return EXT.test(base)
}

function make(raw: string, offset: number): PathCandidate | null {
  const lead = raw.match(LEAD)?.[0].length ?? 0
  let text = raw.slice(lead)
  text = text.replace(TRAIL, '')
  const m = text.match(/^(.*?)(?::(\d+))?(?::\d+)?$/)
  const p = m?.[1] ?? text
  if (!looksLikePath(p)) return null
  const start = offset + lead
  return { text, path: p, line: m?.[2] ? Number(m[2]) : null, start, end: start + text.length }
}

export function findPathCandidates(line: string): PathCandidate[] {
  const out: PathCandidate[] = []
  const taken: [number, number][] = []
  for (const m of line.matchAll(/(["'`])([^"'`]+?)\1/g)) {
    const inner = m[2]
    if (!inner.includes(' ')) continue // sem espaço, o passo seguinte acha
    const c = make(inner, m.index! + 1)
    if (c) {
      out.push(c)
      taken.push([m.index!, m.index! + m[0].length])
    }
  }
  for (const m of line.matchAll(/[^\s]+/g)) {
    const s = m.index!
    if (taken.some(([a, b]) => s >= a && s < b)) continue
    if (/^\w+:\/\//.test(m[0].replace(LEAD, ''))) continue
    const c = make(m[0], s)
    if (c) out.push(c)
  }
  return out.sort((a, b) => a.start - b.start)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/renderer/file-links.test.ts`
Expected: PASS. Se algum caso de borda falhar, ajuste as regex (não o teste) e rode de novo.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/file-links.ts tests/renderer/file-links.test.ts
git commit -m "feat(arquivos): detector de caminhos no texto do terminal"
```

---

### Task 4: Modelo do painel de arquivo (puro)

**Files:**
- Create: `src/renderer/src/file-model.ts`
- Modify: `src/renderer/src/header.ts` (`sharesContext` ignora arquivos)
- Test: `tests/renderer/file-model.test.ts`, `tests/renderer/header.test.ts`

**Interfaces:**
- Consumes: `FilePaneMeta` (Task 2); `leaves`, `splitLeaf` de `layout.ts`.
- Produces:
  - `isFilePane(id: string): boolean`
  - `type FileLanguage = 'markdown' | 'json' | 'yaml' | 'javascript' | 'typescript' | 'env' | 'text'`; `languageFor(path: string): FileLanguage`
  - `lineSeparator(content: string): '\r\n' | '\n'`
  - `insertFileLeaf(l: Layout, fileId: string, besideId: string | null, fallbackTab: Tab): Layout`
  - `findFilePane(filePanes: Record<string, FilePaneMeta>, layout: Layout, path: string): string | null`
  - `pickerRoot(app: Pick<AppState, 'panes' | 'projects' | 'layout' | 'filePanes' | 'userHome'>, focusedId: string | null): string`
  - `baseName(p: string): string`; `relativeTo(root: string | null, p: string): string`

- [ ] **Step 1: Teste que falha**

`tests/renderer/file-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { baseName, findFilePane, insertFileLeaf, isFilePane, languageFor, lineSeparator, pickerRoot, relativeTo } from '../../src/renderer/src/file-model'
import type { Layout, PaneView, ProjectView, Tab } from '../../src/shared/types'

const leaf = (paneId: string) => ({ type: 'leaf' as const, paneId })
const tab = (id: string, root: Layout['tabs'][number]['root']): Tab => ({ id, name: id, root })

describe('file-model', () => {
  it('isFilePane, languageFor, lineSeparator, nomes', () => {
    expect(isFilePane('file:1')).toBe(true)
    expect(isFilePane('abc')).toBe(false)
    expect(['a.md', 'x.json', 'c.yml', 'k.yaml', 's.ts', 'w.tsx', 'j.mjs', '.env', '.env.local', 'Makefile'].map(languageFor)).toEqual(['markdown', 'json', 'yaml', 'yaml', 'typescript', 'typescript', 'javascript', 'env', 'env', 'text'])
    expect(lineSeparator('A=1\r\nB=2\r\n')).toBe('\r\n')
    expect(lineSeparator('A=1\nB=2')).toBe('\n')
    expect(baseName('/r/api/.env')).toBe('.env')
    expect(relativeTo('/r/api', '/r/api/docs/a.md')).toBe('docs/a.md')
    expect(relativeTo('/r/api', '/outro/a.md')).toBe('/outro/a.md')
    expect(relativeTo(null, '/outro/a.md')).toBe('/outro/a.md')
  })

  it('insertFileLeaf: ao lado do painel pedido, na aba ativa, ou numa aba nova', () => {
    const l: Layout = { tabs: [tab('t1', leaf('a')), tab('t2', leaf('b'))], activeTabId: 't1' }
    const beside = insertFileLeaf(l, 'file:x', 'b', tab('nova', null))
    expect(beside.activeTabId).toBe('t2')
    expect(beside.tabs[1].root).toEqual({ type: 'split', dir: 'row', sizes: [], children: [leaf('b'), leaf('file:x')] })
    const active = insertFileLeaf(l, 'file:x', null, tab('nova', null))
    expect(active.tabs[0].root).toEqual({ type: 'split', dir: 'row', sizes: [], children: [leaf('a'), leaf('file:x')] })
    const empty: Layout = { tabs: [tab('t1', null)], activeTabId: 't1' }
    expect(insertFileLeaf(empty, 'file:x', null, tab('nova', null)).tabs[0].root).toEqual(leaf('file:x'))
    const none: Layout = { tabs: [], activeTabId: null }
    const created = insertFileLeaf(none, 'file:x', null, tab('nova', null))
    expect(created.tabs).toEqual([tab('nova', leaf('file:x'))])
    expect(created.activeTabId).toBe('nova')
  })

  it('findFilePane acha painel aberto do mesmo arquivo (só se ainda estiver no layout)', () => {
    const l: Layout = { tabs: [tab('t1', leaf('file:1'))], activeTabId: 't1' }
    const fp = { 'file:1': { path: '/r/a.md', mode: 'view' as const }, 'file:2': { path: '/r/b.md', mode: 'edit' as const } }
    expect(findFilePane(fp, l, '/r/a.md')).toBe('file:1')
    expect(findFilePane(fp, l, '/r/b.md')).toBeNull()
  })

  it('pickerRoot: worktree do painel em foco; arquivo em foco usa a worktree que o contém', () => {
    const project = { path: '/r/api', name: 'api', defaultAccountId: null, error: null, fetchError: null, conflicts: null, worktrees: [{ path: '/r/api', head: null, branch: 'main', isMain: true, locked: false, prunable: false, git: null }, { path: '/r/api/wt/x', head: null, branch: 'x', isMain: false, locked: false, prunable: false, git: null }] } as ProjectView
    const pane = { id: 'p', cwd: '/r/api/wt/x/src', worktreePath: '/r/api/wt/x', projectPath: '/r/api' } as PaneView
    const app = { panes: [pane], projects: [project], layout: { tabs: [], activeTabId: null }, filePanes: { 'file:1': { path: '/r/api/docs/a.md', mode: 'view' as const } }, userHome: '/u' }
    expect(pickerRoot(app, 'p')).toBe('/r/api/wt/x')
    expect(pickerRoot(app, 'file:1')).toBe('/r/api')
    expect(pickerRoot(app, null)).toBe('/r/api')
    expect(pickerRoot({ ...app, projects: [] }, null)).toBe('/u')
  })
})
```

Em `tests/renderer/header.test.ts`, no `describe('sharesContext')`, adicione:

```ts
  it('painel de arquivo na aba não desfaz o "discreto" dos terminais', () => {
    const l: Layout = { tabs: [{ id: 't', name: 't', root: { type: 'split', dir: 'row', sizes: [], children: [leaf('a'), leaf('b'), leaf('file:1')] } }], activeTabId: 't' }
    expect(sharesContext('a', l, [pane({ id: 'a' }), pane({ id: 'b' })])).toBe(true)
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/renderer/file-model.test.ts tests/renderer/header.test.ts`
Expected: FAIL (`file-model` não existe; `sharesContext` devolve false com o arquivo).

- [ ] **Step 3: Implementar**

`src/renderer/src/file-model.ts`:

```ts
import type { AppState, FilePaneMeta, Layout, Tab } from '../../shared/types'
import { leaves, splitLeaf } from './layout'

export const isFilePane = (id: string): boolean => id.startsWith('file:')

export type FileLanguage = 'markdown' | 'json' | 'yaml' | 'javascript' | 'typescript' | 'env' | 'text'

export function baseName(p: string): string {
  return p.split('/').pop() ?? p
}

export function languageFor(p: string): FileLanguage {
  const b = baseName(p).toLowerCase()
  if (/^\.env(\..+)?$/.test(b)) return 'env'
  if (/\.(md|mdx|markdown)$/.test(b)) return 'markdown'
  if (/\.(json|jsonc)$/.test(b)) return 'json'
  if (/\.(ya?ml)$/.test(b)) return 'yaml'
  if (/\.(ts|tsx|mts|cts)$/.test(b)) return 'typescript'
  if (/\.(js|jsx|mjs|cjs)$/.test(b)) return 'javascript'
  return 'text'
}

export function lineSeparator(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

export function relativeTo(root: string | null, p: string): string {
  return root && p.startsWith(root + '/') ? p.slice(root.length + 1) : p
}

/** põe a folha do arquivo à direita do painel indicado; senão na aba ativa; sem abas, numa aba nova */
export function insertFileLeaf(l: Layout, fileId: string, besideId: string | null, fallbackTab: Tab): Layout {
  const fresh = { type: 'leaf' as const, paneId: fileId }
  const owner = besideId ? l.tabs.find((t) => leaves(t.root).includes(besideId)) : undefined
  if (owner && besideId) {
    return { ...l, tabs: l.tabs.map((t) => (t.id === owner.id ? { ...t, root: splitLeaf(t.root!, besideId, fileId, 'row') } : t)), activeTabId: owner.id }
  }
  const active = l.tabs.find((t) => t.id === l.activeTabId)
  if (!active) return { ...l, tabs: [...l.tabs, { ...fallbackTab, root: fresh }], activeTabId: fallbackTab.id }
  const last = leaves(active.root).at(-1)
  const root = active.root && last ? splitLeaf(active.root, last, fileId, 'row') : fresh
  return { ...l, tabs: l.tabs.map((t) => (t.id === active.id ? { ...t, root } : t)) }
}

export function findFilePane(filePanes: Record<string, FilePaneMeta>, layout: Layout, p: string): string | null {
  const inLayout = new Set(layout.tabs.flatMap((t) => leaves(t.root)))
  return Object.entries(filePanes).find(([id, m]) => m.path === p && inLayout.has(id))?.[0] ?? null
}

const dirName = (p: string) => p.slice(0, Math.max(1, p.lastIndexOf('/')))

export function pickerRoot(app: Pick<AppState, 'panes' | 'projects' | 'layout' | 'filePanes' | 'userHome'>, focusedId: string | null): string {
  const worktrees = app.projects.flatMap((p) => p.worktrees.map((w) => w.path)).sort((a, b) => b.length - a.length)
  const containing = (p: string) => worktrees.find((w) => p === w || p.startsWith(w + '/')) ?? null
  if (focusedId && isFilePane(focusedId)) {
    const f = app.filePanes[focusedId]
    if (f) return containing(f.path) ?? dirName(f.path)
  }
  const pane = app.panes.find((p) => p.id === focusedId)
  if (pane) return pane.worktreePath ?? pane.cwd
  return app.projects[0]?.path ?? app.userHome
}
```

`src/renderer/src/header.ts` — em `sharesContext`, troque `const ids = tab ? leaves(tab.root) : []` por:

```ts
  const ids = (tab ? leaves(tab.root) : []).filter((id) => !id.startsWith('file:'))
```

(não importe `file-model` aqui para não criar ciclo; a regra é o mesmo prefixo).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/renderer/file-model.test.ts tests/renderer/header.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/file-model.ts src/renderer/src/header.ts tests/renderer
git commit -m "feat(arquivos): modelo do painel de arquivo (linguagem, CRLF, inserção, raiz do ⌘P)"
```

---

### Task 5: Painel de arquivo (CodeMirror + markdown) e abrir/fechar

**Files:**
- Create: `src/renderer/src/file-events.ts`, `src/renderer/src/components/FilePane.tsx`
- Modify: `package.json` (deps), `src/renderer/src/actions.ts`, `src/renderer/src/main.tsx`, `src/renderer/src/components/Workspace.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: Tasks 2 e 4.
- Produces:
  - `onFileChanged(path: string, fn: (mtimeMs: number | null) => void): () => void`; `emitFileChanged(path: string, mtimeMs: number | null): void`
  - `openFile(path: string, o?: { line?: number | null; besideId?: string | null }): Promise<void>`
  - `requestCloseFile(id: string): Promise<void>`
  - `dirtyFiles: Set<string>` (ids com alteração não salva) e `pendingLine: Map<string, number>`

Sem teste automatizado de componente neste projeto; verificação: typecheck, suíte, build e teste real (Task 7).

- [ ] **Step 1: Dependências**

Run: `npm install codemirror @codemirror/language @codemirror/lang-markdown @codemirror/lang-json @codemirror/lang-yaml @codemirror/lang-javascript @codemirror/legacy-modes marked dompurify`
Expected: instala sem erro; `package.json` ganha as 9 dependências.

- [ ] **Step 2: Eventos e ações**

`src/renderer/src/file-events.ts`:

```ts
const subs = new Map<string, Set<(mtimeMs: number | null) => void>>()

export function onFileChanged(path: string, fn: (mtimeMs: number | null) => void): () => void {
  let set = subs.get(path)
  if (!set) subs.set(path, (set = new Set()))
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (set!.size === 0) subs.delete(path)
  }
}

export function emitFileChanged(path: string, mtimeMs: number | null): void {
  for (const fn of subs.get(path) ?? []) fn(mtimeMs)
}
```

`src/renderer/src/main.tsx` — no `switch` de `window.gt.onEvent`, acrescente:

```ts
    case 'file.changed':
      emitFileChanged(e.path, e.mtimeMs)
      break
```

(import `emitFileChanged` de `./file-events`).

`src/renderer/src/actions.ts` — imports `import { findFilePane, insertFileLeaf, isFilePane, languageFor } from './file-model'`; e no fim:

```ts
/** ids de painéis de arquivo com alteração não salva (o FilePane mantém) */
export const dirtyFiles = new Set<string>()
/** linha para onde o painel recém-aberto deve rolar */
export const pendingLine = new Map<string, number>()

export async function openFile(path: string, o: { line?: number | null; besideId?: string | null } = {}): Promise<void> {
  const app = getUi().app
  if (!app) return
  const open = findFilePane(app.filePanes, app.layout, path)
  if (open) {
    if (o.line) pendingLine.set(open, o.line)
    revealPane(open)
    return
  }
  const id = `file:${crypto.randomUUID()}`
  if (o.line) pendingLine.set(id, o.line)
  await window.gt.request({ t: 'filepane.set', id, path, mode: languageFor(path) === 'markdown' ? 'view' : 'edit' })
  updateLayout((l) => insertFileLeaf(l, id, o.besideId ?? getUi().focusedPaneId, newTab(l.tabs.length + 1, null)))
  focusPane(id)
}

export async function requestCloseFile(id: string): Promise<void> {
  if (dirtyFiles.has(id)) {
    const name = (getUi().app?.filePanes[id]?.path ?? '').split('/').pop() ?? ''
    const r = await window.gt.confirm({ message: `Descartar as alterações em ${name}?`, confirmLabel: 'Descartar' })
    if (!r.ok) return
  }
  dirtyFiles.delete(id)
  hidePane(id)
}
```

E em `runMenuAction`, troque o ramo `hide-pane` por:

```ts
  else if (action === 'hide-pane') {
    const id = getUi().focusedPaneId
    if (id && isFilePane(id)) void requestCloseFile(id)
    else if (id) hidePane(id)
  }
```

- [ ] **Step 3: FilePane**

`src/renderer/src/components/FilePane.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { StreamLanguage } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { javascript } from '@codemirror/lang-javascript'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { dirtyFiles, focusPane, pendingLine, requestCloseFile } from '../actions'
import { errorMessage } from '../api'
import { onFileChanged } from '../file-events'
import { baseName, languageFor, lineSeparator, pickerRoot, relativeTo, type FileLanguage } from '../file-model'
import { setUi, useUi } from '../store'

const LANG: Record<FileLanguage, () => Extension> = {
  markdown: () => markdown(),
  json: () => json(),
  yaml: () => yaml(),
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true, jsx: true }),
  env: () => StreamLanguage.define(properties),
  text: () => [],
}

const theme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--bg)', color: 'var(--fg)' },
    '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--fg-dim)', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)' },
    '.cm-content': { caretColor: 'var(--fg)' },
  },
  { dark: true },
)

type Problem = null | 'missing' | 'cannot-open' | string

export function FilePane({ paneId }: { paneId: string }) {
  const meta = useUi((s) => s.app?.filePanes[paneId])
  const focused = useUi((s) => s.focusedPaneId === paneId)
  const root = useUi((s) => (s.app ? pickerRoot(s.app, paneId) : null))
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const mtime = useRef<number | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [problem, setProblem] = useState<Problem>(null)
  const [external, setExternal] = useState(false)
  const [flash, setFlash] = useState(false)
  const path = meta?.path ?? ''
  const mode = meta?.mode ?? 'edit'

  const markDirty = (d: boolean) => {
    setDirty(d)
    if (d) dirtyFiles.add(paneId)
    else dirtyFiles.delete(paneId)
  }

  const load = async () => {
    try {
      const r = await window.gt.request<{ content: string; mtimeMs: number }>({ t: 'file.read', path })
      mtime.current = r.mtimeMs
      setText(r.content)
      setProblem(null)
      setExternal(false)
      markDirty(false)
    } catch (e) {
      const m = errorMessage(e)
      setProblem(m.includes('file-missing') ? 'missing' : m.includes('file-too-large') || m.includes('file-binary') ? 'cannot-open' : m)
    }
  }

  const save = async (force = false) => {
    const content = view.current ? view.current.state.sliceDoc() : text ?? ''
    try {
      const r = await window.gt.request<{ mtimeMs: number }>({ t: 'file.write', path, content, expectedMtimeMs: force || problem === 'missing' ? null : mtime.current })
      mtime.current = r.mtimeMs
      setText(content)
      setExternal(false)
      setProblem(null)
      markDirty(false)
    } catch (e) {
      const m = errorMessage(e)
      if (m.includes('file-changed')) setExternal(true)
      else setProblem(m)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save
  const forceRef = useRef(false)

  useEffect(() => {
    if (!path) return
    void load()
    void window.gt.request({ t: 'file.watch', path })
    const off = onFileChanged(path, (m) => {
      if (m === null) return setProblem('missing')
      if (m === mtime.current) return
      if (!dirtyFiles.has(paneId)) {
        void load().then(() => {
          setFlash(true)
          setTimeout(() => setFlash(false), 2000)
        })
      } else setExternal(true)
    })
    return () => {
      off()
      void window.gt.request({ t: 'file.unwatch', path })
      dirtyFiles.delete(paneId)
    }
  }, [path])

  // editor: recriado quando o conteúdo é (re)carregado ou o modo muda
  useEffect(() => {
    if (mode !== 'edit' || text === null || !host.current) return
    const sep = lineSeparator(text)
    const state = EditorState.create({
      doc: text,
      extensions: [
        basicSetup,
        theme,
        LANG[languageFor(path)](),
        EditorState.lineSeparator.of(sep),
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (void saveRef.current(forceRef.current), true) }]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) markDirty(true)
        }),
      ],
    })
    const v = new EditorView({ state, parent: host.current })
    view.current = v
    const line = pendingLine.get(paneId)
    if (line) {
      pendingLine.delete(paneId)
      const l = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines))
      v.dispatch({ selection: { anchor: l.from }, scrollIntoView: true })
    }
    if (focused) v.focus()
    return () => {
      v.destroy()
      view.current = null
    }
  }, [text, mode, path])

  const setMode = (m: 'view' | 'edit') => window.gt.request({ t: 'filepane.set', id: paneId, path, mode: m })
  const html = mode === 'view' && text !== null ? DOMPurify.sanitize(marked.parse(text, { async: false }) as string) : ''
  const isMd = languageFor(path) === 'markdown'

  return (
    <div className={`pane file-pane${focused ? ' focused' : ''}`} onMouseDown={() => focusPane(paneId)}>
      <div className="pane-header file-header">
        <span className="file-name">📄 {baseName(path)}</span>
        <span className="file-path" title={path}>{relativeTo(root, path)}</span>
        {dirty && <span className="file-dirty">● não salvo</span>}
        {flash && <span className="file-flash">atualizado do disco</span>}
        <span className="ph-spacer" />
        {isMd && (
          <button className="st-btn" onClick={() => void setMode(mode === 'view' ? 'edit' : 'view')}>
            {mode === 'view' ? 'Editar' : 'Visualizar'}
          </button>
        )}
        <button className="ph-close" title="Fechar arquivo" onClick={() => void requestCloseFile(paneId)}>
          ✕
        </button>
      </div>
      {external && (
        <div className="file-banner">
          O arquivo mudou no disco.{' '}
          <button className="st-btn" onClick={() => void load()}>Recarregar</button>
          <button className="st-btn" onClick={() => { forceRef.current = true; setExternal(false) }}>Manter o meu</button>
        </div>
      )}
      {problem === 'cannot-open' ? (
        <div className="pane-dead">
          <div className="pane-dead-title">Não dá para abrir este arquivo aqui</div>
          <div className="pane-dead-actions">
            <button onClick={() => void window.gt.openPath(path)}>Abrir no app padrão</button>
            <button onClick={() => void window.gt.openPath(path.slice(0, path.lastIndexOf('/')) || '/')}>Mostrar no Finder</button>
          </div>
        </div>
      ) : problem === 'missing' ? (
        <div className="pane-dead">
          <div className="pane-dead-title">Arquivo não encontrado</div>
          <div className="pane-dead-actions">
            {text !== null && <button className="primary" onClick={() => void save(true)}>Salvar mesmo assim</button>}
            <button onClick={() => void requestCloseFile(paneId)}>Fechar</button>
          </div>
        </div>
      ) : problem ? (
        <div className="file-banner error">{problem}</div>
      ) : null}
      {problem !== 'cannot-open' && (problem !== 'missing' || mode === 'edit') && (
        mode === 'view' ? (
          <div
            className="file-md"
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest('a')
              if (!a) return
              e.preventDefault()
              const href = a.getAttribute('href') ?? ''
              if (/^https?:\/\//.test(href)) void window.gt.openExternal(href)
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="file-editor" ref={host} />
        )
      )}
    </div>
  )
}
```

(Se `@codemirror/state`/`@codemirror/view` não estiverem resolvíveis diretamente, eles vêm como dependências do `codemirror`; se o typecheck reclamar, adicione-os ao `npm install` e registre a decisão.)

Silencie `setUi` não usado removendo o import se o typecheck acusar.

`src/renderer/src/components/Workspace.tsx` — import `import { FilePane } from './FilePane'` e `import { isFilePane } from '../file-model'`; em `SplitNode`, troque a primeira linha por:

```tsx
  if (node.type === 'leaf') return isFilePane(node.paneId) ? <FilePane paneId={node.paneId} /> : <PaneFrame paneId={node.paneId} onAddProject={addProject} />
```

`src/renderer/src/styles.css` (fim):

```css
/* painel de arquivo */
.file-pane { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.file-header { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; flex-shrink: 0; }
.file-name { font-weight: 700; white-space: nowrap; }
.file-path { color: var(--fg-dim); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.file-dirty { color: var(--warn); font-size: 11.5px; white-space: nowrap; }
.file-flash { color: var(--fg-dim); font-size: 11px; }
.file-banner { padding: 4px 10px; background: color-mix(in srgb, var(--warn) 18%, transparent); font-size: 12px; display: flex; gap: 8px; align-items: center; }
.file-banner.error { background: color-mix(in srgb, var(--error) 18%, transparent); }
.file-editor { flex: 1; min-height: 0; overflow: hidden; }
.file-md { flex: 1; min-height: 0; overflow: auto; padding: 12px 18px; line-height: 1.55; }
.file-md table { border-collapse: collapse; }
.file-md th, .file-md td { border: 1px solid var(--border); padding: 3px 8px; }
.file-md pre { background: rgba(255,255,255,0.05); padding: 8px; overflow: auto; }
.file-md code { font-family: Menlo, monospace; font-size: 12px; }
```

- [ ] **Step 4: Typecheck, suíte e build**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS e build sem erro.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/renderer
git commit -m "feat(arquivos): painel de arquivo (CodeMirror, markdown renderizado, salvar com conflito, abrir/fechar)"
```

---

### Task 6: ⌘P, menu da worktree e links no terminal

**Files:**
- Create: `src/renderer/src/components/FilePicker.tsx`, `src/renderer/src/file-link-provider.ts`
- Modify: `src/shared/keybindings.ts`, `src/renderer/src/actions.ts`, `src/renderer/src/store.ts`, `src/renderer/src/components/Modals.tsx`, `src/renderer/src/flows.ts`, `src/renderer/src/terminals.ts`, `tests/shared/keybindings.test.ts` (se algum teste enumera ações)

**Interfaces:**
- Consumes: Tasks 3, 4, 5.
- Produces: `Modal` `{ kind: 'file-picker'; root: string }`; `openFilePicker(root?: string): void`; ação `open-file`; `fileLinkProvider(term: Terminal, paneId: string): ILinkProvider`

- [ ] **Step 1: Atalho**

`src/shared/keybindings.ts` — em `ACTIONS`, depois de `palette`:

```ts
  { id: 'open-file', label: 'Abrir arquivo…', group: 'sessao', mac: 'Cmd+P', linux: 'Ctrl+Shift+P' },
```

Run: `npx vitest run tests/shared/keybindings.test.ts`
Expected: PASS (se algum teste checar conflitos de padrão, `Cmd+P` / `Ctrl+Shift+P` não colidem com os existentes; se colidir, ajuste o teste com a nova ação e registre).

- [ ] **Step 2: Store, ação e menu da worktree**

`src/renderer/src/store.ts` — no tipo `Modal`: `| { kind: 'file-picker'; root: string }`.

`src/renderer/src/actions.ts` — import `pickerRoot` de `./file-model` e:

```ts
export function openFilePicker(root?: string): void {
  const app = getUi().app
  if (!app) return
  setUi({ modal: { kind: 'file-picker', root: root ?? pickerRoot(app, getUi().focusedPaneId) } })
}
```

e em `runMenuAction`: `else if (action === 'open-file') openFilePicker()`.

`src/renderer/src/flows.ts` — em `worktreeMenu`, item `{ id: 'file', label: 'Abrir arquivo…' }` depois de `conv`, e no tratamento `else if (choice === 'file') openFilePicker(w.path)` (import de `./actions`).

- [ ] **Step 3: FilePicker**

`src/renderer/src/components/FilePicker.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { openFile } from '../actions'
import { fuzzyScore } from '../search'
import { getUi, setUi } from '../store'

export function FilePicker({ root }: { root: string }) {
  const [files, setFiles] = useState<string[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const besideId = useMemo(() => getUi().focusedPaneId, [])

  useEffect(() => {
    window.gt
      .request<{ files: string[]; truncated: boolean }>({ t: 'file.list', root })
      .then((r) => {
        setFiles(r.files)
        setTruncated(r.truncated)
      })
      .catch(() => setFiles([]))
  }, [root])

  const results = useMemo(() => {
    if (!files) return []
    if (!q.trim()) return files.slice(0, 200)
    return files
      .map((f) => ({ f, s: fuzzyScore(q, f) }))
      .filter((x): x is { f: string; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s)
      .slice(0, 200)
      .map((x) => x.f)
  }, [files, q])

  const close = () => setUi({ modal: null })
  const pick = (rel: string | undefined) => {
    if (!rel) return
    close()
    void openFile(`${root}/${rel}`, { besideId })
  }

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={close}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="palette-input"
          placeholder={`Abrir arquivo em ${root.split('/').pop()}…`}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setSel(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'ArrowDown') setSel((i) => Math.min(i + 1, results.length - 1))
            if (e.key === 'ArrowUp') setSel((i) => Math.max(i - 1, 0))
            if (e.key === 'Enter') pick(results[sel])
          }}
        />
        {!files && <div className="palette-empty">lendo arquivos…</div>}
        {truncated && <div className="palette-empty">lista parcial</div>}
        <div className="palette-list">
          {results.map((f, i) => (
            <div key={f} className={`palette-item${i === sel ? ' selected' : ''}`} onMouseEnter={() => setSel(i)} onMouseDown={() => pick(f)}>
              {f}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

Confira os nomes de classe usados pelo `Palette.tsx` existente (`palette-list`, `palette-item`, `palette-empty`, `selected`) e use os mesmos; se forem outros, troque aqui para os de lá.

`src/renderer/src/components/Modals.tsx` — import e `if (modal.kind === 'file-picker') return <FilePicker root={modal.root} />`.

- [ ] **Step 4: Links no terminal**

`src/renderer/src/file-link-provider.ts`:

```ts
import type { ILink, ILinkProvider, Terminal } from '@xterm/xterm'
import { findPathCandidates } from './file-links'
import { getUi } from './store'

const cache = new Map<string, { abs: string | null; at: number }>()
const TTL = 30_000

async function resolve(cwd: string, paths: string[]): Promise<Map<string, string>> {
  const now = Date.now()
  const out = new Map<string, string>()
  const ask: string[] = []
  for (const p of paths) {
    const hit = cache.get(`${cwd}\n${p}`)
    if (hit && now - hit.at < TTL) {
      if (hit.abs) out.set(p, hit.abs)
    } else ask.push(p)
  }
  if (ask.length) {
    const found = await window.gt.request<{ path: string; abs: string }[]>({ t: 'file.exists', cwd, paths: ask }).catch(() => [])
    const map = new Map(found.map((f) => [f.path, f.abs]))
    for (const p of ask) {
      const abs = map.get(p) ?? null
      cache.set(`${cwd}\n${p}`, { abs, at: now })
      if (abs) out.set(p, abs)
    }
  }
  return out
}

/** caminhos de arquivo que existem viram links; ⌘ (mac) / Ctrl (linux) + clique abre ao lado do terminal */
export function fileLinkProvider(term: Terminal, paneId: string): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const text = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? ''
      const cands = findPathCandidates(text)
      const cwd = getUi().app?.panes.find((p) => p.id === paneId)?.cwd
      if (!cands.length || !cwd) return callback(undefined)
      void resolve(cwd, [...new Set(cands.map((c) => c.path))]).then((abs) => {
        const links: ILink[] = cands
          .filter((c) => abs.has(c.path))
          .map((c) => ({
            range: { start: { x: c.start + 1, y }, end: { x: c.end, y } },
            text: c.text,
            decorations: { underline: true, pointerCursor: true },
            activate: (ev: MouseEvent) => {
              if (!(ev.metaKey || ev.ctrlKey)) return
              void import('./actions').then((a) => a.openFile(abs.get(c.path)!, { line: c.line, besideId: paneId }))
            },
          }))
        callback(links.length ? links : undefined)
      })
    },
  }
}
```

`src/renderer/src/terminals.ts` — import `import { fileLinkProvider } from './file-link-provider'` e, logo depois de `term.loadAddon(new WebLinksAddon(...))`:

```ts
    term.registerLinkProvider(fileLinkProvider(term, paneId))
```

(Confira o nome do pacote de tipos do xterm usado em `terminals.ts` — `@xterm/xterm`; use o mesmo no import de tipos.)

- [ ] **Step 5: Typecheck, suíte e build**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat(arquivos): ⌘P abrir arquivo, item no menu da worktree e links de arquivo no terminal"
```

---

### Task 7: Teste real com o usuário

- [ ] **Step 1:** Electron na worktree (`node node_modules/electron/install.js` dentro de `node_modules/electron` se `dist/` não existir); `GT_HOME=/tmp/gt-arquivos npm run dev` em segundo plano.
- [ ] **Step 2:** Com o usuário:
  1. Num terminal, `echo docs/x.md` com o arquivo existindo → sublinha; ⌘+clique abre renderizado à direita.
  2. ⌘P → `.env` aparece (mesmo ignorado) → editar → ⌘S → conferir no disco e a permissão.
  3. Com o arquivo aberto e editado, `echo B=2 >> .env` num terminal → faixa "O arquivo mudou no disco"; sem edição → recarrega com "atualizado do disco".
  4. ⌘W num arquivo sujo → pergunta "Descartar as alterações em .env?".
  5. Fechar e reabrir o app → o painel de arquivo volta.
- [ ] **Step 3:** Registrar o resultado no commit/PR.
