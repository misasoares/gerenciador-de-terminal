# Gerenciador de Terminal — Fase 1 (MVP macOS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App desktop (Electron) que hospeda várias sessões do Claude Code em splits livres, mostrando por painel projeto, worktree, branch, alterações, ↑/↓ e estado da sessão, com terminais que sobrevivem ao fechamento do app.

**Architecture:** Três peças. Um **daemon** Node (rodando com o binário do Electron em `ELECTRON_RUN_AS_NODE=1`) é dono dos PTYs (`node-pty`), mantém um espelho headless de cada tela (`@xterm/headless` + serialize) e todo o estado (projetos, worktrees, git, sessões). O **app** Electron é só interface (React + xterm.js + allotment) e fala com o daemon por um Unix socket com JSON por linha. O **gt-hook** é um script `sh` chamado pelos hooks do Claude Code que repassa cada evento ao daemon via `nc -U`.

**Tech Stack:** Electron 44, electron-vite 5, Vite 7, React 19, TypeScript 5.9, node-pty 1.1 (N-API), @xterm/xterm 6, @xterm/headless 6, @xterm/addon-serialize 0.14, @xterm/addon-fit, @xterm/addon-web-links, allotment 1.20, Vitest 5, electron-builder (empacotamento local).

**Spec:** `docs/superpowers/specs/2026-09-25-gerenciador-de-terminal-design.md`

## Global Constraints

- Plataforma da fase 1: **somente macOS**. Código que depende de SO fica em `src/daemon/platform/`.
- Diretório de dados: `~/.gerenciador-terminal/` (sobrescrevível por `GT_HOME`). **Caminho de Unix socket no macOS tem limite de 104 bytes** (acima disso o nome é truncado em silêncio): testes criam sockets em `os.tmpdir()` com nomes curtos, nunca no scratchpad/pastas profundas. Socket: `daemon.sock`; estado: `state.json`; log: `daemon.log`; script de hook: `bin/gt-hook`.
- Shell dos terminais: shell do usuário (`os.userInfo().shell`, padrão `/bin/zsh`) com `-il` (login interativo), para as funções `claude*` do `.zshrc` funcionarem.
- O app **nunca** executa `claude` nem `cswap` diretamente: digita o comando da conta no shell (`claude`, `claude-mslabs`, `claude-weboption`, `claude-weboption-max`).
- Hooks instalados em `~/.claude/settings.json` acrescentando entradas, sem alterar as existentes (há um `PreToolUse` do RTK), com backup antes. Nunca registrar `WorktreeCreate`/`WorktreeRemove`.
- `git worktree remove --force` e `git branch -D` só depois de confirmação explícita do usuário.
- O daemon nunca é reiniciado sem pedido do usuário.
- Estados da sessão: `working` 🟢, `needs-you` 🟡, `idle` ⚪ (sem distinção visto/não visto).
- `git fetch` em segundo plano a cada 5 min; `git status` a cada 10 s + gatilhos; todo git com timeout e `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`.
- `macOptionIsMeta = false` no xterm; teclas mortas (`~ ´ ` ^ ¨`) precisam compor.
- Textos de interface em português.
- Todo commit termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Vazamento de ambiente para os shells:** o daemon roda com `ELECTRON_RUN_AS_NODE=1` e pode ter sido iniciado de dentro de uma sessão do Claude (`CLAUDECODE`, `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_*`). Nada disso pode chegar ao terminal, e `LANG` precisa existir (app aberto pelo Finder não tem `LANG`, e sem ele acentos quebram). → teste na Task 9.
2. **`~/.claude/settings.json` é o alvo de 3 symlinks (perfis do cswap):** instalar hooks não pode trocar o symlink por arquivo, apagar o hook do RTK nem escrever por cima de um JSON inválido. → testes na Task 7.
3. **O hook roda em toda sessão do Claude, inclusive fora do app:** sem `GT_PANE_ID` ou sem daemon ele precisa sair com código 0, sem imprimir nada no stdout (stdout de hook vira contexto do Claude) e rápido. → testes na Task 7.
4. **Worktree criada pelo Claude depois que o projeto foi carregado:** a lista de worktrees em cache fica velha; o painel precisa achar a worktree nova mesmo assim. → teste na Task 9.
5. **Caminhos com espaço e texto com acento** (o repositório real fica em `/Volumes/SSD MISA/...`): git, lsof, hook e serialização de tela precisam funcionar com eles. → o helper de repositório de teste cria pastas com espaço (Task 4) e a Task 3 testa `ação` no PTY.

---

## Estrutura de arquivos

```
package.json, tsconfig.json, electron.vite.config.ts, vitest.config.ts, .gitignore, README.md
src/shared/
  types.ts          tipos de domínio compartilhados (AppState, PaneView, Layout...)
  protocol.ts       mensagens app/hook ↔ daemon, PROTOCOL_VERSION, BridgeEvent
  framing.ts        JSON por linha (LineDecoder, encode)
  rpc-client.ts     cliente do socket (request/reply, eventos)
  bridge.ts         interface window.gt exposta pelo preload
src/daemon/
  main.ts           entrada do processo daemon
  daemon.ts         orquestra tudo; trata requisições; monta AppState
  server.ts         servidor do socket
  pty-host.ts       node-pty + espelho headless + serialize
  panes.ts          registros de painel, hooks aplicados, poller de processos
  projects.ts       projetos e suas worktrees; cwd → projeto/worktree
  session.ts        evento de hook → estado da sessão
  title.ts          título da conversa a partir do transcript
  accounts.ts       contas, detecção, comando de lançamento
  resolve.ts        git rev-parse / worktree list + busca pura
  persist.ts        state.json
  hooks.ts          script gt-hook, merge/instalação no settings.json, checagem de perfis
  worktree-remove.ts checagem e remoção segura
  git/run.ts        execução de git com timeout
  git/parse.ts      parsers de status v2 e worktree list -z
  git/monitor.ts    cache de status por worktree, watchers, fetch periódico
  platform/procs.ts ps/lsof (macOS) e parsers
src/main/
  index.ts          processo principal do Electron (janela, IPC)
  daemon-link.ts    garante daemon, conecta, reconecta
  menu.ts           menu e atalhos
src/preload/index.ts
src/renderer/index.html
src/renderer/src/
  main.tsx, App.tsx, styles.css
  api.ts            tipagem de window.gt, errorMessage
  store.ts          estado de UI (useSyncExternalStore)
  layout.ts         funções puras de árvore de splits
  header.ts         modelo puro do cabeçalho
  sidebar-model.ts  modelo puro da sidebar
  keys.ts           decisão pura de teclado (Shift+Enter, ⌘)
  terminals.ts      registro de instâncias xterm por painel
  actions.ts        ações de alto nível (abrir, mostrar, esconder, remover worktree...)
  components/ Workspace.tsx, PaneFrame.tsx, PaneHeader.tsx, TerminalView.tsx,
              Sidebar.tsx, NewSessionDialog.tsx, Banners.tsx
tests/
  helpers/ wait.ts, repo.ts, run.ts, app-client.ts
  shared/, daemon/, main/, renderer/  (espelham src/)
```

---

### Task 1: Scaffold, tipos compartilhados e protocolo

**Files:**
- Create: `package.json`, `tsconfig.json`, `electron.vite.config.ts`, `vitest.config.ts`
- Modify: `.gitignore`
- Create: `src/shared/types.ts`, `src/shared/protocol.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx` (versões mínimas, substituídas nas Tasks 11 e 13)
- Test: `tests/smoke/node-pty.test.ts`

**Interfaces:**
- Produces: todos os tipos de `src/shared/types.ts` e `src/shared/protocol.ts` abaixo — nomes e campos são usados literalmente pelas tasks seguintes.

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "gerenciador-de-terminal",
  "version": "0.1.0",
  "private": true,
  "description": "Gerenciador de terminais para sessões do Claude Code",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "postinstall": "chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper 2>/dev/null || true"
  }
}
```

- [ ] **Step 2: Instalar dependências**

```bash
npm install node-pty@^1.1.0 @xterm/headless@^6.0.0 @xterm/addon-serialize@^0.14.0
npm install -D electron@^44.4.5 electron-vite@^5.0.0 vite@^7.3.6 @vitejs/plugin-react@^5.2.0 \
  vitest@^5.0.2 typescript@5.9.3 @types/node@^22 @types/react@^19 @types/react-dom@^19 \
  react@^19.3.0 react-dom@^19.3.0 @xterm/xterm@^6.0.0 @xterm/addon-fit@^0.11.0 \
  @xterm/addon-web-links@^0.12.0 allotment@^1.20.5
```

Expected: instala sem erro de peer dependency.

- [ ] **Step 3: Configs**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src", "tests", "electron.vite.config.ts", "vitest.config.ts"]
}
```

`electron.vite.config.ts`:
```ts
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          daemon: resolve(__dirname, 'src/daemon/main.ts'),
        },
      },
    },
  },
  preload: {},
  renderer: { plugins: [react()] },
})
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], testTimeout: 20_000, pool: 'forks' },
})
```

`.gitignore` (substituir o conteúdo):
```
node_modules/
out/
dist/
.DS_Store
*.log
```

- [ ] **Step 4: Tipos compartilhados — `src/shared/types.ts`**

```ts
export type SessionStatus = 'working' | 'needs-you' | 'idle'

export interface ClaudeSession {
  sessionId: string
  status: SessionStatus
  title: string | null
  transcriptPath: string | null
}

export interface Account {
  id: string
  label: string
  /** comando digitado no shell, ex.: "claude-mslabs" */
  command: string
  color: string
  /** trechos de CLAUDE_CONFIG_DIR que identificam a conta */
  configDirMatch: string[]
  /** conta usada quando CLAUDE_CONFIG_DIR não está definido */
  isDefault: boolean
  /** trecho do argumento --settings que desempata contas com o mesmo perfil */
  settingsMatch: string | null
  /** projetos dentro deste prefixo (com ~) sugerem esta conta */
  pathPrefix: string | null
}

export interface GitStatus {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  changed: number
  error: string | null
}

export interface WorktreeInfo {
  path: string
  head: string | null
  branch: string | null
  isMain: boolean
  locked: boolean
  prunable: boolean
}

export interface WorktreeView extends WorktreeInfo {
  git: GitStatus | null
}

export interface ProjectConfig {
  /** caminho da worktree principal; também é o id do projeto */
  path: string
  name: string
  defaultAccountId: string | null
}

export interface ProjectView extends ProjectConfig {
  worktrees: WorktreeView[]
  error: string | null
  fetchError: string | null
}

export interface PaneView {
  id: string
  seq: number
  cwd: string
  alive: boolean
  exitCode: number | null
  accountId: string | null
  claude: ClaudeSession | null
  projectPath: string | null
  worktreePath: string | null
}

export type LayoutNode =
  | { type: 'leaf'; paneId: string }
  | { type: 'split'; dir: 'row' | 'column'; children: LayoutNode[]; sizes: number[] }

export interface Tab {
  id: string
  name: string
  root: LayoutNode | null
}

export interface Layout {
  tabs: Tab[]
  activeTabId: string | null
}

export interface ResumeEntry {
  paneId: string
  cwd: string
  accountId: string | null
  sessionId: string | null
}

export interface AppState {
  protocolVersion: number
  userHome: string
  projects: ProjectView[]
  panes: PaneView[]
  layout: Layout
  accounts: Account[]
  resumable: ResumeEntry[]
  /** arquivos settings.json sem os hooks do app */
  hookWarnings: string[]
}

export interface HookPayload {
  hook_event_name: string
  session_id: string
  cwd: string
  transcript_path?: string
  tool_name?: string
  notification_type?: string
  source?: string
  [key: string]: unknown
}

export interface RemoveCheck {
  path: string
  branch: string | null
  isMain: boolean
  hasOpenSession: boolean
  dirtyFiles: string[]
  unpushedCommits: string[]
}
```

- [ ] **Step 5: Protocolo — `src/shared/protocol.ts`**

```ts
import type { AppState, HookPayload, Layout } from './types'

export const PROTOCOL_VERSION = 1

export type ClientRequest =
  | { t: 'hello'; role: 'app' | 'hook'; version: number }
  | { t: 'state.get' }
  | { t: 'hook'; paneId: string; configDir: string; payload: HookPayload }
  | { t: 'pane.create'; paneId?: string; cwd: string; accountId: string | null; resumeSessionId?: string; cols: number; rows: number }
  | { t: 'pane.attach'; paneId: string; cols?: number; rows?: number }
  | { t: 'pane.input'; paneId: string; data: string }
  | { t: 'pane.resize'; paneId: string; cols: number; rows: number }
  | { t: 'pane.kill'; paneId: string }
  | { t: 'pane.forget'; paneId: string }
  | { t: 'project.add'; path: string }
  | { t: 'project.remove'; path: string }
  | { t: 'project.setAccount'; path: string; accountId: string | null }
  | { t: 'layout.save'; layout: Layout }
  | { t: 'worktree.checkRemove'; path: string }
  | { t: 'worktree.remove'; path: string; force: boolean; deleteBranch: boolean }
  | { t: 'hooks.install' }
  | { t: 'resume.dismiss'; paneId: string }
  | { t: 'daemon.shutdown' }

/** id 0 = sem resposta (fire-and-forget) */
export interface RequestEnvelope {
  id: number
  req: ClientRequest
}

export type ServerMessage =
  | { t: 'reply'; id: number; ok: true; result: unknown }
  | { t: 'reply'; id: number; ok: false; error: string }
  | { t: 'state'; state: AppState }
  | { t: 'pane.data'; paneId: string; data: string }

/** eventos que o processo principal do Electron entrega ao renderer */
export type BridgeEvent =
  | ServerMessage
  | { t: 'disconnected' }
  | { t: 'reconnected' }
  | { t: 'version-mismatch'; daemon: number; app: number }
```

- [ ] **Step 6: Placeholders mínimos do Electron**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import path from 'node:path'

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1200, height: 800, webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: false } })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
```

`src/preload/index.ts`:
```ts
export {}
```

`src/renderer/index.html`:
```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" />
    <title>Gerenciador de Terminal</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!).render(<h1>Gerenciador de Terminal</h1>)
```

Crie também um `src/daemon/main.ts` provisório (substituído na Task 9):
```ts
console.log('daemon placeholder')
```

- [ ] **Step 7: Teste de fumaça do node-pty — `tests/smoke/node-pty.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import * as pty from 'node-pty'

describe('node-pty', () => {
  it('abre um processo e lê a saída com acento', async () => {
    const p = pty.spawn('/bin/echo', ['ação'], { cols: 80, rows: 24, cwd: process.cwd(), env: { LANG: 'en_US.UTF-8' } })
    const out = await new Promise<string>((resolve) => {
      let buf = ''
      p.onData((d) => { buf += d })
      p.onExit(() => resolve(buf))
    })
    expect(out).toContain('ação')
  })
})
```

- [ ] **Step 8: Rodar testes, typecheck e o node-pty dentro do Electron**

Run: `npm test && npm run typecheck`
Expected: 1 teste passando, typecheck sem erros.
Se aparecer `posix_spawnp failed`, rode `npm run postinstall` e repita.

Run: `ELECTRON_RUN_AS_NODE=1 npx electron -e "require('node-pty').spawn('/bin/echo',['ok'],{}).onData(d=>{process.stdout.write(d);process.exit(0)})"`
Expected: imprime `ok` (confirma que o módulo N-API carrega no runtime do Electron, onde o daemon vai rodar).

- [ ] **Step 9: Conferir que o app abre**

Run: `npm run dev`
Expected: janela com o título "Gerenciador de Terminal". Feche a janela.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "chore: scaffold electron-vite, tipos compartilhados e protocolo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Framing JSON por linha, servidor e cliente do socket

**Files:**
- Create: `src/shared/framing.ts`, `src/shared/rpc-client.ts`, `src/daemon/server.ts`
- Create: `tests/helpers/wait.ts`
- Test: `tests/shared/framing.test.ts`, `tests/daemon/server.test.ts`

**Interfaces:**
- Consumes: `ClientRequest`, `RequestEnvelope`, `ServerMessage` (Task 1).
- Produces:
  - `class LineDecoder { push(chunk: string): unknown[] }`, `encode(msg: unknown): string`
  - `class RpcClient { static connect(socketPath: string, timeoutMs?: number): Promise<RpcClient>; request<T = unknown>(req: ClientRequest): Promise<T>; send(req: ClientRequest): void; onMessage(cb: (m: ServerMessage) => void): () => void; onClose(cb: () => void): void; close(): void }`
  - `interface Conn { role: 'app' | 'hook' | null; subscriptions: Set<string>; send(m: ServerMessage): void; end(): void }`
  - `type Handler = (req: ClientRequest, conn: Conn) => unknown | Promise<unknown>`
  - `interface RpcServer { conns: Set<Conn>; close(): Promise<void> }`
  - `startServer(socketPath: string, handler: Handler): Promise<RpcServer>`
  - `waitFor<T>(fn: () => T | null | undefined | false | Promise<T | null | undefined | false>, ms?: number): Promise<T>`

- [ ] **Step 1: Helper de espera — `tests/helpers/wait.ts`**

```ts
export async function waitFor<T>(
  fn: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  ms = 5000,
  step = 25,
): Promise<T> {
  const deadline = Date.now() + ms
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    await new Promise((r) => setTimeout(r, step))
  }
  throw new Error(`waitFor: tempo esgotado${last ? ` (último erro: ${String(last)})` : ''}`)
}
```

- [ ] **Step 2: Testes que falham — `tests/shared/framing.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { encode, LineDecoder } from '../../src/shared/framing'

describe('framing', () => {
  it('junta pedaços e separa por linha', () => {
    const d = new LineDecoder()
    expect(d.push('{"a":1}\n{"b"')).toEqual([{ a: 1 }])
    expect(d.push(':2}\n')).toEqual([{ b: 2 }])
  })

  it('ignora linha inválida sem perder as outras', () => {
    const d = new LineDecoder()
    expect(d.push('lixo\n{"ok":true}\n')).toEqual([{ ok: true }])
  })

  it('encode escapa quebras de linha dentro de strings', () => {
    const line = encode({ data: 'a\nb' })
    expect(line.split('\n')).toHaveLength(2)
    expect(new LineDecoder().push(line)).toEqual([{ data: 'a\nb' }])
  })
})
```

`tests/daemon/server.test.ts`:
```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RpcClient } from '../../src/shared/rpc-client'
import { startServer, type RpcServer } from '../../src/daemon/server'
import { waitFor } from '../helpers/wait'

let server: RpcServer | null = null
const sock = () => path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-s-'))), 's.sock')

afterEach(async () => { await server?.close(); server = null })

describe('rpc', () => {
  it('responde requisições e propaga erros', async () => {
    const p = sock()
    server = await startServer(p, (req) => {
      if (req.t === 'project.add') throw new Error('falhou: ' + req.path)
      return { eco: req.t }
    })
    const c = await RpcClient.connect(p)
    await expect(c.request({ t: 'state.get' })).resolves.toEqual({ eco: 'state.get' })
    await expect(c.request({ t: 'project.add', path: '/x' })).rejects.toThrow('falhou: /x')
    c.close()
  })

  it('send não recebe resposta e servidor pode empurrar mensagens', async () => {
    const p = sock()
    const seen: string[] = []
    server = await startServer(p, (req, conn) => {
      seen.push(req.t)
      if (req.t === 'hello') conn.send({ t: 'pane.data', paneId: 'x', data: 'oi' })
      return null
    })
    const c = await RpcClient.connect(p)
    const got: string[] = []
    c.onMessage((m) => { if (m.t === 'pane.data') got.push(m.data) })
    c.send({ t: 'hello', role: 'app', version: 1 })
    await waitFor(() => got.length === 1)
    expect(seen).toEqual(['hello'])
    c.close()
  })

  it('requisições pendentes falham quando a conexão cai', async () => {
    const p = sock()
    server = await startServer(p, () => new Promise(() => {}))
    const c = await RpcClient.connect(p)
    const pending = c.request({ t: 'state.get' })
    await server.close(); server = null
    await expect(pending).rejects.toThrow('conexão com o daemon encerrada')
  })

  it('connect falha rápido quando não há servidor', async () => {
    await expect(RpcClient.connect(sock())).rejects.toThrow()
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/shared/framing.test.ts tests/daemon/server.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Step 4: Implementar `src/shared/framing.ts`**

```ts
export class LineDecoder {
  private buf = ''

  push(chunk: string): unknown[] {
    this.buf += chunk
    const out: unknown[] = []
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i)
      this.buf = this.buf.slice(i + 1)
      if (!line.trim()) continue
      try {
        out.push(JSON.parse(line))
      } catch {
        // linha corrompida: descarta e segue
      }
    }
    return out
  }
}

export const encode = (msg: unknown): string => JSON.stringify(msg) + '\n'
```

- [ ] **Step 5: Implementar `src/shared/rpc-client.ts`**

```ts
import net from 'node:net'
import { encode, LineDecoder } from './framing'
import type { ClientRequest, ServerMessage } from './protocol'

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class RpcClient {
  private nextId = 1
  private pending = new Map<number, Pending>()
  private listeners = new Set<(m: ServerMessage) => void>()
  private closeListeners = new Set<() => void>()

  private constructor(private sock: net.Socket) {
    const dec = new LineDecoder()
    sock.setEncoding('utf8')
    sock.on('data', (chunk: string) => {
      for (const m of dec.push(chunk) as ServerMessage[]) this.dispatch(m)
    })
    sock.on('error', () => {})
    sock.on('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('conexão com o daemon encerrada'))
      this.pending.clear()
      for (const l of this.closeListeners) l()
    })
  }

  static connect(socketPath: string, timeoutMs = 2000): Promise<RpcClient> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(socketPath)
      const timer = setTimeout(() => {
        sock.destroy()
        reject(new Error('tempo esgotado ao conectar no daemon'))
      }, timeoutMs)
      sock.once('connect', () => {
        clearTimeout(timer)
        resolve(new RpcClient(sock))
      })
      sock.once('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
    })
  }

  request<T = unknown>(req: ClientRequest): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.sock.write(encode({ id, req }))
    })
  }

  send(req: ClientRequest): void {
    this.sock.write(encode({ id: 0, req }))
  }

  onMessage(cb: (m: ServerMessage) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onClose(cb: () => void): void {
    this.closeListeners.add(cb)
  }

  close(): void {
    this.sock.end()
  }

  private dispatch(m: ServerMessage): void {
    if (m.t === 'reply') {
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      if (m.ok) p.resolve(m.result)
      else p.reject(new Error(m.error))
      return
    }
    for (const l of this.listeners) l(m)
  }
}
```

- [ ] **Step 6: Implementar `src/daemon/server.ts`**

```ts
import fs from 'node:fs'
import net from 'node:net'
import { encode, LineDecoder } from '../shared/framing'
import type { ClientRequest, RequestEnvelope, ServerMessage } from '../shared/protocol'

export interface Conn {
  role: 'app' | 'hook' | null
  subscriptions: Set<string>
  send(m: ServerMessage): void
  end(): void
}

export type Handler = (req: ClientRequest, conn: Conn) => unknown | Promise<unknown>

export interface RpcServer {
  conns: Set<Conn>
  close(): Promise<void>
}

export async function startServer(socketPath: string, handler: Handler): Promise<RpcServer> {
  try {
    fs.unlinkSync(socketPath)
  } catch {
    // não existia
  }
  const conns = new Set<Conn>()
  const sockets = new Set<net.Socket>()

  const server = net.createServer((sock) => {
    sockets.add(sock)
    sock.setEncoding('utf8')
    const dec = new LineDecoder()
    const conn: Conn = {
      role: null,
      subscriptions: new Set(),
      send: (m) => {
        if (!sock.destroyed) sock.write(encode(m))
      },
      end: () => sock.end(),
    }
    conns.add(conn)

    const handle = async (env: RequestEnvelope): Promise<void> => {
      try {
        const result = await handler(env.req, conn)
        if (env.id) conn.send({ t: 'reply', id: env.id, ok: true, result: result ?? null })
      } catch (e) {
        if (env.id) conn.send({ t: 'reply', id: env.id, ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }

    sock.on('data', (chunk: string) => {
      for (const env of dec.push(chunk) as RequestEnvelope[]) void handle(env)
    })
    sock.on('error', () => {})
    sock.on('close', () => {
      conns.delete(conn)
      sockets.delete(sock)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => resolve())
  })
  fs.chmodSync(socketPath, 0o600)

  return {
    conns,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      }),
  }
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run tests/shared/framing.test.ts tests/daemon/server.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: framing JSON por linha e RPC via unix socket

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: PtyHost (terminais vivos + espelho headless)

**Files:**
- Create: `src/daemon/pty-host.ts`
- Test: `tests/daemon/pty-host.test.ts`

**Interfaces:**
- Produces:
  - `interface SpawnOptions { id: string; shell: string; args: string[]; cwd: string; cols: number; rows: number; env: Record<string, string> }`
  - `interface PtyHostEvents { data(id: string, data: string): void; exit(id: string, code: number): void }`
  - `class PtyHost { constructor(events: PtyHostEvents); spawn(o: SpawnOptions): number; has(id: string): boolean; pid(id: string): number | undefined; write(id: string, data: string): void; resize(id: string, cols: number, rows: number): void; serialize(id: string): string; kill(id: string): void; killAll(): void }`
- Invariante: `events.data` só é chamado **depois** que o dado foi processado pelo espelho headless. Assim, em qualquer momento síncrono, `serialize()` equivale a tudo que já foi emitido — é isso que permite anexar um cliente sem perder nem duplicar saída.

- [ ] **Step 1: Teste que falha — `tests/daemon/pty-host.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { PtyHost } from '../../src/daemon/pty-host'
import { waitFor } from '../helpers/wait'

const env = { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }
let host: PtyHost | null = null
afterEach(() => { host?.killAll(); host = null })

function make() {
  const out = new Map<string, string>()
  const exits = new Map<string, number>()
  host = new PtyHost({
    data: (id, d) => out.set(id, (out.get(id) ?? '') + d),
    exit: (id, code) => exits.set(id, code),
  })
  return { host, out, exits }
}

describe('PtyHost', () => {
  it('emite saída e a tela serializada contém o texto com acento', async () => {
    const { host, out } = make()
    host.spawn({ id: 'a', shell: '/bin/sh', args: ['-c', "printf 'ação ok\\n'; sleep 30"], cwd: '/', cols: 80, rows: 24, env })
    await waitFor(() => out.get('a')?.includes('ação ok'))
    expect(host.serialize('a')).toContain('ação ok')
  })

  it('escreve no processo', async () => {
    const { host, out } = make()
    host.spawn({ id: 'b', shell: '/bin/cat', args: [], cwd: '/', cols: 80, rows: 24, env })
    host.write('b', 'olá\r')
    await waitFor(() => out.get('b')?.includes('olá'))
  })

  it('avisa a saída com o código e esquece o terminal', async () => {
    const { host, exits } = make()
    host.spawn({ id: 'c', shell: '/bin/sh', args: ['-c', 'exit 3'], cwd: '/', cols: 80, rows: 24, env })
    await waitFor(() => exits.has('c'))
    expect(exits.get('c')).toBe(3)
    expect(host.has('c')).toBe(false)
  })

  it('redimensiona, informa pid e recusa id duplicado', () => {
    const { host } = make()
    const pid = host.spawn({ id: 'd', shell: '/bin/cat', args: [], cwd: '/', cols: 80, rows: 24, env })
    expect(host.pid('d')).toBe(pid)
    expect(() => host.resize('d', 120, 40)).not.toThrow()
    expect(() => host.spawn({ id: 'd', shell: '/bin/cat', args: [], cwd: '/', cols: 80, rows: 24, env })).toThrow('já existe')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/pty-host.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `src/daemon/pty-host.ts`**

```ts
import * as pty from 'node-pty'
import { Terminal } from '@xterm/headless'
import { SerializeAddon } from '@xterm/addon-serialize'

export interface SpawnOptions {
  id: string
  shell: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env: Record<string, string>
}

export interface PtyHostEvents {
  data(id: string, data: string): void
  exit(id: string, code: number): void
}

interface Entry {
  proc: pty.IPty
  term: Terminal
  ser: SerializeAddon
}

const SCROLLBACK = 10_000

export class PtyHost {
  private entries = new Map<string, Entry>()

  constructor(private events: PtyHostEvents) {}

  spawn(o: SpawnOptions): number {
    if (this.entries.has(o.id)) throw new Error(`terminal ${o.id} já existe`)
    const proc = pty.spawn(o.shell, o.args, { name: 'xterm-256color', cols: o.cols, rows: o.rows, cwd: o.cwd, env: o.env })
    const term = new Terminal({ cols: o.cols, rows: o.rows, scrollback: SCROLLBACK, allowProposedApi: true })
    const ser = new SerializeAddon()
    term.loadAddon(ser)
    this.entries.set(o.id, { proc, term, ser })

    // só repassa depois que o espelho processou: serialize() == tudo que já foi emitido
    proc.onData((data) => term.write(data, () => this.events.data(o.id, data)))
    proc.onExit(({ exitCode }) => {
      term.write('', () => {
        this.entries.delete(o.id)
        term.dispose()
        this.events.exit(o.id, exitCode)
      })
    })
    return proc.pid
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  pid(id: string): number | undefined {
    return this.entries.get(id)?.proc.pid
  }

  write(id: string, data: string): void {
    this.entries.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const e = this.entries.get(id)
    if (!e) return
    const c = Math.max(2, Math.floor(cols))
    const r = Math.max(1, Math.floor(rows))
    if (c === e.term.cols && r === e.term.rows) return
    e.proc.resize(c, r)
    e.term.resize(c, r)
  }

  serialize(id: string): string {
    const e = this.entries.get(id)
    if (!e) throw new Error(`terminal ${id} não existe`)
    return e.ser.serialize({ scrollback: SCROLLBACK })
  }

  kill(id: string): void {
    try {
      this.entries.get(id)?.proc.kill()
    } catch {
      // já morreu
    }
  }

  killAll(): void {
    for (const id of [...this.entries.keys()]) this.kill(id)
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/daemon/pty-host.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: PtyHost com espelho headless serializável

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Git — execução com timeout e parsers

**Files:**
- Create: `src/daemon/git/run.ts`, `src/daemon/git/parse.ts`
- Create: `tests/helpers/repo.ts`
- Test: `tests/daemon/git.test.ts`

**Interfaces:**
- Consumes: `GitStatus`, `WorktreeInfo` (Task 1).
- Produces:
  - `interface GitResult { ok: boolean; stdout: string; stderr: string }`
  - `git(cwd: string, args: string[], timeoutMs?: number): Promise<GitResult>` (padrão 5000 ms)
  - `parseStatus(out: string): Omit<GitStatus, 'error'>` — entrada: `git status --porcelain=v2 --branch`
  - `parseWorktreeList(out: string): WorktreeInfo[]` — entrada: `git worktree list --porcelain -z`; o primeiro é a principal
  - helper de teste `makeRepo(): TestRepo` com `{ root: string; dir: string; git(...args: string[]): string; write(rel: string, content: string): void; cleanup(): void }` — `root` e `dir` **contêm espaço** no nome

- [ ] **Step 1: Helper de repositório — `tests/helpers/repo.ts`**

```ts
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface TestRepo {
  root: string
  dir: string
  git(...args: string[]): string
  write(rel: string, content: string): void
  cleanup(): void
}

const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }

export function makeRepo(): TestRepo {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt repo ')))
  const dir = path.join(root, 'meu projeto')
  fs.mkdirSync(dir)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env })
  git('init', '-b', 'main')
  git('config', 'user.email', 'teste@exemplo.com')
  git('config', 'user.name', 'Teste')
  git('config', 'commit.gpgsign', 'false')
  fs.writeFileSync(path.join(dir, 'README.md'), 'oi\n')
  git('add', '.')
  git('commit', '-m', 'inicial')
  return {
    root,
    dir,
    git,
    write: (rel, content) => fs.writeFileSync(path.join(dir, rel), content),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  }
}
```

- [ ] **Step 2: Testes que falham — `tests/daemon/git.test.ts`**

```ts
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { git } from '../../src/daemon/git/run'
import { parseStatus, parseWorktreeList } from '../../src/daemon/git/parse'
import { makeRepo, type TestRepo } from '../helpers/repo'

let repo: TestRepo | null = null
afterEach(() => { repo?.cleanup(); repo = null })

describe('parseStatus', () => {
  it('lê branch, upstream, ahead/behind e conta alterações', () => {
    const out = [
      '# branch.oid abc',
      '# branch.head feat/auth',
      '# branch.upstream origin/feat/auth',
      '# branch.ab +2 -1',
      '1 .M N... 100644 100644 100644 a b src/a.ts',
      '2 R. N... 100644 100644 100644 a b R100 novo.ts\tvelho.ts',
      'u UU N... 1 2 3 4 a b c conflito.ts',
      '? solto.txt',
      '',
    ].join('\n')
    expect(parseStatus(out)).toEqual({ branch: 'feat/auth', upstream: 'origin/feat/auth', ahead: 2, behind: 1, changed: 4 })
  })

  it('HEAD destacado e sem upstream', () => {
    expect(parseStatus('# branch.oid abc\n# branch.head (detached)\n')).toEqual({ branch: null, upstream: null, ahead: 0, behind: 0, changed: 0 })
  })
})

describe('parseWorktreeList', () => {
  it('lê a saída -z com principal, branch, detached, locked e prunable', () => {
    const out = [
      'worktree /r/meu projeto', 'HEAD aaa', 'branch refs/heads/main', '',
      'worktree /r/meu projeto/.claude/worktrees/auth', 'HEAD bbb', 'branch refs/heads/feat/auth', 'locked', '',
      'worktree /r/solto', 'HEAD ccc', 'detached', 'prunable gitdir file points to non-existent location', '',
    ].join('\0') + '\0'
    expect(parseWorktreeList(out)).toEqual([
      { path: '/r/meu projeto', head: 'aaa', branch: 'main', isMain: true, locked: false, prunable: false },
      { path: '/r/meu projeto/.claude/worktrees/auth', head: 'bbb', branch: 'feat/auth', isMain: false, locked: true, prunable: false },
      { path: '/r/solto', head: 'ccc', branch: null, isMain: false, locked: false, prunable: true },
    ])
  })
})

describe('git real (caminhos com espaço)', () => {
  it('status e worktree list funcionam num repositório de verdade', async () => {
    repo = makeRepo()
    const wt = path.join(repo.root, 'wt auth')
    repo.git('worktree', 'add', '-b', 'feat/auth', wt)
    repo.write('novo.txt', 'x')

    const st = await git(repo.dir, ['status', '--porcelain=v2', '--branch'])
    expect(st.ok).toBe(true)
    expect(parseStatus(st.stdout)).toMatchObject({ branch: 'main', changed: 1 })

    const wl = await git(repo.dir, ['worktree', 'list', '--porcelain', '-z'])
    expect(parseWorktreeList(wl.stdout).map((w) => [w.path, w.branch, w.isMain])).toEqual([
      [repo.dir, 'main', true],
      [wt, 'feat/auth', false],
    ])
  })

  it('falha sem lançar exceção quando a pasta não existe', async () => {
    const r = await git('/nao/existe', ['status'])
    expect(r.ok).toBe(false)
    expect(r.stderr).not.toBe('')
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/git.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar `src/daemon/git/run.ts`**

```ts
import { execFile } from 'node:child_process'

export interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
}

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes',
  // status em segundo plano não pode segurar o index.lock enquanto o Claude usa git
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C',
}

export function git(cwd: string, args: string[], timeoutMs = 5000): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...GIT_ENV } },
      (err, stdout, stderr) => {
        const errText = String(stderr) || (err ? err.message : '')
        resolve({ ok: !err, stdout: String(stdout), stderr: errText })
      },
    )
  })
}
```

- [ ] **Step 5: Implementar `src/daemon/git/parse.ts`**

```ts
import type { GitStatus, WorktreeInfo } from '../../shared/types'

export function parseStatus(out: string): Omit<GitStatus, 'error'> {
  const s: Omit<GitStatus, 'error'> = { branch: null, upstream: null, ahead: 0, behind: 0, changed: 0 }
  for (const line of out.split('\n')) {
    if (!line) continue
    if (line.startsWith('# branch.head ')) {
      const v = line.slice('# branch.head '.length)
      s.branch = v === '(detached)' ? null : v
    } else if (line.startsWith('# branch.upstream ')) {
      s.upstream = line.slice('# branch.upstream '.length)
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        s.ahead = Number(m[1])
        s.behind = Number(m[2])
      }
    } else if (/^[12u?] /.test(line)) {
      s.changed++
    }
  }
  return s
}

export function parseWorktreeList(out: string): WorktreeInfo[] {
  const result: WorktreeInfo[] = []
  let cur: WorktreeInfo | null = null
  for (const field of out.split('\0')) {
    if (field === '') {
      if (cur) result.push(cur)
      cur = null
      continue
    }
    const sp = field.indexOf(' ')
    const key = sp < 0 ? field : field.slice(0, sp)
    const val = sp < 0 ? '' : field.slice(sp + 1)
    if (key === 'worktree') {
      if (cur) result.push(cur)
      cur = { path: val, head: null, branch: null, isMain: false, locked: false, prunable: false }
    } else if (cur) {
      if (key === 'HEAD') cur.head = val
      else if (key === 'branch') cur.branch = val.replace(/^refs\/heads\//, '')
      else if (key === 'locked') cur.locked = true
      else if (key === 'prunable') cur.prunable = true
    }
  }
  if (cur) result.push(cur)
  result.forEach((w, i) => { w.isMain = i === 0 })
  return result
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run tests/daemon/git.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: execução de git com timeout e parsers de status/worktree

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Resolução de worktree, contas e estado da sessão

**Files:**
- Create: `src/daemon/resolve.ts`, `src/daemon/accounts.ts`, `src/daemon/session.ts`, `src/daemon/title.ts`
- Test: `tests/daemon/resolve.test.ts`, `tests/daemon/accounts.test.ts`, `tests/daemon/session.test.ts`

**Interfaces:**
- Consumes: `git`, `parseWorktreeList` (Task 4); tipos da Task 1.
- Produces:
  - `interface Location { projectPath: string; worktreePath: string }`
  - `findWorktree(projects: { path: string; worktrees: WorktreeInfo[] }[], toplevel: string): Location | null`
  - `gitToplevel(cwd: string): Promise<string | null>`
  - `listWorktrees(dir: string): Promise<{ ok: true; worktrees: WorktreeInfo[] } | { ok: false; error: string }>`
  - `DEFAULT_ACCOUNTS: Account[]`
  - `detectAccount(accounts: Account[], configDir: string | null, argv: string | null): string | null`
  - `buildCommand(account: Account, resumeSessionId?: string): string`
  - `suggestAccount(accounts: Account[], projectPath: string, userHome: string): string | null`
  - `reduceSession(prev: ClaudeSession | null, p: HookPayload): ClaudeSession | null`
  - `readTitle(transcriptPath: string): Promise<string | null>`

- [ ] **Step 1: Testes que falham — `tests/daemon/resolve.test.ts`**

```ts
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findWorktree, gitToplevel, listWorktrees } from '../../src/daemon/resolve'
import type { WorktreeInfo } from '../../src/shared/types'
import { makeRepo, type TestRepo } from '../helpers/repo'

const wt = (p: string, isMain = false): WorktreeInfo => ({ path: p, head: null, branch: null, isMain, locked: false, prunable: false })
let repo: TestRepo | null = null
afterEach(() => { repo?.cleanup(); repo = null })

describe('findWorktree', () => {
  const projects = [
    { path: '/a', worktrees: [wt('/a', true), wt('/a/.claude/worktrees/x')] },
    { path: '/b', worktrees: [wt('/b', true)] },
  ]
  it('acha pela raiz exata da worktree', () => {
    expect(findWorktree(projects, '/a/.claude/worktrees/x')).toEqual({ projectPath: '/a', worktreePath: '/a/.claude/worktrees/x' })
    expect(findWorktree(projects, '/b')).toEqual({ projectPath: '/b', worktreePath: '/b' })
  })
  it('não acha o que não está cadastrado', () => {
    expect(findWorktree(projects, '/c')).toBeNull()
  })
})

describe('gitToplevel / listWorktrees', () => {
  it('resolve subpasta para a raiz e lista worktrees', async () => {
    repo = makeRepo()
    fs.mkdirSync(path.join(repo.dir, 'sub pasta'))
    expect(await gitToplevel(path.join(repo.dir, 'sub pasta'))).toBe(repo.dir)
    const other = path.join(repo.root, 'wt x')
    repo.git('worktree', 'add', '-b', 'x', other)
    expect(await gitToplevel(other)).toBe(other)
    const r = await listWorktrees(other)
    expect(r.ok && r.worktrees[0].path).toBe(repo.dir)
  })
  it('fora de repositório devolve null / erro', async () => {
    expect(await gitToplevel('/')).toBeNull()
    expect((await listWorktrees('/')).ok).toBe(false)
  })
})
```

`tests/daemon/accounts.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildCommand, DEFAULT_ACCOUNTS, detectAccount, suggestAccount } from '../../src/daemon/accounts'

const S = '/Users/u/.claude-swap-backup/sessions'

describe('detectAccount', () => {
  it('sem CLAUDE_CONFIG_DIR é a conta padrão', () => {
    expect(detectAccount(DEFAULT_ACCOUNTS, null, '/Users/u/.local/bin/claude')).toBe('misa')
  })
  it('pelo perfil do cswap', () => {
    expect(detectAccount(DEFAULT_ACCOUNTS, `${S}/3-misael_mslabs-dev.com`, null)).toBe('mslabs')
    expect(detectAccount(DEFAULT_ACCOUNTS, `${S}/1-misasoaresms2_gmail.com`, null)).toBe('misa')
  })
  it('weboption x weboption-max pelo --settings', () => {
    const dir = `${S}/2-weboption2011_gmail.com`
    expect(detectAccount(DEFAULT_ACCOUNTS, dir, 'claude --settings /Users/u/.config/claude/weboption-gateway.proj.json')).toBe('weboption')
    expect(detectAccount(DEFAULT_ACCOUNTS, dir, 'claude --settings /Users/u/.config/claude/weboption-max.json')).toBe('weboption-max')
    expect(detectAccount(DEFAULT_ACCOUNTS, dir, null)).toBe('weboption')
  })
  it('perfil desconhecido não chuta', () => {
    expect(detectAccount(DEFAULT_ACCOUNTS, `${S}/9-outro`, null)).toBeNull()
  })
})

describe('buildCommand', () => {
  it('monta o comando e o resume', () => {
    const mslabs = DEFAULT_ACCOUNTS.find((a) => a.id === 'mslabs')!
    expect(buildCommand(mslabs)).toBe('claude-mslabs')
    expect(buildCommand(mslabs, '6f574752-bb4d-4ff2-8ed1-bb685dce78ed')).toBe('claude-mslabs --resume 6f574752-bb4d-4ff2-8ed1-bb685dce78ed')
  })
  it('recusa session id que não parece um id', () => {
    expect(() => buildCommand(DEFAULT_ACCOUNTS[0], 'x; rm -rf ~')).toThrow('session id inválido')
  })
})

describe('suggestAccount', () => {
  it('sugere pela pasta do projeto', () => {
    expect(suggestAccount(DEFAULT_ACCOUNTS, '/Users/u/Documents/weboption/site', '/Users/u')).toBe('weboption')
    expect(suggestAccount(DEFAULT_ACCOUNTS, '/Users/u/Documents/weboption-velho', '/Users/u')).toBeNull()
    expect(suggestAccount(DEFAULT_ACCOUNTS, '/Volumes/SSD MISA/apps', '/Users/u')).toBeNull()
  })
})
```

`tests/daemon/session.test.ts`:
```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { reduceSession } from '../../src/daemon/session'
import { readTitle } from '../../src/daemon/title'
import type { ClaudeSession, HookPayload } from '../../src/shared/types'

const ev = (hook_event_name: string, extra: Partial<HookPayload> = {}): HookPayload => ({ hook_event_name, session_id: 's1', cwd: '/p', ...extra })

function run(events: HookPayload[]): ClaudeSession | null {
  return events.reduce<ClaudeSession | null>((s, e) => reduceSession(s, e), null)
}

describe('reduceSession', () => {
  it('ciclo normal de um turno', () => {
    expect(run([ev('SessionStart')])?.status).toBe('idle')
    expect(run([ev('SessionStart'), ev('UserPromptSubmit')])?.status).toBe('working')
    expect(run([ev('SessionStart'), ev('UserPromptSubmit'), ev('PreToolUse', { tool_name: 'Bash' }), ev('PostToolUse')])?.status).toBe('working')
    expect(run([ev('SessionStart'), ev('UserPromptSubmit'), ev('Stop')])?.status).toBe('idle')
  })

  it('precisa de você: permissão, pergunta e notificações', () => {
    expect(run([ev('UserPromptSubmit'), ev('PermissionRequest')])?.status).toBe('needs-you')
    expect(run([ev('UserPromptSubmit'), ev('PreToolUse', { tool_name: 'AskUserQuestion' })])?.status).toBe('needs-you')
    expect(run([ev('UserPromptSubmit'), ev('Notification', { notification_type: 'permission_prompt' })])?.status).toBe('needs-you')
    expect(run([ev('UserPromptSubmit'), ev('Notification', { notification_type: 'auth_success' })])?.status).toBe('working')
  })

  it('SessionStart de compact no meio do trabalho mantém o estado', () => {
    expect(run([ev('UserPromptSubmit'), ev('SessionStart', { source: 'compact' })])?.status).toBe('working')
  })

  it('evento sem SessionStart cria a sessão (app aberto no meio)', () => {
    expect(run([ev('PostToolUse', { transcript_path: '/t.jsonl' })])).toEqual({ sessionId: 's1', status: 'working', title: null, transcriptPath: '/t.jsonl' })
  })

  it('/clear troca o id e zera o título; SessionEnd encerra', () => {
    const a = { ...run([ev('SessionStart')])!, title: 'velho' }
    const b = reduceSession(a, ev('SessionStart', { session_id: 's2', source: 'clear' }))
    expect(b).toMatchObject({ sessionId: 's2', title: null })
    expect(reduceSession(b, ev('SessionEnd'))).toBeNull()
  })

  it('CwdChanged não mexe no estado', () => {
    expect(run([ev('UserPromptSubmit'), ev('CwdChanged')])?.status).toBe('working')
  })
})

describe('readTitle', () => {
  it('prefere o título manual (/rename) ao título gerado', async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-t-')), 't.jsonl')
    fs.writeFileSync(f, [
      JSON.stringify({ type: 'user', message: 'oi' }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Título gerado', sessionId: 's1' }),
      JSON.stringify({ type: 'custom-title', customTitle: 'meu nome', sessionId: 's1' }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Outro gerado', sessionId: 's1' }),
      '',
    ].join('\n'))
    expect(await readTitle(f)).toBe('meu nome')
  })
  it('usa o último título gerado quando não há manual; arquivo ausente → null', async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-t-')), 't.jsonl')
    fs.writeFileSync(f, JSON.stringify({ type: 'ai-title', aiTitle: 'A' }) + '\n' + JSON.stringify({ type: 'ai-title', aiTitle: 'B' }) + '\n')
    expect(await readTitle(f)).toBe('B')
    expect(await readTitle('/nao/existe.jsonl')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/resolve.test.ts tests/daemon/accounts.test.ts tests/daemon/session.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/daemon/resolve.ts`**

```ts
import type { WorktreeInfo } from '../shared/types'
import { git } from './git/run'
import { parseWorktreeList } from './git/parse'

export interface Location {
  projectPath: string
  worktreePath: string
}

export function findWorktree(projects: { path: string; worktrees: WorktreeInfo[] }[], toplevel: string): Location | null {
  for (const p of projects) {
    for (const w of p.worktrees) if (w.path === toplevel) return { projectPath: p.path, worktreePath: w.path }
  }
  return null
}

export async function gitToplevel(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['rev-parse', '--show-toplevel'])
  return r.ok ? r.stdout.trim() || null : null
}

export async function listWorktrees(
  dir: string,
): Promise<{ ok: true; worktrees: WorktreeInfo[] } | { ok: false; error: string }> {
  const r = await git(dir, ['worktree', 'list', '--porcelain', '-z'])
  if (!r.ok) return { ok: false, error: r.stderr.trim().split('\n')[0] || 'git worktree list falhou' }
  const worktrees = parseWorktreeList(r.stdout)
  if (worktrees.length === 0) return { ok: false, error: 'nenhuma worktree encontrada' }
  return { ok: true, worktrees }
}
```

- [ ] **Step 4: Implementar `src/daemon/accounts.ts`**

```ts
import path from 'node:path'
import type { Account } from '../shared/types'

export const DEFAULT_ACCOUNTS: Account[] = [
  { id: 'misa', label: 'misa', command: 'claude', color: '#4fc1ff', configDirMatch: ['1-misasoaresms2'], isDefault: true, settingsMatch: null, pathPrefix: null },
  { id: 'mslabs', label: 'mslabs', command: 'claude-mslabs', color: '#c586c0', configDirMatch: ['3-misael_mslabs-dev.com'], isDefault: false, settingsMatch: null, pathPrefix: null },
  { id: 'weboption', label: 'weboption', command: 'claude-weboption', color: '#dcdcaa', configDirMatch: ['2-weboption2011_gmail.com'], isDefault: false, settingsMatch: 'weboption-gateway', pathPrefix: '~/Documents/weboption' },
  { id: 'weboption-max', label: 'weboption-max', command: 'claude-weboption-max', color: '#ce9178', configDirMatch: ['2-weboption2011_gmail.com'], isDefault: false, settingsMatch: 'weboption-max', pathPrefix: null },
]

export function detectAccount(accounts: Account[], configDir: string | null, argv: string | null): string | null {
  const candidates = configDir
    ? accounts.filter((a) => a.configDirMatch.some((m) => configDir.includes(m)))
    : accounts.filter((a) => a.isDefault)
  if (candidates.length <= 1) return candidates[0]?.id ?? null
  const bySettings = candidates.find((a) => a.settingsMatch && argv?.includes(a.settingsMatch))
  return (bySettings ?? candidates.find((a) => !a.settingsMatch) ?? candidates[0]).id
}

const SESSION_ID_RE = /^[0-9a-f-]{8,64}$/i

export function buildCommand(account: Account, resumeSessionId?: string): string {
  if (!resumeSessionId) return account.command
  if (!SESSION_ID_RE.test(resumeSessionId)) throw new Error(`session id inválido: ${resumeSessionId}`)
  return `${account.command} --resume ${resumeSessionId}`
}

export function suggestAccount(accounts: Account[], projectPath: string, userHome: string): string | null {
  for (const a of accounts) {
    if (!a.pathPrefix) continue
    const prefix = a.pathPrefix.startsWith('~/') ? path.join(userHome, a.pathPrefix.slice(2)) : a.pathPrefix
    if (projectPath === prefix || projectPath.startsWith(prefix + '/')) return a.id
  }
  return null
}
```

- [ ] **Step 5: Implementar `src/daemon/session.ts`**

```ts
import type { ClaudeSession, HookPayload } from '../shared/types'

const NEEDS_YOU_NOTIFICATIONS = new Set(['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input'])

export function reduceSession(prev: ClaudeSession | null, p: HookPayload): ClaudeSession | null {
  const ev = p.hook_event_name
  if (ev === 'SessionEnd') return null
  const base: ClaudeSession =
    prev && prev.sessionId === p.session_id
      ? prev
      : { sessionId: p.session_id, status: 'idle', title: null, transcriptPath: null }
  const next: ClaudeSession = { ...base, transcriptPath: p.transcript_path ?? base.transcriptPath }

  switch (ev) {
    case 'SessionStart':
      return p.source === 'compact' ? next : { ...next, status: 'idle' }
    case 'UserPromptSubmit':
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return { ...next, status: 'working' }
    case 'PreToolUse':
      return { ...next, status: p.tool_name === 'AskUserQuestion' ? 'needs-you' : 'working' }
    case 'PermissionRequest':
      return { ...next, status: 'needs-you' }
    case 'Notification':
      return NEEDS_YOU_NOTIFICATIONS.has(p.notification_type ?? '') ? { ...next, status: 'needs-you' } : next
    case 'Stop':
    case 'StopFailure':
      return { ...next, status: 'idle' }
    default:
      return next
  }
}
```

Observação: no teste "evento sem SessionStart", `PostToolUse` parte de `idle` e vira `working`, como esperado.

- [ ] **Step 6: Implementar `src/daemon/title.ts`**

```ts
import fs from 'node:fs'
import readline from 'node:readline'

export async function readTitle(transcriptPath: string): Promise<string | null> {
  let custom: string | null = null
  let ai: string | null = null
  try {
    const rl = readline.createInterface({ input: fs.createReadStream(transcriptPath, { encoding: 'utf8' }), crlfDelay: Infinity })
    for await (const line of rl) {
      if (line.includes('"type":"custom-title"')) {
        try {
          const o = JSON.parse(line) as { customTitle?: unknown }
          if (typeof o.customTitle === 'string') custom = o.customTitle
        } catch {
          // linha quebrada
        }
      } else if (line.includes('"type":"ai-title"')) {
        try {
          const o = JSON.parse(line) as { aiTitle?: unknown }
          if (typeof o.aiTitle === 'string') ai = o.aiTitle
        } catch {
          // linha quebrada
        }
      }
    }
  } catch {
    return null
  }
  return custom ?? ai
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run tests/daemon/resolve.test.ts tests/daemon/accounts.test.ts tests/daemon/session.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: resolução de worktree, contas e estado da sessão do Claude

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Leitura de processos (ps/lsof)

**Files:**
- Create: `src/daemon/platform/procs.ts`
- Test: `tests/daemon/procs.test.ts`

**Interfaces:**
- Produces:
  - `interface Proc { pid: number; ppid: number; stat: string; args: string }`
  - `parsePs(out: string): Proc[]` — entrada de `ps -A -o pid=,ppid=,stat=,args=`
  - `descendants(procs: Proc[], rootPid: number): Proc[]`
  - `foregroundOf(procs: Proc[], rootPid: number): Proc | null` — processo em primeiro plano mais profundo (stat com `+`) entre a raiz e seus descendentes
  - `findClaude(procs: Proc[], rootPid: number): Proc | null` — descendente que é o CLI do Claude
  - `parseLsofCwd(out: string): Map<number, string>` — entrada de `lsof -a -d cwd -Fn -p ...`
  - `snapshotProcs(): Promise<Proc[]>`, `cwdOf(pids: number[]): Promise<Map<number, string>>`
- Usa caminhos absolutos (`/bin/ps`, `/usr/sbin/lsof`): o app aberto pelo Finder não tem `/usr/sbin` no PATH.

- [ ] **Step 1: Teste que falha — `tests/daemon/procs.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { cwdOf, descendants, findClaude, foregroundOf, parseLsofCwd, parsePs, snapshotProcs } from '../../src/daemon/platform/procs'

const PS = [
  '  100     1 Ss   /Applications/Gerenciador.app/Contents/MacOS/Gerenciador',
  '  200   100 Ss   -zsh',
  '  300   200 S+   /Users/u/.local/bin/cswap run misael@mslabs-dev.com --',
  '  301   300 S+   /Users/u/.local/bin/claude --settings /Users/u/.config/claude/weboption-max.json',
  '  302   301 S    /bin/zsh -c source /Users/u/.claude/shell-snapshots/x.sh',
  '  400   100 Ss+  -zsh',
  '  500     1 SNs  claude bg-pty-host --bg-pty-host /tmp/x.sock',
].join('\n')

describe('parsePs e árvore', () => {
  const procs = parsePs(PS)
  it('lê pid, ppid, stat e args com espaços', () => {
    expect(procs).toHaveLength(7)
    expect(procs[3]).toEqual({ pid: 301, ppid: 300, stat: 'S+', args: '/Users/u/.local/bin/claude --settings /Users/u/.config/claude/weboption-max.json' })
  })
  it('descendentes', () => {
    expect(descendants(procs, 200).map((p) => p.pid).sort()).toEqual([300, 301, 302])
  })
  it('primeiro plano mais profundo', () => {
    expect(foregroundOf(procs, 200)?.pid).toBe(301)
    expect(foregroundOf(procs, 400)?.pid).toBe(400)
  })
  it('acha o claude embaixo do shell do painel e ignora os de fora', () => {
    expect(findClaude(procs, 200)?.pid).toBe(301)
    expect(findClaude(procs, 400)).toBeNull()
  })
})

describe('parseLsofCwd', () => {
  it('mapeia pid → cwd, inclusive com espaço', () => {
    const out = 'p301\nfcwd\nn/Volumes/SSD MISA/apps/meu projeto\np400\nfcwd\nn/Users/u\n'
    expect(parseLsofCwd(out)).toEqual(new Map([[301, '/Volumes/SSD MISA/apps/meu projeto'], [400, '/Users/u']]))
  })
})

describe('no sistema de verdade', () => {
  it('encontra o próprio processo e o cwd dele', async () => {
    const procs = await snapshotProcs()
    expect(procs.some((p) => p.pid === process.pid)).toBe(true)
    const cwds = await cwdOf([process.pid])
    expect(cwds.get(process.pid)).toBe(process.cwd())
  })
  it('lista vazia não chama lsof', async () => {
    expect((await cwdOf([])).size).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/procs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/daemon/platform/procs.ts`**

```ts
import { execFile } from 'node:child_process'
import fs from 'node:fs'

export interface Proc {
  pid: number
  ppid: number
  stat: string
  args: string
}

export function parsePs(out: string): Proc[] {
  const procs: Proc[] = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (m) procs.push({ pid: Number(m[1]), ppid: Number(m[2]), stat: m[3], args: m[4] })
  }
  return procs
}

export function descendants(procs: Proc[], rootPid: number): Proc[] {
  const children = new Map<number, Proc[]>()
  for (const p of procs) {
    const list = children.get(p.ppid) ?? []
    list.push(p)
    children.set(p.ppid, list)
  }
  const out: Proc[] = []
  const queue = [rootPid]
  while (queue.length) {
    const pid = queue.shift()!
    for (const c of children.get(pid) ?? []) {
      out.push(c)
      queue.push(c.pid)
    }
  }
  return out
}

export function foregroundOf(procs: Proc[], rootPid: number): Proc | null {
  const self = procs.find((p) => p.pid === rootPid) ?? null
  const all = self ? [self, ...descendants(procs, rootPid)] : descendants(procs, rootPid)
  const fg = all.filter((p) => p.stat.includes('+'))
  if (fg.length === 0) return self
  const deepest = fg.filter((p) => !fg.some((c) => c.ppid === p.pid))
  return deepest.sort((a, b) => b.pid - a.pid)[0] ?? self
}

const CLAUDE_RE = /(^|\/)claude(\s|$)|claude-code\/cli\.js|\/claude\/versions\//

export function findClaude(procs: Proc[], rootPid: number): Proc | null {
  return descendants(procs, rootPid).find((p) => CLAUDE_RE.test(p.args)) ?? null
}

export function parseLsofCwd(out: string): Map<number, string> {
  const result = new Map<number, string>()
  let pid: number | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid !== null) result.set(pid, line.slice(1))
  }
  return result
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    // lsof sai com código 1 se algum pid sumiu; a saída parcial ainda vale
    execFile(cmd, args, { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (_err, stdout) => resolve(String(stdout ?? '')))
  })
}

export async function snapshotProcs(): Promise<Proc[]> {
  return parsePs(await run('/bin/ps', ['-A', '-o', 'pid=,ppid=,stat=,args=']))
}

export async function cwdOf(pids: number[]): Promise<Map<number, string>> {
  if (pids.length === 0) return new Map()
  if (process.platform === 'linux') {
    const m = new Map<number, string>()
    for (const pid of pids) {
      try {
        m.set(pid, fs.readlinkSync(`/proc/${pid}/cwd`))
      } catch {
        // processo sumiu
      }
    }
    return m
  }
  return parseLsofCwd(await run('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fn', '-p', pids.join(',')]))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/daemon/procs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: leitura de processos e cwd (ps/lsof)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Persistência, script gt-hook e instalação dos hooks

**Files:**
- Create: `src/daemon/persist.ts`, `src/daemon/hooks.ts`
- Create: `tests/helpers/run.ts`
- Test: `tests/daemon/persist.test.ts`, `tests/daemon/hooks.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_ACCOUNTS` (Task 5), `startServer` (Task 2), tipos da Task 1.
- Produces:
  - `interface PersistedPane { id: string; cwd: string; accountId: string | null; sessionId: string | null }`
  - `interface Persisted { version: 1; projects: ProjectConfig[]; layout: Layout; accounts: Account[]; panes: PersistedPane[]; resumable: ResumeEntry[]; fetchIntervalMin: number }`
  - `defaultPersisted(): Persisted`, `loadPersisted(file: string): Persisted`, `savePersisted(file: string, data: Persisted): void`
  - `HOOK_EVENTS: readonly string[]`, `HOOK_MARKER = 'gt-hook'`, `GT_HOOK_SCRIPT: string`
  - `hookCommand(scriptPath: string): string`, `writeHookScript(scriptPath: string): void`
  - `mergeHooks(settings: Record<string, unknown>, command: string): Record<string, unknown>`
  - `hasHooks(settings: unknown, command: string): boolean`
  - `installHooks(settingsPath: string, command: string): { backup: string | null }`
  - `settingsFiles(userHome: string): string[]`, `checkProfiles(userHome: string, command: string): string[]`
  - helper de teste `runWithInput(cmd: string, args: string[], input: string, env: Record<string, string>): Promise<{ code: number; stdout: string; ms: number }>`

**Sobre o gt-hook:** é um script `sh` (e não Node) porque roda de forma **síncrona** a cada evento do Claude — inclusive a cada ferramenta usada. Síncrono garante a ordem dos eventos; `sh` + `nc -U` leva poucos milissegundos. O daemon fecha a conexão assim que lê a linha, então o `nc` sai na hora. `-w 2` é a rede de segurança se o daemon travar.

- [ ] **Step 1: Helper — `tests/helpers/run.ts`**

```ts
import { spawn } from 'node:child_process'

export function runWithInput(
  cmd: string,
  args: string[],
  input: string,
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; ms: number }> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { env })
    let stdout = ''
    p.stdout.on('data', (d) => { stdout += String(d) })
    p.on('close', (code) => resolve({ code: code ?? -1, stdout, ms: Date.now() - t0 }))
    p.stdin.end(input)
  })
}
```

- [ ] **Step 2: Testes que falham — `tests/daemon/persist.test.ts`**

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultPersisted, loadPersisted, savePersisted } from '../../src/daemon/persist'
import { DEFAULT_ACCOUNTS } from '../../src/daemon/accounts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gt-p-'))

describe('persistência', () => {
  it('arquivo ausente → padrão com as contas conhecidas', () => {
    const p = loadPersisted(path.join(tmp(), 'state.json'))
    expect(p).toEqual(defaultPersisted())
    expect(p.accounts).toEqual(DEFAULT_ACCOUNTS)
    expect(p.fetchIntervalMin).toBe(5)
  })

  it('ida e volta', () => {
    const f = path.join(tmp(), 'state.json')
    const data = { ...defaultPersisted(), projects: [{ path: '/a', name: 'a', defaultAccountId: null }] }
    savePersisted(f, data)
    expect(loadPersisted(f)).toEqual(data)
    expect(fs.readdirSync(path.dirname(f))).toEqual(['state.json'])
  })

  it('JSON corrompido → padrão e o arquivo ruim é guardado ao lado', () => {
    const dir = tmp()
    const f = path.join(dir, 'state.json')
    fs.writeFileSync(f, '{ quebrado')
    expect(loadPersisted(f)).toEqual(defaultPersisted())
    expect(fs.readdirSync(dir).some((n) => n.startsWith('state.json.corrupt-'))).toBe(true)
  })
})
```

`tests/daemon/hooks.test.ts`:
```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkProfiles, HOOK_EVENTS, hasHooks, hookCommand, installHooks, mergeHooks, writeHookScript } from '../../src/daemon/hooks'
import { startServer, type RpcServer } from '../../src/daemon/server'
import type { ClientRequest } from '../../src/shared/protocol'
import { runWithInput } from '../helpers/run'
import { waitFor } from '../helpers/wait'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-h-')))
const CMD = '"/Users/u/.gerenciador-terminal/bin/gt-hook"'
const RTK = { matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook' }] }

describe('mergeHooks', () => {
  it('acrescenta em todos os eventos e preserva o hook existente', () => {
    const out = mergeHooks({ model: 'x', hooks: { PreToolUse: [RTK] } }, CMD) as { model: string; hooks: Record<string, unknown[]> }
    expect(out.model).toBe('x')
    expect(out.hooks.PreToolUse[0]).toEqual(RTK)
    for (const ev of HOOK_EVENTS) expect(out.hooks[ev]).toContainEqual({ hooks: [{ type: 'command', command: CMD, timeout: 5 }] })
    expect(hasHooks(out, CMD)).toBe(true)
  })

  it('é idempotente e substitui versão antiga do próprio hook', () => {
    const once = mergeHooks({}, '"/velho/gt-hook"')
    const twice = mergeHooks(mergeHooks(once, CMD), CMD) as { hooks: Record<string, unknown[]> }
    for (const ev of HOOK_EVENTS) expect(twice.hooks[ev]).toHaveLength(1)
    expect(hasHooks(twice, '"/velho/gt-hook"')).toBe(false)
  })

  it('nunca registra WorktreeCreate/WorktreeRemove', () => {
    expect(HOOK_EVENTS).not.toContain('WorktreeCreate')
    expect(HOOK_EVENTS).not.toContain('WorktreeRemove')
  })
})

describe('installHooks', () => {
  it('escreve no alvo do symlink, mantém o symlink e faz backup', () => {
    const dir = tmp()
    const real = path.join(dir, 'real.json')
    const link = path.join(dir, 'settings.json')
    fs.writeFileSync(real, JSON.stringify({ hooks: { PreToolUse: [RTK] } }))
    fs.symlinkSync(real, link)
    const { backup } = installHooks(link, CMD)
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    const saved = JSON.parse(fs.readFileSync(real, 'utf8'))
    expect(saved.hooks.PreToolUse[0]).toEqual(RTK)
    expect(hasHooks(saved, CMD)).toBe(true)
    expect(backup && fs.existsSync(backup)).toBe(true)
  })

  it('JSON inválido: lança e não toca no arquivo', () => {
    const f = path.join(tmp(), 'settings.json')
    fs.writeFileSync(f, '{ ruim')
    expect(() => installHooks(f, CMD)).toThrow('não é um JSON válido')
    expect(fs.readFileSync(f, 'utf8')).toBe('{ ruim')
  })

  it('cria o arquivo quando não existe', () => {
    const f = path.join(tmp(), 'nova', 'settings.json')
    installHooks(f, CMD)
    expect(hasHooks(JSON.parse(fs.readFileSync(f, 'utf8')), CMD)).toBe(true)
  })
})

describe('checkProfiles', () => {
  it('lista cada arquivo real sem hooks uma única vez (symlinks dos perfis do cswap)', () => {
    const home = tmp()
    const main = path.join(home, '.claude', 'settings.json')
    fs.mkdirSync(path.dirname(main), { recursive: true })
    fs.writeFileSync(main, '{}')
    const profileA = path.join(home, '.claude-swap-backup', 'sessions', '1-a')
    const profileB = path.join(home, '.claude-swap-backup', 'sessions', '2-b')
    fs.mkdirSync(profileA, { recursive: true })
    fs.mkdirSync(profileB, { recursive: true })
    fs.symlinkSync(main, path.join(profileA, 'settings.json'))
    fs.writeFileSync(path.join(profileB, 'settings.json'), '{}')

    expect(checkProfiles(home, CMD)).toEqual([main, path.join(profileB, 'settings.json')])
    for (const f of checkProfiles(home, CMD)) installHooks(f, CMD)
    expect(checkProfiles(home, CMD)).toEqual([])
  })
})

describe('script gt-hook', () => {
  let server: RpcServer | null = null
  afterEach(async () => { await server?.close(); server = null })

  function setup() {
    const dir = tmp()
    const script = path.join(dir, 'bin', 'gt-hook')
    writeHookScript(script)
    expect(hookCommand(script)).toBe(`"${script}"`)
    return { dir, script }
  }

  it('fora do app: sai 0, rápido e sem stdout', async () => {
    const { script } = setup()
    const r = await runWithInput('/bin/sh', [script], '{"hook_event_name":"Stop"}', { PATH: '/usr/bin:/bin' })
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(r.ms).toBeLessThan(1000)
  })

  it('daemon ausente: sai 0, rápido e sem stdout', async () => {
    const { dir, script } = setup()
    const r = await runWithInput('/bin/sh', [script], '{}', { PATH: '/usr/bin:/bin', GT_PANE_ID: 'p1', GT_SOCKET: path.join(dir, 'nada.sock') })
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(r.ms).toBeLessThan(1000)
  })

  it('entrega o evento ao daemon, com JSON em várias linhas e config dir com aspas', async () => {
    const { dir, script } = setup()
    const sock = path.join(dir, 'd.sock')
    const got: ClientRequest[] = []
    server = await startServer(sock, (req, conn) => { got.push(req); conn.end(); return null })
    const payload = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/Volumes/SSD MISA/x' }, null, 2)
    const r = await runWithInput('/bin/sh', [script], payload, {
      PATH: '/usr/bin:/bin', GT_PANE_ID: 'p1', GT_SOCKET: sock, CLAUDE_CONFIG_DIR: '/tmp/perfil "estranho"',
    })
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(r.ms).toBeLessThan(1500)
    await waitFor(() => got.length === 1)
    expect(got[0]).toEqual({
      t: 'hook', paneId: 'p1', configDir: '/tmp/perfil "estranho"',
      payload: { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/Volumes/SSD MISA/x' },
    })
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/persist.test.ts tests/daemon/hooks.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar `src/daemon/persist.ts`**

```ts
import fs from 'node:fs'
import path from 'node:path'
import type { Account, Layout, ProjectConfig, ResumeEntry } from '../shared/types'
import { DEFAULT_ACCOUNTS } from './accounts'

export interface PersistedPane {
  id: string
  cwd: string
  accountId: string | null
  sessionId: string | null
}

export interface Persisted {
  version: 1
  projects: ProjectConfig[]
  layout: Layout
  accounts: Account[]
  panes: PersistedPane[]
  resumable: ResumeEntry[]
  fetchIntervalMin: number
}

export function defaultPersisted(): Persisted {
  return {
    version: 1,
    projects: [],
    layout: { tabs: [], activeTabId: null },
    accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a, configDirMatch: [...a.configDirMatch] })),
    panes: [],
    resumable: [],
    fetchIntervalMin: 5,
  }
}

export function loadPersisted(file: string): Persisted {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return defaultPersisted()
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Persisted>
    const base = defaultPersisted()
    return {
      ...base,
      ...parsed,
      version: 1,
      accounts: parsed.accounts?.length ? parsed.accounts : base.accounts,
    }
  } catch {
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`)
    return defaultPersisted()
  }
}

export function savePersisted(file: string, data: Persisted): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}
```

- [ ] **Step 5: Implementar `src/daemon/hooks.ts`**

```ts
import fs from 'node:fs'
import path from 'node:path'

export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'Stop',
  'StopFailure',
  'CwdChanged',
  'SessionEnd',
] as const

export const HOOK_MARKER = 'gt-hook'

export const GT_HOOK_SCRIPT = `#!/bin/sh
# gerenciador-terminal: repassa o evento do Claude Code ao daemon do app.
# Fora do app (sem GT_PANE_ID) ou sem daemon, sai sem fazer nada.
if [ -z "$GT_PANE_ID" ] || [ ! -S "$GT_SOCKET" ]; then
  cat >/dev/null
  exit 0
fi
cfg=$(printf '%s' "\${CLAUDE_CONFIG_DIR:-}" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
{
  printf '{"id":0,"req":{"t":"hook","paneId":"%s","configDir":"%s","payload":' "$GT_PANE_ID" "$cfg"
  tr -d '\\n\\r'
  printf '}}\\n'
} | nc -U -w 2 "$GT_SOCKET" >/dev/null 2>&1
exit 0
`

export function hookCommand(scriptPath: string): string {
  return `"${scriptPath}"`
}

export function writeHookScript(scriptPath: string): void {
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true })
  fs.writeFileSync(scriptPath, GT_HOOK_SCRIPT, { mode: 0o755 })
  fs.chmodSync(scriptPath, 0o755)
}

interface HookHandler {
  type?: string
  command?: string
}
interface HookGroup {
  matcher?: string
  hooks?: HookHandler[]
}

const isOurs = (g: HookGroup): boolean =>
  Array.isArray(g.hooks) && g.hooks.length > 0 && g.hooks.every((h) => typeof h.command === 'string' && h.command.includes(HOOK_MARKER))

export function mergeHooks(settings: Record<string, unknown>, command: string): Record<string, unknown> {
  const hooks = { ...((settings.hooks as Record<string, HookGroup[]> | undefined) ?? {}) }
  for (const ev of HOOK_EVENTS) {
    const groups = (hooks[ev] ?? []).filter((g) => !isOurs(g))
    groups.push({ hooks: [{ type: 'command', command, timeout: 5 } as HookHandler] })
    hooks[ev] = groups
  }
  return { ...settings, hooks }
}

export function hasHooks(settings: unknown, command: string): boolean {
  const hooks = ((settings as { hooks?: Record<string, HookGroup[]> } | null)?.hooks ?? {}) as Record<string, HookGroup[]>
  return HOOK_EVENTS.every((ev) => (hooks[ev] ?? []).some((g) => g.hooks?.some((h) => h.command === command)))
}

export function installHooks(settingsPath: string, command: string): { backup: string | null } {
  // escreve no alvo real: trocar o symlink por arquivo desligaria os perfis do cswap
  const real = fs.existsSync(settingsPath) ? fs.realpathSync(settingsPath) : settingsPath
  let current: Record<string, unknown> = {}
  let backup: string | null = null
  if (fs.existsSync(real)) {
    const raw = fs.readFileSync(real, 'utf8')
    try {
      current = raw.trim() ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      throw new Error(`${settingsPath} não é um JSON válido; corrija o arquivo antes de instalar os hooks`)
    }
    backup = `${real}.bak-gt-${Date.now()}`
    fs.copyFileSync(real, backup)
  } else {
    fs.mkdirSync(path.dirname(real), { recursive: true })
  }
  const next = mergeHooks(current, command)
  const tmp = `${real}.tmp-gt-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n')
  fs.renameSync(tmp, real)
  return { backup }
}

export function settingsFiles(userHome: string): string[] {
  const files = [path.join(userHome, '.claude', 'settings.json')]
  const sessions = path.join(userHome, '.claude-swap-backup', 'sessions')
  try {
    for (const d of fs.readdirSync(sessions, { withFileTypes: true })) {
      if (d.isDirectory()) files.push(path.join(sessions, d.name, 'settings.json'))
    }
  } catch {
    // sem cswap
  }
  return files
}

export function checkProfiles(userHome: string, command: string): string[] {
  const seen = new Set<string>()
  const missing: string[] = []
  for (const f of settingsFiles(userHome)) {
    let real = f
    try {
      real = fs.realpathSync(f)
    } catch {
      // ainda não existe
    }
    if (seen.has(real)) continue
    seen.add(real)
    let ok = false
    try {
      ok = hasHooks(JSON.parse(fs.readFileSync(real, 'utf8')), command)
    } catch {
      ok = false
    }
    if (!ok) missing.push(f)
  }
  return missing
}
```

O template literal passa por dois níveis de escape. O script gravado em disco deve conter exatamente as linhas abaixo (validado manualmente durante o planejamento: entrega em ~15 ms, aspas e barras no `CLAUDE_CONFIG_DIR` e JSON em várias linhas chegam corretos ao daemon):
```sh
cfg=$(printf '%s' "${CLAUDE_CONFIG_DIR:-}" | sed 's/\\/\\\\/g; s/"/\\"/g')
{
  printf '{"id":0,"req":{"t":"hook","paneId":"%s","configDir":"%s","payload":' "$GT_PANE_ID" "$cfg"
  tr -d '\n\r'
  printf '}}\n'
} | nc -U -w 2 "$GT_SOCKET" >/dev/null 2>&1
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx vitest run tests/daemon/persist.test.ts tests/daemon/hooks.test.ts`
Expected: PASS. Se o teste do `configDir` com aspas falhar, abra o arquivo `bin/gt-hook` gerado no diretório temporário e compare com o trecho acima.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: persistência, script gt-hook e instalação segura dos hooks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Registro de projetos e monitor de git

**Files:**
- Create: `src/daemon/projects.ts`, `src/daemon/git/monitor.ts`
- Test: `tests/daemon/projects.test.ts`, `tests/daemon/monitor.test.ts`

**Interfaces:**
- Consumes: `listWorktrees`, `gitToplevel`, `findWorktree`, `Location` (Task 5); `git`, `parseStatus` (Task 4).
- Produces:
  - `class ProjectRegistry { constructor(configs: ProjectConfig[], onChange: () => void); list(): ProjectConfig[]; get(path: string): ProjectConfig | undefined; worktrees(path: string): WorktreeInfo[]; error(path: string): string | null; allWorktreePaths(): string[]; add(dir: string, defaultAccountId: string | null): Promise<ProjectConfig>; remove(path: string): void; setAccount(path: string, accountId: string | null): void; refresh(path: string): Promise<void>; refreshAll(): Promise<void>; locate(cwd: string): Promise<Location | null> }`
  - `class GitMonitor { constructor(onChange: () => void, opts?: { pollMs: number; debounceMs: number }); get(worktreePath: string): GitStatus | null; fetchError(projectPath: string): string | null; track(paths: string[]): void; refresh(path: string): void; refreshNow(path: string): Promise<void>; startFetch(projects: () => string[], intervalMs: number): void; stop(): void }`

- [ ] **Step 1: Testes que falham — `tests/daemon/projects.test.ts`**

```ts
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectRegistry } from '../../src/daemon/projects'
import { makeRepo, type TestRepo } from '../helpers/repo'

let repo: TestRepo | null = null
afterEach(() => { repo?.cleanup(); repo = null })

describe('ProjectRegistry', () => {
  it('adicionar a partir de uma worktree ou subpasta cadastra o repositório principal, sem duplicar', async () => {
    repo = makeRepo()
    const wt = path.join(repo.root, 'wt a')
    repo.git('worktree', 'add', '-b', 'a', wt)
    let changes = 0
    const reg = new ProjectRegistry([], () => { changes++ })
    const p = await reg.add(wt, 'mslabs')
    expect(p).toEqual({ path: repo.dir, name: 'meu projeto', defaultAccountId: 'mslabs' })
    fs.mkdirSync(path.join(repo.dir, 'sub'))
    await reg.add(path.join(repo.dir, 'sub'), null)
    expect(reg.list()).toHaveLength(1)
    expect(reg.worktrees(repo.dir).map((w) => w.path)).toEqual([repo.dir, wt])
    expect(changes).toBeGreaterThan(0)
  })

  it('recusa pasta que não é git', async () => {
    const reg = new ProjectRegistry([], () => {})
    await expect(reg.add('/', null)).rejects.toThrow('não é um repositório git')
  })

  it('locate acha worktree criada depois do cadastro (cache velho)', async () => {
    repo = makeRepo()
    const reg = new ProjectRegistry([], () => {})
    await reg.add(repo.dir, null)
    const nova = path.join(repo.dir, '.claude', 'worktrees', 'feat x')
    repo.git('worktree', 'add', '-b', 'feat-x', nova)
    fs.mkdirSync(path.join(nova, 'src'))
    expect(await reg.locate(path.join(nova, 'src'))).toEqual({ projectPath: repo.dir, worktreePath: nova })
    expect(reg.worktrees(repo.dir).map((w) => w.path)).toContain(nova)
  })

  it('locate devolve null fora de projeto cadastrado', async () => {
    repo = makeRepo()
    const reg = new ProjectRegistry([], () => {})
    expect(await reg.locate(repo.dir)).toBeNull()
    expect(await reg.locate('/')).toBeNull()
  })

  it('refresh registra erro quando a pasta some', async () => {
    repo = makeRepo()
    const reg = new ProjectRegistry([{ path: path.join(repo.root, 'sumiu'), name: 'sumiu', defaultAccountId: null }], () => {})
    await reg.refreshAll()
    expect(reg.error(path.join(repo.root, 'sumiu'))).not.toBeNull()
  })
})
```

`tests/daemon/monitor.test.ts`:
```ts
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitMonitor } from '../../src/daemon/git/monitor'
import { makeRepo, type TestRepo } from '../helpers/repo'
import { waitFor } from '../helpers/wait'

let repo: TestRepo | null = null
let mon: GitMonitor | null = null
afterEach(() => { mon?.stop(); mon = null; repo?.cleanup(); repo = null })

describe('GitMonitor', () => {
  it('lê o status ao rastrear e atualiza quando arquivos mudam', async () => {
    repo = makeRepo()
    mon = new GitMonitor(() => {}, { pollMs: 200, debounceMs: 20 })
    mon.track([repo.dir])
    await waitFor(() => mon!.get(repo!.dir)?.branch === 'main')
    expect(mon.get(repo.dir)?.changed).toBe(0)
    repo.write('a.txt', 'x')
    await waitFor(() => mon!.get(repo!.dir)?.changed === 1)
  })

  it('deixar de rastrear apaga o status', async () => {
    repo = makeRepo()
    mon = new GitMonitor(() => {}, { pollMs: 200, debounceMs: 20 })
    mon.track([repo.dir])
    await waitFor(() => mon!.get(repo!.dir))
    mon.track([])
    expect(mon.get(repo.dir)).toBeNull()
  })

  it('erro de git vira campo error, sem exceção', async () => {
    repo = makeRepo()
    mon = new GitMonitor(() => {}, { pollMs: 200, debounceMs: 20 })
    const fake = path.join(repo.root, 'nao existe')
    mon.track([fake])
    await waitFor(() => mon!.get(fake)?.error)
  })

  it('fetch sem remoto não gera erro', async () => {
    repo = makeRepo()
    mon = new GitMonitor(() => {}, { pollMs: 200, debounceMs: 20 })
    let calls = 0
    mon.startFetch(() => { calls++; return [repo!.dir] }, 60_000)
    await waitFor(() => calls > 0)
    await new Promise((r) => setTimeout(r, 300))
    expect(mon.fetchError(repo.dir)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/projects.test.ts tests/daemon/monitor.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/daemon/projects.ts`**

```ts
import path from 'node:path'
import type { ProjectConfig, WorktreeInfo } from '../shared/types'
import { findWorktree, gitToplevel, listWorktrees, type Location } from './resolve'

export class ProjectRegistry {
  private wts = new Map<string, WorktreeInfo[]>()
  private errors = new Map<string, string | null>()

  constructor(private configs: ProjectConfig[], private onChange: () => void) {}

  list(): ProjectConfig[] {
    return this.configs
  }

  get(p: string): ProjectConfig | undefined {
    return this.configs.find((c) => c.path === p)
  }

  worktrees(p: string): WorktreeInfo[] {
    return this.wts.get(p) ?? []
  }

  error(p: string): string | null {
    return this.errors.get(p) ?? null
  }

  allWorktreePaths(): string[] {
    return this.configs.flatMap((c) => this.worktrees(c.path).filter((w) => !w.prunable).map((w) => w.path))
  }

  async add(dir: string, defaultAccountId: string | null): Promise<ProjectConfig> {
    const r = await listWorktrees(dir)
    if (!r.ok) throw new Error(`não é um repositório git: ${dir}`)
    const main = r.worktrees[0].path
    const existing = this.get(main)
    if (existing) return existing
    const cfg: ProjectConfig = { path: main, name: path.basename(main), defaultAccountId }
    this.configs.push(cfg)
    this.wts.set(main, r.worktrees)
    this.errors.set(main, null)
    this.onChange()
    return cfg
  }

  remove(p: string): void {
    this.configs = this.configs.filter((c) => c.path !== p)
    this.wts.delete(p)
    this.errors.delete(p)
    this.onChange()
  }

  setAccount(p: string, accountId: string | null): void {
    const c = this.get(p)
    if (!c) throw new Error(`projeto não encontrado: ${p}`)
    c.defaultAccountId = accountId
    this.onChange()
  }

  async refresh(p: string): Promise<void> {
    const r = await listWorktrees(p)
    if (r.ok) {
      this.wts.set(p, r.worktrees)
      this.errors.set(p, null)
    } else {
      this.errors.set(p, r.error)
    }
    this.onChange()
  }

  async refreshAll(): Promise<void> {
    await Promise.all(this.configs.map((c) => this.refresh(c.path)))
  }

  async locate(cwd: string): Promise<Location | null> {
    const top = await gitToplevel(cwd)
    if (!top) return null
    const hit = findWorktree(this.view(), top)
    if (hit) return hit
    // worktree nova (o Claude acabou de criar): a lista em cache está velha
    const r = await listWorktrees(top)
    if (!r.ok) return null
    const main = r.worktrees[0].path
    if (!this.get(main)) return null
    this.wts.set(main, r.worktrees)
    this.onChange()
    return findWorktree(this.view(), top)
  }

  private view(): { path: string; worktrees: WorktreeInfo[] }[] {
    return this.configs.map((c) => ({ path: c.path, worktrees: this.worktrees(c.path) }))
  }
}
```

- [ ] **Step 4: Implementar `src/daemon/git/monitor.ts`**

```ts
import fs from 'node:fs'
import type { GitStatus } from '../../shared/types'
import { parseStatus } from './parse'
import { git } from './run'

export class GitMonitor {
  private status = new Map<string, GitStatus>()
  private fetchErrors = new Map<string, string | null>()
  private debounce = new Map<string, NodeJS.Timeout>()
  private watchers = new Map<string, fs.FSWatcher>()
  private tracked = new Set<string>()
  private pollTimer: NodeJS.Timeout | null = null
  private fetchTimer: NodeJS.Timeout | null = null

  constructor(
    private onChange: () => void,
    private opts: { pollMs: number; debounceMs: number } = { pollMs: 10_000, debounceMs: 300 },
  ) {}

  get(worktreePath: string): GitStatus | null {
    return this.status.get(worktreePath) ?? null
  }

  fetchError(projectPath: string): string | null {
    return this.fetchErrors.get(projectPath) ?? null
  }

  track(paths: string[]): void {
    const next = new Set(paths)
    for (const p of [...this.tracked]) {
      if (next.has(p)) continue
      this.tracked.delete(p)
      this.watchers.get(p)?.close()
      this.watchers.delete(p)
      clearTimeout(this.debounce.get(p))
      this.debounce.delete(p)
      this.status.delete(p)
    }
    for (const p of next) {
      if (this.tracked.has(p)) continue
      this.tracked.add(p)
      void this.watch(p)
      this.refresh(p)
    }
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        for (const p of this.tracked) this.refresh(p)
      }, this.opts.pollMs)
    }
  }

  refresh(p: string): void {
    if (!this.tracked.has(p)) return
    clearTimeout(this.debounce.get(p))
    this.debounce.set(
      p,
      setTimeout(() => {
        this.debounce.delete(p)
        void this.refreshNow(p)
      }, this.opts.debounceMs),
    )
  }

  async refreshNow(p: string): Promise<void> {
    const r = await git(p, ['status', '--porcelain=v2', '--branch'])
    if (!this.tracked.has(p)) return
    const prev = this.status.get(p)
    const next: GitStatus = r.ok
      ? { ...parseStatus(r.stdout), error: null }
      : {
          branch: prev?.branch ?? null,
          upstream: prev?.upstream ?? null,
          ahead: prev?.ahead ?? 0,
          behind: prev?.behind ?? 0,
          changed: prev?.changed ?? 0,
          error: r.stderr.trim().split('\n')[0] || 'git status falhou',
        }
    if (JSON.stringify(prev) === JSON.stringify(next)) return
    this.status.set(p, next)
    this.onChange()
  }

  startFetch(projects: () => string[], intervalMs: number): void {
    const run = async (): Promise<void> => {
      for (const pp of projects()) {
        const r = await git(pp, ['fetch', '--all', '--prune', '--quiet'], 60_000)
        const err = r.ok ? null : r.stderr.trim().split('\n')[0] || 'git fetch falhou'
        if ((this.fetchErrors.get(pp) ?? null) !== err) {
          this.fetchErrors.set(pp, err)
          this.onChange()
        }
      }
    }
    this.fetchTimer = setInterval(() => void run(), intervalMs)
    void run()
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.fetchTimer) clearInterval(this.fetchTimer)
    for (const t of this.debounce.values()) clearTimeout(t)
    for (const w of this.watchers.values()) w.close()
    this.pollTimer = null
    this.fetchTimer = null
    this.debounce.clear()
    this.watchers.clear()
    this.tracked.clear()
  }

  private async watch(p: string): Promise<void> {
    const r = await git(p, ['rev-parse', '--absolute-git-dir'])
    if (!r.ok || !this.tracked.has(p)) return
    try {
      // não recursivo: pega HEAD, index e FETCH_HEAD daquela worktree
      const w = fs.watch(r.stdout.trim(), () => this.refresh(p))
      w.on('error', () => {})
      this.watchers.set(p, w)
    } catch {
      // sem watcher: o polling cobre
    }
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/daemon/projects.test.ts tests/daemon/monitor.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: registro de projetos/worktrees e monitor de git

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: PaneManager, Daemon e ponto de entrada do daemon

**Files:**
- Create: `src/daemon/panes.ts`, `src/daemon/daemon.ts`
- Modify: `src/daemon/main.ts` (substitui o placeholder)
- Create: `tests/helpers/app-client.ts`
- Test: `tests/daemon/daemon.test.ts`

**Interfaces:**
- Consumes: `PtyHost` (Task 3); `git` (Task 4); `reduceSession`, `readTitle`, `detectAccount`, `buildCommand`, `suggestAccount`, `DEFAULT_ACCOUNTS` (Task 5); `snapshotProcs`, `cwdOf`, `findClaude`, `foregroundOf` (Task 6); `loadPersisted`, `savePersisted`, `Persisted`, `writeHookScript`, `hookCommand`, `checkProfiles`, `installHooks` (Task 7); `ProjectRegistry`, `GitMonitor` (Task 8); `startServer`, `Conn`, `RpcServer` (Task 2).
- Produces:
  - `buildPaneEnv(base: Record<string, string | undefined>): Record<string, string>`
  - `interface PaneRecord { id: string; seq: number; cwd: string; alive: boolean; exitCode: number | null; launchedAccountId: string | null; accountId: string | null; configDir: string | null; claudeArgv: string | null; claude: ClaudeSession | null; missingPolls: number; projectPath: string | null; worktreePath: string | null }`
  - `interface CreatePane { paneId?: string; cwd: string; accountId: string | null; resumeSessionId?: string; cols: number; rows: number }`
  - `class PaneManager { readonly host: PtyHost; records(): PaneRecord[]; get(id): PaneRecord | undefined; create(o: CreatePane): PaneRecord; write(id, data): void; resize(id, cols, rows): void; kill(id): void; forget(id): void; applyHook(paneId: string, configDir: string | null, p: HookPayload): Promise<void>; poll(): Promise<void>; relocateAll(): Promise<void> }`
  - `interface DaemonOptions { home: string; socketPath: string; stateFile: string; hookScriptPath: string; userHome: string; shell: string; shellArgs: string[]; env?: Record<string, string | undefined>; pollMs?: number; gitPollMs?: number; fetchIntervalMs?: number; onShutdown?: () => void }`
  - `class Daemon { static start(o: DaemonOptions): Promise<Daemon>; stop(killPtys: boolean): Promise<void> }` — o Daemon também trata `worktree.checkRemove`/`worktree.remove`, mas esses dois ficam para a Task 10 (aqui respondem `throw new Error('não implementado')`).
  - helper de teste `connectApp(socketPath)` com `{ client: RpcClient; state(): AppState | null; output(paneId): string; waitState(pred, ms?): Promise<AppState> }`

**Regras do painel (resumo do spec, seção 5):**
- Enquanto há sessão Claude ativa (`rec.claude !== null`), o cwd do painel vem **só dos hooks**; sem sessão, vem do poller (processo em primeiro plano).
- A conta: se o painel foi aberto pelo app com uma conta, ela vale; se o usuário digitou `claude…` na mão, a conta é detectada no início da sessão (config dir do hook + argv do poller). Quando a sessão termina, a conta some do painel.
- Se o hook `SessionEnd` não chegar, o poller encerra a sessão depois de 2 leituras seguidas sem processo `claude` embaixo do shell.
- O ambiente dos terminais passa por `buildPaneEnv` (Review Focus 1).

- [ ] **Step 1: Helper — `tests/helpers/app-client.ts`**

```ts
import { RpcClient } from '../../src/shared/rpc-client'
import { PROTOCOL_VERSION } from '../../src/shared/protocol'
import type { AppState } from '../../src/shared/types'
import { waitFor } from './wait'

export async function connectApp(socketPath: string) {
  const client = await RpcClient.connect(socketPath)
  let last: AppState | null = null
  const data = new Map<string, string>()
  client.onMessage((m) => {
    if (m.t === 'state') last = m.state
    if (m.t === 'pane.data') data.set(m.paneId, (data.get(m.paneId) ?? '') + m.data)
  })
  await client.request({ t: 'hello', role: 'app', version: PROTOCOL_VERSION })
  return {
    client,
    state: () => last,
    output: (paneId: string) => data.get(paneId) ?? '',
    waitState: (pred: (s: AppState) => boolean, ms = 8000) => waitFor(() => (last && pred(last) ? last : null), ms),
  }
}
```

- [ ] **Step 2: Testes que falham — `tests/daemon/daemon.test.ts`**

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Daemon, type DaemonOptions } from '../../src/daemon/daemon'
import { buildPaneEnv } from '../../src/daemon/panes'
import { connectApp } from '../helpers/app-client'
import { makeRepo, type TestRepo } from '../helpers/repo'
import { runWithInput } from '../helpers/run'

let daemons: Daemon[] = []
let repo: TestRepo | null = null

afterEach(async () => {
  for (const d of daemons) await d.stop(true)
  daemons = []
  repo?.cleanup()
  repo = null
})

function opts(home: string, extra: Partial<DaemonOptions> = {}): DaemonOptions {
  const userHome = path.join(home, 'user')
  fs.mkdirSync(userHome, { recursive: true })
  return {
    home,
    socketPath: path.join(home, 'd.sock'),
    stateFile: path.join(home, 'state.json'),
    hookScriptPath: path.join(home, 'bin', 'gt-hook'),
    userHome,
    shell: '/bin/sh',
    shellArgs: [],
    env: { PATH: process.env.PATH, HOME: userHome, ELECTRON_RUN_AS_NODE: '1', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/x', GT_PANE_ID: 'herdado' },
    pollMs: 60_000,
    gitPollMs: 500,
    fetchIntervalMs: 3_600_000,
    ...extra,
  }
}

async function boot(extra: Partial<DaemonOptions> = {}, home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-d-')))) {
  const o = opts(home, extra)
  const d = await Daemon.start(o)
  daemons.push(d)
  const app = await connectApp(o.socketPath)
  return { o, d, app, home }
}

function hook(o: DaemonOptions, paneId: string, payload: Record<string, unknown>, configDir?: string) {
  return runWithInput('/bin/sh', [o.hookScriptPath], JSON.stringify(payload), {
    PATH: '/usr/bin:/bin', GT_PANE_ID: paneId, GT_SOCKET: o.socketPath, ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}),
  })
}

describe('buildPaneEnv', () => {
  it('remove variáveis do daemon/Claude e garante LANG e TERM', () => {
    const env = buildPaneEnv({ PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/x', CLAUDE_CODE_ENTRYPOINT: 'cli', GT_PANE_ID: 'a', HOME: '/h' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', LANG: 'en_US.UTF-8', TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'gerenciador-terminal' })
  })
  it('respeita LANG existente', () => {
    expect(buildPaneEnv({ LANG: 'pt_BR.UTF-8' }).LANG).toBe('pt_BR.UTF-8')
  })
})

describe('Daemon', () => {
  it('adiciona projeto e publica worktrees com status git', async () => {
    repo = makeRepo()
    const { app } = await boot()
    await app.client.request({ t: 'project.add', path: repo.dir })
    const st = await app.waitState((s) => s.projects[0]?.worktrees[0]?.git?.branch === 'main')
    expect(st.projects[0]).toMatchObject({ path: repo.dir, name: 'meu projeto' })
  })

  it('cria painel, anexa, recebe saída e o ambiente vem limpo', async () => {
    repo = makeRepo()
    const { app } = await boot()
    await app.client.request({ t: 'project.add', path: repo.dir })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 100, rows: 30 })
    const { snapshot } = await app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId, cols: 90, rows: 20 })
    expect(typeof snapshot).toBe('string')
    app.client.send({ t: 'pane.input', paneId, data: 'echo "[$ELECTRON_RUN_AS_NODE][$CLAUDECODE][$CLAUDE_CONFIG_DIR][$GT_PANE_ID][$LANG]"\r' })
    await app.waitState(() => app.output(paneId).includes(`[][][][${paneId}][en_US.UTF-8]`))
    await app.waitState((s) => s.panes.some((p) => p.id === paneId && p.worktreePath === repo!.dir))
  })

  it('hooks: sessão, estado, título, conta e worktree nova criada pelo Claude', async () => {
    repo = makeRepo()
    const { o, app, home } = await boot()
    await app.client.request({ t: 'project.add', path: repo.dir })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    const transcript = path.join(home, 't.jsonl')
    fs.writeFileSync(transcript, JSON.stringify({ type: 'custom-title', customTitle: 'minha tarefa' }) + '\n')
    const base = { session_id: 's1', cwd: repo.dir, transcript_path: transcript }
    const mslabs = '/Users/u/.claude-swap-backup/sessions/3-misael_mslabs-dev.com'

    await hook(o, paneId, { ...base, hook_event_name: 'SessionStart', source: 'startup' }, mslabs)
    let st = await app.waitState((s) => s.panes[0]?.claude?.title === 'minha tarefa')
    expect(st.panes[0]).toMatchObject({ accountId: 'mslabs', claude: { sessionId: 's1', status: 'idle' } })

    await hook(o, paneId, { ...base, hook_event_name: 'UserPromptSubmit' }, mslabs)
    await app.waitState((s) => s.panes[0]?.claude?.status === 'working')
    await hook(o, paneId, { ...base, hook_event_name: 'PermissionRequest' }, mslabs)
    await app.waitState((s) => s.panes[0]?.claude?.status === 'needs-you')

    // o Claude cria uma worktree e entra nela
    const nova = path.join(repo.dir, '.claude', 'worktrees', 'feat x')
    repo.git('worktree', 'add', '-b', 'feat-x', nova)
    await hook(o, paneId, { ...base, cwd: nova, hook_event_name: 'CwdChanged' }, mslabs)
    st = await app.waitState((s) => s.panes[0]?.worktreePath === nova)
    expect(st.projects[0].worktrees.map((w) => w.path)).toContain(nova)

    await hook(o, paneId, { ...base, cwd: nova, hook_event_name: 'Stop' }, mslabs)
    await app.waitState((s) => s.panes[0]?.claude?.status === 'idle')
    await hook(o, paneId, { ...base, cwd: nova, hook_event_name: 'SessionEnd' }, mslabs)
    st = await app.waitState((s) => s.panes[0]?.claude === null)
    expect(st.panes[0].accountId).toBeNull()
  })

  it('poller: cd no shell muda a worktree; sessão sem processo claude é encerrada', async () => {
    repo = makeRepo()
    const wt = path.join(repo.root, 'wt b')
    repo.git('worktree', 'add', '-b', 'b', wt)
    const { o, app } = await boot({ pollMs: 200 })
    await app.client.request({ t: 'project.add', path: repo.dir })
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    app.client.send({ t: 'pane.input', paneId, data: `cd "${wt}"\r` })
    await app.waitState((s) => s.panes[0]?.worktreePath === wt)

    await hook(o, paneId, { hook_event_name: 'SessionStart', session_id: 's9', cwd: wt })
    await app.waitState((s) => s.panes[0]?.claude?.sessionId === 's9', 2000).catch(() => null)
    await app.waitState((s) => s.panes[0]?.claude === null)
  })

  it('painel aberto com conta digita o comando da conta', async () => {
    repo = makeRepo()
    const { app } = await boot()
    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: 'mslabs', cols: 80, rows: 24 })
    const { snapshot } = await app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId })
    // o eco pode chegar antes do attach (vai no snapshot) ou depois (vai em pane.data)
    await app.waitState(() => (snapshot + app.output(paneId)).includes('claude-mslabs'))
    const st = await app.waitState((s) => s.panes[0]?.accountId === 'mslabs')
    expect(st.panes[0].id).toBe(paneId)
  })

  it('reinício do daemon: painéis vivos viram retomáveis com o mesmo id', async () => {
    repo = makeRepo()
    const first = await boot()
    const { paneId } = await first.app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: repo.dir, accountId: null, cols: 80, rows: 24 })
    await hook(first.o, paneId, { hook_event_name: 'SessionStart', session_id: 'abcd-1234', cwd: repo.dir })
    await first.app.waitState((s) => s.panes[0]?.claude?.sessionId === 'abcd-1234')
    first.app.client.close()
    await first.d.stop(true)
    daemons = []

    const second = await boot({}, first.home)
    const st = await second.app.waitState((s) => s.resumable.length === 1)
    expect(st.resumable[0]).toEqual({ paneId, cwd: repo.dir, accountId: 'misa', sessionId: 'abcd-1234' })
    expect(st.panes).toEqual([])

    await second.app.client.request({ t: 'pane.create', paneId, cwd: repo.dir, accountId: 'misa', resumeSessionId: 'abcd-1234', cols: 80, rows: 24 })
    const { snapshot } = await second.app.client.request<{ snapshot: string }>({ t: 'pane.attach', paneId })
    await second.app.waitState((s) => s.resumable.length === 0 && s.panes[0]?.id === paneId)
    await second.app.waitState(() => (snapshot + second.app.output(paneId)).includes('claude --resume abcd-1234'))
  })

  it('layout é salvo e volta após reinício; avisos de hooks e instalação', async () => {
    const first = await boot()
    let st = await first.app.waitState((s) => s.hookWarnings.length === 1)
    expect(st.hookWarnings[0]).toBe(path.join(first.o.userHome, '.claude', 'settings.json'))
    await first.app.client.request({ t: 'hooks.install' })
    await first.app.waitState((s) => s.hookWarnings.length === 0)

    const layout = { tabs: [{ id: 't1', name: 'Trabalho', root: { type: 'leaf' as const, paneId: 'x' } }], activeTabId: 't1' }
    await first.app.client.request({ t: 'layout.save', layout })
    await new Promise((r) => setTimeout(r, 400))
    first.app.client.close()
    await first.d.stop(false)
    daemons = []
    const second = await boot({}, first.home)
    st = await second.app.waitState((s) => s.layout.tabs.length === 1)
    expect(st.layout).toEqual(layout)
  })

  it('erros de requisição voltam como mensagem', async () => {
    const { app } = await boot()
    await expect(app.client.request({ t: 'pane.create', cwd: '/', accountId: 'nao-existe', cols: 80, rows: 24 })).rejects.toThrow('conta desconhecida')
    await expect(app.client.request({ t: 'project.add', path: '/' })).rejects.toThrow('não é um repositório git')
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/daemon.test.ts`
Expected: FAIL (módulos não existem).

- [ ] **Step 4: Implementar `src/daemon/panes.ts`**

```ts
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import type { Account, ClaudeSession, HookPayload } from '../shared/types'
import { buildCommand, detectAccount } from './accounts'
import { cwdOf, findClaude, foregroundOf, snapshotProcs } from './platform/procs'
import type { ProjectRegistry } from './projects'
import { PtyHost } from './pty-host'
import { reduceSession } from './session'
import { readTitle } from './title'

export interface PaneRecord {
  id: string
  seq: number
  cwd: string
  alive: boolean
  exitCode: number | null
  launchedAccountId: string | null
  accountId: string | null
  configDir: string | null
  claudeArgv: string | null
  claude: ClaudeSession | null
  missingPolls: number
  projectPath: string | null
  worktreePath: string | null
}

export interface CreatePane {
  paneId?: string
  cwd: string
  accountId: string | null
  resumeSessionId?: string
  cols: number
  rows: number
}

export interface PaneManagerDeps {
  accounts(): Account[]
  registry: ProjectRegistry
  socketPath: string
  shell: string
  shellArgs: string[]
  baseEnv: Record<string, string>
  fallbackCwd: string
  onData(id: string, data: string): void
  onChange(): void
  onGitHint(worktreePath: string): void
}

const DROP_ENV = new Set(['ELECTRON_RUN_AS_NODE', 'CLAUDECODE', 'CLAUDE_CONFIG_DIR'])

export function buildPaneEnv(base: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || DROP_ENV.has(k) || k.startsWith('GT_') || k.startsWith('CLAUDE_CODE_')) continue
    env[k] = v
  }
  if (!env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = 'en_US.UTF-8'
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'gerenciador-terminal'
  return env
}

const GIT_HINT_EVENTS = new Set(['PostToolUse', 'Stop', 'CwdChanged'])
const TITLE_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'Stop'])

export class PaneManager {
  readonly host: PtyHost
  private recs = new Map<string, PaneRecord>()
  private seq = 0

  constructor(private d: PaneManagerDeps) {
    this.host = new PtyHost({
      data: (id, data) => d.onData(id, data),
      exit: (id, code) => {
        const r = this.recs.get(id)
        if (!r) return
        r.alive = false
        r.exitCode = code
        r.claude = null
        d.onChange()
      },
    })
  }

  records(): PaneRecord[] {
    return [...this.recs.values()]
  }

  get(id: string): PaneRecord | undefined {
    return this.recs.get(id)
  }

  create(o: CreatePane): PaneRecord {
    const id = o.paneId ?? randomUUID()
    const existing = this.recs.get(id)
    if (existing?.alive) throw new Error(`painel ${id} já está ativo`)
    const accounts = this.d.accounts()
    let account = o.accountId ? accounts.find((a) => a.id === o.accountId) : undefined
    if (o.accountId && !account) throw new Error(`conta desconhecida: ${o.accountId}`)
    if (!account && o.resumeSessionId) account = accounts.find((a) => a.isDefault)
    const command = account ? buildCommand(account, o.resumeSessionId) : null
    const cwd = fs.existsSync(o.cwd) ? o.cwd : this.d.fallbackCwd
    const env = { ...this.d.baseEnv, GT_PANE_ID: id, GT_SOCKET: this.d.socketPath }
    this.host.spawn({ id, shell: this.d.shell, args: this.d.shellArgs, cwd, cols: o.cols, rows: o.rows, env })
    const rec: PaneRecord = {
      id,
      seq: existing?.seq ?? ++this.seq,
      cwd,
      alive: true,
      exitCode: null,
      launchedAccountId: account?.id ?? null,
      accountId: account?.id ?? null,
      configDir: null,
      claudeArgv: null,
      claude: null,
      missingPolls: 0,
      projectPath: null,
      worktreePath: null,
    }
    this.recs.set(id, rec)
    if (command) this.host.write(id, command + '\r')
    void this.relocate(rec)
    this.d.onChange()
    return rec
  }

  write(id: string, data: string): void {
    this.host.write(id, data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.host.resize(id, cols, rows)
  }

  kill(id: string): void {
    this.host.kill(id)
  }

  forget(id: string): void {
    const r = this.recs.get(id)
    if (!r) return
    if (r.alive) this.host.kill(id)
    this.recs.delete(id)
    this.d.onChange()
  }

  async applyHook(paneId: string, configDir: string | null, p: HookPayload): Promise<void> {
    const rec = this.recs.get(paneId)
    if (!rec || !rec.alive) return
    const hadSession = rec.claude !== null
    rec.configDir = configDir
    rec.claude = reduceSession(rec.claude, p)
    rec.missingPolls = 0
    if (!rec.claude) {
      rec.launchedAccountId = null
      rec.accountId = null
    } else if (!hadSession && !rec.launchedAccountId) {
      rec.accountId = detectAccount(this.d.accounts(), configDir, rec.claudeArgv)
    }
    this.d.onChange()

    if (p.cwd && p.cwd !== rec.cwd) {
      rec.cwd = p.cwd
      await this.relocate(rec)
    }
    const ev = p.hook_event_name
    if (rec.worktreePath && GIT_HINT_EVENTS.has(ev)) this.d.onGitHint(rec.worktreePath)
    if (rec.claude?.transcriptPath && TITLE_EVENTS.has(ev)) {
      const sessionId = rec.claude.sessionId
      const title = await readTitle(rec.claude.transcriptPath)
      if (rec.claude && rec.claude.sessionId === sessionId && title !== rec.claude.title) {
        rec.claude = { ...rec.claude, title }
        this.d.onChange()
      }
    }
  }

  async poll(): Promise<void> {
    const live = this.records().filter((r) => r.alive)
    if (live.length === 0) return
    const procs = await snapshotProcs()
    const want = new Map<number, PaneRecord>()
    let changed = false
    for (const rec of live) {
      const pid = this.host.pid(rec.id)
      if (!pid) continue
      const claudeProc = findClaude(procs, pid)
      const argv = claudeProc?.args ?? null
      if (argv !== rec.claudeArgv) {
        rec.claudeArgv = argv
        if (rec.claude && argv && !rec.launchedAccountId) {
          rec.accountId = detectAccount(this.d.accounts(), rec.configDir, argv)
          changed = true
        }
      }
      if (rec.claude && !claudeProc) {
        rec.missingPolls++
        if (rec.missingPolls >= 2) {
          rec.claude = null
          rec.launchedAccountId = null
          rec.accountId = null
          changed = true
        }
      }
      if (!rec.claude) want.set(foregroundOf(procs, pid)?.pid ?? pid, rec)
    }
    if (changed) this.d.onChange()
    if (want.size === 0) return
    const cwds = await cwdOf([...want.keys()])
    for (const [pid, rec] of want) {
      const cwd = cwds.get(pid)
      if (cwd && cwd !== rec.cwd && !rec.claude) {
        rec.cwd = cwd
        await this.relocate(rec)
      }
    }
  }

  async relocateAll(): Promise<void> {
    await Promise.all(this.records().map((r) => this.relocate(r)))
  }

  private async relocate(rec: PaneRecord): Promise<void> {
    const cwd = rec.cwd
    const loc = await this.d.registry.locate(cwd)
    if (rec.cwd !== cwd) return // mudou de novo enquanto resolvia
    const projectPath = loc?.projectPath ?? null
    const worktreePath = loc?.worktreePath ?? null
    if (projectPath === rec.projectPath && worktreePath === rec.worktreePath) return
    rec.projectPath = projectPath
    rec.worktreePath = worktreePath
    this.d.onChange()
  }
}
```

- [ ] **Step 5: Implementar `src/daemon/daemon.ts`**

```ts
import os from 'node:os'
import { PROTOCOL_VERSION, type ClientRequest } from '../shared/protocol'
import type { AppState } from '../shared/types'
import { suggestAccount } from './accounts'
import { GitMonitor } from './git/monitor'
import { checkProfiles, hookCommand, installHooks, writeHookScript } from './hooks'
import { PaneManager, buildPaneEnv } from './panes'
import { loadPersisted, savePersisted, type Persisted } from './persist'
import { ProjectRegistry } from './projects'
import { startServer, type Conn, type RpcServer } from './server'

export interface DaemonOptions {
  home: string
  socketPath: string
  stateFile: string
  hookScriptPath: string
  userHome: string
  shell: string
  shellArgs: string[]
  env?: Record<string, string | undefined>
  pollMs?: number
  gitPollMs?: number
  fetchIntervalMs?: number
  onShutdown?: () => void
}

export class Daemon {
  private persisted!: Persisted
  private registry!: ProjectRegistry
  private monitor!: GitMonitor
  private panes!: PaneManager
  private server: RpcServer | null = null
  private hookWarnings: string[] = []
  private broadcastTimer: NodeJS.Timeout | null = null
  private saveTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private stopping = false

  private constructor(private o: DaemonOptions) {}

  static async start(o: DaemonOptions): Promise<Daemon> {
    const d = new Daemon(o)
    await d.init()
    return d
  }

  private get hookCmd(): string {
    return hookCommand(this.o.hookScriptPath)
  }

  private async init(): Promise<void> {
    writeHookScript(this.o.hookScriptPath)
    const p = loadPersisted(this.o.stateFile)
    // o que estava vivo no daemon anterior vira retomável (mesmo id → o layout continua valendo)
    const byId = new Map(p.resumable.map((r) => [r.paneId, r]))
    for (const pane of p.panes) byId.set(pane.id, { paneId: pane.id, cwd: pane.cwd, accountId: pane.accountId, sessionId: pane.sessionId })
    p.resumable = [...byId.values()]
    p.panes = []
    this.persisted = p

    this.monitor = new GitMonitor(() => this.changed(false), { pollMs: this.o.gitPollMs ?? 10_000, debounceMs: 300 })
    this.registry = new ProjectRegistry(p.projects, () => this.changed())
    this.panes = new PaneManager({
      accounts: () => this.persisted.accounts,
      registry: this.registry,
      socketPath: this.o.socketPath,
      shell: this.o.shell,
      shellArgs: this.o.shellArgs,
      baseEnv: buildPaneEnv(this.o.env ?? process.env),
      fallbackCwd: this.o.userHome,
      onData: (id, data) => {
        for (const c of this.server?.conns ?? []) if (c.subscriptions.has(id)) c.send({ t: 'pane.data', paneId: id, data })
      },
      onChange: () => this.changed(),
      onGitHint: (wt) => this.monitor.refresh(wt),
    })
    this.hookWarnings = checkProfiles(this.o.userHome, this.hookCmd)
    this.server = await startServer(this.o.socketPath, (req, conn) => this.handle(req, conn))
    await this.registry.refreshAll()
    this.monitor.startFetch(() => this.registry.list().map((c) => c.path), this.o.fetchIntervalMs ?? p.fetchIntervalMin * 60_000)
    this.pollTimer = setInterval(() => {
      this.panes.poll().catch((e) => console.error('poll falhou', e))
    }, this.o.pollMs ?? 2000)
    this.save()
  }

  async stop(killPtys: boolean): Promise<void> {
    if (this.stopping) return
    this.save() // antes de matar: os painéis vivos viram retomáveis no próximo início
    this.stopping = true
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer)
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.monitor.stop()
    if (killPtys) this.panes.host.killAll()
    await this.server?.close()
  }

  private changed(persist = true): void {
    if (this.stopping) return
    this.monitor.track(this.registry.allWorktreePaths())
    if (!this.broadcastTimer) {
      this.broadcastTimer = setTimeout(() => {
        this.broadcastTimer = null
        const state = this.buildState()
        for (const c of this.server?.conns ?? []) if (c.role === 'app') c.send({ t: 'state', state })
      }, 30)
    }
    if (persist && !this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null
        this.save()
      }, 300)
    }
  }

  private save(): void {
    if (this.stopping) return
    savePersisted(this.o.stateFile, {
      ...this.persisted,
      projects: this.registry.list(),
      panes: this.panes
        .records()
        .filter((r) => r.alive)
        .map((r) => ({ id: r.id, cwd: r.cwd, accountId: r.accountId, sessionId: r.claude?.sessionId ?? null })),
    })
  }

  private buildState(): AppState {
    return {
      protocolVersion: PROTOCOL_VERSION,
      userHome: this.o.userHome,
      projects: this.registry.list().map((c) => ({
        ...c,
        worktrees: this.registry.worktrees(c.path).map((w) => ({ ...w, git: this.monitor.get(w.path) })),
        error: this.registry.error(c.path),
        fetchError: this.monitor.fetchError(c.path),
      })),
      panes: this.panes.records().map((r) => ({
        id: r.id,
        seq: r.seq,
        cwd: r.cwd,
        alive: r.alive,
        exitCode: r.exitCode,
        accountId: r.accountId,
        claude: r.claude,
        projectPath: r.projectPath,
        worktreePath: r.worktreePath,
      })),
      layout: this.persisted.layout,
      accounts: this.persisted.accounts,
      resumable: this.persisted.resumable,
      hookWarnings: this.hookWarnings,
    }
  }

  private async handle(req: ClientRequest, conn: Conn): Promise<unknown> {
    switch (req.t) {
      case 'hello':
        conn.role = req.role
        if (req.role === 'app') setImmediate(() => conn.send({ t: 'state', state: this.buildState() }))
        return { protocolVersion: PROTOCOL_VERSION }
      case 'state.get':
        return this.buildState()
      case 'hook':
        conn.role = 'hook'
        conn.end() // libera o Claude antes de processar (ler título pode demorar)
        await this.panes.applyHook(req.paneId, req.configDir || null, req.payload)
        return null
      case 'pane.create': {
        const rec = this.panes.create(req)
        this.persisted.resumable = this.persisted.resumable.filter((r) => r.paneId !== rec.id)
        this.changed()
        return { paneId: rec.id }
      }
      case 'pane.attach': {
        if (req.cols && req.rows) this.panes.resize(req.paneId, req.cols, req.rows)
        const snapshot = this.panes.host.serialize(req.paneId)
        conn.subscriptions.add(req.paneId)
        return { snapshot }
      }
      case 'pane.input':
        this.panes.write(req.paneId, req.data)
        return null
      case 'pane.resize':
        this.panes.resize(req.paneId, req.cols, req.rows)
        return null
      case 'pane.kill':
        this.panes.kill(req.paneId)
        return null
      case 'pane.forget':
        this.panes.forget(req.paneId)
        return null
      case 'project.add': {
        const cfg = await this.registry.add(req.path, suggestAccount(this.persisted.accounts, req.path, this.o.userHome))
        await this.panes.relocateAll()
        return cfg
      }
      case 'project.remove':
        this.registry.remove(req.path)
        await this.panes.relocateAll()
        return null
      case 'project.setAccount':
        this.registry.setAccount(req.path, req.accountId)
        return null
      case 'layout.save':
        this.persisted.layout = req.layout
        this.changed()
        return null
      case 'worktree.checkRemove':
      case 'worktree.remove':
        throw new Error('não implementado')
      case 'hooks.install':
        for (const f of this.hookWarnings) installHooks(f, this.hookCmd)
        this.hookWarnings = checkProfiles(this.o.userHome, this.hookCmd)
        this.changed(false)
        return null
      case 'resume.dismiss':
        this.persisted.resumable = this.persisted.resumable.filter((r) => r.paneId !== req.paneId)
        this.changed()
        return null
      case 'daemon.shutdown':
        setImmediate(() => {
          void this.stop(true).then(() => this.o.onShutdown?.())
        })
        return null
    }
  }
}

export const defaultShell = (): string => os.userInfo().shell || process.env.SHELL || '/bin/zsh'
```

Nota: no teste de reinício, `accountId` do retomável é `'misa'` porque a sessão começou sem `CLAUDE_CONFIG_DIR` e sem conta de lançamento → `detectAccount` devolve a conta padrão.

- [ ] **Step 6: Implementar `src/daemon/main.ts`**

```ts
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Daemon, defaultShell } from './daemon'

function alreadyRunning(sock: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection(sock)
    s.once('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.once('error', () => resolve(false))
  })
}

async function main(): Promise<void> {
  const home = process.env.GT_HOME ?? path.join(os.homedir(), '.gerenciador-terminal')
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  const log = fs.createWriteStream(path.join(home, 'daemon.log'), { flags: 'a' })
  const write =
    (level: string) =>
    (...args: unknown[]) =>
      log.write(`${new Date().toISOString()} ${level} ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}\n`)
  console.log = write('INFO')
  console.error = write('ERROR')
  // um daemon que cai leva todas as sessões junto: registra e segue
  process.on('uncaughtException', (e) => console.error('uncaughtException', e))
  process.on('unhandledRejection', (e) => console.error('unhandledRejection', e))
  process.on('SIGHUP', () => {})

  const socketPath = path.join(home, 'daemon.sock')
  if (await alreadyRunning(socketPath)) {
    console.log('já existe um daemon rodando; saindo')
    process.exit(0)
  }
  const daemon = await Daemon.start({
    home,
    socketPath,
    stateFile: path.join(home, 'state.json'),
    hookScriptPath: path.join(home, 'bin', 'gt-hook'),
    userHome: os.homedir(),
    shell: defaultShell(),
    shellArgs: ['-il'],
    onShutdown: () => process.exit(0),
  })
  const bye = () => {
    void daemon.stop(true).then(() => process.exit(0))
  }
  process.on('SIGTERM', bye)
  process.on('SIGINT', bye)
  console.log(`daemon iniciado pid=${process.pid}`)
}

main().catch((e) => {
  console.error('falha ao iniciar o daemon', e)
  process.exit(1)
})
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npx vitest run tests/daemon/daemon.test.ts`
Expected: PASS (10 testes). Depois rode a suíte inteira: `npm test` — tudo verde.

- [ ] **Step 8: Build e fumaça do daemon real**

Run: `npm run build && GT_HOME=/tmp/gt-smoke ELECTRON_RUN_AS_NODE=1 npx electron out/main/daemon.js & sleep 2; ls /tmp/gt-smoke; cat /tmp/gt-smoke/daemon.log; kill %1`
Expected: `/tmp/gt-smoke` contém `daemon.sock`, `state.json`, `bin/gt-hook`; o log tem `daemon iniciado`. Apague `/tmp/gt-smoke` depois.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: daemon com painéis, hooks, poller, estado e persistência

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Remoção segura de worktree

**Files:**
- Create: `src/daemon/worktree-remove.ts`
- Modify: `src/daemon/daemon.ts` (casos `worktree.checkRemove` / `worktree.remove` e métodos privados)
- Test: `tests/daemon/worktree-remove.test.ts`

**Interfaces:**
- Consumes: `git` (Task 4), `RemoveCheck`, `WorktreeInfo` (Task 1), `Daemon` (Task 9).
- Produces:
  - `checkRemove(o: { mainPath: string; worktree: WorktreeInfo; mainBranch: string | null; hasOpenSession: boolean }): Promise<RemoveCheck>`
  - `removeWorktree(o: { mainPath: string; worktree: WorktreeInfo; force: boolean; deleteBranch: boolean }): Promise<void>`
  - Requisições do daemon: `worktree.checkRemove` → `RemoveCheck`; `worktree.remove` → recusa sessão aberta, recusa perda de trabalho sem `force`, remove e atualiza o projeto.

- [ ] **Step 1: Testes que falham — `tests/daemon/worktree-remove.test.ts`**

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkRemove, removeWorktree } from '../../src/daemon/worktree-remove'
import { listWorktrees } from '../../src/daemon/resolve'
import { Daemon } from '../../src/daemon/daemon'
import { connectApp } from '../helpers/app-client'
import { makeRepo, type TestRepo } from '../helpers/repo'

let repo: TestRepo | null = null
let daemon: Daemon | null = null
afterEach(async () => { await daemon?.stop(true); daemon = null; repo?.cleanup(); repo = null })

async function setup(name = 'wt x') {
  repo = makeRepo()
  const wtPath = path.join(repo.root, name)
  repo.git('worktree', 'add', '-b', 'feat-x', wtPath)
  const r = await listWorktrees(repo.dir)
  if (!r.ok) throw new Error(r.error)
  return { wt: r.worktrees[1], main: r.worktrees[0] }
}

describe('checkRemove', () => {
  it('worktree limpa e sem commits próprios', async () => {
    const { wt } = await setup()
    const c = await checkRemove({ mainPath: repo!.dir, worktree: wt, mainBranch: 'main', hasOpenSession: false })
    expect(c).toEqual({ path: wt.path, branch: 'feat-x', isMain: false, hasOpenSession: false, dirtyFiles: [], unpushedCommits: [] })
  })

  it('lista arquivos alterados e commits fora do remoto e da main', async () => {
    const { wt } = await setup()
    fs.writeFileSync(path.join(wt.path, 'a.txt'), '1')
    const g = (...a: string[]) => repo!.git('-C', wt.path, ...a)
    g('add', '.')
    g('commit', '-m', 'trabalho da worktree')
    fs.writeFileSync(path.join(wt.path, 'b.txt'), '2')
    const c = await checkRemove({ mainPath: repo!.dir, worktree: wt, mainBranch: 'main', hasOpenSession: true })
    expect(c.dirtyFiles).toEqual(['?? b.txt'])
    expect(c.unpushedCommits).toHaveLength(1)
    expect(c.unpushedCommits[0]).toContain('trabalho da worktree')
    expect(c.hasOpenSession).toBe(true)
  })
})

describe('removeWorktree', () => {
  it('remove a worktree e opcionalmente a branch', async () => {
    const { wt } = await setup()
    await removeWorktree({ mainPath: repo!.dir, worktree: wt, force: false, deleteBranch: true })
    expect(fs.existsSync(wt.path)).toBe(false)
    expect(repo!.git('branch', '--list', 'feat-x').trim()).toBe('')
  })

  it('sem force, git recusa worktree suja', async () => {
    const { wt } = await setup()
    fs.writeFileSync(path.join(wt.path, 'sujo.txt'), 'x')
    await expect(removeWorktree({ mainPath: repo!.dir, worktree: wt, force: false, deleteBranch: false })).rejects.toThrow()
    expect(fs.existsSync(wt.path)).toBe(true)
  })

  it('recusa a principal', async () => {
    const { main } = await setup()
    await expect(removeWorktree({ mainPath: repo!.dir, worktree: main, force: true, deleteBranch: false })).rejects.toThrow('principal')
  })

  it('pasta apagada à mão (prunable) é limpa com prune', async () => {
    const { wt } = await setup()
    fs.rmSync(wt.path, { recursive: true, force: true })
    const r = await listWorktrees(repo!.dir)
    const pr = r.ok ? r.worktrees.find((w) => w.path === wt.path)! : wt
    expect(pr.prunable).toBe(true)
    await removeWorktree({ mainPath: repo!.dir, worktree: pr, force: false, deleteBranch: false })
    const after = await listWorktrees(repo!.dir)
    expect(after.ok && after.worktrees).toHaveLength(1)
  })
})

describe('pelo daemon', () => {
  it('recusa com sessão aberta, recusa perda sem force e remove com force', async () => {
    const { wt } = await setup()
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-r-')))
    const userHome = path.join(home, 'user')
    fs.mkdirSync(userHome)
    daemon = await Daemon.start({
      home, socketPath: path.join(home, 'd.sock'), stateFile: path.join(home, 'state.json'), hookScriptPath: path.join(home, 'bin', 'gt-hook'),
      userHome, shell: '/bin/sh', shellArgs: [], env: { PATH: process.env.PATH, HOME: userHome }, pollMs: 60_000, gitPollMs: 500, fetchIntervalMs: 3_600_000,
    })
    const app = await connectApp(path.join(home, 'd.sock'))
    await app.client.request({ t: 'project.add', path: repo!.dir })

    const { paneId } = await app.client.request<{ paneId: string }>({ t: 'pane.create', cwd: wt.path, accountId: null, cols: 80, rows: 24 })
    await app.waitState((s) => s.panes[0]?.worktreePath === wt.path)
    await expect(app.client.request({ t: 'worktree.remove', path: wt.path, force: true, deleteBranch: false })).rejects.toThrow('sessões abertas')

    app.client.send({ t: 'pane.kill', paneId })
    await app.waitState((s) => s.panes[0]?.alive === false)
    fs.writeFileSync(path.join(wt.path, 'sujo.txt'), 'x')
    const check = await app.client.request<{ dirtyFiles: string[] }>({ t: 'worktree.checkRemove', path: wt.path })
    expect(check.dirtyFiles).toEqual(['?? sujo.txt'])
    await expect(app.client.request({ t: 'worktree.remove', path: wt.path, force: false, deleteBranch: false })).rejects.toThrow('seriam perdidos')

    await app.client.request({ t: 'worktree.remove', path: wt.path, force: true, deleteBranch: true })
    await app.waitState((s) => s.projects[0].worktrees.length === 1)
    app.client.close()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/worktree-remove.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/daemon/worktree-remove.ts`**

```ts
import type { RemoveCheck, WorktreeInfo } from '../shared/types'
import { git } from './git/run'

const lines = (s: string): string[] => s.split('\n').filter(Boolean)

export async function checkRemove(o: {
  mainPath: string
  worktree: WorktreeInfo
  mainBranch: string | null
  hasOpenSession: boolean
}): Promise<RemoveCheck> {
  const w = o.worktree
  let dirtyFiles: string[] = []
  if (!w.prunable) {
    const st = await git(w.path, ['status', '--porcelain'])
    if (!st.ok) throw new Error(`não consegui ler o status de ${w.path}: ${st.stderr.trim()}`)
    dirtyFiles = lines(st.stdout)
  }
  let unpushedCommits: string[] = []
  const tip = w.branch ?? w.head
  if (tip && !w.isMain) {
    const args = ['log', '--oneline', '--max-count=20', tip, '--not', '--remotes']
    if (o.mainBranch && o.mainBranch !== w.branch) args.push(o.mainBranch)
    const r = await git(o.mainPath, args)
    if (!r.ok) throw new Error(`não consegui listar os commits de ${tip}: ${r.stderr.trim()}`)
    unpushedCommits = lines(r.stdout)
  }
  return { path: w.path, branch: w.branch, isMain: w.isMain, hasOpenSession: o.hasOpenSession, dirtyFiles, unpushedCommits }
}

export async function removeWorktree(o: { mainPath: string; worktree: WorktreeInfo; force: boolean; deleteBranch: boolean }): Promise<void> {
  const w = o.worktree
  if (w.isMain) throw new Error('a worktree principal não pode ser removida')
  if (w.prunable) {
    const r = await git(o.mainPath, ['worktree', 'prune'])
    if (!r.ok) throw new Error(r.stderr.trim() || 'git worktree prune falhou')
  } else {
    const r = await git(o.mainPath, ['worktree', 'remove', ...(o.force ? ['--force'] : []), w.path], 30_000)
    if (!r.ok) throw new Error(r.stderr.trim() || 'git worktree remove falhou')
  }
  if (o.deleteBranch && w.branch) {
    const r = await git(o.mainPath, ['branch', o.force ? '-D' : '-d', w.branch])
    if (!r.ok) throw new Error(`worktree removida, mas a branch não: ${r.stderr.trim()}`)
  }
}
```

- [ ] **Step 4: Ligar no daemon — `src/daemon/daemon.ts`**

Adicione o import:
```ts
import { checkRemove, removeWorktree } from './worktree-remove'
```

Troque os dois casos que lançavam "não implementado" por:
```ts
      case 'worktree.checkRemove':
        return this.checkRemove(req.path)
      case 'worktree.remove':
        await this.removeWorktree(req.path, req.force, req.deleteBranch)
        return null
```

Adicione os métodos privados na classe `Daemon`:
```ts
  private findWorktree(p: string) {
    for (const project of this.registry.list()) {
      const wts = this.registry.worktrees(project.path)
      const worktree = wts.find((w) => w.path === p)
      if (worktree) return { project, worktree, main: wts[0] }
    }
    throw new Error(`worktree não encontrada: ${p}`)
  }

  private checkRemove(p: string) {
    const { project, worktree, main } = this.findWorktree(p)
    return checkRemove({
      mainPath: project.path,
      worktree,
      mainBranch: main?.branch ?? null,
      hasOpenSession: this.panes.records().some((r) => r.alive && r.worktreePath === p),
    })
  }

  private async removeWorktree(p: string, force: boolean, deleteBranch: boolean): Promise<void> {
    const check = await this.checkRemove(p)
    if (check.isMain) throw new Error('a worktree principal não pode ser removida')
    if (check.hasOpenSession) throw new Error('feche as sessões abertas nesta worktree antes de remover')
    if (!force && (check.dirtyFiles.length > 0 || check.unpushedCommits.length > 0)) {
      throw new Error('a worktree tem alterações ou commits que seriam perdidos')
    }
    const { project, worktree } = this.findWorktree(p)
    await removeWorktree({ mainPath: project.path, worktree, force, deleteBranch })
    await this.registry.refresh(project.path)
  }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/daemon/worktree-remove.test.ts && npm test`
Expected: PASS em tudo.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: checagem e remoção segura de worktree

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Processo principal do Electron (daemon, IPC, menu, preload)

**Files:**
- Create: `src/main/daemon-link.ts`, `src/main/menu.ts`, `src/shared/bridge.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts` (substituem os placeholders)
- Test: `tests/main/daemon-link.test.ts`

**Interfaces:**
- Consumes: `RpcClient` (Task 2), `PROTOCOL_VERSION`, `BridgeEvent`, `ClientRequest` (Task 1), `startServer` (só no teste).
- Produces:
  - `ensureDaemon(socketPath: string, spawnDaemon: () => void, timeoutMs?: number): Promise<RpcClient>`
  - `spawnDetached(daemonScript: string, env: NodeJS.ProcessEnv): void`
  - `class DaemonLink { constructor(o: { socketPath: string; daemonScript: string; onEvent(e: BridgeEvent): void }); start(): Promise<void>; request<T>(req: ClientRequest): Promise<T>; send(req: ClientRequest): void; shutdownDaemon(restart: boolean): Promise<void> }`
  - `buildMenu(o: { send(action: string): void; quitAll(): void }): Electron.Menu` — ações: `new-session`, `split-right`, `split-down`, `hide-pane`, `new-tab`, `tab-1`…`tab-9`, `focus-left|right|up|down`
  - `interface GtApi` (em `src/shared/bridge.ts`) — é o `window.gt` do renderer:

```ts
import type { BridgeEvent, ClientRequest } from './protocol'

export interface ConfirmOptions {
  message: string
  detail?: string
  confirmLabel?: string
  checkboxLabel?: string
}

/** id "-" vira separador */
export interface MenuItemSpec {
  id: string
  label: string
  enabled?: boolean
}

export interface GtApi {
  request<T = unknown>(req: ClientRequest): Promise<T>
  send(req: ClientRequest): void
  onEvent(cb: (e: BridgeEvent) => void): () => void
  onMenu(cb: (action: string) => void): () => void
  pickFolder(): Promise<string | null>
  confirm(o: ConfirmOptions): Promise<{ ok: boolean; checked: boolean }>
  alert(message: string, detail?: string): Promise<void>
  contextMenu(items: MenuItemSpec[]): Promise<string | null>
  openPath(p: string): Promise<void>
  openExternal(url: string): Promise<void>
  restartDaemon(): Promise<void>
}
```

- [ ] **Step 1: Criar `src/shared/bridge.ts`** com o conteúdo acima.

- [ ] **Step 2: Teste que falha — `tests/main/daemon-link.test.ts`**

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureDaemon } from '../../src/main/daemon-link'
import { startServer, type RpcServer } from '../../src/daemon/server'

let server: RpcServer | null = null
afterEach(async () => { await server?.close(); server = null })
const sock = () => path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-m-'))), 'd.sock')

describe('ensureDaemon', () => {
  it('conecta direto quando o daemon já existe, sem iniciar outro', async () => {
    const p = sock()
    server = await startServer(p, () => 'ok')
    let spawned = 0
    const c = await ensureDaemon(p, () => { spawned++ })
    expect(spawned).toBe(0)
    await expect(c.request({ t: 'state.get' })).resolves.toBe('ok')
    c.close()
  })

  it('inicia o daemon e espera o socket aparecer', async () => {
    const p = sock()
    let spawned = 0
    const c = await ensureDaemon(p, () => {
      spawned++
      setTimeout(() => { void startServer(p, () => 'novo').then((s) => { server = s }) }, 300)
    })
    expect(spawned).toBe(1)
    await expect(c.request({ t: 'state.get' })).resolves.toBe('novo')
    c.close()
  })

  it('desiste depois do tempo limite', async () => {
    await expect(ensureDaemon(sock(), () => {}, 400)).rejects.toThrow('não consegui iniciar o daemon')
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run tests/main/daemon-link.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implementar `src/main/daemon-link.ts`**

```ts
import { spawn } from 'node:child_process'
import { RpcClient } from '../shared/rpc-client'
import { PROTOCOL_VERSION, type BridgeEvent, type ClientRequest } from '../shared/protocol'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function ensureDaemon(socketPath: string, spawnDaemon: () => void, timeoutMs = 5000): Promise<RpcClient> {
  try {
    return await RpcClient.connect(socketPath)
  } catch {
    // não está rodando
  }
  spawnDaemon()
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown = null
  while (Date.now() < deadline) {
    await sleep(100)
    try {
      return await RpcClient.connect(socketPath)
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(`não consegui iniciar o daemon: ${String(lastErr)}`)
}

export function spawnDetached(daemonScript: string, env: NodeJS.ProcessEnv): void {
  // o próprio binário do Electron roda como Node; o daemon não depende de Node instalado
  const child = spawn(process.execPath, [daemonScript], {
    detached: true,
    stdio: 'ignore',
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
  })
  child.unref()
}

export class DaemonLink {
  private client: RpcClient | null = null
  private quitting = false

  constructor(private o: { socketPath: string; daemonScript: string; onEvent(e: BridgeEvent): void }) {}

  async start(): Promise<void> {
    await this.connectOnce(false)
  }

  request<T = unknown>(req: ClientRequest): Promise<T> {
    if (!this.client) return Promise.reject(new Error('sem conexão com o daemon'))
    return this.client.request<T>(req)
  }

  send(req: ClientRequest): void {
    this.client?.send(req)
  }

  /** restart=false: o app vai sair e não deve reconectar */
  async shutdownDaemon(restart: boolean): Promise<void> {
    if (!restart) this.quitting = true
    await this.request({ t: 'daemon.shutdown' }).catch(() => {})
  }

  private async connectOnce(isReconnect: boolean): Promise<void> {
    const client = await ensureDaemon(this.o.socketPath, () => spawnDetached(this.o.daemonScript, process.env))
    this.client = client
    client.onMessage((m) => this.o.onEvent(m))
    client.onClose(() => {
      this.client = null
      if (this.quitting) return
      this.o.onEvent({ t: 'disconnected' })
      void this.reconnectLoop()
    })
    const hello = await client.request<{ protocolVersion: number }>({ t: 'hello', role: 'app', version: PROTOCOL_VERSION })
    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      this.o.onEvent({ t: 'version-mismatch', daemon: hello.protocolVersion, app: PROTOCOL_VERSION })
    }
    if (isReconnect) this.o.onEvent({ t: 'reconnected' })
  }

  private async reconnectLoop(): Promise<void> {
    while (!this.quitting) {
      try {
        await this.connectOnce(true)
        return
      } catch {
        await sleep(1000)
      }
    }
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/main/daemon-link.test.ts`
Expected: PASS.

- [ ] **Step 6: Implementar `src/main/menu.ts`**

```ts
import { Menu, type MenuItemConstructorOptions } from 'electron'

export function buildMenu(o: { send(action: string): void; quitAll(): void }): Menu {
  const item = (label: string, accelerator: string, action: string): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => o.send(action),
  })
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Gerenciador de Terminal',
      submenu: [
        { role: 'about', label: 'Sobre' },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar' },
        { role: 'hideOthers', label: 'Ocultar outros' },
        { type: 'separator' },
        { label: 'Encerrar tudo (inclusive as sessões)…', click: () => o.quitAll() },
        { role: 'quit', label: 'Sair (as sessões continuam rodando)' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Sessão',
      submenu: [
        item('Nova sessão…', 'CmdOrCtrl+T', 'new-session'),
        item('Dividir à direita', 'CmdOrCtrl+D', 'split-right'),
        item('Dividir abaixo', 'CmdOrCtrl+Shift+D', 'split-down'),
        item('Esconder painel', 'CmdOrCtrl+W', 'hide-pane'),
        { type: 'separator' },
        item('Foco à esquerda', 'Alt+CmdOrCtrl+Left', 'focus-left'),
        item('Foco à direita', 'Alt+CmdOrCtrl+Right', 'focus-right'),
        item('Foco acima', 'Alt+CmdOrCtrl+Up', 'focus-up'),
        item('Foco abaixo', 'Alt+CmdOrCtrl+Down', 'focus-down'),
      ],
    },
    {
      label: 'Abas',
      submenu: [
        item('Nova aba', 'CmdOrCtrl+Shift+T', 'new-tab'),
        { type: 'separator' },
        ...Array.from({ length: 9 }, (_, i) => item(`Aba ${i + 1}`, `CmdOrCtrl+${i + 1}`, `tab-${i + 1}`)),
      ],
    },
    { role: 'viewMenu' },
    {
      label: 'Janela',
      submenu: [{ role: 'minimize', label: 'Minimizar' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
  ]
  return Menu.buildFromTemplate(template)
}
```

(Não há `role: 'close'` em nenhum menu: ⌘W é "Esconder painel".)

- [ ] **Step 7: Implementar `src/main/index.ts`**

```ts
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import type { ClientRequest } from '../shared/protocol'
import type { ConfirmOptions, MenuItemSpec } from '../shared/bridge'
import { DaemonLink } from './daemon-link'
import { buildMenu } from './menu'

let win: BrowserWindow | null = null
const home = process.env.GT_HOME ?? path.join(os.homedir(), '.gerenciador-terminal')

const link = new DaemonLink({
  socketPath: path.join(home, 'daemon.sock'),
  daemonScript: path.join(__dirname, 'daemon.js'),
  onEvent: (e) => win?.webContents.send('gt:event', e),
})

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    backgroundColor: '#1e1e1e',
    title: 'Gerenciador de Terminal',
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: false },
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  win.on('closed', () => {
    win = null
  })
}

ipcMain.handle('gt:request', (_e, req: ClientRequest) => link.request(req))
ipcMain.on('gt:send', (_e, req: ClientRequest) => link.send(req))
ipcMain.handle('gt:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('gt:confirm', async (_e, o: ConfirmOptions) => {
  const r = await dialog.showMessageBox(win!, {
    type: 'warning',
    message: o.message,
    detail: o.detail,
    buttons: [o.confirmLabel ?? 'Confirmar', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    checkboxLabel: o.checkboxLabel,
  })
  return { ok: r.response === 0, checked: r.checkboxChecked }
})
ipcMain.handle('gt:alert', async (_e, message: string, detail?: string) => {
  await dialog.showMessageBox(win!, { type: 'info', message, detail })
})
ipcMain.handle(
  'gt:contextMenu',
  (_e, items: MenuItemSpec[]) =>
    new Promise<string | null>((resolve) => {
      let done = false
      const finish = (v: string | null) => {
        if (!done) {
          done = true
          resolve(v)
        }
      }
      const menu = Menu.buildFromTemplate(
        items.map((i) =>
          i.id === '-' ? { type: 'separator' as const } : { label: i.label, enabled: i.enabled !== false, click: () => finish(i.id) },
        ),
      )
      // o callback de fechamento pode vir antes do click
      menu.popup({ window: win ?? undefined, callback: () => setTimeout(() => finish(null), 50) })
    }),
)
ipcMain.handle('gt:openPath', async (_e, p: string) => {
  await shell.openPath(p)
})
ipcMain.handle('gt:openExternal', async (_e, url: string) => {
  if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
})
ipcMain.handle('gt:restartDaemon', () => link.shutdownDaemon(true))

async function quitAll(): Promise<void> {
  const r = await dialog.showMessageBox(win!, {
    type: 'warning',
    message: 'Encerrar tudo?',
    detail: 'Todas as sessões e terminais serão finalizados. Eles poderão ser retomados na próxima abertura.',
    buttons: ['Encerrar tudo', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
  })
  if (r.response !== 0) return
  await link.shutdownDaemon(false)
  app.quit()
}

app.whenReady().then(async () => {
  try {
    await link.start()
  } catch (e) {
    dialog.showErrorBox('Gerenciador de Terminal', `Não foi possível iniciar o daemon.\n\n${String(e)}\n\nVeja ${path.join(home, 'daemon.log')}`)
    app.quit()
    return
  }
  Menu.setApplicationMenu(buildMenu({ send: (a) => win?.webContents.send('gt:menu', a), quitAll: () => void quitAll() }))
  createWindow()
  app.on('activate', () => {
    if (!win) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 8: Implementar `src/preload/index.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { BridgeEvent, ClientRequest } from '../shared/protocol'
import type { ConfirmOptions, GtApi, MenuItemSpec } from '../shared/bridge'

const api: GtApi = {
  request: (req: ClientRequest) => ipcRenderer.invoke('gt:request', req),
  send: (req: ClientRequest) => ipcRenderer.send('gt:send', req),
  onEvent: (cb) => {
    const l = (_e: unknown, m: BridgeEvent) => cb(m)
    ipcRenderer.on('gt:event', l)
    return () => ipcRenderer.removeListener('gt:event', l)
  },
  onMenu: (cb) => {
    const l = (_e: unknown, a: string) => cb(a)
    ipcRenderer.on('gt:menu', l)
    return () => ipcRenderer.removeListener('gt:menu', l)
  },
  pickFolder: () => ipcRenderer.invoke('gt:pickFolder'),
  confirm: (o: ConfirmOptions) => ipcRenderer.invoke('gt:confirm', o),
  alert: (message: string, detail?: string) => ipcRenderer.invoke('gt:alert', message, detail),
  contextMenu: (items: MenuItemSpec[]) => ipcRenderer.invoke('gt:contextMenu', items),
  openPath: (p: string) => ipcRenderer.invoke('gt:openPath', p),
  openExternal: (url: string) => ipcRenderer.invoke('gt:openExternal', url),
  restartDaemon: () => ipcRenderer.invoke('gt:restartDaemon'),
}

contextBridge.exposeInMainWorld('gt', api)
```

- [ ] **Step 9: Verificar build e processo de ponta a ponta**

Run: `npm run typecheck && npm run build`
Expected: sem erros; `out/main/index.js`, `out/main/daemon.js`, `out/preload/index.js` existem. Se o preload sair com outro nome (ex.: `index.mjs`), ajuste o caminho no `BrowserWindow`.

Run: `GT_HOME=/tmp/gt-e2e npm run dev`
Expected: a janela abre (ainda com o placeholder); em outro terminal, `ls /tmp/gt-e2e` mostra `daemon.sock`. Feche o app: `ls /tmp/gt-e2e/daemon.sock` **continua existindo** (daemon sobreviveu). Encerre abrindo o app de novo e usando "Encerrar tudo" (ou `pkill -f out/main/daemon.js`). Apague `/tmp/gt-e2e`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: processo principal do Electron, ponte IPC e menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Renderer — estado de UI e modelos puros

**Files:**
- Create: `src/renderer/src/api.ts`, `src/renderer/src/store.ts`, `src/renderer/src/layout.ts`, `src/renderer/src/header.ts`, `src/renderer/src/sidebar-model.ts`, `src/renderer/src/keys.ts`
- Test: `tests/renderer/layout.test.ts`, `tests/renderer/header.test.ts`, `tests/renderer/sidebar-model.test.ts`, `tests/renderer/keys.test.ts`

**Interfaces:**
- Consumes: tipos da Task 1, `GtApi` (Task 11).
- Produces:
  - `api.ts`: `declare global { interface Window { gt: GtApi } }`; `errorMessage(e: unknown): string`
  - `store.ts`: `interface UiState { app: AppState | null; connected: boolean; versionMismatch: { daemon: number; app: number } | null; focusedPaneId: string | null; newSession: { projectPath: string | null; worktreePath: string | null } | null; error: string | null }`; `getUi(): UiState`; `setUi(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)): void`; `useUi<T>(sel: (s: UiState) => T): T`; `updateLayout(fn: (l: Layout) => Layout): void`; `showError(e: unknown): void`
  - `layout.ts`: `leaves(n: LayoutNode | null): string[]`; `findTab(l: Layout, paneId: string): Tab | undefined`; `splitLeaf(root: LayoutNode, target: string, paneId: string, dir: 'row' | 'column'): LayoutNode`; `removeLeaf(root: LayoutNode, paneId: string): LayoutNode | null`; `setSizes(root: LayoutNode, path: number[], sizes: number[]): LayoutNode`; `type Dir = 'left' | 'right' | 'up' | 'down'`; `interface Rect { id: string; x: number; y: number; w: number; h: number }`; `neighbor(rects: Rect[], fromId: string | null, dir: Dir): string | null`
  - `header.ts`: `interface HeaderView { project: string; worktree: string; isMainWorktree: boolean; branch: string | null; changed: number; ahead: number; behind: number; hasUpstream: boolean; status: SessionStatus | 'shell'; account: { label: string; color: string } | null; warning: string | null }`; `headerView(pane: PaneView, app: Pick<AppState, 'projects' | 'accounts' | 'userHome'>): HeaderView`; `worktreeLabel(w: { path: string; isMain: boolean }): string`; `tildify(p: string, home: string): string`
  - `sidebar-model.ts`: `interface SessionItem { paneId: string; label: string; status: SessionStatus | 'shell'; alive: boolean; cwd: string }`; `interface WorktreeItem { path: string; label: string; isMain: boolean; branch: string | null; git: GitStatus | null; prunable: boolean; sessions: SessionItem[] }`; `interface ProjectItem { path: string; name: string; defaultAccountId: string | null; error: string | null; fetchError: string | null; worktrees: WorktreeItem[]; summary: { working: number; needsYou: number; idle: number } }`; `buildSidebar(app: AppState): { projects: ProjectItem[]; outside: SessionItem[] }`; `sessionLabel(p: PaneView): string`
  - `keys.ts`: `SHIFT_ENTER_SEQUENCE = '\x1b\r'`; `type KeyDecision = 'send-shift-enter' | 'swallow' | 'xterm'`; `decideKey(e: { type: string; key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): KeyDecision`

**Atenção com `useUi`:** o seletor precisa devolver referências estáveis (um pedaço do estado, `find` de um item existente, um primitivo). Nunca construa objeto/array novo dentro do seletor — `useSyncExternalStore` entra em loop. Derive com `useMemo` no componente.

- [ ] **Step 1: Testes que falham**

`tests/renderer/layout.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { findTab, leaves, neighbor, removeLeaf, setSizes, splitLeaf } from '../../src/renderer/src/layout'
import type { LayoutNode } from '../../src/shared/types'

const leaf = (paneId: string): LayoutNode => ({ type: 'leaf', paneId })

describe('layout', () => {
  it('split de folha cria nó; mesma direção insere ao lado', () => {
    const a = splitLeaf(leaf('a'), 'a', 'b', 'row')
    expect(a).toEqual({ type: 'split', dir: 'row', children: [leaf('a'), leaf('b')], sizes: [] })
    const b = splitLeaf(a, 'a', 'c', 'row')
    expect(leaves(b)).toEqual(['a', 'c', 'b'])
    const c = splitLeaf(b, 'c', 'd', 'column')
    expect(c).toEqual({ type: 'split', dir: 'row', sizes: [], children: [leaf('a'), { type: 'split', dir: 'column', sizes: [], children: [leaf('c'), leaf('d')] }, leaf('b')] })
  })

  it('remover folha colapsa splits de um filho só', () => {
    const t: LayoutNode = { type: 'split', dir: 'row', sizes: [1, 1], children: [leaf('a'), { type: 'split', dir: 'column', sizes: [1, 1], children: [leaf('b'), leaf('c')] }] }
    expect(removeLeaf(t, 'b')).toEqual({ type: 'split', dir: 'row', sizes: [1, 1], children: [leaf('a'), leaf('c')] })
    expect(removeLeaf(leaf('a'), 'a')).toBeNull()
    expect(removeLeaf(removeLeaf(t, 'b')!, 'a')).toEqual(leaf('c'))
  })

  it('setSizes pelo caminho e findTab', () => {
    const t: LayoutNode = { type: 'split', dir: 'row', sizes: [], children: [leaf('a'), { type: 'split', dir: 'column', sizes: [], children: [leaf('b'), leaf('c')] }] }
    const s = setSizes(t, [1], [30, 70])
    expect(s.type === 'split' && s.children[1].type === 'split' && s.children[1].sizes).toEqual([30, 70])
    expect(findTab({ tabs: [{ id: 't1', name: 'A', root: t }], activeTabId: 't1' }, 'c')?.id).toBe('t1')
  })

  it('vizinho na direção pedida', () => {
    const rects = [
      { id: 'a', x: 0, y: 0, w: 100, h: 200 },
      { id: 'b', x: 100, y: 0, w: 100, h: 100 },
      { id: 'c', x: 100, y: 100, w: 100, h: 100 },
    ]
    expect(neighbor(rects, 'a', 'right')).toBe('b')
    expect(neighbor(rects, 'c', 'left')).toBe('a')
    expect(neighbor(rects, 'b', 'down')).toBe('c')
    expect(neighbor(rects, 'b', 'up')).toBeNull()
    expect(neighbor(rects, null, 'up')).toBe('a')
  })
})
```

`tests/renderer/header.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { headerView, tildify } from '../../src/renderer/src/header'
import { DEFAULT_ACCOUNTS } from '../../src/daemon/accounts'
import type { PaneView, ProjectView } from '../../src/shared/types'

const project: ProjectView = {
  path: '/r/api', name: 'api', defaultAccountId: null, error: null, fetchError: null,
  worktrees: [
    { path: '/r/api', head: 'a', branch: 'main', isMain: true, locked: false, prunable: false, git: { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 3, changed: 0, error: null } },
    { path: '/r/api/.claude/worktrees/auth', head: 'b', branch: 'feat/auth', isMain: false, locked: false, prunable: false, git: { branch: 'feat/auth', upstream: null, ahead: 2, behind: 0, changed: 5, error: null } },
  ],
}
const pane = (over: Partial<PaneView>): PaneView => ({ id: 'p', seq: 1, cwd: '/r/api', alive: true, exitCode: null, accountId: null, claude: null, projectPath: '/r/api', worktreePath: '/r/api', ...over })
const app = { projects: [project], accounts: DEFAULT_ACCOUNTS, userHome: '/Users/u' }

describe('headerView', () => {
  it('worktree secundária com sessão e conta', () => {
    const h = headerView(pane({ worktreePath: '/r/api/.claude/worktrees/auth', accountId: 'mslabs', claude: { sessionId: 's', status: 'needs-you', title: null, transcriptPath: null } }), app)
    expect(h).toEqual({
      project: 'api', worktree: 'auth', isMainWorktree: false, branch: 'feat/auth', changed: 5, ahead: 2, behind: 0,
      hasUpstream: false, status: 'needs-you', account: { label: 'mslabs', color: '#c586c0' }, warning: null,
    })
  })

  it('principal, terminal comum, aviso de fetch', () => {
    const h = headerView(pane({}), { ...app, projects: [{ ...project, fetchError: 'Permission denied' }] })
    expect(h).toMatchObject({ worktree: 'principal', isMainWorktree: true, behind: 3, status: 'shell', account: null, warning: 'Permission denied' })
  })

  it('fora de projeto mostra o cwd com ~', () => {
    const h = headerView(pane({ projectPath: null, worktreePath: null, cwd: '/Users/u/Downloads' }), app)
    expect(h).toMatchObject({ project: 'fora de projeto', worktree: '~/Downloads', branch: null })
    expect(tildify('/Users/u', '/Users/u')).toBe('~')
    expect(tildify('/Users/uu', '/Users/u')).toBe('/Users/uu')
  })
})
```

`tests/renderer/sidebar-model.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { buildSidebar, sessionLabel } from '../../src/renderer/src/sidebar-model'
import type { AppState, PaneView } from '../../src/shared/types'

const pane = (id: string, over: Partial<PaneView>): PaneView => ({ id, seq: Number(id.slice(1)), cwd: '/r/api', alive: true, exitCode: null, accountId: null, claude: null, projectPath: '/r/api', worktreePath: '/r/api', ...over })
const claude = (status: 'working' | 'needs-you' | 'idle', title: string | null = null) => ({ sessionId: 's', status, title, transcriptPath: null })

const app: AppState = {
  protocolVersion: 1, userHome: '/u', accounts: [], resumable: [], hookWarnings: [], layout: { tabs: [], activeTabId: null },
  projects: [{
    path: '/r/api', name: 'api', defaultAccountId: null, error: null, fetchError: null,
    worktrees: [
      { path: '/r/api', head: null, branch: 'main', isMain: true, locked: false, prunable: false, git: null },
      { path: '/r/api/wt/x', head: null, branch: 'x', isMain: false, locked: false, prunable: false, git: null },
    ],
  }],
  panes: [
    pane('p1', { claude: claude('working', 'Refatorar auth') }),
    pane('p2', { claude: claude('needs-you') }),
    pane('p3', {}),
    pane('p4', { projectPath: null, worktreePath: null, cwd: '/tmp' }),
  ],
}

describe('buildSidebar', () => {
  it('agrupa sessões por worktree, resume estados e separa as de fora', () => {
    const m = buildSidebar(app)
    const [main, x] = m.projects[0].worktrees
    expect(main.sessions.map((s) => [s.paneId, s.label, s.status])).toEqual([
      ['p1', 'Refatorar auth', 'working'],
      ['p2', 'sessão 2', 'needs-you'],
      ['p3', 'terminal 3', 'shell'],
    ])
    expect(x).toMatchObject({ label: 'x', sessions: [] })
    expect(m.projects[0].summary).toEqual({ working: 1, needsYou: 1, idle: 0 })
    expect(m.outside.map((s) => s.paneId)).toEqual(['p4'])
  })

  it('rótulo de painel encerrado', () => {
    expect(sessionLabel(pane('p7', { alive: false }))).toBe('encerrado 7')
  })
})
```

`tests/renderer/keys.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { decideKey } from '../../src/renderer/src/keys'

const k = (over: Partial<Parameters<typeof decideKey>[0]>) => decideKey({ type: 'keydown', key: 'a', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...over })

describe('decideKey', () => {
  it('Shift+Enter envia a sequência só no keydown e engole o resto', () => {
    expect(k({ key: 'Enter', shiftKey: true })).toBe('send-shift-enter')
    expect(k({ key: 'Enter', shiftKey: true, type: 'keypress' })).toBe('swallow')
    expect(k({ key: 'Enter' })).toBe('xterm')
  })
  it('⌘ fica com o menu do app', () => {
    expect(k({ key: 't', metaKey: true })).toBe('swallow')
  })
  it('teclas mortas e ⌥ seguem para o xterm (composição de acentos)', () => {
    expect(k({ key: 'Dead' })).toBe('xterm')
    expect(k({ key: 'Dead', shiftKey: true })).toBe('xterm')
    expect(k({ key: 'ã' })).toBe('xterm')
    expect(k({ key: 'ç', altKey: true })).toBe('xterm')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/renderer`
Expected: FAIL.

- [ ] **Step 3: Implementar `src/renderer/src/layout.ts`**

```ts
import type { Layout, LayoutNode, Tab } from '../../shared/types'

export type Dir = 'left' | 'right' | 'up' | 'down'

export interface Rect {
  id: string
  x: number
  y: number
  w: number
  h: number
}

export function leaves(n: LayoutNode | null): string[] {
  if (!n) return []
  return n.type === 'leaf' ? [n.paneId] : n.children.flatMap(leaves)
}

export function findTab(l: Layout, paneId: string): Tab | undefined {
  return l.tabs.find((t) => leaves(t.root).includes(paneId))
}

export function splitLeaf(root: LayoutNode, target: string, paneId: string, dir: 'row' | 'column'): LayoutNode {
  if (root.type === 'leaf') {
    return root.paneId === target ? { type: 'split', dir, children: [root, { type: 'leaf', paneId }], sizes: [] } : root
  }
  const idx = root.children.findIndex((c) => c.type === 'leaf' && c.paneId === target)
  if (idx >= 0 && root.dir === dir) {
    const children = [...root.children]
    children.splice(idx + 1, 0, { type: 'leaf', paneId })
    return { ...root, children, sizes: [] }
  }
  return { ...root, children: root.children.map((c) => splitLeaf(c, target, paneId, dir)) }
}

export function removeLeaf(root: LayoutNode, paneId: string): LayoutNode | null {
  if (root.type === 'leaf') return root.paneId === paneId ? null : root
  const children = root.children.map((c) => removeLeaf(c, paneId)).filter((c): c is LayoutNode => c !== null)
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { ...root, children, sizes: children.length === root.children.length ? root.sizes : [] }
}

export function setSizes(root: LayoutNode, path: number[], sizes: number[]): LayoutNode {
  if (root.type === 'leaf') return root
  if (path.length === 0) return { ...root, sizes }
  const [i, ...rest] = path
  return { ...root, children: root.children.map((c, j) => (j === i ? setSizes(c, rest, sizes) : c)) }
}

export function neighbor(rects: Rect[], fromId: string | null, dir: Dir): string | null {
  const src = rects.find((r) => r.id === fromId)
  if (!src) return rects[0]?.id ?? null
  const cx = (r: Rect) => r.x + r.w / 2
  const cy = (r: Rect) => r.y + r.h / 2
  const inDir = (r: Rect) =>
    dir === 'right' ? r.x >= src.x + src.w - 1
    : dir === 'left' ? r.x + r.w <= src.x + 1
    : dir === 'down' ? r.y >= src.y + src.h - 1
    : r.y + r.h <= src.y + 1
  const horizontal = dir === 'left' || dir === 'right'
  const score = (r: Rect) =>
    horizontal
      ? Math.abs(cx(r) - cx(src)) + Math.abs(cy(r) - cy(src)) * 2
      : Math.abs(cy(r) - cy(src)) + Math.abs(cx(r) - cx(src)) * 2
  return rects.filter((r) => r.id !== src.id && inDir(r)).sort((a, b) => score(a) - score(b))[0]?.id ?? null
}
```

- [ ] **Step 4: Implementar `src/renderer/src/header.ts`**

```ts
import type { AppState, PaneView, SessionStatus } from '../../shared/types'

export interface HeaderView {
  project: string
  worktree: string
  isMainWorktree: boolean
  branch: string | null
  changed: number
  ahead: number
  behind: number
  hasUpstream: boolean
  status: SessionStatus | 'shell'
  account: { label: string; color: string } | null
  warning: string | null
}

export function worktreeLabel(w: { path: string; isMain: boolean }): string {
  return w.isMain ? 'principal' : (w.path.split('/').pop() ?? w.path)
}

export function tildify(p: string, home: string): string {
  return p === home || p.startsWith(home + '/') ? '~' + p.slice(home.length) : p
}

export function headerView(pane: PaneView, app: Pick<AppState, 'projects' | 'accounts' | 'userHome'>): HeaderView {
  const project = app.projects.find((p) => p.path === pane.projectPath)
  const wt = project?.worktrees.find((w) => w.path === pane.worktreePath)
  const account = app.accounts.find((a) => a.id === pane.accountId)
  const git = wt?.git ?? null
  return {
    project: project?.name ?? 'fora de projeto',
    worktree: wt ? worktreeLabel(wt) : tildify(pane.cwd, app.userHome),
    isMainWorktree: wt?.isMain ?? true,
    branch: git?.branch ?? wt?.branch ?? null,
    changed: git?.changed ?? 0,
    ahead: git?.ahead ?? 0,
    behind: git?.behind ?? 0,
    hasUpstream: Boolean(git?.upstream),
    status: pane.claude?.status ?? 'shell',
    account: account ? { label: account.label, color: account.color } : null,
    warning: git?.error ?? project?.fetchError ?? null,
  }
}
```

No teste "principal, terminal comum" o `hasUpstream` é `true` e o `branch` é `main`; o `toMatchObject` só confere os campos listados.

- [ ] **Step 5: Implementar `src/renderer/src/sidebar-model.ts`**

```ts
import type { AppState, GitStatus, PaneView, SessionStatus } from '../../shared/types'
import { worktreeLabel } from './header'

export interface SessionItem {
  paneId: string
  label: string
  status: SessionStatus | 'shell'
  alive: boolean
  cwd: string
}

export interface WorktreeItem {
  path: string
  label: string
  isMain: boolean
  branch: string | null
  git: GitStatus | null
  prunable: boolean
  sessions: SessionItem[]
}

export interface ProjectItem {
  path: string
  name: string
  defaultAccountId: string | null
  error: string | null
  fetchError: string | null
  worktrees: WorktreeItem[]
  summary: { working: number; needsYou: number; idle: number }
}

export function sessionLabel(p: PaneView): string {
  if (!p.alive) return `encerrado ${p.seq}`
  if (p.claude) return p.claude.title ?? `sessão ${p.seq}`
  return `terminal ${p.seq}`
}

const toItem = (p: PaneView): SessionItem => ({
  paneId: p.id,
  label: sessionLabel(p),
  status: p.claude?.status ?? 'shell',
  alive: p.alive,
  cwd: p.cwd,
})

export function buildSidebar(app: AppState): { projects: ProjectItem[]; outside: SessionItem[] } {
  const used = new Set<string>()
  const projects = app.projects.map((p): ProjectItem => {
    const worktrees = p.worktrees.map((w): WorktreeItem => {
      const sessions = app.panes
        .filter((x) => x.projectPath === p.path && x.worktreePath === w.path)
        .map((x) => {
          used.add(x.id)
          return toItem(x)
        })
      return { path: w.path, label: worktreeLabel(w), isMain: w.isMain, branch: w.git?.branch ?? w.branch, git: w.git, prunable: w.prunable, sessions }
    })
    const all = worktrees.flatMap((w) => w.sessions)
    const count = (s: SessionStatus) => all.filter((x) => x.status === s).length
    return {
      path: p.path,
      name: p.name,
      defaultAccountId: p.defaultAccountId,
      error: p.error,
      fetchError: p.fetchError,
      worktrees,
      summary: { working: count('working'), needsYou: count('needs-you'), idle: count('idle') },
    }
  })
  const outside = app.panes.filter((x) => !used.has(x.id)).map(toItem)
  return { projects, outside }
}
```

- [ ] **Step 6: Implementar `src/renderer/src/keys.ts`**

```ts
/** ESC + CR: o Claude Code interpreta como quebra de linha (igual ao Option+Enter) */
export const SHIFT_ENTER_SEQUENCE = '\x1b\r'

export type KeyDecision = 'send-shift-enter' | 'swallow' | 'xterm'

export function decideKey(e: { type: string; key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): KeyDecision {
  if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey) return e.type === 'keydown' ? 'send-shift-enter' : 'swallow'
  // ⌘ fica com o menu do app (⌘T, ⌘D, ⌘W, ⌘C, ⌘V…); o paste continua pelo evento nativo
  if (e.metaKey) return 'swallow'
  return 'xterm'
}
```

- [ ] **Step 7: Implementar `src/renderer/src/api.ts` e `src/renderer/src/store.ts`**

`api.ts`:
```ts
import type { GtApi } from '../../shared/bridge'

declare global {
  interface Window {
    gt: GtApi
  }
}

export function errorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
```

`store.ts`:
```ts
import { useSyncExternalStore } from 'react'
import type { AppState, Layout } from '../../shared/types'
import { errorMessage } from './api'

export interface UiState {
  app: AppState | null
  connected: boolean
  versionMismatch: { daemon: number; app: number } | null
  focusedPaneId: string | null
  newSession: { projectPath: string | null; worktreePath: string | null } | null
  error: string | null
}

let state: UiState = { app: null, connected: false, versionMismatch: null, focusedPaneId: null, newSession: null, error: null }
const subs = new Set<() => void>()

const subscribe = (cb: () => void) => {
  subs.add(cb)
  return () => subs.delete(cb)
}

export function getUi(): UiState {
  return state
}

export function setUi(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  for (const s of subs) s()
}

export function useUi<T>(sel: (s: UiState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state))
}

/** o renderer é a fonte do layout: aplica local e salva no daemon */
export function updateLayout(fn: (l: Layout) => Layout): void {
  const app = state.app
  if (!app) return
  const layout = fn(app.layout)
  if (layout === app.layout) return
  setUi({ app: { ...app, layout } })
  window.gt.send({ t: 'layout.save', layout })
}

export function showError(e: unknown): void {
  setUi({ error: errorMessage(e) })
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npx vitest run tests/renderer && npm run typecheck`
Expected: PASS e typecheck limpo.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: estado de UI e modelos puros do renderer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Renderer — terminais, splits, abas e atalhos

**Files:**
- Create: `src/renderer/src/terminals.ts`, `src/renderer/src/actions.ts`
- Create: `src/renderer/src/components/TerminalView.tsx`, `PaneHeader.tsx`, `PaneFrame.tsx`, `Workspace.tsx`
- Create: `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`
- Modify: `src/renderer/src/main.tsx`
- Test: manual (checklist no Step 9); a lógica pura já foi testada na Task 12.

**Interfaces:**
- Consumes: tudo da Task 12; `GtApi` (Task 11); protocolo (Task 1).
- Produces:
  - `terminals.ts`: `const terminals: { mount(paneId: string, container: HTMLElement): void; unmount(paneId: string, container: HTMLElement): void; fit(paneId: string): void; focus(paneId: string): void; onData(paneId: string, data: string): void; reattachAll(): void }`
  - `actions.ts`: `PANE_MIME = 'application/x-gt-pane'`; `activeTab(l: Layout): Tab | undefined`; `openNewPane(o: { cwd: string; accountId: string | null; resumeSessionId?: string; paneId?: string; dir?: 'row' | 'column' }): Promise<string>`; `placePane(paneId: string, dir: 'row' | 'column'): void`; `revealPane(paneId: string): void`; `hidePane(paneId: string): void`; `movePaneNextTo(dragged: string, target: string, dir: 'row' | 'column'): void`; `closeDeadPane(paneId: string): void`; `splitFocused(dir: 'row' | 'column'): void`; `addTab(): void`; `closeTab(tabId: string): void`; `renameTab(tabId: string, name: string): void`; `saveSizes(tabId: string, path: number[], sizes: number[]): void`; `openNewSessionDialog(projectPath?: string, worktreePath?: string): void`; `moveFocus(dir: Dir): void`; `runMenuAction(action: string): void`
  - Componentes: `<TerminalView paneId />`, `<PaneHeader pane />`, `<PaneFrame paneId />`, `<Workspace />`, `<App />`

**Anexar sem perder saída:** o `pane.attach` vai por `invoke` e o `pane.data` por outro canal de IPC, então a ordem entre eles no renderer não é garantida. Enquanto o attach não volta, os dados do painel ficam num buffer e são escritos **depois** do snapshot. O daemon só manda `pane.data` depois de registrar a assinatura, e o snapshot é exatamente o estado nesse instante (invariante da Task 3), então não há duplicação.

- [ ] **Step 1: `src/renderer/src/terminals.ts`**

```ts
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { decideKey, SHIFT_ENTER_SEQUENCE } from './keys'
import { setUi } from './store'

interface Entry {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
  state: 'idle' | 'attaching' | 'live'
  pending: string[]
  lastSize: string
}

const OPTIONS = {
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: 13,
  lineHeight: 1.2,
  scrollback: 10_000,
  cursorBlink: true,
  macOptionIsMeta: false, // ⌥ digita caracteres do layout (teclas mortas, ç, etc.)
  allowProposedApi: true,
  theme: { background: '#1e1e1e', foreground: '#cccccc', cursor: '#aeafad', selectionBackground: '#264f78' },
}

class TerminalRegistry {
  private entries = new Map<string, Entry>()

  mount(paneId: string, container: HTMLElement): void {
    const e = this.ensure(paneId)
    container.appendChild(e.el)
    requestAnimationFrame(() => {
      if (e.state === 'idle') void this.attach(paneId)
      else this.fit(paneId)
    })
  }

  unmount(paneId: string, container: HTMLElement): void {
    const e = this.entries.get(paneId)
    if (e && e.el.parentElement === container) container.removeChild(e.el)
  }

  fit(paneId: string): void {
    const e = this.entries.get(paneId)
    if (!e || e.state !== 'live' || !e.el.isConnected || e.el.clientWidth === 0) return
    e.fit.fit()
    const size = `${e.term.cols}x${e.term.rows}`
    if (size === e.lastSize) return
    e.lastSize = size
    window.gt.send({ t: 'pane.resize', paneId, cols: e.term.cols, rows: e.term.rows })
  }

  focus(paneId: string): void {
    this.entries.get(paneId)?.term.focus()
  }

  onData(paneId: string, data: string): void {
    const e = this.entries.get(paneId)
    if (!e) return
    if (e.state === 'live') e.term.write(data)
    else if (e.state === 'attaching') e.pending.push(data)
  }

  reattachAll(): void {
    for (const id of this.entries.keys()) void this.attach(id)
  }

  private ensure(paneId: string): Entry {
    const found = this.entries.get(paneId)
    if (found) return found
    const el = document.createElement('div')
    el.className = 'term-host'
    const term = new Terminal(OPTIONS)
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon((_ev, uri) => void window.gt.openExternal(uri)))
    term.open(el)
    term.attachCustomKeyEventHandler((ev) => {
      const d = decideKey(ev)
      if (d === 'send-shift-enter') window.gt.send({ t: 'pane.input', paneId, data: SHIFT_ENTER_SEQUENCE })
      return d === 'xterm'
    })
    term.onData((data) => window.gt.send({ t: 'pane.input', paneId, data }))
    term.textarea?.addEventListener('focus', () => setUi({ focusedPaneId: paneId }))
    const entry: Entry = { term, fit, el, state: 'idle', pending: [], lastSize: '' }
    this.entries.set(paneId, entry)
    return entry
  }

  private async attach(paneId: string): Promise<void> {
    const e = this.entries.get(paneId)
    if (!e) return
    e.state = 'attaching'
    e.pending = []
    const dims = e.el.isConnected && e.el.clientWidth > 0 ? e.fit.proposeDimensions() : undefined
    try {
      const { snapshot } = await window.gt.request<{ snapshot: string }>({ t: 'pane.attach', paneId, cols: dims?.cols, rows: dims?.rows })
      e.term.reset()
      if (dims?.cols && dims?.rows) e.term.resize(dims.cols, dims.rows)
      e.term.write(snapshot)
      for (const d of e.pending) e.term.write(d)
      e.pending = []
      e.state = 'live'
      e.lastSize = `${e.term.cols}x${e.term.rows}`
      this.fit(paneId)
    } catch {
      e.state = 'idle' // painel morreu ou daemon caiu; tenta de novo no próximo mount/reconnect
    }
  }
}

export const terminals = new TerminalRegistry()
```

- [ ] **Step 2: `src/renderer/src/actions.ts`**

```ts
import type { Layout, Tab } from '../../shared/types'
import { findTab, leaves, neighbor, removeLeaf, setSizes, splitLeaf, type Dir } from './layout'
import { getUi, setUi, showError, updateLayout } from './store'
import { terminals } from './terminals'

export const PANE_MIME = 'application/x-gt-pane'

export function activeTab(l: Layout): Tab | undefined {
  return l.tabs.find((t) => t.id === l.activeTabId)
}

const newTab = (n: number, root: Tab['root']): Tab => ({ id: crypto.randomUUID(), name: `Aba ${n}`, root })

export function placePane(paneId: string, dir: 'row' | 'column'): void {
  updateLayout((l) => {
    const owner = findTab(l, paneId)
    if (owner) return l.activeTabId === owner.id ? l : { ...l, activeTabId: owner.id }
    const tab = activeTab(l)
    if (!tab) {
      const t = newTab(l.tabs.length + 1, { type: 'leaf', paneId })
      return { tabs: [...l.tabs, t], activeTabId: t.id }
    }
    const inTab = leaves(tab.root)
    const focused = getUi().focusedPaneId
    const target = focused && inTab.includes(focused) ? focused : inTab[inTab.length - 1]
    const root = tab.root && target ? splitLeaf(tab.root, target, paneId, dir) : ({ type: 'leaf', paneId } as const)
    return { ...l, tabs: l.tabs.map((t) => (t.id === tab.id ? { ...t, root } : t)) }
  })
}

export function focusPane(paneId: string): void {
  setUi({ focusedPaneId: paneId })
  requestAnimationFrame(() => terminals.focus(paneId))
}

export async function openNewPane(o: {
  cwd: string
  accountId: string | null
  resumeSessionId?: string
  paneId?: string
  dir?: 'row' | 'column'
}): Promise<string> {
  const paneId = o.paneId ?? crypto.randomUUID()
  await window.gt.request({ t: 'pane.create', paneId, cwd: o.cwd, accountId: o.accountId, resumeSessionId: o.resumeSessionId, cols: 100, rows: 30 })
  placePane(paneId, o.dir ?? 'row')
  focusPane(paneId)
  return paneId
}

export function revealPane(paneId: string): void {
  placePane(paneId, 'row')
  focusPane(paneId)
}

export function hidePane(paneId: string): void {
  updateLayout((l) => ({ ...l, tabs: l.tabs.map((t) => ({ ...t, root: t.root ? removeLeaf(t.root, paneId) : null })) }))
  if (getUi().focusedPaneId === paneId) setUi({ focusedPaneId: null })
}

export function movePaneNextTo(dragged: string, target: string, dir: 'row' | 'column'): void {
  if (dragged === target) return
  updateLayout((l) => {
    const tabs = l.tabs.map((t) => ({ ...t, root: t.root ? removeLeaf(t.root, dragged) : null }))
    const tab = tabs.find((t) => leaves(t.root).includes(target))
    if (!tab || !tab.root) return l
    const root = splitLeaf(tab.root, target, dragged, dir)
    return { tabs: tabs.map((t) => (t.id === tab.id ? { ...t, root } : t)), activeTabId: tab.id }
  })
  focusPane(dragged)
}

export function closeDeadPane(paneId: string): void {
  hidePane(paneId)
  window.gt.send({ t: 'pane.forget', paneId })
  window.gt.send({ t: 'resume.dismiss', paneId })
}

export function splitFocused(dir: 'row' | 'column'): void {
  const ui = getUi()
  const p = ui.app?.panes.find((x) => x.id === ui.focusedPaneId)
  const cwd = p?.worktreePath ?? p?.cwd ?? ui.app?.userHome
  if (!cwd) return
  openNewPane({ cwd, accountId: null, dir }).catch(showError)
}

export function addTab(): void {
  updateLayout((l) => {
    const t = newTab(l.tabs.length + 1, null)
    return { tabs: [...l.tabs, t], activeTabId: t.id }
  })
}

export function closeTab(tabId: string): void {
  updateLayout((l) => {
    const tabs = l.tabs.filter((t) => t.id !== tabId)
    const activeTabId = l.activeTabId === tabId ? (tabs[tabs.length - 1]?.id ?? null) : l.activeTabId
    return { tabs, activeTabId }
  })
}

export function renameTab(tabId: string, name: string): void {
  const clean = name.trim()
  if (!clean) return
  updateLayout((l) => ({ ...l, tabs: l.tabs.map((t) => (t.id === tabId ? { ...t, name: clean } : t)) }))
}

const sizeTimers = new Map<string, ReturnType<typeof setTimeout>>()
export function saveSizes(tabId: string, path: number[], sizes: number[]): void {
  const key = `${tabId}:${path.join('.')}`
  clearTimeout(sizeTimers.get(key))
  sizeTimers.set(
    key,
    setTimeout(() => {
      updateLayout((l) => ({ ...l, tabs: l.tabs.map((t) => (t.id === tabId && t.root ? { ...t, root: setSizes(t.root, path, sizes) } : t)) }))
    }, 400),
  )
}

export function openNewSessionDialog(projectPath?: string, worktreePath?: string): void {
  const ui = getUi()
  const p = ui.app?.panes.find((x) => x.id === ui.focusedPaneId)
  setUi({ newSession: { projectPath: projectPath ?? p?.projectPath ?? null, worktreePath: worktreePath ?? p?.worktreePath ?? null } })
}

export function moveFocus(dir: Dir): void {
  const rects = [...document.querySelectorAll<HTMLElement>('[data-pane-id]')].map((el) => {
    const r = el.getBoundingClientRect()
    return { id: el.dataset.paneId!, x: r.left, y: r.top, w: r.width, h: r.height }
  })
  const next = neighbor(rects, getUi().focusedPaneId, dir)
  if (next) focusPane(next)
}

export function runMenuAction(action: string): void {
  if (action === 'new-session') openNewSessionDialog()
  else if (action === 'split-right') splitFocused('row')
  else if (action === 'split-down') splitFocused('column')
  else if (action === 'hide-pane') {
    const id = getUi().focusedPaneId
    if (id) hidePane(id)
  } else if (action === 'new-tab') addTab()
  else if (action.startsWith('tab-')) {
    const n = Number(action.slice(4))
    updateLayout((l) => (l.tabs[n - 1] ? { ...l, activeTabId: l.tabs[n - 1].id } : l))
  } else if (action.startsWith('focus-')) moveFocus(action.slice(6) as Dir)
}
```

- [ ] **Step 3: `src/renderer/src/components/TerminalView.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { terminals } from '../terminals'

export function TerminalView({ paneId }: { paneId: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current!
    terminals.mount(paneId, el)
    const ro = new ResizeObserver(() => terminals.fit(paneId))
    ro.observe(el)
    return () => {
      ro.disconnect()
      terminals.unmount(paneId, el)
    }
  }, [paneId])
  return <div className="term-container" ref={ref} />
}
```

- [ ] **Step 4: `src/renderer/src/components/PaneHeader.tsx`**

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PaneView } from '../../../shared/types'
import { hidePane, PANE_MIME } from '../actions'
import { headerView } from '../header'
import { useUi } from '../store'

export const STATUS_DOT = { working: '🟢', 'needs-you': '🟡', idle: '⚪', shell: '' } as const

export function PaneHeader({ pane }: { pane: PaneView }) {
  const projects = useUi((s) => s.app!.projects)
  const accounts = useUi((s) => s.app!.accounts)
  const userHome = useUi((s) => s.app!.userHome)
  const h = useMemo(() => headerView(pane, { projects, accounts, userHome }), [pane, projects, accounts, userHome])

  const [flash, setFlash] = useState(false)
  const prev = useRef(pane.worktreePath)
  useEffect(() => {
    if (prev.current === pane.worktreePath) return
    prev.current = pane.worktreePath
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 1200)
    return () => clearTimeout(t)
  }, [pane.worktreePath])

  return (
    <div
      className={`pane-header${h.isMainWorktree ? '' : ' in-worktree'}${flash ? ' flash' : ''}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData(PANE_MIME, pane.id)}
    >
      <span className="ph-project">{h.project}</span>
      <span className="ph-worktree">⎇ {h.worktree}</span>
      {h.branch && <span className="ph-branch">{h.branch}</span>}
      <span className={h.changed ? 'ph-changed dirty' : 'ph-changed'}>●{h.changed}</span>
      <span className="ph-sync" title={h.hasUpstream ? '' : 'branch sem upstream'}>
        ↑{h.ahead} ↓{h.behind}
      </span>
      {h.warning && (
        <span className="ph-warn" title={h.warning}>
          ⚠
        </span>
      )}
      <span className="ph-spacer" />
      {h.status !== 'shell' && <span className="ph-status">{STATUS_DOT[h.status]}</span>}
      {h.account && (
        <span className="ph-account" style={{ color: h.account.color }}>
          {h.account.label}
        </span>
      )}
      <button className="ph-close" title="Esconder painel (a sessão continua rodando)" onClick={() => hidePane(pane.id)}>
        ✕
      </button>
    </div>
  )
}
```

- [ ] **Step 5: `src/renderer/src/components/PaneFrame.tsx`**

```tsx
import type React from 'react'
import { closeDeadPane, movePaneNextTo, openNewPane, PANE_MIME } from '../actions'
import { setUi, showError, useUi } from '../store'
import { PaneHeader } from './PaneHeader'
import { TerminalView } from './TerminalView'

export function PaneFrame({ paneId }: { paneId: string }) {
  const pane = useUi((s) => s.app?.panes.find((p) => p.id === paneId))
  const focused = useUi((s) => s.focusedPaneId === paneId)
  const resumable = useUi((s) => s.app?.resumable.find((r) => r.paneId === paneId))

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const dragged = e.dataTransfer.getData(PANE_MIME)
    if (!dragged || dragged === paneId) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const relX = (e.clientX - r.left) / r.width
    const relY = (e.clientY - r.top) / r.height
    movePaneNextTo(dragged, paneId, relX > relY ? 'row' : 'column')
  }

  const resume = () => {
    if (!resumable) return
    openNewPane({ paneId, cwd: resumable.cwd, accountId: resumable.accountId, resumeSessionId: resumable.sessionId ?? undefined }).catch(showError)
  }

  return (
    <div
      className={`pane${focused ? ' focused' : ''}`}
      data-pane-id={paneId}
      onMouseDown={() => setUi({ focusedPaneId: paneId })}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PANE_MIME)) e.preventDefault()
      }}
      onDrop={onDrop}
    >
      {pane && <PaneHeader pane={pane} />}
      {pane?.alive ? (
        <TerminalView paneId={paneId} />
      ) : (
        <div className="pane-dead">
          <p>
            {resumable
              ? 'Sessão da execução anterior do daemon.'
              : pane
                ? `Terminal encerrado${pane.exitCode !== null ? ` (código ${pane.exitCode})` : ''}.`
                : 'Painel indisponível.'}
          </p>
          <div className="pane-dead-actions">
            {resumable && (
              <button className="primary" onClick={resume}>
                {resumable.sessionId ? 'Retomar sessão do Claude' : 'Reabrir terminal'}
              </button>
            )}
            <button onClick={() => closeDeadPane(paneId)}>Fechar</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: `src/renderer/src/components/Workspace.tsx`**

```tsx
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import { useState } from 'react'
import type { Layout, LayoutNode } from '../../../shared/types'
import { addTab, closeTab, renameTab, saveSizes } from '../actions'
import { leaves } from '../layout'
import { updateLayout, useUi } from '../store'
import { PaneFrame } from './PaneFrame'

const nodeKey = (n: LayoutNode): string => (n.type === 'leaf' ? n.paneId : `split:${leaves(n).join(',')}`)

function SplitNode({ node, tabId, path }: { node: LayoutNode; tabId: string; path: number[] }) {
  if (node.type === 'leaf') return <PaneFrame paneId={node.paneId} />
  return (
    <Allotment
      vertical={node.dir === 'column'}
      defaultSizes={node.sizes.length === node.children.length ? node.sizes : undefined}
      onChange={(sizes) => saveSizes(tabId, path, sizes)}
    >
      {node.children.map((c, i) => (
        <Allotment.Pane key={nodeKey(c)} minSize={120}>
          <SplitNode node={c} tabId={tabId} path={[...path, i]} />
        </Allotment.Pane>
      ))}
    </Allotment>
  )
}

function TabBar({ layout }: { layout: Layout }) {
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <div className="tabbar">
      {layout.tabs.map((t) => (
        <div
          key={t.id}
          className={`tab${t.id === layout.activeTabId ? ' active' : ''}`}
          onClick={() => updateLayout((l) => ({ ...l, activeTabId: t.id }))}
          onDoubleClick={() => setEditing(t.id)}
        >
          {editing === t.id ? (
            <input
              autoFocus
              defaultValue={t.name}
              onBlur={(e) => {
                renameTab(t.id, e.target.value)
                setEditing(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditing(null)
              }}
            />
          ) : (
            <span>{t.name}</span>
          )}
          <button
            className="tab-close"
            title="Fechar aba (as sessões continuam rodando)"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button className="tab-add" title="Nova aba (⇧⌘T)" onClick={addTab}>
        +
      </button>
    </div>
  )
}

export function Workspace() {
  const layout = useUi((s) => s.app?.layout)
  if (!layout) return null
  const tab = layout.tabs.find((t) => t.id === layout.activeTabId)
  return (
    <div className="workspace">
      <TabBar layout={layout} />
      <div className="tab-body">
        {tab?.root ? (
          <SplitNode key={tab.id} node={tab.root} tabId={tab.id} path={[]} />
        ) : (
          <div className="empty">Nenhum painel aqui. ⌘T abre uma nova sessão; ⌘D abre um terminal.</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 7: `src/renderer/src/App.tsx`, `main.tsx` e `styles.css`**

`App.tsx` (a sidebar, o diálogo e os banners entram na Task 14):
```tsx
import { Workspace } from './components/Workspace'
import { useUi } from './store'

export function App() {
  const ready = useUi((s) => s.app !== null)
  if (!ready) return <div className="loading">Conectando ao daemon…</div>
  return (
    <div className="app">
      <main className="main">
        <Workspace />
      </main>
    </div>
  )
}
```

`main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import type { AppState } from '../../shared/types'
import { runMenuAction } from './actions'
import { App } from './App'
import { setUi, showError } from './store'
import { terminals } from './terminals'
import './styles.css'

window.gt.onEvent((e) => {
  switch (e.t) {
    case 'state':
      // depois do primeiro carregamento o layout é do renderer (evita "voltar" com broadcast atrasado)
      setUi((s) => ({ app: s.app ? { ...e.state, layout: s.app.layout } : e.state, connected: true }))
      break
    case 'pane.data':
      terminals.onData(e.paneId, e.data)
      break
    case 'disconnected':
      setUi({ connected: false })
      break
    case 'reconnected':
      setUi({ connected: true })
      terminals.reattachAll()
      break
    case 'version-mismatch':
      setUi({ versionMismatch: { daemon: e.daemon, app: e.app } })
      break
  }
})
window.gt.onMenu(runMenuAction)
window.gt
  .request<AppState>({ t: 'state.get' })
  .then((app) => setUi((s) => ({ app: s.app ?? app, connected: true })))
  .catch(showError)

createRoot(document.getElementById('root')!).render(<App />)
```

`styles.css`:
```css
:root {
  --bg: #1e1e1e;
  --bg-side: #181818;
  --bg-bar: #252526;
  --border: #2b2b2b;
  --fg: #cccccc;
  --fg-dim: #8b8b8b;
  --accent: #0078d4;
  --worktree: #d7ba7d;
  --warn: #cca700;
  --error: #f14c4c;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  color: var(--fg);
}
* { box-sizing: border-box; }
html, body, #root { margin: 0; height: 100%; background: var(--bg); overflow: hidden; }
button { font: inherit; color: var(--fg); background: #3a3d41; border: 0; border-radius: 3px; padding: 3px 8px; cursor: pointer; }
button:hover { background: #45494e; }
button.primary { background: var(--accent); color: #fff; }
.loading, .empty { display: grid; place-items: center; height: 100%; color: var(--fg-dim); }

.app { display: flex; height: 100%; }
.main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.workspace { flex: 1; min-height: 0; display: flex; flex-direction: column; }

.tabbar { display: flex; align-items: stretch; background: var(--bg-bar); border-bottom: 1px solid var(--border); height: 32px; }
.tab { display: flex; align-items: center; gap: 6px; padding: 0 10px; border-right: 1px solid var(--border); color: var(--fg-dim); cursor: pointer; }
.tab.active { background: var(--bg); color: var(--fg); }
.tab input { width: 120px; background: #3c3c3c; color: var(--fg); border: 1px solid var(--accent); }
.tab-close, .tab-add { background: none; padding: 0 4px; color: var(--fg-dim); }
.tab-body { flex: 1; min-height: 0; position: relative; }

.pane { display: flex; flex-direction: column; height: 100%; border: 1px solid transparent; }
.pane.focused { border-color: var(--accent); }
.pane-header { display: flex; align-items: center; gap: 10px; height: 26px; padding: 0 8px; background: var(--bg-bar); border-bottom: 1px solid var(--border); white-space: nowrap; overflow: hidden; cursor: grab; font-size: 12px; }
.pane-header.in-worktree { background: #3a3220; }
.pane-header.in-worktree .ph-worktree { color: var(--worktree); font-weight: 600; }
.pane-header.flash { animation: flash 1.2s ease-out; }
@keyframes flash { from { background: #7a5f1c; } }
.ph-project { font-weight: 600; }
.ph-worktree, .ph-branch, .ph-sync { color: var(--fg-dim); }
.ph-changed.dirty { color: var(--warn); }
.ph-warn { color: var(--warn); }
.ph-spacer { flex: 1; }
.ph-close { background: none; color: var(--fg-dim); padding: 0 4px; }
.term-container { flex: 1; min-height: 0; padding: 4px 0 0 6px; }
.term-host { width: 100%; height: 100%; }
.pane-dead { flex: 1; display: grid; place-content: center; gap: 10px; color: var(--fg-dim); text-align: center; }
.pane-dead-actions { display: flex; gap: 8px; justify-content: center; }
```

- [ ] **Step 8: Typecheck e testes**

Run: `npm run typecheck && npm test`
Expected: tudo verde.

- [ ] **Step 9: Verificação manual**

Run: `GT_HOME=/tmp/gt-ui npm run dev`
1. Janela abre com "Nenhum painel aqui". ⌘D → terminal no `~`. Digite `ls` e Enter: saída aparece.
2. ⌘D e ⇧⌘D → painéis dividem à direita/abaixo; arraste as bordas; ⌥⌘+setas movem o foco (borda azul).
3. ⌘W esconde o painel focado; ⇧⌘T cria aba; ⌘1/⌘2 trocam; duplo clique renomeia a aba.
4. Arraste o cabeçalho de um painel para outro: ele se reposiciona.
5. No terminal, digite `echo não ação você à pôr ~/pasta` usando as teclas mortas do teclado Brasileiro - Pro: o texto aparece idêntico.
6. Rode `claude` num painel: Shift+Enter quebra linha no prompt sem enviar.
7. Feche a janela (⌘Q → "Sair") e rode `npm run dev` de novo: os painéis voltam com o conteúdo e o scroll anterior.
Anote qualquer falha e corrija antes do commit. Para limpar: "Encerrar tudo" no menu e `rm -rf /tmp/gt-ui`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: terminais xterm, splits livres, abas e atalhos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Renderer — sidebar, nova sessão, banners e fluxos de worktree

**Files:**
- Create: `src/renderer/src/flows.ts`
- Create: `src/renderer/src/components/Sidebar.tsx`, `NewSessionDialog.tsx`, `Banners.tsx`
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/styles.css` (acrescentar)
- Test: manual (Step 7); `RemoveCheck` e as regras de remoção já são testadas na Task 10.

**Interfaces:**
- Consumes: `actions.ts`, `store.ts`, `sidebar-model.ts`, `header.ts` (Tasks 12–13); `RemoveCheck`, `ResumeEntry` (Task 1); `GtApi` (Task 11).
- Produces:
  - `flows.ts`: `addProjectFlow(dir?: string): Promise<void>`; `removeWorktreeFlow(path: string): Promise<void>`; `worktreeMenu(p: ProjectItem, w: WorktreeItem): Promise<void>`; `projectMenu(p: ProjectItem): Promise<void>`; `sessionMenu(s: SessionItem): Promise<void>`; `resumeAll(): Promise<void>`; `dismissAllResumable(): void`; `restartDaemonFlow(): Promise<void>`
  - Componentes: `<Sidebar />`, `<NewSessionDialog />`, `<Banners />`

- [ ] **Step 1: `src/renderer/src/flows.ts`**

```ts
import type { RemoveCheck } from '../../shared/types'
import { closeDeadPane, hidePane, openNewPane, openNewSessionDialog, revealPane } from './actions'
import type { ProjectItem, SessionItem, WorktreeItem } from './sidebar-model'
import { getUi, setUi, showError } from './store'

export async function addProjectFlow(dir?: string): Promise<void> {
  try {
    const path = dir ?? (await window.gt.pickFolder())
    if (!path) return
    await window.gt.request({ t: 'project.add', path })
  } catch (e) {
    showError(e)
  }
}

export async function removeWorktreeFlow(path: string): Promise<void> {
  try {
    const c = await window.gt.request<RemoveCheck>({ t: 'worktree.checkRemove', path })
    if (c.isMain) return void (await window.gt.alert('A worktree principal não pode ser removida.'))
    if (c.hasOpenSession) {
      return void (await window.gt.alert('Esta worktree tem sessões abertas.', 'Encerre as sessões dela antes de remover.'))
    }
    const risky = c.dirtyFiles.length > 0 || c.unpushedCommits.length > 0
    const detail =
      [
        c.dirtyFiles.length ? `Alterações não commitadas (${c.dirtyFiles.length}):\n${c.dirtyFiles.slice(0, 15).join('\n')}` : '',
        c.unpushedCommits.length
          ? `Commits que não estão em nenhum remoto nem na branch principal (${c.unpushedCommits.length}):\n${c.unpushedCommits.join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n') || 'Nenhuma alteração pendente.'
    const r = await window.gt.confirm({
      message: risky ? `Remover ${c.path}? O trabalho listado abaixo será PERDIDO.` : `Remover a worktree ${c.path}?`,
      detail,
      confirmLabel: risky ? 'Remover mesmo assim' : 'Remover',
      checkboxLabel: c.branch ? `Apagar também a branch ${c.branch}` : undefined,
    })
    if (!r.ok) return
    await window.gt.request({ t: 'worktree.remove', path, force: risky, deleteBranch: r.checked })
  } catch (e) {
    showError(e)
  }
}

export async function worktreeMenu(p: ProjectItem, w: WorktreeItem): Promise<void> {
  const choice = await window.gt.contextMenu([
    { id: 'new', label: 'Nova sessão…' },
    { id: 'shell', label: 'Terminal comum' },
    { id: '-', label: '' },
    { id: 'finder', label: 'Abrir no Finder' },
    { id: 'remove', label: 'Remover worktree…', enabled: !w.isMain },
  ])
  if (choice === 'new') openNewSessionDialog(p.path, w.path)
  else if (choice === 'shell') openNewPane({ cwd: w.path, accountId: null }).catch(showError)
  else if (choice === 'finder') void window.gt.openPath(w.path)
  else if (choice === 'remove') await removeWorktreeFlow(w.path)
}

export async function projectMenu(p: ProjectItem): Promise<void> {
  const accounts = getUi().app?.accounts ?? []
  const mark = (on: boolean) => (on ? '✓ ' : '    ')
  const choice = await window.gt.contextMenu([
    ...accounts.map((a) => ({ id: `acct:${a.id}`, label: `${mark(p.defaultAccountId === a.id)}Conta padrão: ${a.label}` })),
    { id: 'acct:', label: `${mark(p.defaultAccountId === null)}Sem conta padrão` },
    { id: '-', label: '' },
    { id: 'remove', label: 'Remover projeto da lista' },
  ])
  if (!choice) return
  try {
    if (choice.startsWith('acct:')) {
      await window.gt.request({ t: 'project.setAccount', path: p.path, accountId: choice.slice(5) || null })
    } else if (choice === 'remove') {
      const r = await window.gt.confirm({ message: `Remover ${p.name} da lista?`, detail: 'Nada é apagado do disco; as sessões abertas continuam.', confirmLabel: 'Remover' })
      if (r.ok) await window.gt.request({ t: 'project.remove', path: p.path })
    }
  } catch (e) {
    showError(e)
  }
}

export async function sessionMenu(s: SessionItem): Promise<void> {
  const choice = await window.gt.contextMenu([
    { id: 'show', label: 'Mostrar' },
    { id: 'hide', label: 'Esconder' },
    { id: '-', label: '' },
    s.alive ? { id: 'kill', label: 'Encerrar sessão…' } : { id: 'forget', label: 'Remover da lista' },
  ])
  if (choice === 'show') revealPane(s.paneId)
  else if (choice === 'hide') hidePane(s.paneId)
  else if (choice === 'forget') closeDeadPane(s.paneId)
  else if (choice === 'kill') {
    const r =
      s.status === 'working'
        ? await window.gt.confirm({ message: 'O Claude está trabalhando nesta sessão. Encerrar mesmo assim?', confirmLabel: 'Encerrar' })
        : await window.gt.confirm({ message: `Encerrar "${s.label}"?`, confirmLabel: 'Encerrar' })
    if (r.ok) window.gt.send({ t: 'pane.kill', paneId: s.paneId })
  }
}

export async function resumeAll(): Promise<void> {
  for (const r of getUi().app?.resumable ?? []) {
    try {
      await openNewPane({ paneId: r.paneId, cwd: r.cwd, accountId: r.accountId, resumeSessionId: r.sessionId ?? undefined })
    } catch (e) {
      showError(e)
    }
  }
}

export function dismissAllResumable(): void {
  for (const r of getUi().app?.resumable ?? []) {
    hidePane(r.paneId)
    window.gt.send({ t: 'resume.dismiss', paneId: r.paneId })
  }
}

export async function restartDaemonFlow(): Promise<void> {
  const r = await window.gt.confirm({
    message: 'Reiniciar o daemon?',
    detail: 'Todas as sessões em execução serão finalizadas. Elas poderão ser retomadas em seguida.',
    confirmLabel: 'Reiniciar',
  })
  if (!r.ok) return
  setUi({ versionMismatch: null })
  await window.gt.restartDaemon()
}
```

- [ ] **Step 2: `src/renderer/src/components/Sidebar.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { openNewSessionDialog, PANE_MIME, revealPane } from '../actions'
import { addProjectFlow, projectMenu, sessionMenu, worktreeMenu } from '../flows'
import { buildSidebar, type ProjectItem, type SessionItem } from '../sidebar-model'
import { useUi } from '../store'
import { STATUS_DOT } from './PaneHeader'

function Summary({ s }: { s: ProjectItem['summary'] }) {
  return (
    <span className="sb-summary">
      {s.needsYou > 0 && `🟡${s.needsYou} `}
      {s.working > 0 && `🟢${s.working} `}
      {s.idle > 0 && `⚪${s.idle}`}
    </span>
  )
}

function SessionRow({ s, outside }: { s: SessionItem; outside?: boolean }) {
  const focused = useUi((st) => st.focusedPaneId === s.paneId)
  return (
    <div
      className={`sb-session${focused ? ' focused' : ''}${s.alive ? '' : ' dead'}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData(PANE_MIME, s.paneId)}
      onClick={() => revealPane(s.paneId)}
      onContextMenu={(e) => {
        e.preventDefault()
        void sessionMenu(s)
      }}
      title={s.cwd}
    >
      <span className="dot">{STATUS_DOT[s.status] || '›'}</span>
      <span className="sb-label">{s.label}</span>
      {outside && (
        <button
          className="sb-mini"
          onClick={(e) => {
            e.stopPropagation()
            void addProjectFlow(s.cwd)
          }}
        >
          adicionar projeto
        </button>
      )}
    </div>
  )
}

export function Sidebar() {
  const app = useUi((s) => s.app)
  const model = useMemo(() => (app ? buildSidebar(app) : null), [app])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  if (!model) return <aside className="sidebar" />
  return (
    <aside className="sidebar">
      <div className="sb-title">
        <span>PROJETOS</span>
        <button className="sb-mini" title="Adicionar projeto" onClick={() => void addProjectFlow()}>
          ＋
        </button>
      </div>
      {model.projects.length === 0 && <div className="sb-empty">Adicione a pasta de um repositório git.</div>}
      {model.projects.map((p) => (
        <div key={p.path} className="sb-project">
          <div
            className="sb-project-row"
            onClick={() => setCollapsed((c) => ({ ...c, [p.path]: !c[p.path] }))}
            onContextMenu={(e) => {
              e.preventDefault()
              void projectMenu(p)
            }}
            title={p.path}
          >
            <span className="sb-caret">{collapsed[p.path] ? '▸' : '▾'}</span>
            <span className="sb-name">{p.name}</span>
            {collapsed[p.path] && <Summary s={p.summary} />}
            {(p.error || p.fetchError) && (
              <span className="ph-warn" title={p.error ?? p.fetchError ?? ''}>
                ⚠
              </span>
            )}
          </div>
          {!collapsed[p.path] &&
            p.worktrees.map((w) => (
              <div key={w.path} className="sb-worktree">
                <div
                  className="sb-wt-row"
                  title={w.path}
                  onDoubleClick={() => openNewSessionDialog(p.path, w.path)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    void worktreeMenu(p, w)
                  }}
                >
                  <span className={w.isMain ? 'sb-wt-name' : 'sb-wt-name wt'}>{w.isMain ? 'principal' : `⎇ ${w.label}`}</span>
                  <span className="sb-branch">{w.prunable ? 'pasta apagada' : (w.branch ?? 'detached')}</span>
                  {w.git && (
                    <span className="sb-git">
                      {w.git.changed > 0 && <span className="dirty">●{w.git.changed} </span>}
                      {w.git.ahead > 0 && `↑${w.git.ahead} `}
                      {w.git.behind > 0 && `↓${w.git.behind}`}
                    </span>
                  )}
                </div>
                {w.sessions.length === 0 ? (
                  <div className="sb-empty">(sem sessão)</div>
                ) : (
                  w.sessions.map((s) => <SessionRow key={s.paneId} s={s} />)
                )}
              </div>
            ))}
        </div>
      ))}
      {model.outside.length > 0 && (
        <div className="sb-project">
          <div className="sb-project-row">
            <span className="sb-name">Fora de projeto</span>
          </div>
          {model.outside.map((s) => (
            <SessionRow key={s.paneId} s={s} outside />
          ))}
        </div>
      )}
    </aside>
  )
}
```

- [ ] **Step 3: `src/renderer/src/components/NewSessionDialog.tsx`**

```tsx
import { useEffect, useState } from 'react'
import type { AppState } from '../../../shared/types'
import { openNewPane } from '../actions'
import { worktreeLabel } from '../header'
import { setUi, showError, useUi } from '../store'

const SHELL = '__shell__'

function defaults(app: AppState, projectPath: string | null, worktreePath: string | null) {
  const project = app.projects.find((p) => p.path === projectPath) ?? app.projects[0]
  const wt = project?.worktrees.find((w) => w.path === worktreePath) ?? project?.worktrees[0]
  const accountId = project?.defaultAccountId ?? app.accounts.find((a) => a.isDefault)?.id ?? SHELL
  return { projectPath: project?.path ?? '', worktreePath: wt?.path ?? '', accountId }
}

export function NewSessionDialog() {
  const req = useUi((s) => s.newSession)
  const app = useUi((s) => s.app)
  const [form, setForm] = useState({ projectPath: '', worktreePath: '', accountId: SHELL })

  useEffect(() => {
    if (req && app) setForm(defaults(app, req.projectPath, req.worktreePath))
    // só ao abrir o diálogo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req])

  if (!req || !app) return null
  const close = () => setUi({ newSession: null })
  const project = app.projects.find((p) => p.path === form.projectPath)
  const submit = () => {
    if (!form.worktreePath) return
    close()
    openNewPane({ cwd: form.worktreePath, accountId: form.accountId === SHELL ? null : form.accountId }).catch(showError)
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter') submit()
        }}
      >
        <h3>Nova sessão</h3>
        {app.projects.length === 0 ? (
          <p>Adicione um projeto na barra lateral primeiro.</p>
        ) : (
          <>
            <label>
              Projeto
              <select value={form.projectPath} onChange={(e) => setForm(defaults(app, e.target.value, null))}>
                {app.projects.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Worktree
              <select value={form.worktreePath} onChange={(e) => setForm({ ...form, worktreePath: e.target.value })}>
                {project?.worktrees
                  .filter((w) => !w.prunable)
                  .map((w) => (
                    <option key={w.path} value={w.path}>
                      {worktreeLabel(w)}
                      {w.branch ? ` — ${w.branch}` : ''}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Conta
              <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                {app.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} ({a.command})
                  </option>
                ))}
                <option value={SHELL}>Terminal comum (sem Claude)</option>
              </select>
            </label>
          </>
        )}
        <div className="modal-actions">
          <button onClick={close}>Cancelar</button>
          <button className="primary" autoFocus disabled={!form.worktreePath} onClick={submit}>
            Abrir
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: `src/renderer/src/components/Banners.tsx`**

```tsx
import { dismissAllResumable, restartDaemonFlow, resumeAll } from '../flows'
import { setUi, showError, useUi } from '../store'

export function Banners() {
  const connected = useUi((s) => s.connected)
  const vm = useUi((s) => s.versionMismatch)
  const warnings = useUi((s) => s.app?.hookWarnings)
  const resumable = useUi((s) => s.app?.resumable)
  const error = useUi((s) => s.error)
  return (
    <div className="banners">
      {!connected && <div className="banner warn">Reconectando ao daemon…</div>}
      {vm && (
        <div className="banner warn">
          O daemon em execução é de outra versão (daemon v{vm.daemon}, app v{vm.app}).{' '}
          <button onClick={() => void restartDaemonFlow()}>Reiniciar daemon…</button>
        </div>
      )}
      {warnings && warnings.length > 0 && (
        <div className="banner warn">
          Os hooks do app não estão instalados em: {warnings.join(', ')}. Sem eles o app não vê a worktree nem o estado do Claude.{' '}
          <button onClick={() => window.gt.request({ t: 'hooks.install' }).catch(showError)}>Instalar hooks</button>
        </div>
      )}
      {resumable && resumable.length > 0 && (
        <div className="banner">
          {resumable.length === 1 ? '1 sessão' : `${resumable.length} sessões`} da execução anterior podem ser retomadas.{' '}
          <button className="primary" onClick={() => void resumeAll()}>
            Retomar todas
          </button>{' '}
          <button onClick={dismissAllResumable}>Descartar</button>
        </div>
      )}
      {error && (
        <div className="banner error">
          {error} <button onClick={() => setUi({ error: null })}>OK</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Atualizar `src/renderer/src/App.tsx`**

```tsx
import { Banners } from './components/Banners'
import { NewSessionDialog } from './components/NewSessionDialog'
import { Sidebar } from './components/Sidebar'
import { Workspace } from './components/Workspace'
import { useUi } from './store'

export function App() {
  const ready = useUi((s) => s.app !== null)
  if (!ready) return <div className="loading">Conectando ao daemon…</div>
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Banners />
        <Workspace />
      </main>
      <NewSessionDialog />
    </div>
  )
}
```

- [ ] **Step 6: Acrescentar ao `src/renderer/src/styles.css`**

```css
.sidebar { width: 260px; flex-shrink: 0; background: var(--bg-side); border-right: 1px solid var(--border); overflow-y: auto; padding-bottom: 12px; user-select: none; }
.sb-title { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; font-size: 11px; letter-spacing: 0.06em; color: var(--fg-dim); }
.sb-mini { background: none; color: var(--fg-dim); padding: 0 4px; font-size: 11px; }
.sb-mini:hover { color: var(--fg); }
.sb-project-row { display: flex; align-items: center; gap: 6px; padding: 4px 8px; cursor: pointer; font-weight: 600; }
.sb-project-row:hover, .sb-wt-row:hover, .sb-session:hover { background: #2a2d2e; }
.sb-caret { width: 10px; color: var(--fg-dim); }
.sb-summary { margin-left: auto; font-weight: 400; font-size: 11px; }
.sb-wt-row { display: flex; align-items: center; gap: 6px; padding: 3px 8px 3px 24px; cursor: default; }
.sb-wt-name.wt { color: var(--worktree); }
.sb-branch { color: var(--fg-dim); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-git { margin-left: auto; font-size: 11px; color: var(--fg-dim); white-space: nowrap; }
.sb-git .dirty { color: var(--warn); }
.sb-session { display: flex; align-items: center; gap: 6px; padding: 3px 8px 3px 40px; cursor: pointer; }
.sb-session.focused { background: #04395e; }
.sb-session.dead { color: var(--fg-dim); font-style: italic; }
.sb-session .dot { width: 16px; text-align: center; font-size: 10px; }
.sb-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sb-empty { padding: 2px 8px 4px 40px; color: var(--fg-dim); font-size: 11px; }

.banners { display: flex; flex-direction: column; }
.banner { padding: 6px 10px; background: #1f3a53; border-bottom: 1px solid var(--border); }
.banner.warn { background: #4b3d10; }
.banner.error { background: #5a1d1d; }

.modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); display: grid; place-items: center; z-index: 10; }
.modal { width: 420px; background: var(--bg-bar); border: 1px solid var(--border); border-radius: 6px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.modal h3 { margin: 0 0 4px; font-size: 14px; }
.modal label { display: flex; flex-direction: column; gap: 4px; color: var(--fg-dim); font-size: 12px; }
.modal select { background: #3c3c3c; color: var(--fg); border: 1px solid #555; border-radius: 3px; padding: 4px; font: inherit; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
```

- [ ] **Step 7: Verificação manual com o Claude de verdade**

Run: `npm run typecheck && npm test && GT_HOME=/tmp/gt-ui npm run dev`

> Com `GT_HOME=/tmp/gt-ui` o app ainda instala os hooks no `~/.claude/settings.json` **real** (o hook aponta para `/tmp/gt-ui/bin/gt-hook`). Ao terminar os testes, rode `npm run dev` sem `GT_HOME` e clique em "Instalar hooks" de novo: a instalação substitui a entrada antiga (o marcador `gt-hook` identifica a versão anterior).

1. Banner "hooks não instalados" aparece → "Instalar hooks" → banner some; `~/.claude/settings.json` mantém o hook do RTK e tem as entradas novas; existe um `settings.json.bak-gt-*` ao lado.
2. ＋ → escolha este repositório. A sidebar mostra o projeto, a worktree "principal", a branch e ●/↑/↓.
3. ⌘T → projeto/worktree/conta preenchidos → Abrir. O comando `claude` é digitado no terminal. Na sidebar a sessão aparece; ao mandar um prompt, 🟢; num pedido de permissão, 🟡; ao terminar, ⚪. Depois do primeiro turno o nome vira o título da conversa.
4. Peça ao Claude: "crie uma worktree chamada teste-gt e entre nela". O cabeçalho pisca, fica âmbar e mostra `⎇ teste-gt`; a sidebar lista a worktree nova com a sessão embaixo.
5. Abra uma sessão com `mslabs` pelo diálogo: o cabeçalho mostra `mslabs` na cor da conta. Num terminal comum, digite `claude-weboption-max` e confirme que a conta detectada é `weboption-max`.
6. Encerre a sessão da worktree `teste-gt`, clique com o botão direito nela → "Remover worktree…" → confirme com "Apagar também a branch". A worktree some da sidebar e do `git worktree list`.
7. Crie um arquivo numa worktree e tente removê-la: a confirmação lista o arquivo e o botão diz "Remover mesmo assim".
8. Clique direito num projeto → marque "Conta padrão: weboption" → ⌘T sugere weboption para esse projeto.
9. "Encerrar tudo" no menu → reabra o app → banner "sessões podem ser retomadas" → "Retomar todas": cada painel volta no mesmo lugar do layout com `claude… --resume <id>`.
Limpeza: "Encerrar tudo", `rm -rf /tmp/gt-ui`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: sidebar de projetos/worktrees, nova sessão, banners e remoção de worktree

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Empacotamento local, README e aceitação final

**Files:**
- Modify: `package.json` (script `pack` e bloco `build` do electron-builder)
- Create: `README.md`

**Interfaces:**
- Consumes: build completo das Tasks 1–14.
- Produces: `dist/mac-arm64/Gerenciador de Terminal.app` para uso diário (sem assinatura, só nesta máquina).

- [ ] **Step 1: Instalar o electron-builder e configurar**

Run: `npm install -D electron-builder`

Acrescente ao `package.json`:
```json
{
  "scripts": {
    "pack": "electron-vite build && electron-builder --mac --dir"
  },
  "build": {
    "appId": "dev.misasoares.gerenciador-terminal",
    "productName": "Gerenciador de Terminal",
    "files": ["out/**", "package.json"],
    "asarUnpack": ["node_modules/node-pty/**"],
    "mac": { "target": "dir", "identity": null, "category": "public.app-category.developer-tools" }
  }
}
```
(mescle `scripts.pack` com os scripts existentes; não substitua os outros.)

- [ ] **Step 2: Empacotar e testar o .app**

Run: `npm run pack`
Expected: `dist/mac-arm64/Gerenciador de Terminal.app` gerado.

Antes de abrir, encerre qualquer daemon de desenvolvimento: `pkill -f out/main/daemon.js` (sessões de teste serão finalizadas).

Run: `open "dist/mac-arm64/Gerenciador de Terminal.app"`
Expected: o app abre pelo Finder (sem o PATH/LANG do terminal) e:
- um terminal novo tem `echo $LANG` = `en_US.UTF-8` e `echo $ELECTRON_RUN_AS_NODE` vazio;
- `claude` funciona (a função do `.zshrc` foi carregada pelo `zsh -il`);
- `ps -A -o args= | grep daemon.js` mostra o daemon rodando a partir de `app.asar`.

Se o daemon não subir, veja `~/.gerenciador-terminal/daemon.log`. O erro mais provável é o `spawn-helper` sem permissão dentro de `app.asar.unpacked`: confirme com `ls -l "dist/mac-arm64/Gerenciador de Terminal.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds/"*/spawn-helper` e, se faltar o `x`, adicione `chmod +x` desse caminho ao script `pack`.

- [ ] **Step 3: Instalar para uso diário**

Run: `rm -rf "/Applications/Gerenciador de Terminal.app" && cp -R "dist/mac-arm64/Gerenciador de Terminal.app" /Applications/`

Atenção: se um daemon de outra build estiver rodando, o app mostra o banner de versão diferente só quando o `PROTOCOL_VERSION` muda. Para trocar o código do daemon sem mudar o protocolo, use "Encerrar tudo" antes de abrir a build nova (as sessões ficam retomáveis).

- [ ] **Step 4: `README.md`**

```markdown
# Gerenciador de Terminal

App para macOS que hospeda várias sessões do Claude Code em splits livres e mostra, por painel,
projeto, worktree, branch, alterações, commits para push/pull, estado da sessão e conta.

## Como funciona
- Um daemon (`~/.gerenciador-terminal/daemon.sock`) é dono dos terminais: fechar ou atualizar o app não mata sessões.
- Hooks do Claude Code (instalados em `~/.claude/settings.json`, com backup) avisam o app de mudança de pasta/worktree e do estado da sessão.
- As contas são os comandos do seu `.zshrc` (`claude`, `claude-mslabs`, `claude-weboption`, `claude-weboption-max`); o app só digita o comando.

## Desenvolvimento
    npm install
    npm test
    npm run dev            # usa ~/.gerenciador-terminal (GT_HOME=/tmp/x npm run dev para isolar)
    npm run pack           # gera dist/mac-arm64/Gerenciador de Terminal.app

## Atalhos
⌘T nova sessão · ⌘D / ⇧⌘D dividir · ⌘W esconder painel · ⇧⌘T nova aba · ⌘1…9 abas · ⌥⌘+setas foco

## Encerrar de verdade
Menu do app → "Encerrar tudo" (as sessões ficam disponíveis para retomar na próxima abertura).
Logs: `~/.gerenciador-terminal/daemon.log`.
```

- [ ] **Step 5: Checklist de aceitação (spec, seção 1 — critérios de sucesso)**

Com o app instalado em `/Applications`, confirme cada item e anote o resultado:
1. N sessões do Claude em N projetos/worktrees lado a lado, sem VS Code.
2. O Claude entra numa worktree e o cabeçalho muda em até ~2 s, sem ação sua.
3. ⌘Q, reabrir: tela e scroll de cada terminal intactos; um Claude 🟢 continuou trabalhando enquanto o app estava fechado.
4. `não, ação, você, à, pôr, ~/pasta` digitados com teclas mortas chegam idênticos ao Claude.
5. Uma worktree órfã pode ser aberta num terminal novo e removida com a confirmação de segurança.
Qualquer item que falhar vira uma correção antes de encerrar a fase 1.

- [ ] **Step 6: Commit e push**

```bash
git add -A
git commit -m "chore: empacotamento local e README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```
