# Atualização pelo próprio app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o app acha a release nova no GitHub, baixa e confere sozinho, e com um clique fecha, troca a versão, reabre e retoma todas as sessões (com volta automática se a nova não abrir).

**Architecture:** módulos puros e testáveis em `src/main/updater/` (consulta, download conferido, estado, instalação, pós-atualização) ligados no `src/main/index.ts`; um script POSIX `resources/update-helper.sh` copiado para `~/.gerenciador-terminal/updates/` faz a troca do bundle depois que o app sai; o renderer mostra o estado na barra de status e retoma as sessões quando a janela abre com `?updated=<versão>`. Publicação por `scripts/release.sh` (gh + Docker) e assinatura estável no Mac com certificado próprio.

**Tech Stack:** Electron 44 (main/preload/renderer), React 19, TypeScript, vitest, electron-builder, sh POSIX, `gh`, `ditto`/`codesign`/`security` no macOS.

**Spec:** `docs/superpowers/specs/2026-10-08-atualizacao-pelo-app-design.md`

## Global Constraints

- Tem de funcionar no macOS e no Linux; o script auxiliar é `sh` POSIX (sem bash-ismos).
- Commits semânticos, granulares, em português (`feat(atualizacao): …`, `test(...)`, `chore(...)`).
- Antes de usar subagentes, perguntar ao usuário (preferência global).
- Nunca trocar o bundle instalado em `/Applications` enquanto ele roda; testes reais usam cópia em pasta temporária e `GT_HOME` isolado.
- Depois de testes reais: `pkill -f "gerenciador-de-terminal/node_modules/electron/dist"` e matar as cópias de teste; conferir com `pgrep` que não sobrou nada.
- Atualizador só liga com `app.isPackaged`.
- URL da API: `https://api.github.com/repos/misasoares/gerenciador-de-terminal/releases/latest`, sobrescrita por `GT_UPDATE_URL`.
- Pasta de atualizações: `<GT_HOME ou ~/.gerenciador-terminal>/updates/`.
- Verificação: 10 s depois de abrir e a cada 6 h.
- Nomes dos arquivos da release (seguem o padrão que o electron-builder já gera): `gerenciador-de-terminal-<v>-mac-<arm64|x64>.zip`, `gerenciador-de-terminal-<v>-x86_64.AppImage`, `.deb`, `.rpm` e `SHA256SUMS`.
- Textos visíveis em português com acentos: "Versão X pronta", "Atualizar", "Ver novidades", "Atualizado para X · N sessões retomadas", "A atualização para X falhou; você continua na Y".
- Certificado de assinatura: nome exato `Gerenciador de Terminal Local`.

## Review Focus

1. Release igual ou mais velha que a instalada (ou rascunho/pré-release) → nada acontece, nunca rebaixa. (Task 1 e Task 3)
2. Clicar "Atualizar" duas vezes ou com a verificação de 6 h rodando junto → uma instalação só, um download só. (Task 3 e Task 7)
3. Caminhos com espaço ("Gerenciador de Terminal.app") no script auxiliar → troca e volta funcionam. (Task 4)
4. `pending.json` de uma versão que não é nem a de origem nem a atual (usuário instalou outra à mão), ou a versão de origem abrindo enquanto o script ainda espera → nenhum aviso falso e nada apagado antes da hora. (Task 6)
5. App aberto de pasta sem escrita (dentro do `.dmg`, translocado) → aviso "mova o app", sem baixar. (Task 3 e Task 5)

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/shared/update.ts` (novo) | tipo `UpdateStatus` compartilhado main/renderer |
| `src/main/updater/release-check.ts` (novo) | versões, leitura da release, escolha do arquivo, `SHA256SUMS` |
| `src/main/updater/download.ts` (novo) | download para `.part`, conferência do SHA-256, limpeza de versões |
| `src/main/updater/updater.ts` (novo) | classe `Updater`: verificação, estado, sem concorrência |
| `resources/update-helper.sh` (novo) | troca do bundle/AppImage depois que o app sai, volta se falhar |
| `src/main/updater/install.ts` (novo) | `runInstall`, `waitSocketGone`, `installTarget`, `canWriteTarget`, `helperEnv` |
| `src/main/updater/after-update.ts` (novo) | `readAfterUpdate`, `markStarted`, `clearAfterUpdate` |
| `src/main/workspaces-model.ts` | + `busySessions`, `openAfterUpdate` |
| `src/main/windows.ts` | + `afterUpdate` (query `updated`), `broadcast` |
| `src/main/index.ts` | liga o atualizador, IPC, abertura pós-atualização |
| `src/shared/bridge.ts`, `src/preload/index.ts` | `updateStatus`, `onUpdate`, `installUpdate` |
| `src/renderer/src/update-model.ts` (novo) | texto e ação do item da barra de status; aviso pós-atualização |
| `src/renderer/src/store.ts`, `view.ts`, `flows.ts`, `main.tsx` | estado, `UPDATED_TO`, retomada automática |
| `src/renderer/src/components/StatusBar.tsx`, `ReleaseNotesModal.tsx` (novo), `Modals.tsx`, `styles.css` | interface |
| `scripts/mac-cert.sh`, `scripts/mac-sign.sh` (novos) | certificado fixo e assinatura |
| `scripts/release-notes.mjs`, `scripts/release.sh` (novos) | publicação |
| `package.json` | `extraResources`, `pack`, `release` |

---

### Task 1: Tipos e leitura da release

**Files:**
- Create: `src/shared/update.ts`
- Create: `src/main/updater/release-check.ts`
- Test: `tests/main/updater-release-check.test.ts`

**Interfaces:**
- Produces:
  - `type UpdateStatus = { kind: 'idle' } | { kind: 'ready'; version: string; notes: string } | { kind: 'notify-only'; version: string; notes: string; url: string } | { kind: 'blocked'; version: string; reason: 'not-writable' } | { kind: 'failed-last'; to: string; current: string }`
  - `compareVersions(a: string, b: string): number` (lança em versão inválida), `isNewer(candidate: string, current: string): boolean`
  - `interface ReleaseAsset { name: string; url: string; size: number }`, `interface Release { version: string; notes: string; htmlUrl: string; assets: ReleaseAsset[] }`
  - `parseRelease(json: unknown): Release | null`
  - `type ArtifactKind = 'mac-zip' | 'appimage'`
  - `assetName(kind: ArtifactKind, version: string, arch: string): string`
  - `pickAsset(r: Release, o: { platform: string; arch: string; appImage: boolean }): { kind: ArtifactKind; asset: ReleaseAsset } | { kind: 'notify-only' } | null`
  - `parseSums(text: string): Map<string, string>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/updater-release-check.test.ts
import { describe, expect, it } from 'vitest'
import { assetName, compareVersions, isNewer, parseRelease, parseSums, pickAsset } from '../../src/main/updater/release-check'

const gh = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v0.2.0',
  body: '- Novo: atualização pelo app',
  html_url: 'https://github.com/misasoares/gerenciador-de-terminal/releases/tag/v0.2.0',
  draft: false,
  prerelease: false,
  assets: [
    { name: 'gerenciador-de-terminal-0.2.0-mac-arm64.zip', browser_download_url: 'https://x/mac-arm64.zip', size: 10 },
    { name: 'gerenciador-de-terminal-0.2.0-mac-x64.zip', browser_download_url: 'https://x/mac-x64.zip', size: 10 },
    { name: 'gerenciador-de-terminal-0.2.0-x86_64.AppImage', browser_download_url: 'https://x/app.AppImage', size: 10 },
    { name: 'SHA256SUMS', browser_download_url: 'https://x/SHA256SUMS', size: 1 },
  ],
  ...over,
})

describe('versões', () => {
  it('compara numericamente (0.10.0 > 0.9.0) e aceita prefixo v', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.1.9', '0.2.0')).toBe(-1)
  })
  it('versão inválida: compareVersions lança, isNewer diz não', () => {
    expect(() => compareVersions('abc', '0.1.0')).toThrow()
    expect(isNewer('abc', '0.1.0')).toBe(false)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.0.9', '0.1.0')).toBe(false)
    expect(isNewer('0.1.1', '0.1.0')).toBe(true)
  })
})

describe('release do GitHub', () => {
  it('lê versão, notas, página e arquivos', () => {
    const r = parseRelease(gh())!
    expect(r.version).toBe('0.2.0')
    expect(r.notes).toBe('- Novo: atualização pelo app')
    expect(r.htmlUrl).toContain('/releases/tag/v0.2.0')
    expect(r.assets[0]).toEqual({ name: 'gerenciador-de-terminal-0.2.0-mac-arm64.zip', url: 'https://x/mac-arm64.zip', size: 10 })
  })
  it('rascunho, pré-release, tag inválida ou lixo → null', () => {
    expect(parseRelease(gh({ draft: true }))).toBeNull()
    expect(parseRelease(gh({ prerelease: true }))).toBeNull()
    expect(parseRelease(gh({ tag_name: 'nightly' }))).toBeNull()
    expect(parseRelease(null)).toBeNull()
    expect(parseRelease('x')).toBeNull()
  })
  it('asset malformado é ignorado', () => {
    const r = parseRelease(gh({ assets: [{ name: 1 }, { name: 'SHA256SUMS', browser_download_url: 'https://x/s', size: 1 }] }))!
    expect(r.assets.map((a) => a.name)).toEqual(['SHA256SUMS'])
  })
})

describe('escolha do arquivo', () => {
  const r = parseRelease(gh())!
  it('nomes por plataforma', () => {
    expect(assetName('mac-zip', '0.2.0', 'arm64')).toBe('gerenciador-de-terminal-0.2.0-mac-arm64.zip')
    expect(assetName('appimage', '0.2.0', 'x64')).toBe('gerenciador-de-terminal-0.2.0-x86_64.AppImage')
  })
  it('Mac pela arquitetura', () => {
    expect(pickAsset(r, { platform: 'darwin', arch: 'arm64', appImage: false })).toEqual({ kind: 'mac-zip', asset: r.assets[0] })
    expect(pickAsset(r, { platform: 'darwin', arch: 'x64', appImage: false })).toEqual({ kind: 'mac-zip', asset: r.assets[1] })
  })
  it('Linux: AppImage se atualiza; deb/rpm só avisam', () => {
    expect(pickAsset(r, { platform: 'linux', arch: 'x64', appImage: true })).toEqual({ kind: 'appimage', asset: r.assets[2] })
    expect(pickAsset(r, { platform: 'linux', arch: 'x64', appImage: false })).toEqual({ kind: 'notify-only' })
  })
  it('sem o arquivo da máquina ou plataforma desconhecida → null', () => {
    expect(pickAsset(r, { platform: 'linux', arch: 'arm64', appImage: true })).toBeNull()
    expect(pickAsset(r, { platform: 'win32', arch: 'x64', appImage: false })).toBeNull()
  })
})

describe('SHA256SUMS', () => {
  it('lê "hash  arquivo" (e o formato binário com *), ignora lixo', () => {
    const h = 'a'.repeat(64)
    const m = parseSums(`${h}  gerenciador-de-terminal-0.2.0-mac-arm64.zip\n${'B'.repeat(64)} *outro.AppImage\nlixo\n`)
    expect(m.get('gerenciador-de-terminal-0.2.0-mac-arm64.zip')).toBe(h)
    expect(m.get('outro.AppImage')).toBe('b'.repeat(64))
    expect(m.size).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/updater-release-check.test.ts`
Expected: FAIL ("Failed to resolve import ../../src/main/updater/release-check")

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/update.ts
/** estado do atualizador mostrado na barra de status (o download é silencioso: segue 'idle' até ficar pronto) */
export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'ready'; version: string; notes: string }
  /** .deb/.rpm: só avisa e abre a página da release */
  | { kind: 'notify-only'; version: string; notes: string; url: string }
  /** a pasta do app não aceita escrita (dentro do .dmg, translocado) */
  | { kind: 'blocked'; version: string; reason: 'not-writable' }
  /** a última tentativa voltou para a versão anterior */
  | { kind: 'failed-last'; to: string; current: string }
```

```ts
// src/main/updater/release-check.ts
/** sem Electron: lê a release do GitHub e decide o arquivo desta máquina */

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface Release {
  version: string
  notes: string
  htmlUrl: string
  assets: ReleaseAsset[]
}

export type ArtifactKind = 'mac-zip' | 'appimage'

const parts = (v: string): number[] | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** maior.menor.correção numérico; lança em versão inválida */
export function compareVersions(a: string, b: string): number {
  const x = parts(a)
  const y = parts(b)
  if (!x || !y) throw new Error(`versão inválida: ${x ? b : a}`)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

export function isNewer(candidate: string, current: string): boolean {
  try {
    return compareVersions(candidate, current) > 0
  } catch {
    return false
  }
}

export function parseRelease(json: unknown): Release | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  if (j.draft || j.prerelease) return null
  const version = typeof j.tag_name === 'string' ? j.tag_name.replace(/^v/, '') : ''
  if (!parts(version)) return null
  const assets = (Array.isArray(j.assets) ? j.assets : []).flatMap((a): ReleaseAsset[] => {
    const o = a as Record<string, unknown>
    return typeof o?.name === 'string' && typeof o.browser_download_url === 'string'
      ? [{ name: o.name, url: o.browser_download_url, size: typeof o.size === 'number' ? o.size : 0 }]
      : []
  })
  return { version, notes: typeof j.body === 'string' ? j.body : '', htmlUrl: typeof j.html_url === 'string' ? j.html_url : '', assets }
}

/** nomes publicados pelo scripts/release.sh (AppImage com o nome que o electron-builder gera) */
export function assetName(kind: ArtifactKind, version: string, arch: string): string {
  return kind === 'mac-zip'
    ? `gerenciador-de-terminal-${version}-mac-${arch}.zip`
    : `gerenciador-de-terminal-${version}-${arch === 'x64' ? 'x86_64' : arch}.AppImage`
}

export function pickAsset(
  r: Release,
  o: { platform: string; arch: string; appImage: boolean },
): { kind: ArtifactKind; asset: ReleaseAsset } | { kind: 'notify-only' } | null {
  if (o.platform === 'linux' && !o.appImage) return { kind: 'notify-only' }
  const kind: ArtifactKind | null = o.platform === 'darwin' ? 'mac-zip' : o.platform === 'linux' ? 'appimage' : null
  if (!kind) return null
  const asset = r.assets.find((a) => a.name === assetName(kind, r.version, o.arch))
  return asset ? { kind, asset } : null
}

/** "<sha256>  <arquivo>" por linha (o * do modo binário do shasum é aceito) */
export function parseSums(text: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const line of text.split('\n')) {
    const r = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (r) m.set(r[2], r[1].toLowerCase())
  }
  return m
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/updater-release-check.test.ts`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add src/shared/update.ts src/main/updater/release-check.ts tests/main/updater-release-check.test.ts
git commit -m "feat(atualizacao): leitura da release do GitHub, comparação de versões e escolha do arquivo por plataforma"
```

---

### Task 2: Download conferido

**Files:**
- Create: `src/main/updater/download.ts`
- Test: `tests/main/updater-download.test.ts`

**Interfaces:**
- Produces:
  - `type Fetch = (url: string, init?: RequestInit) => Promise<Response>`
  - `sha256File(file: string): Promise<string>`
  - `downloadVerified(o: { fetch: Fetch; url: string; dir: string; name: string; sha256: string }): Promise<string>` → caminho final; lança se HTTP falhar ou hash não bater (não deixa arquivo nem `.part`)
  - `pruneVersions(updatesDir: string, keep: string): void`

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/updater-download.test.ts
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { downloadVerified, pruneVersions, sha256File } from '../../src/main/updater/download'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gt-dl-'))
const bytes = Buffer.from('conteúdo do zip')
const sha = crypto.createHash('sha256').update(bytes).digest('hex')
const fetchOf = (body: Buffer, status = 200) => {
  let calls = 0
  const f = async () => {
    calls++
    return new Response(body, { status })
  }
  return { f, calls: () => calls }
}

describe('download conferido', () => {
  it('baixa, confere e deixa só o arquivo final', async () => {
    const dir = path.join(tmp(), '0.2.0')
    const { f } = fetchOf(bytes)
    const file = await downloadVerified({ fetch: f, url: 'https://x/a.zip', dir, name: 'a.zip', sha256: sha })
    expect(file).toBe(path.join(dir, 'a.zip'))
    expect(fs.readFileSync(file)).toEqual(bytes)
    expect(fs.existsSync(file + '.part')).toBe(false)
    expect(await sha256File(file)).toBe(sha)
  })
  it('hash diferente → lança e não deixa nada', async () => {
    const dir = path.join(tmp(), '0.2.0')
    const { f } = fetchOf(Buffer.from('corrompido'))
    await expect(downloadVerified({ fetch: f, url: 'u', dir, name: 'a.zip', sha256: sha })).rejects.toThrow(/SHA-256/)
    expect(fs.readdirSync(dir)).toEqual([])
  })
  it('HTTP com erro → lança', async () => {
    const dir = path.join(tmp(), '0.2.0')
    const { f } = fetchOf(Buffer.from(''), 404)
    await expect(downloadVerified({ fetch: f, url: 'u', dir, name: 'a.zip', sha256: sha })).rejects.toThrow(/404/)
  })
  it('arquivo já baixado e conferido → não baixa de novo', async () => {
    const dir = path.join(tmp(), '0.2.0')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'a.zip'), bytes)
    const { f, calls } = fetchOf(bytes)
    await downloadVerified({ fetch: f, url: 'u', dir, name: 'a.zip', sha256: sha })
    expect(calls()).toBe(0)
  })
  it('limpa pastas de outras versões e mantém arquivos soltos', () => {
    const upd = tmp()
    for (const d of ['0.1.5', '0.2.0', 'outra']) fs.mkdirSync(path.join(upd, d))
    fs.writeFileSync(path.join(upd, 'pending.json'), '{}')
    pruneVersions(upd, '0.2.0')
    expect(fs.readdirSync(upd).sort()).toEqual(['0.2.0', 'outra', 'pending.json'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/updater-download.test.ts`
Expected: FAIL (módulo inexistente)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/updater/download.ts
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export async function sha256File(file: string): Promise<string> {
  const h = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) h.update(chunk as Buffer)
  return h.digest('hex')
}

/** baixa em .part e só renomeia se o SHA-256 bater; em qualquer falha não deixa nada para trás */
export async function downloadVerified(o: { fetch: Fetch; url: string; dir: string; name: string; sha256: string }): Promise<string> {
  fs.mkdirSync(o.dir, { recursive: true })
  const final = path.join(o.dir, o.name)
  if (fs.existsSync(final) && (await sha256File(final)) === o.sha256) return final
  const part = final + '.part'
  fs.rmSync(part, { force: true })
  try {
    const res = await o.fetch(o.url, { redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`download falhou: HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), fs.createWriteStream(part))
    if ((await sha256File(part)) !== o.sha256) throw new Error(`SHA-256 diferente em ${o.name}`)
    fs.renameSync(part, final)
    return final
  } catch (e) {
    fs.rmSync(part, { force: true })
    fs.rmSync(final, { force: true })
    throw e
  }
}

/** apaga as pastas de outras versões (pending.json, logs e backups ficam) */
export function pruneVersions(updatesDir: string, keep: string): void {
  for (const e of fs.readdirSync(updatesDir, { withFileTypes: true })) {
    if (e.isDirectory() && e.name !== keep && /^\d+\.\d+\.\d+$/.test(e.name)) fs.rmSync(path.join(updatesDir, e.name), { recursive: true, force: true })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/updater-download.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/updater/download.ts tests/main/updater-download.test.ts
git commit -m "feat(atualizacao): download em .part conferido pelo SHA-256 e limpeza de versões antigas"
```

---

### Task 3: Classe `Updater` (verificação e estado)

**Files:**
- Create: `src/main/updater/updater.ts`
- Test: `tests/main/updater.test.ts`

**Interfaces:**
- Consumes: `parseRelease`, `isNewer`, `pickAsset`, `parseSums`, `ArtifactKind` (Task 1); `downloadVerified`, `pruneVersions`, `Fetch` (Task 2); `UpdateStatus` (Task 1)
- Produces:
  - `interface ReadyArtifact { version: string; kind: ArtifactKind; file: string }`
  - `interface UpdaterDeps { current: string; platform: string; arch: string; appImage: boolean; updatesDir: string; apiUrl: string; fetch: Fetch; canWrite(): boolean; onStatus(s: UpdateStatus): void }`
  - `class Updater { status: UpdateStatus; ready: ReadyArtifact | null; check(): Promise<void>; setFailed(to: string, current: string): void }` — `check()` nunca lança; chamadas simultâneas compartilham a mesma execução.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/updater.test.ts
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { Updater, type UpdaterDeps } from '../../src/main/updater/updater'
import type { UpdateStatus } from '../../src/shared/update'

const ZIP = Buffer.from('zip da 0.2.0')
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex')
const release = (tag = 'v0.2.0') => ({
  tag_name: tag,
  body: 'notas',
  html_url: 'https://gh/rel',
  assets: [
    { name: `gerenciador-de-terminal-${tag.slice(1)}-mac-arm64.zip`, browser_download_url: 'https://dl/zip', size: ZIP.length },
    { name: 'SHA256SUMS', browser_download_url: 'https://dl/sums', size: 1 },
  ],
})

function setup(o: { tag?: string; zip?: Buffer; sums?: string; canWrite?: boolean; platform?: string; appImage?: boolean; failApi?: boolean } = {}) {
  const calls: string[] = []
  const tag = o.tag ?? 'v0.2.0'
  const fetch: UpdaterDeps['fetch'] = async (url) => {
    calls.push(url)
    if (url === 'https://api/latest') {
      if (o.failApi) throw new Error('sem rede')
      return new Response(JSON.stringify(release(tag)))
    }
    if (url === 'https://dl/sums') return new Response(o.sums ?? `${sha(ZIP)}  gerenciador-de-terminal-${tag.slice(1)}-mac-arm64.zip\n`)
    if (url === 'https://dl/zip') return new Response(o.zip ?? ZIP)
    return new Response('', { status: 404 })
  }
  const statuses: UpdateStatus[] = []
  const updatesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-upd-'))
  const u = new Updater({
    current: '0.1.0',
    platform: o.platform ?? 'darwin',
    arch: 'arm64',
    appImage: o.appImage ?? false,
    updatesDir,
    apiUrl: 'https://api/latest',
    fetch,
    canWrite: () => o.canWrite ?? true,
    onStatus: (s) => statuses.push(s),
  })
  return { u, calls, statuses, updatesDir }
}

describe('Updater', () => {
  it('versão nova: baixa, confere e fica pronta', async () => {
    const { u, statuses, updatesDir } = setup()
    await u.check()
    expect(u.status).toEqual({ kind: 'ready', version: '0.2.0', notes: 'notas' })
    expect(statuses).toEqual([u.status])
    expect(u.ready).toEqual({ version: '0.2.0', kind: 'mac-zip', file: path.join(updatesDir, '0.2.0', 'gerenciador-de-terminal-0.2.0-mac-arm64.zip') })
    expect(fs.readFileSync(u.ready!.file)).toEqual(ZIP)
  })
  it('mesma versão ou mais velha: nada (nunca rebaixa)', async () => {
    for (const tag of ['v0.1.0', 'v0.0.9']) {
      const { u, calls, statuses } = setup({ tag })
      await u.check()
      expect(u.status).toEqual({ kind: 'idle' })
      expect(statuses).toEqual([])
      expect(calls).toEqual(['https://api/latest'])
    }
  })
  it('já pronta: nova verificação não baixa de novo', async () => {
    const { u, calls } = setup()
    await u.check()
    await u.check()
    expect(calls.filter((c) => c === 'https://dl/zip')).toHaveLength(1)
  })
  it('verificações simultâneas fazem um download só', async () => {
    const { u, calls } = setup()
    await Promise.all([u.check(), u.check(), u.check()])
    expect(calls.filter((c) => c === 'https://api/latest')).toHaveLength(1)
    expect(calls.filter((c) => c === 'https://dl/zip')).toHaveLength(1)
  })
  it('SHA-256 diferente: segue ocioso, sem arquivo', async () => {
    const { u, updatesDir } = setup({ zip: Buffer.from('corrompido') })
    await u.check()
    expect(u.status).toEqual({ kind: 'idle' })
    expect(u.ready).toBeNull()
    expect(fs.readdirSync(path.join(updatesDir, '0.2.0'))).toEqual([])
  })
  it('sem SHA256SUMS para o arquivo: não baixa', async () => {
    const { u, calls } = setup({ sums: `${'a'.repeat(64)}  outro.zip\n` })
    await u.check()
    expect(u.status).toEqual({ kind: 'idle' })
    expect(calls).not.toContain('https://dl/zip')
  })
  it('sem rede: não lança e segue ocioso', async () => {
    const { u } = setup({ failApi: true })
    await expect(u.check()).resolves.toBeUndefined()
    expect(u.status).toEqual({ kind: 'idle' })
  })
  it('pasta sem escrita: avisa "bloqueado" sem baixar', async () => {
    const { u, calls } = setup({ canWrite: false })
    await u.check()
    expect(u.status).toEqual({ kind: 'blocked', version: '0.2.0', reason: 'not-writable' })
    expect(calls).not.toContain('https://dl/zip')
  })
  it('Linux por .deb/.rpm: só avisa, com a página da release', async () => {
    const { u, calls } = setup({ platform: 'linux', appImage: false })
    await u.check()
    expect(u.status).toEqual({ kind: 'notify-only', version: '0.2.0', notes: 'notas', url: 'https://gh/rel' })
    expect(calls).toEqual(['https://api/latest'])
  })
  it('falha anterior aparece até haver novidade', () => {
    const { u, statuses } = setup()
    u.setFailed('0.2.0', '0.1.0')
    expect(u.status).toEqual({ kind: 'failed-last', to: '0.2.0', current: '0.1.0' })
    expect(statuses).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/updater.test.ts`
Expected: FAIL (módulo inexistente)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/updater/updater.ts
import path from 'node:path'
import type { UpdateStatus } from '../../shared/update'
import { downloadVerified, pruneVersions, type Fetch } from './download'
import { isNewer, parseRelease, parseSums, pickAsset, type ArtifactKind } from './release-check'

export interface ReadyArtifact {
  version: string
  kind: ArtifactKind
  file: string
}

export interface UpdaterDeps {
  current: string
  platform: string
  arch: string
  appImage: boolean
  updatesDir: string
  apiUrl: string
  fetch: Fetch
  /** a pasta do bundle (Mac) ou do AppImage aceita a troca */
  canWrite(): boolean
  onStatus(s: UpdateStatus): void
}

/** verifica a release, baixa em segundo plano e guarda o arquivo pronto; falhas de rede ficam em silêncio */
export class Updater {
  status: UpdateStatus = { kind: 'idle' }
  ready: ReadyArtifact | null = null
  private running: Promise<void> | null = null

  constructor(private d: UpdaterDeps) {}

  check(): Promise<void> {
    if (!this.running) {
      this.running = this.run()
        .catch((e) => console.error('atualização: verificação falhou', e))
        .finally(() => {
          this.running = null
        })
    }
    return this.running
  }

  setFailed(to: string, current: string): void {
    this.set({ kind: 'failed-last', to, current })
  }

  private async run(): Promise<void> {
    const res = await this.d.fetch(this.d.apiUrl, { headers: { accept: 'application/vnd.github+json' } })
    if (!res.ok) return
    const r = parseRelease(await res.json())
    if (!r || !isNewer(r.version, this.d.current) || this.ready?.version === r.version) return
    const pick = pickAsset(r, this.d)
    if (!pick) return
    if (pick.kind === 'notify-only') return this.set({ kind: 'notify-only', version: r.version, notes: r.notes, url: r.htmlUrl })
    if (!this.d.canWrite()) return this.set({ kind: 'blocked', version: r.version, reason: 'not-writable' })
    const sumsAsset = r.assets.find((a) => a.name === 'SHA256SUMS')
    if (!sumsAsset) return
    const sres = await this.d.fetch(sumsAsset.url, { redirect: 'follow' })
    if (!sres.ok) return
    const sha256 = parseSums(await sres.text()).get(pick.asset.name)
    if (!sha256) return
    const file = await downloadVerified({ fetch: this.d.fetch, url: pick.asset.url, dir: path.join(this.d.updatesDir, r.version), name: pick.asset.name, sha256 })
    pruneVersions(this.d.updatesDir, r.version)
    this.ready = { version: r.version, kind: pick.kind, file }
    this.set({ kind: 'ready', version: r.version, notes: r.notes })
  }

  private set(s: UpdateStatus): void {
    this.status = s
    this.d.onStatus(s)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/updater.test.ts`
Expected: PASS (10 testes). A saída pode mostrar `console.error` do teste "SHA-256 diferente"/"sem rede" — é o registro esperado.

- [ ] **Step 5: Commit**

```bash
git add src/main/updater/updater.ts tests/main/updater.test.ts
git commit -m "feat(atualizacao): verificador em segundo plano com estado, sem downloads simultâneos e sem rebaixar versão"
```

---

### Task 4: Script auxiliar de troca

**Files:**
- Create: `resources/update-helper.sh`
- Test: `tests/main/update-helper.test.ts`

**Interfaces:**
- Produces: `sh update-helper.sh <mac-zip|appimage> <pid do app> <bundle ou AppImage atual> <arquivo baixado> <pasta updates> <versão nova> <versão atual>`
  - espera o PID sair (limite `GT_HELPER_WAIT_EXIT`, padrão 30 s); troca; abre; espera `<updates>/ok-<nova>` (limite `GT_HELPER_WAIT_OK`, padrão 60 s); sem confirmação → restaura e abre a anterior; grava `<updates>/failed.json` `{from,to,at}` em qualquer falha; registra em `<updates>/helper.log`; apaga `ok-<nova>` e o `.anterior` no sucesso.
  - abrir: `GT_HELPER_LAUNCH` (testes, recebe o caminho em `$1`); Mac `open -n` repassando `GT_HOME`/`GT_UPDATE_URL` com `--env`; AppImage `nohup <arquivo> &`.
  - Mac: anterior em `<nome>.anterior.app`; AppImage: `<arquivo>.anterior`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/update-helper.test.ts
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const HELPER = path.resolve(__dirname, '../../resources/update-helper.sh')
// abrir de mentira: anota a versão aberta e, se for a "boa", confirma como o app novo faria
const LAUNCH =
  'v=$(cat "$1/Contents/version" 2>/dev/null || cat "$1"); echo "$v" >> "$GT_TEST_UPD/launched"; [ "$v" = "$GT_TEST_GOOD" ] && touch "$GT_TEST_UPD/ok-$v"; true'

function run(args: string[], env: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn('sh', [HELPER, ...args], { env: { ...process.env, GT_HELPER_LAUNCH: LAUNCH, GT_HELPER_WAIT_OK: '2', ...env }, stdio: 'ignore' })
    p.on('exit', (code) => resolve(code ?? -1))
  })
}
const deadPid = () => {
  const p = spawn('sleep', ['0.2'])
  return String(p.pid)
}
const launched = (upd: string) => (fs.existsSync(path.join(upd, 'launched')) ? fs.readFileSync(path.join(upd, 'launched'), 'utf8').trim().split('\n') : [])

/** pasta com espaço no nome, como /Applications/Gerenciador de Terminal.app */
function macFixture(newVersion: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt helper '))
  const apps = path.join(root, 'Aplicativos com espaço')
  const upd = path.join(root, 'updates')
  fs.mkdirSync(upd, { recursive: true })
  const app = path.join(apps, 'Gerenciador de Terminal.app')
  fs.mkdirSync(path.join(app, 'Contents'), { recursive: true })
  fs.writeFileSync(path.join(app, 'Contents', 'version'), '0.1.0')
  const src = path.join(root, 'novo', 'Gerenciador de Terminal.app')
  fs.mkdirSync(path.join(src, 'Contents'), { recursive: true })
  fs.writeFileSync(path.join(src, 'Contents', 'version'), newVersion)
  const zip = path.join(upd, 'novo.zip')
  execFileSync('ditto', ['-c', '-k', '--keepParent', src, zip])
  return { app, upd, zip }
}

function appImageFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt helper '))
  const upd = path.join(root, 'updates')
  fs.mkdirSync(upd)
  const target = path.join(root, 'Meus Apps', 'gerenciador.AppImage')
  fs.mkdirSync(path.dirname(target))
  fs.writeFileSync(target, '0.1.0')
  const art = path.join(upd, 'novo.AppImage')
  fs.writeFileSync(art, '0.2.0')
  return { target, upd, art }
}

describe.skipIf(process.platform !== 'darwin')('script auxiliar · Mac', () => {
  it('troca, abre a nova e, confirmada, apaga a anterior', async () => {
    const f = macFixture('0.2.0')
    const code = await run(['mac-zip', deadPid(), f.app, f.zip, f.upd, '0.2.0', '0.1.0'], { GT_TEST_UPD: f.upd, GT_TEST_GOOD: '0.2.0' })
    expect(code).toBe(0)
    expect(fs.readFileSync(path.join(f.app, 'Contents', 'version'), 'utf8')).toBe('0.2.0')
    expect(fs.existsSync(f.app.replace(/\.app$/, '.anterior.app'))).toBe(false)
    expect(fs.existsSync(path.join(f.upd, 'ok-0.2.0'))).toBe(false)
    expect(fs.existsSync(path.join(f.upd, 'failed.json'))).toBe(false)
    expect(launched(f.upd)).toEqual(['0.2.0'])
  })
  it('a nova não confirma: volta para a anterior, abre e registra a falha', async () => {
    const f = macFixture('0.2.0')
    const code = await run(['mac-zip', deadPid(), f.app, f.zip, f.upd, '0.2.0', '0.1.0'], { GT_TEST_UPD: f.upd, GT_TEST_GOOD: 'nenhuma' })
    expect(code).toBe(1)
    expect(fs.readFileSync(path.join(f.app, 'Contents', 'version'), 'utf8')).toBe('0.1.0')
    expect(launched(f.upd)).toEqual(['0.2.0', '0.1.0'])
    expect(JSON.parse(fs.readFileSync(path.join(f.upd, 'failed.json'), 'utf8'))).toMatchObject({ from: '0.1.0', to: '0.2.0' })
  })
  it('zip corrompido: não troca nada e reabre a atual', async () => {
    const f = macFixture('0.2.0')
    fs.writeFileSync(f.zip, 'não é zip')
    const code = await run(['mac-zip', deadPid(), f.app, f.zip, f.upd, '0.2.0', '0.1.0'], { GT_TEST_UPD: f.upd, GT_TEST_GOOD: '0.2.0' })
    expect(code).toBe(1)
    expect(fs.readFileSync(path.join(f.app, 'Contents', 'version'), 'utf8')).toBe('0.1.0')
    expect(launched(f.upd)).toEqual(['0.1.0'])
    expect(fs.existsSync(path.join(f.upd, 'failed.json'))).toBe(true)
  })
})

describe('script auxiliar · AppImage e espera', () => {
  it('AppImage: troca o arquivo, deixa executável e confirma', async () => {
    const f = appImageFixture()
    const code = await run(['appimage', deadPid(), f.target, f.art, f.upd, '0.2.0', '0.1.0'], { GT_TEST_UPD: f.upd, GT_TEST_GOOD: '0.2.0' })
    expect(code).toBe(0)
    expect(fs.readFileSync(f.target, 'utf8')).toBe('0.2.0')
    expect(fs.statSync(f.target).mode & 0o111).not.toBe(0)
    expect(fs.existsSync(f.target + '.anterior')).toBe(false)
  })
  it('AppImage que não confirma: volta para a anterior', async () => {
    const f = appImageFixture()
    const code = await run(['appimage', deadPid(), f.target, f.art, f.upd, '0.2.0', '0.1.0'], { GT_TEST_UPD: f.upd, GT_TEST_GOOD: 'nenhuma' })
    expect(code).toBe(1)
    expect(fs.readFileSync(f.target, 'utf8')).toBe('0.1.0')
    expect(launched(f.upd)).toEqual(['0.2.0', '0.1.0'])
  })
  it('o app não fecha a tempo: desiste sem trocar', async () => {
    const f = appImageFixture()
    const alive = spawn('sleep', ['30'])
    const code = await run(['appimage', String(alive.pid), f.target, f.art, f.upd, '0.2.0', '0.1.0'], { GT_TEST_UPD: f.upd, GT_TEST_GOOD: '0.2.0', GT_HELPER_WAIT_EXIT: '1' })
    alive.kill()
    expect(code).toBe(1)
    expect(fs.readFileSync(f.target, 'utf8')).toBe('0.1.0')
    expect(launched(f.upd)).toEqual([])
    expect(fs.readFileSync(path.join(f.upd, 'helper.log'), 'utf8')).toMatch(/não fechou/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/update-helper.test.ts`
Expected: FAIL (o `sh` sai com código 127/2 porque o script não existe; asserções de código falham)

- [ ] **Step 3: Write minimal implementation**

```sh
#!/bin/sh
# Troca a versão do Gerenciador de Terminal depois que o app fecha. Roda fora do bundle (o app copia
# este arquivo para a pasta de atualizações: no AppImage a montagem some quando o app sai).
# uso: update-helper.sh <mac-zip|appimage> <pid do app> <bundle ou AppImage atual> <arquivo baixado> <pasta updates> <versão nova> <versão atual>
set -u
KIND=$1
PID=$2
TARGET=$3
ART=$4
UPD=$5
TO=$6
FROM=$7
WAIT_EXIT=${GT_HELPER_WAIT_EXIT:-30}
WAIT_OK=${GT_HELPER_WAIT_OK:-60}
LOG="$UPD/helper.log"

log() { echo "$(date '+%Y-%m-%dT%H:%M:%S') $*" >>"$LOG"; }

fail() {
  log "falhou: $*"
  printf '{"from":"%s","to":"%s","at":"%s"}\n' "$FROM" "$TO" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >"$UPD/failed.json"
}

launch() {
  if [ -n "${GT_HELPER_LAUNCH:-}" ]; then
    sh -c "$GT_HELPER_LAUNCH" launch "$1"
  elif [ "$KIND" = mac-zip ]; then
    # -n: instância nova mesmo se o LaunchServices ainda lembrar da anterior; --env leva o GT_HOME isolado dos testes
    set -- "$1"
    [ -n "${GT_HOME:-}" ] && set -- --env "GT_HOME=$GT_HOME" "$@"
    [ -n "${GT_UPDATE_URL:-}" ] && set -- --env "GT_UPDATE_URL=$GT_UPDATE_URL" "$@"
    open -n "$@"
  else
    nohup "$1" >/dev/null 2>&1 &
  fi
}

log "início: $KIND $FROM → $TO ($TARGET)"

i=0
while kill -0 "$PID" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt $((WAIT_EXIT * 2)) ]; then
    fail "o app não fechou em ${WAIT_EXIT}s; nada foi trocado"
    exit 1
  fi
  sleep 0.5
done

case "$KIND" in
mac-zip)
  OLD="${TARGET%.app}.anterior.app"
  STAGE="$(dirname "$TARGET")/.gt-update-$TO"
  rm -rf "$STAGE"
  if ! mkdir -p "$STAGE" || ! ditto -x -k "$ART" "$STAGE" 2>>"$LOG"; then
    fail "não consegui extrair $ART"
    rm -rf "$STAGE"
    launch "$TARGET"
    exit 1
  fi
  NEW=$(find "$STAGE" -maxdepth 1 -name '*.app' | head -n 1)
  if [ -z "$NEW" ]; then
    fail "o zip não tem um .app"
    rm -rf "$STAGE"
    launch "$TARGET"
    exit 1
  fi
  rm -rf "$OLD"
  if ! mv "$TARGET" "$OLD" || ! mv "$NEW" "$TARGET"; then
    fail "não consegui trocar o bundle"
    [ -d "$TARGET" ] || mv "$OLD" "$TARGET"
    rm -rf "$STAGE"
    launch "$TARGET"
    exit 1
  fi
  rm -rf "$STAGE"
  ;;
appimage)
  OLD="$TARGET.anterior"
  if ! cp "$ART" "$TARGET.novo" || ! chmod +x "$TARGET.novo" || ! cp -p "$TARGET" "$OLD" || ! mv "$TARGET.novo" "$TARGET"; then
    fail "não consegui trocar o AppImage"
    rm -f "$TARGET.novo"
    launch "$TARGET"
    exit 1
  fi
  ;;
*)
  fail "tipo desconhecido: $KIND"
  exit 1
  ;;
esac

log "trocado; abrindo $TO"
rm -f "$UPD/ok-$TO"
launch "$TARGET"

i=0
while [ ! -f "$UPD/ok-$TO" ]; do
  i=$((i + 1))
  if [ "$i" -gt $((WAIT_OK * 2)) ]; then
    fail "a versão $TO não confirmou em ${WAIT_OK}s; voltando para $FROM"
    # Mac: a nova pode estar aberta e travada (e com um daemon dela); fecha antes de reabrir a anterior
    [ "$KIND" = mac-zip ] && pkill -f "$TARGET/Contents/MacOS/" 2>/dev/null
    sleep 1
    rm -rf "$TARGET"
    mv "$OLD" "$TARGET"
    launch "$TARGET"
    exit 1
  fi
  sleep 0.5
done

rm -rf "$OLD"
rm -f "$UPD/ok-$TO"
log "ok: $TO"
exit 0
```

Depois: `chmod +x resources/update-helper.sh`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/update-helper.test.ts`
Expected: PASS (6 testes no Mac; no Linux os 3 do Mac aparecem como "skipped")

- [ ] **Step 5: Commit**

```bash
git add resources/update-helper.sh tests/main/update-helper.test.ts
git commit -m "feat(atualizacao): script que troca o bundle ou o AppImage depois que o app fecha e volta para a anterior se a nova não confirmar"
```

---

### Task 5: Instalação (preparar, encerrar daemon, chamar o script)

**Files:**
- Create: `src/main/updater/install.ts`
- Modify: `src/main/workspaces-model.ts` (acrescentar `busySessions`, `openAfterUpdate` no fim)
- Test: `tests/main/updater-install.test.ts`, `tests/main/workspaces-model.test.ts` (acrescentar casos)

**Interfaces:**
- Consumes: `ReadyArtifact` (Task 3); `WorkspaceSummary` de `src/shared/types.ts`
- Produces:
  - `stamp(d: Date): string` → `YYYYMMDD-HHMMSS` (UTC)
  - `interface InstallDeps { updatesDir: string; stateFile: string; helperSource: string; from: string; ready: ReadyArtifact; target: string; appPid: number; env: NodeJS.ProcessEnv; stopDaemon(): Promise<void>; spawnDetached(cmd: string, args: string[], env: NodeJS.ProcessEnv): void; quit(): void; now?: () => Date }`
  - `runInstall(d: InstallDeps): Promise<void>` — backup do state, `pending.json`, apaga `failed.json`, copia o script, `stopDaemon`, `spawnDetached('/bin/sh', [script, kind, pid, target, file, updatesDir, to, from])`, `quit`
  - `helperEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv` — sem `APPDIR`, `APPIMAGE`, `ARGV0`, `OWD`, `ELECTRON_RUN_AS_NODE`
  - `waitSocketGone(socketPath: string, ms: number): Promise<boolean>`
  - `installTarget(platform: string, execPath: string, appImage: string | undefined): string | null`
  - `canWriteTarget(target: string): boolean`
  - `busySessions(list: WorkspaceSummary[]): number` (status `working` ou `needs-you`, em abas e escondidas)
  - `openAfterUpdate(list: WorkspaceSummary[]): string[]` (espaços marcados como abertos; nenhum → o primeiro ou `principal`)

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/updater-install.test.ts
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canWriteTarget, helperEnv, installTarget, runInstall, stamp, waitSocketGone } from '../../src/main/updater/install'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gt-inst-'))

describe('instalação', () => {
  it('na ordem: backup, pending, script copiado, daemon encerrado, script chamado, app sai', async () => {
    const home = tmp()
    const upd = path.join(home, 'updates')
    fs.writeFileSync(path.join(home, 'state.json'), '{"v":1}')
    fs.mkdirSync(upd)
    fs.writeFileSync(path.join(upd, 'failed.json'), '{}')
    const helperSource = path.join(home, 'helper-original.sh')
    fs.writeFileSync(helperSource, 'echo oi')
    const order: string[] = []
    let spawned: { cmd: string; args: string[]; env: NodeJS.ProcessEnv } | null = null
    await runInstall({
      updatesDir: upd,
      stateFile: path.join(home, 'state.json'),
      helperSource,
      from: '0.1.0',
      ready: { version: '0.2.0', kind: 'mac-zip', file: '/u/0.2.0/a.zip' },
      target: '/Applications/Gerenciador de Terminal.app',
      appPid: 4242,
      env: { PATH: '/bin', APPIMAGE: '/x', ELECTRON_RUN_AS_NODE: '1' },
      now: () => new Date('2026-10-08T12:34:56Z'),
      stopDaemon: async () => {
        order.push('daemon')
        expect(fs.existsSync(path.join(upd, 'pending.json'))).toBe(true)
      },
      spawnDetached: (cmd, args, env) => {
        order.push('spawn')
        spawned = { cmd, args, env }
      },
      quit: () => order.push('quit'),
    })
    expect(order).toEqual(['daemon', 'spawn', 'quit'])
    expect(fs.readFileSync(path.join(upd, 'state-20261008-123456.json'), 'utf8')).toBe('{"v":1}')
    expect(JSON.parse(fs.readFileSync(path.join(upd, 'pending.json'), 'utf8'))).toEqual({ from: '0.1.0', to: '0.2.0', at: '2026-10-08T12:34:56.000Z' })
    expect(fs.existsSync(path.join(upd, 'failed.json'))).toBe(false)
    expect(fs.readFileSync(path.join(upd, 'update-helper.sh'), 'utf8')).toBe('echo oi')
    expect(spawned!.cmd).toBe('/bin/sh')
    expect(spawned!.args).toEqual([path.join(upd, 'update-helper.sh'), 'mac-zip', '4242', '/Applications/Gerenciador de Terminal.app', '/u/0.2.0/a.zip', upd, '0.2.0', '0.1.0'])
    expect(spawned!.env).toEqual({ PATH: '/bin' })
  })
  it('sem state.json: segue sem backup', async () => {
    const upd = path.join(tmp(), 'updates')
    const src = path.join(tmp(), 'h.sh')
    fs.writeFileSync(src, '')
    await runInstall({ updatesDir: upd, stateFile: '/nao/existe.json', helperSource: src, from: '0.1.0', ready: { version: '0.2.0', kind: 'appimage', file: 'f' }, target: 't', appPid: 1, env: {}, stopDaemon: async () => {}, spawnDetached: () => {}, quit: () => {} })
    expect(fs.readdirSync(upd).sort()).toEqual(['pending.json', 'update-helper.sh'])
  })
  it('carimbo de horário', () => {
    expect(stamp(new Date('2026-01-02T03:04:05Z'))).toBe('20260102-030405')
  })
  it('ambiente do script sem as variáveis do AppImage e do modo Node', () => {
    expect(helperEnv({ A: '1', APPDIR: 'x', APPIMAGE: 'y', ARGV0: 'z', OWD: 'w', ELECTRON_RUN_AS_NODE: '1' })).toEqual({ A: '1' })
  })
})

describe('daemon encerrado', () => {
  it('true quando o socket para de aceitar; false se continuar no limite', async () => {
    const sock = path.join(tmp(), 's.sock')
    const srv = net.createServer((c) => c.end())
    await new Promise<void>((r) => srv.listen(sock, r))
    expect(await waitSocketGone(sock, 300)).toBe(false)
    setTimeout(() => srv.close(), 100)
    expect(await waitSocketGone(sock, 3000)).toBe(true)
  })
})

describe('onde trocar', () => {
  it('Mac: o .app a partir do executável; Linux: o AppImage; .deb/.rpm: nada', () => {
    expect(installTarget('darwin', '/Applications/Gerenciador de Terminal.app/Contents/MacOS/Gerenciador de Terminal', undefined)).toBe('/Applications/Gerenciador de Terminal.app')
    expect(installTarget('darwin', '/usr/local/bin/electron', undefined)).toBeNull()
    expect(installTarget('linux', '/tmp/.mount_x/gt', '/home/u/Apps/gt.AppImage')).toBe('/home/u/Apps/gt.AppImage')
    expect(installTarget('linux', '/opt/gerenciador-de-terminal/gt', undefined)).toBeNull()
  })
  it('pasta gravável sim; translocado ou sem escrita não', () => {
    const d = tmp()
    expect(canWriteTarget(path.join(d, 'X.app'))).toBe(true)
    expect(canWriteTarget('/private/var/folders/x/AppTranslocation/abc/d/X.app')).toBe(false)
    // como root (testes Linux no Docker) toda pasta aceita escrita
    if (process.getuid?.() !== 0) {
      const ro = tmp()
      fs.chmodSync(ro, 0o500)
      expect(canWriteTarget(path.join(ro, 'X.app'))).toBe(false)
      fs.chmodSync(ro, 0o700)
    }
  })
})
```

Acrescentar em `tests/main/workspaces-model.test.ts` (importar `busySessions, openAfterUpdate` junto dos imports existentes de `../../src/main/workspaces-model`):

```ts
describe('atualização: espaços e sessões', () => {
  const pane = (id: string, status: 'working' | 'needs-you' | 'your-turn' | 'idle' | null) => ({ id, label: id, status })
  const w = (id: string, open: boolean, panes: ReturnType<typeof pane>[] = [], hidden: ReturnType<typeof pane>[] = []) => ({
    id, name: id, open, sessions: panes.length, attention: 0, tabs: [{ id: 't', name: 't', panes }], hidden, floating: [],
  })
  it('conta trabalhando e pedindo algo, em abas e escondidas', () => {
    expect(busySessions([w('a', true, [pane('1', 'working'), pane('2', 'idle')], [pane('3', 'needs-you')]), w('b', false, [pane('4', 'your-turn'), pane('5', null)])])).toBe(2)
  })
  it('reabre os espaços que estavam abertos; nenhum → o primeiro', () => {
    expect(openAfterUpdate([w('a', true), w('b', false), w('c', true)])).toEqual(['a', 'c'])
    expect(openAfterUpdate([w('a', false), w('b', false)])).toEqual(['a'])
    expect(openAfterUpdate([])).toEqual(['principal'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/updater-install.test.ts tests/main/workspaces-model.test.ts`
Expected: FAIL (módulo `install` inexistente; `busySessions`/`openAfterUpdate` não exportados)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/updater/install.ts
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { ReadyArtifact } from './updater'

export interface InstallDeps {
  updatesDir: string
  stateFile: string
  /** update-helper.sh dentro do bundle (resources) */
  helperSource: string
  from: string
  ready: ReadyArtifact
  /** .app (Mac) ou AppImage a trocar */
  target: string
  appPid: number
  env: NodeJS.ProcessEnv
  stopDaemon(): Promise<void>
  spawnDetached(cmd: string, args: string[], env: NodeJS.ProcessEnv): void
  quit(): void
  now?: () => Date
}

export const stamp = (d: Date): string => d.toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-')

/** variáveis do AppImage e do modo Node não vão para o script nem para o app reaberto */
export function helperEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { APPDIR: _a, APPIMAGE: _b, ARGV0: _c, OWD: _d, ELECTRON_RUN_AS_NODE: _e, ...rest } = env
  return rest
}

/** prepara a troca e sai; quem troca é o script, depois que este processo terminar */
export async function runInstall(d: InstallDeps): Promise<void> {
  const now = (d.now ?? (() => new Date()))()
  fs.mkdirSync(d.updatesDir, { recursive: true })
  if (fs.existsSync(d.stateFile)) fs.copyFileSync(d.stateFile, path.join(d.updatesDir, `state-${stamp(now)}.json`))
  fs.writeFileSync(path.join(d.updatesDir, 'pending.json'), JSON.stringify({ from: d.from, to: d.ready.version, at: now.toISOString() }))
  fs.rmSync(path.join(d.updatesDir, 'failed.json'), { force: true })
  // cópia fora do bundle: no AppImage a montagem some quando o app sai
  const helper = path.join(d.updatesDir, 'update-helper.sh')
  fs.copyFileSync(d.helperSource, helper)
  await d.stopDaemon()
  d.spawnDetached('/bin/sh', [helper, d.ready.kind, String(d.appPid), d.target, d.ready.file, d.updatesDir, d.ready.version, d.from], helperEnv(d.env))
  d.quit()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const accepts = (socketPath: string) =>
  new Promise<boolean>((resolve) => {
    const s = net.createConnection(socketPath)
    s.once('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.once('error', () => resolve(false))
  })

/** true quando o daemon parou de aceitar conexões dentro do limite */
export async function waitSocketGone(socketPath: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!(await accepts(socketPath))) return true
    await sleep(100)
  }
  return !(await accepts(socketPath))
}

/** o que o script troca: o .app no Mac, o AppImage no Linux; null = este tipo de instalação não se atualiza */
export function installTarget(platform: string, execPath: string, appImage: string | undefined): string | null {
  if (platform === 'linux') return appImage || null
  if (platform !== 'darwin') return null
  const app = path.resolve(execPath, '..', '..', '..')
  return app.endsWith('.app') ? app : null
}

/** a troca precisa escrever na pasta do bundle; translocado (aberto de Downloads/.dmg) nunca é a pasta real */
export function canWriteTarget(target: string): boolean {
  if (target.includes('/AppTranslocation/')) return false
  try {
    fs.accessSync(path.dirname(target), fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}
```

Acrescentar no fim de `src/main/workspaces-model.ts`:

```ts
/** sessões que seriam interrompidas por uma atualização agora (trabalhando ou pedindo algo), em todos os espaços */
export function busySessions(list: WorkspaceSummary[]): number {
  return list.reduce((acc, w) => acc + [...w.tabs.flatMap((t) => t.panes), ...w.hidden].filter((p) => p.status === 'working' || p.status === 'needs-you').length, 0)
}

/** depois de atualizar: reabre direto os espaços que estavam abertos (sem a tela de reabrir) */
export function openAfterUpdate(list: WorkspaceSummary[]): string[] {
  const open = list.filter((w) => w.open).map((w) => w.id)
  return open.length > 0 ? open : [list[0]?.id ?? 'principal']
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/updater-install.test.ts tests/main/workspaces-model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/updater/install.ts src/main/workspaces-model.ts tests/main/updater-install.test.ts tests/main/workspaces-model.test.ts
git commit -m "feat(atualizacao): preparar a instalação (backup, pendência, daemon encerrado, script destacado) e escolher o que trocar"
```

---

### Task 6: Pós-atualização

**Files:**
- Create: `src/main/updater/after-update.ts`
- Test: `tests/main/updater-after-update.test.ts`

**Interfaces:**
- Produces:
  - `type AfterUpdate = { kind: 'none' } | { kind: 'updated'; to: string } | { kind: 'failed'; to: string; current: string }`
  - `readAfterUpdate(updatesDir: string, current: string): AfterUpdate` — `pending.to === current` → updated; `pending.from === current` **e** `failed.json` existe → failed; `pending.from === current` sem `failed.json` → none (o script ainda pode estar trabalhando: não limpar); outra versão ou sem/ilegível → none
  - quem chama só limpa (`clearAfterUpdate`) quando o resultado não é `none`
  - `markStarted(updatesDir: string, version: string): void` → grava `ok-<version>`
  - `clearAfterUpdate(updatesDir: string): void` → apaga `pending.json` e `failed.json` (os `ok-*` são do script)

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/updater-after-update.test.ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { clearAfterUpdate, markStarted, readAfterUpdate } from '../../src/main/updater/after-update'

const dir = (pending?: unknown, failed = false) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-after-'))
  if (pending !== undefined) fs.writeFileSync(path.join(d, 'pending.json'), typeof pending === 'string' ? pending : JSON.stringify(pending))
  if (failed) fs.writeFileSync(path.join(d, 'failed.json'), '{}')
  return d
}

describe('depois de atualizar', () => {
  it('abriu na versão nova → updated', () => {
    expect(readAfterUpdate(dir({ from: '0.1.0', to: '0.2.0' }), '0.2.0')).toEqual({ kind: 'updated', to: '0.2.0' })
  })
  it('voltou para a anterior → failed', () => {
    expect(readAfterUpdate(dir({ from: '0.1.0', to: '0.2.0' }, true), '0.1.0')).toEqual({ kind: 'failed', to: '0.2.0', current: '0.1.0' })
  })
  it('na versão de origem sem failed.json (o script ainda espera a nova) → none', () => {
    expect(readAfterUpdate(dir({ from: '0.1.0', to: '0.2.0' }), '0.1.0')).toEqual({ kind: 'none' })
  })
  it('pendência de outra versão (instalada à mão), sem pendência ou ilegível → none', () => {
    expect(readAfterUpdate(dir({ from: '0.1.0', to: '0.2.0' }), '0.3.0')).toEqual({ kind: 'none' })
    expect(readAfterUpdate(dir(), '0.2.0')).toEqual({ kind: 'none' })
    expect(readAfterUpdate(dir('{quebrado'), '0.2.0')).toEqual({ kind: 'none' })
    expect(readAfterUpdate(dir({ from: 1 }), '0.2.0')).toEqual({ kind: 'none' })
  })
  it('confirma a abertura e limpa a pendência (o ok fica para o script)', () => {
    const d = dir({ from: '0.1.0', to: '0.2.0' }, true)
    markStarted(d, '0.2.0')
    clearAfterUpdate(d)
    expect(fs.readdirSync(d)).toEqual(['ok-0.2.0'])
  })
  it('pasta inexistente: tudo sem erro', () => {
    const d = path.join(os.tmpdir(), 'gt-nao-existe-' + Date.now())
    expect(readAfterUpdate(d, '0.1.0')).toEqual({ kind: 'none' })
    expect(() => clearAfterUpdate(d)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/updater-after-update.test.ts`
Expected: FAIL (módulo inexistente)

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/updater/after-update.ts
import fs from 'node:fs'
import path from 'node:path'

export type AfterUpdate = { kind: 'none' } | { kind: 'updated'; to: string } | { kind: 'failed'; to: string; current: string }

/** o que a última atualização deixou: abriu na nova, voltou para a anterior ou nada a fazer */
export function readAfterUpdate(updatesDir: string, current: string): AfterUpdate {
  let p: { from?: unknown; to?: unknown }
  try {
    p = JSON.parse(fs.readFileSync(path.join(updatesDir, 'pending.json'), 'utf8'))
  } catch {
    return { kind: 'none' }
  }
  if (typeof p?.from !== 'string' || typeof p.to !== 'string') return { kind: 'none' }
  if (p.to === current) return { kind: 'updated', to: current }
  // sem failed.json o script ainda pode estar esperando a versão nova confirmar
  if (p.from === current && fs.existsSync(path.join(updatesDir, 'failed.json'))) return { kind: 'failed', to: p.to, current }
  return { kind: 'none' }
}

/** o script espera este arquivo para saber que a versão nova abriu */
export function markStarted(updatesDir: string, version: string): void {
  fs.mkdirSync(updatesDir, { recursive: true })
  fs.writeFileSync(path.join(updatesDir, `ok-${version}`), new Date().toISOString())
}

export function clearAfterUpdate(updatesDir: string): void {
  for (const f of ['pending.json', 'failed.json']) fs.rmSync(path.join(updatesDir, f), { force: true })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/main/updater-after-update.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/updater/after-update.ts tests/main/updater-after-update.test.ts
git commit -m "feat(atualizacao): ler o resultado da última atualização e confirmar a abertura da versão nova"
```

---

### Task 7: Ligar no processo principal e na ponte

**Files:**
- Modify: `src/main/windows.ts` (campo `afterUpdate`, método `broadcast`, query em `open`)
- Modify: `src/main/index.ts`
- Modify: `src/shared/bridge.ts`, `src/preload/index.ts`
- Modify: `package.json` (`build.extraResources`)

**Interfaces:**
- Consumes: `Updater` (Task 3); `runInstall`, `waitSocketGone`, `installTarget`, `canWriteTarget` (Task 5); `busySessions`, `openAfterUpdate` (Task 5); `readAfterUpdate`, `markStarted`, `clearAfterUpdate` (Task 6)
- Produces (ponte, usada na Task 8):
  - `GtApi.updateStatus(): Promise<UpdateStatus>`
  - `GtApi.onUpdate(cb: (s: UpdateStatus) => void): () => void` (canal `gt:update`)
  - `GtApi.installUpdate(): Promise<boolean>` (false = cancelado ou nada pronto)
  - janela de espaço aberta logo após atualizar recebe `?updated=<versão>`

Esta tarefa é fiação do Electron (sem lógica nova): a prova é `typecheck` + suíte + build; o comportamento é provado de ponta a ponta na Task 11.

- [ ] **Step 1: `windows.ts` — campo, query e broadcast**

Em `class WindowManager`, junto dos outros campos públicos (`summary`, `quitting`, `background`…):

```ts
  /** versão recém-instalada: as janelas de espaço abertas agora retomam as sessões sozinhas (query updated) */
  afterUpdate: string | null = null
```

Em `open(id)`, trocar a linha `this.load(win, { ws: id, desktop: transparent ? '1' : '0' })` por:

```ts
    this.load(win, { ws: id, desktop: transparent ? '1' : '0', ...(this.afterUpdate ? { updated: this.afterUpdate } : {}) })
```

Logo depois de `detachAll()`:

```ts
  /** manda para todas as janelas de espaço (não para as flutuantes) */
  broadcast(channel: string, payload: unknown): void {
    for (const e of this.entries.values()) if (!e.win.isDestroyed()) e.win.webContents.send(channel, payload)
  }
```

- [ ] **Step 2: ponte (`bridge.ts` e `preload/index.ts`)**

Em `src/shared/bridge.ts`: `import type { UpdateStatus } from './update'` no topo e, no fim de `interface GtApi`:

```ts
  /** estado do atualizador (pronta, só aviso, bloqueada, falhou) */
  updateStatus(): Promise<UpdateStatus>
  onUpdate(cb: (s: UpdateStatus) => void): () => void
  /** instala a versão baixada (confirma se há sessões trabalhando); false = cancelado ou nada pronto */
  installUpdate(): Promise<boolean>
```

Em `src/preload/index.ts`, no objeto `api`, depois de `onWorkspaceCommand`:

```ts
  updateStatus: () => ipcRenderer.invoke('gt:updateStatus'),
  onUpdate: (cb) => {
    const l = (_e: unknown, s: Parameters<typeof cb>[0]) => cb(s)
    ipcRenderer.on('gt:update', l)
    return () => ipcRenderer.removeListener('gt:update', l)
  },
  installUpdate: () => ipcRenderer.invoke('gt:installUpdate'),
```

- [ ] **Step 3: `index.ts` — atualizador, IPC e abertura pós-atualização**

Imports novos no topo:

```ts
import { spawn } from 'node:child_process'
import { Updater } from './updater/updater'
import { canWriteTarget, installTarget, runInstall, waitSocketGone } from './updater/install'
import { clearAfterUpdate, markStarted, readAfterUpdate } from './updater/after-update'
```

e trocar `import { badgeTotal, decideStartup } from './workspaces-model'` por `import { badgeTotal, busySessions, decideStartup, openAfterUpdate } from './workspaces-model'`.

Depois de `manager.desktop = readWindowDesktop(windowDesktopFile)`:

```ts
const updatesDir = path.join(home, 'updates')
const updateTarget = installTarget(process.platform, process.execPath, process.env.APPIMAGE)
const updater = new Updater({
  current: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  appImage: !!process.env.APPIMAGE,
  updatesDir,
  apiUrl: process.env.GT_UPDATE_URL ?? 'https://api.github.com/repos/misasoares/gerenciador-de-terminal/releases/latest',
  fetch: (url, init) => fetch(url, init),
  canWrite: () => !!updateTarget && canWriteTarget(updateTarget),
  onStatus: (s) => manager.broadcast('gt:update', s),
})
let installing = false

/** botão "Atualizar": confirma se há sessões trabalhando; o daemon salva as sessões e o script troca a versão */
async function installUpdate(w: BrowserWindow | undefined): Promise<boolean> {
  const ready = updater.ready
  if (!ready || !updateTarget || installing) return false
  const busy = busySessions(manager.summary)
  if (busy > 0) {
    const opts = {
      type: 'question' as const,
      message: `Atualizar para ${ready.version}?`,
      detail: `${busy === 1 ? '1 sessão está trabalhando' : `${busy} sessões estão trabalhando`}. Elas param agora e são retomadas na nova versão.`,
      buttons: ['Atualizar', 'Cancelar'],
      defaultId: 1,
      cancelId: 1,
    }
    const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts)
    if (r.response !== 0) return false
  }
  installing = true
  try {
    await runInstall({
      updatesDir,
      stateFile: path.join(home, 'state.json'),
      helperSource: path.join(process.resourcesPath, 'update-helper.sh'),
      from: app.getVersion(),
      ready,
      target: updateTarget,
      appPid: process.pid,
      env: process.env,
      // como no "Encerrar tudo": as janelas soltam o daemon antes (senão reconectariam e subiriam outro)
      stopDaemon: async () => {
        manager.quitting = true
        manager.detachAll()
        await service.shutdownDaemon(false)
        if (!(await waitSocketGone(socketPath, 10_000))) console.error('atualização: o daemon não encerrou em 10 s; seguindo')
      },
      spawnDetached: (cmd, args, env) => spawn(cmd, args, { detached: true, stdio: 'ignore', env }).unref(),
      quit: () => app.quit(),
    })
    return true
  } catch (e) {
    installing = false
    throw e
  }
}

/** primeira abertura na versão nova: reabre os espaços abertos direto e cada janela retoma as sessões */
async function startupAfterUpdate(version: string): Promise<void> {
  const list = await service.request<WorkspaceSummary[]>({ t: 'workspace.list' })
  manager.summary = list
  manager.afterUpdate = version
  try {
    for (const id of openAfterUpdate(list)) await manager.open(id)
  } finally {
    manager.afterUpdate = null
  }
  markStarted(updatesDir, version)
}
```

Junto dos outros `ipcMain.handle`:

```ts
ipcMain.handle('gt:updateStatus', () => updater.status)
ipcMain.handle('gt:installUpdate', (e) => installUpdate(winOf(e)))
```

Em `app.whenReady().then(...)`, trocar o bloco `try { ... await startup() } catch` e o que vem depois por:

```ts
app.whenReady().then(async () => {
  handleMediaProtocol()
  const after = readAfterUpdate(updatesDir, app.getVersion())
  try {
    await service.start()
    applyMenu()
    if (after.kind === 'updated') await startupAfterUpdate(after.to)
    else await startup()
  } catch (e) {
    dialog.showErrorBox('Gerenciador de Terminal', `Não foi possível iniciar o daemon.\n\n${String(e)}\n\nVeja ${path.join(home, 'daemon.log')}`)
    app.quit()
    return
  }
  if (after.kind === 'failed') updater.setFailed(after.to, after.current)
  if (after.kind !== 'none') clearAfterUpdate(updatesDir)
  // só o app empacotado se atualiza (no dev o "bundle" seria o Electron do node_modules)
  if (app.isPackaged) {
    setTimeout(() => void updater.check(), 10_000)
    setInterval(() => void updater.check(), 6 * 60 * 60 * 1000)
  }
  // mac: clique no Dock sem janelas → tela de reabrir (ou direto, com 1 espaço)
  app.on('activate', () => {
    if (manager.windows().length === 0) void startup().catch(showOpenError)
  })
})
```

- [ ] **Step 4: `package.json` — script dentro do pacote**

Em `"build"`, depois de `"asarUnpack"`:

```json
    "extraResources": [
      {
        "from": "resources/update-helper.sh",
        "to": "update-helper.sh"
      }
    ],
```

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npx vitest run > .superpowers/vitest.log 2>&1; tail -5 .superpowers/vitest.log && npx electron-vite build`
Expected: typecheck sem erros; suíte toda passando (o `daemon.test` "contratar" é instável sob carga — se falhar só ele, rodar de novo e anotar); build gera `out/` sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/main/windows.ts src/main/index.ts src/shared/bridge.ts src/preload/index.ts package.json
git commit -m "feat(atualizacao): ligar o verificador e a instalação no processo principal; reabrir os espaços e retomar depois de atualizar"
```

---

### Task 8: Interface (barra de status, novidades, retomada automática)

**Files:**
- Create: `src/renderer/src/update-model.ts`
- Create: `src/renderer/src/components/ReleaseNotesModal.tsx`
- Modify: `src/renderer/src/store.ts`, `src/renderer/src/view.ts`, `src/renderer/src/flows.ts`, `src/renderer/src/main.tsx`, `src/renderer/src/components/StatusBar.tsx`, `src/renderer/src/components/Modals.tsx`, `src/renderer/src/styles.css`
- Test: `tests/renderer/update-model.test.ts`

**Interfaces:**
- Consumes: `GtApi.updateStatus/onUpdate/installUpdate` (Task 7); `UpdateStatus` (Task 1)
- Produces:
  - `updateItem(s: UpdateStatus, platform: string): { text: string; tone: 'info' | 'warn'; action: { label: string; run: 'install' | 'open-release' } | null; notes: boolean } | null`
  - `updatedNotice(version: string, resumed: number): string`
  - `resumeAll(): Promise<number>` (número de sessões retomadas)
  - store: `update: UpdateStatus`, `updateNotice: string | null`, modal `{ kind: 'release-notes'; version: string; notes: string }`
  - `UPDATED_TO: string | null` em `view.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/renderer/update-model.test.ts
import { describe, expect, it } from 'vitest'
import { updatedNotice, updateItem } from '../../src/renderer/src/update-model'

describe('item de atualização na barra de status', () => {
  it('pronta: Atualizar + novidades', () => {
    expect(updateItem({ kind: 'ready', version: '0.2.0', notes: 'n' }, 'darwin')).toEqual({
      text: '● Versão 0.2.0 pronta',
      tone: 'info',
      action: { label: 'Atualizar', run: 'install' },
      notes: true,
    })
  })
  it('.deb/.rpm: Baixar abre a release', () => {
    expect(updateItem({ kind: 'notify-only', version: '0.2.0', notes: '', url: 'u' }, 'linux')).toMatchObject({
      text: '● Versão 0.2.0 disponível',
      action: { label: 'Baixar', run: 'open-release' },
      notes: true,
    })
  })
  it('bloqueada: diz o que fazer, por sistema', () => {
    expect(updateItem({ kind: 'blocked', version: '0.2.0', reason: 'not-writable' }, 'darwin')!.text).toBe('Versão 0.2.0 disponível · mova o app para Aplicativos para atualizar')
    expect(updateItem({ kind: 'blocked', version: '0.2.0', reason: 'not-writable' }, 'linux')!.text).toBe('Versão 0.2.0 disponível · mova o AppImage para uma pasta sua para atualizar')
  })
  it('falhou: aviso sem ação', () => {
    expect(updateItem({ kind: 'failed-last', to: '0.2.0', current: '0.1.0' }, 'darwin')).toEqual({
      text: 'A atualização para 0.2.0 falhou; você continua na 0.1.0',
      tone: 'warn',
      action: null,
      notes: false,
    })
  })
  it('ocioso: nada', () => {
    expect(updateItem({ kind: 'idle' }, 'darwin')).toBeNull()
  })
})

describe('aviso depois de atualizar', () => {
  it('singular, plural e nenhuma sessão', () => {
    expect(updatedNotice('0.2.0', 5)).toBe('Atualizado para 0.2.0 · 5 sessões retomadas')
    expect(updatedNotice('0.2.0', 1)).toBe('Atualizado para 0.2.0 · 1 sessão retomada')
    expect(updatedNotice('0.2.0', 0)).toBe('Atualizado para 0.2.0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/update-model.test.ts`
Expected: FAIL (módulo inexistente)

- [ ] **Step 3: `update-model.ts`**

```ts
// src/renderer/src/update-model.ts
import type { UpdateStatus } from '../../shared/update'

export interface UpdateItem {
  text: string
  tone: 'info' | 'warn'
  action: { label: string; run: 'install' | 'open-release' } | null
  /** mostra "Ver novidades" */
  notes: boolean
}

export function updateItem(s: UpdateStatus, platform: string): UpdateItem | null {
  switch (s.kind) {
    case 'ready':
      return { text: `● Versão ${s.version} pronta`, tone: 'info', action: { label: 'Atualizar', run: 'install' }, notes: true }
    case 'notify-only':
      return { text: `● Versão ${s.version} disponível`, tone: 'info', action: { label: 'Baixar', run: 'open-release' }, notes: true }
    case 'blocked':
      return {
        text: `Versão ${s.version} disponível · ${platform === 'darwin' ? 'mova o app para Aplicativos' : 'mova o AppImage para uma pasta sua'} para atualizar`,
        tone: 'warn',
        action: null,
        notes: false,
      }
    case 'failed-last':
      return { text: `A atualização para ${s.to} falhou; você continua na ${s.current}`, tone: 'warn', action: null, notes: false }
    default:
      return null
  }
}

export function updatedNotice(version: string, resumed: number): string {
  const n = resumed === 0 ? '' : resumed === 1 ? ' · 1 sessão retomada' : ` · ${resumed} sessões retomadas`
  return `Atualizado para ${version}${n}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/renderer/update-model.test.ts`
Expected: PASS

- [ ] **Step 5: store, view e flows**

`src/renderer/src/store.ts`:
- `import type { UpdateStatus } from '../../shared/update'`
- em `UiState`, depois de `motion`:
  ```ts
  /** atualizador (processo principal) */
  update: UpdateStatus
  /** "Atualizado para X · N sessões retomadas" na primeira abertura da versão nova */
  updateNotice: string | null
  ```
- em `Modal`, acrescentar `| { kind: 'release-notes'; version: string; notes: string }`
- no estado inicial, acrescentar `update: { kind: 'idle' }, updateNotice: null`

`src/renderer/src/view.ts`, no fim:

```ts
/** janela aberta logo após atualizar para esta versão: retoma as sessões sozinha */
export const UPDATED_TO = q.get('updated')
```

`src/renderer/src/flows.ts`:
- `resumeAll` passa a contar e devolver as retomadas:
  ```ts
  export async function resumeAll(): Promise<number> {
    const missing: string[] = []
    let resumed = 0
    for (const r of getUi().app?.resumable ?? []) {
      try {
        await openNewPane({ paneId: r.paneId, cwd: r.cwd, accountId: r.accountId, resumeSessionId: r.sessionId ?? undefined, resumeAgent: r.agent, transcriptPath: r.transcriptPath ?? null })
        resumed++
      } catch (e) {
        if (isMissing(e)) missing.push(r.paneId)
        else showError(e)
      }
    }
    setUi({ missingResume: missing })
    return resumed
  }
  ```
- no fim do arquivo (com `import type { UpdateStatus } from '../../shared/update'` no topo):
  ```ts
  /** ação do item de atualização da barra de status */
  export function runUpdateAction(s: UpdateStatus): void {
    if (s.kind === 'ready') window.gt.installUpdate().catch(showError)
    else if (s.kind === 'notify-only') void window.gt.openExternal(s.url)
  }

  export function openReleaseNotes(s: UpdateStatus): void {
    if (s.kind === 'ready' || s.kind === 'notify-only') setUi({ modal: { kind: 'release-notes', version: s.version, notes: s.notes } })
  }
  ```

- [ ] **Step 6: main.tsx — estado do atualizador e retomada automática**

Imports: `import { FLOAT_PANE, UPDATED_TO } from './view'` (trocar o import existente de `FLOAT_PANE`), `import { resumeAll } from './flows'`, `import { updatedNotice } from './update-model'`.

Em `bootWorkspace()`, antes de `window.gt.request<AppState>({ t: 'state.get' })`:

```ts
  window.gt.onUpdate((s) => setUi({ update: s }))
  window.gt.updateStatus().then((s) => setUi({ update: s })).catch(() => {})
```

e, dentro do `.then((app) => { ... })` do `state.get`, depois do `if (... accounts ...length === 0) setUi(...)`:

```ts
      // primeira abertura na versão nova: retoma tudo e avisa
      if (UPDATED_TO) {
        const v = UPDATED_TO
        void resumeAll().then((n) => setUi({ updateNotice: updatedNotice(v, n) }))
      }
```

- [ ] **Step 7: StatusBar, modal de novidades e estilos**

`src/renderer/src/components/ReleaseNotesModal.tsx`:

```tsx
import { ModalFrame } from './ModalFrame'
import { setUi } from '../store'

/** notas da release em texto simples (nunca HTML) */
export function ReleaseNotesModal(p: { version: string; notes: string }) {
  const close = () => setUi({ modal: null })
  return (
    <ModalFrame onClose={close} onKeyDown={(e) => e.key === 'Escape' && close()}>
      <h3>Novidades da versão {p.version}</h3>
      <div className="release-notes">{p.notes.trim() || 'Sem notas para esta versão.'}</div>
      <div className="modal-actions">
        <button className="primary" autoFocus onClick={close}>
          Fechar
        </button>
      </div>
    </ModalFrame>
  )
}
```

`Modals.tsx`: `import { ReleaseNotesModal } from './ReleaseNotesModal'` e, em `ModalSwitch`, logo depois da linha do `file-picker`:

```tsx
  if (modal.kind === 'release-notes') return <ReleaseNotesModal version={modal.version} notes={modal.notes} />
```

`StatusBar.tsx`:
- imports: `import { chooseConversationFor, openReleaseNotes, resumeAll, restartDaemonFlow, runUpdateAction } from '../flows'` e `import { updateItem } from '../update-model'`
- depois de `const desktopMismatch = …`:
  ```tsx
  const update = useUi((s) => s.update)
  const updateNotice = useUi((s) => s.updateNotice)
  ```
- depois de `const dismiss = …`: `const upd = updateItem(update, window.gt.platform)`
- logo depois do `<span>{alive === 1 ? … }</span>` inicial:
  ```tsx
      {upd && !dismissed['upd:' + upd.text] && (
        <span className={`st-item${upd.tone === 'warn' ? ' warn' : ''}`}>
          {upd.text}{' '}
          {upd.action && (
            <button className="st-btn" onClick={() => runUpdateAction(update)}>
              {upd.action.label}
            </button>
          )}
          {upd.notes && (
            <button className="st-btn" onClick={() => openReleaseNotes(update)}>
              Ver novidades
            </button>
          )}
          {!upd.action && (
            <button className="st-x" onClick={() => dismiss('upd:' + upd.text)}>
              ✕
            </button>
          )}
        </span>
      )}
      {updateNotice && (
        <span className="st-item">
          {updateNotice}{' '}
          <button className="st-x" onClick={() => setUi({ updateNotice: null })}>
            ✕
          </button>
        </span>
      )}
  ```

`styles.css`, no fim:

```css
.release-notes {
  white-space: pre-wrap;
  max-height: 50vh;
  overflow: auto;
  font-size: 13px;
  line-height: 1.5;
  color: var(--fg);
  margin: 8px 0 16px;
}
```

- [ ] **Step 8: Verificar**

Run: `npm run typecheck && npx vitest run > .superpowers/vitest.log 2>&1; tail -5 .superpowers/vitest.log`
Expected: typecheck sem erros; suíte toda passando.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/update-model.ts src/renderer/src/components/ReleaseNotesModal.tsx src/renderer/src/store.ts src/renderer/src/view.ts src/renderer/src/flows.ts src/renderer/src/main.tsx src/renderer/src/components/StatusBar.tsx src/renderer/src/components/Modals.tsx src/renderer/src/styles.css tests/renderer/update-model.test.ts
git commit -m "feat(atualizacao): aviso na barra de status, novidades da versão e retomada automática das sessões na versão nova"
```

---

### Task 9: Assinatura estável no Mac

**Files:**
- Create: `scripts/mac-cert.sh`, `scripts/mac-sign.sh`
- Modify: `package.json` (`scripts.pack`)

**Interfaces:**
- Produces: identidade `Gerenciador de Terminal Local` no Keychain de login; `npm run pack` assina com ela; `sh scripts/mac-sign.sh` falha com instrução se a identidade faltar.

- [ ] **Step 1: `scripts/mac-cert.sh`**

```sh
#!/bin/sh
# Cria (uma vez) o certificado fixo de assinatura de código no Keychain de login.
# Com a mesma identidade em todos os builds, o macOS mantém as permissões de pastas entre versões.
set -eu
NAME="Gerenciador de Terminal Local"
KC="$HOME/Library/Keychains/login.keychain-db"
if security find-identity -v -p codesigning | grep -q "$NAME"; then
  echo "certificado \"$NAME\" já existe"
  exit 0
fi
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat >"$TMP/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$TMP/cert.cnf" -keyout "$TMP/key.pem" -out "$TMP/cert.pem"
/usr/bin/openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -out "$TMP/cert.p12" -passout pass:gt
security import "$TMP/cert.p12" -k "$KC" -P gt -T /usr/bin/codesign
# confiança só para assinatura de código (o macOS pede a senha)
security add-trusted-cert -r trustRoot -p codeSign -k "$KC" "$TMP/cert.pem"
security find-identity -v -p codesigning | grep "$NAME"
```

- [ ] **Step 2: `scripts/mac-sign.sh`**

```sh
#!/bin/sh
# Assina o .app do dist com o certificado fixo (criado uma vez por scripts/mac-cert.sh).
set -eu
NAME="Gerenciador de Terminal Local"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
APP=$(ls -d "$ROOT"/dist/mac*/"Gerenciador de Terminal.app" 2>/dev/null | head -n 1)
[ -n "$APP" ] || { echo "app não encontrado em dist/mac*"; exit 1; }
security find-identity -v -p codesigning | grep -q "$NAME" || { echo "certificado \"$NAME\" ausente: rode uma vez  sh scripts/mac-cert.sh"; exit 1; }
codesign --force --deep --sign "$NAME" "$APP"
codesign --verify --deep --strict "$APP"
echo "assinado: $APP"
```

`chmod +x scripts/mac-cert.sh scripts/mac-sign.sh`

- [ ] **Step 3: `package.json`**

Trocar o script `pack` por:

```json
    "pack": "electron-vite build && electron-builder --mac --dir && sh scripts/mac-sign.sh",
```

- [ ] **Step 4: Verificar a falha sem certificado**

Run: `security find-identity -v -p codesigning | grep -c "Gerenciador de Terminal Local"; sh scripts/mac-sign.sh; echo "saída=$?"`
Expected (antes do certificado): `0`, a mensagem `certificado "Gerenciador de Terminal Local" ausente: rode uma vez  sh scripts/mac-cert.sh` e `saída=1`. (Se já existir, pular para o Step 6.)

- [ ] **Step 5: Criar o certificado (o usuário digita a senha)**

Pedir ao usuário para rodar no prompt: `! sh scripts/mac-cert.sh` (o macOS pede a senha do Mac para confiar no certificado).
Expected: a última linha lista `"Gerenciador de Terminal Local"` como identidade válida.

- [ ] **Step 6: Empacotar e conferir a identidade**

Run: `npm run pack > .superpowers/pack.log 2>&1; tail -3 .superpowers/pack.log; codesign -dr - "dist/mac-arm64/Gerenciador de Terminal.app" 2>&1 | tail -1; ls "dist/mac-arm64/Gerenciador de Terminal.app/Contents/Resources/update-helper.sh"`
Expected: `assinado: …/Gerenciador de Terminal.app`; o requisito designado contém `certificate leaf = H"…"` (não `cdhash`); o `update-helper.sh` existe dentro de `Resources`.

- [ ] **Step 7: Commit**

```bash
git add scripts/mac-cert.sh scripts/mac-sign.sh package.json
git commit -m "build(mac): assinar com certificado próprio e fixo para o macOS manter as permissões entre versões"
```

---

### Task 10: Publicar (`npm run release -- <versão>`)

**Files:**
- Create: `scripts/release-notes.mjs`, `scripts/release.sh`
- Modify: `package.json` (`scripts.release`)
- Test: `tests/main/release-scripts.test.ts`

**Interfaces:**
- Produces: `git log --format=%s A..B | node scripts/release-notes.mjs` → linhas `- Novo: …` (feat) e depois `- Corrigido: …` (fix), ou `- Melhorias internas`; `sh scripts/release.sh <versão>` publica (guardas antes de mexer em qualquer coisa).

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/release-scripts.test.ts
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')

describe('notas da release', () => {
  it('feat vira Novo, fix vira Corrigido (Novo primeiro); o resto some', () => {
    const r = spawnSync('node', ['scripts/release-notes.mjs'], {
      cwd: ROOT,
      input: 'fix(abas): contorno da aba ativa\nfeat(atualizacao): atualização pelo app\ndocs: spec\nchore(release): 0.1.0\nfeat: tela nova\n',
      encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('- Novo: Atualização pelo app\n- Novo: Tela nova\n- Corrigido: Contorno da aba ativa\n')
  })
  it('sem feat/fix → Melhorias internas', () => {
    const r = spawnSync('node', ['scripts/release-notes.mjs'], { cwd: ROOT, input: 'docs: x\n', encoding: 'utf8' })
    expect(r.stdout).toBe('- Melhorias internas\n')
  })
})

describe('release.sh: guardas antes de mexer em qualquer coisa', () => {
  const pkg = () => fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
  it('versão inválida ou não maior que a atual → erro, package.json intacto', () => {
    const before = pkg()
    for (const v of ['abc', '0.0.1', JSON.parse(before).version]) {
      const r = spawnSync('sh', ['scripts/release.sh', v], { cwd: ROOT, encoding: 'utf8' })
      expect(r.status).not.toBe(0)
      expect(r.stderr).toMatch(/versão/)
    }
    expect(pkg()).toBe(before)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/release-scripts.test.ts`
Expected: FAIL (scripts inexistentes: status ≠ 0 com stdout vazio; "versão" ausente do stderr)

- [ ] **Step 3: `scripts/release-notes.mjs`**

```js
#!/usr/bin/env node
// Notas da release a partir dos assuntos dos commits (stdin, um por linha): feat → Novo, fix → Corrigido.
import { readFileSync } from 'node:fs'

const novo = []
const corrigido = []
for (const s of readFileSync(0, 'utf8').split('\n')) {
  const m = /^(feat|fix)(\([^)]*\))?!?:\s*(.+)$/.exec(s.trim())
  if (!m) continue
  const text = m[3].charAt(0).toUpperCase() + m[3].slice(1)
  ;(m[1] === 'feat' ? novo : corrigido).push(`- ${m[1] === 'feat' ? 'Novo' : 'Corrigido'}: ${text}`)
}
const lines = [...novo, ...corrigido]
process.stdout.write((lines.length ? lines : ['- Melhorias internas']).join('\n') + '\n')
```

- [ ] **Step 4: `scripts/release.sh`**

```sh
#!/bin/sh
# Publica uma versão: testes, builds Mac (.zip assinado) e Linux (AppImage/.deb/.rpm), SHA256SUMS, tag e release no GitHub.
# uso: npm run release -- 0.2.0
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
die() { echo "release: $*" >&2; exit 1; }

V="${1:-}"
echo "$V" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "versão inválida: \"$V\" (use maior.menor.correção, ex.: 0.2.0)"
CUR=$(node -p "require('./package.json').version")
[ "$V" != "$CUR" ] && [ "$(printf '%s\n%s\n' "$CUR" "$V" | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)" = "$V" ] \
  || die "a versão $V precisa ser maior que a atual ($CUR)"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "rode na main"
[ -z "$(git status --porcelain)" ] || die "há mudanças não commitadas"
gh auth status >/dev/null 2>&1 || die "gh sem login (gh auth login)"
docker info >/dev/null 2>&1 || die "Docker não está rodando (o build Linux precisa dele)"

COMMITTED=0
restore() { [ "$COMMITTED" = 1 ] || git checkout -- package.json package-lock.json 2>/dev/null || true; }
trap restore EXIT

echo "== testes"
npm test
echo "== versão $CUR → $V"
npm version "$V" --no-git-tag-version >/dev/null

OUT="$ROOT/dist/release-$V"
rm -rf "$OUT"
mkdir -p "$OUT"
echo "== Mac"
npm run pack
ARCH=$(uname -m)
[ "$ARCH" = x86_64 ] && ARCH=x64
APP=$(ls -d "$ROOT"/dist/mac*/"Gerenciador de Terminal.app" | head -n 1)
ditto -c -k --keepParent "$APP" "$OUT/gerenciador-de-terminal-$V-mac-$ARCH.zip"
echo "== Linux"
sh scripts/build-linux.sh
cp "$ROOT"/dist/gerenciador-de-terminal-"$V"-* "$OUT"/
(cd "$OUT" && shasum -a 256 gerenciador-de-terminal-* >"$ROOT/dist/SHA256SUMS.tmp" && mv "$ROOT/dist/SHA256SUMS.tmp" SHA256SUMS)
ls "$OUT"

PREV=$(git describe --tags --abbrev=0 2>/dev/null || true)
NOTES=$(git log --format=%s ${PREV:+"$PREV"..}HEAD | node scripts/release-notes.mjs)

git commit -qam "chore(release): $V"
COMMITTED=1
git tag "v$V"
git push origin main "v$V"
gh release create "v$V" "$OUT"/* --title "$V" --notes "$NOTES"
echo "publicado: v$V"
```

`chmod +x scripts/release.sh`. Em `package.json` → `scripts`: `"release": "sh scripts/release.sh"`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/main/release-scripts.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/release-notes.mjs scripts/release.sh package.json tests/main/release-scripts.test.ts
git commit -m "build(release): comando npm run release que testa, gera Mac e Linux, calcula SHA256SUMS e publica a release no GitHub"
```

---

### Task 11: Teste real de ponta a ponta (Mac isolado) e Linux

**Files:**
- Create (fora do repo): `<scratchpad>/pw/e2e-update.cjs`, `<scratchpad>/pw/fake-release.cjs`

**Interfaces:**
- Consumes: tudo das Tasks 1–10.

Nenhum código do produto muda aqui, a não ser correções de bugs achados (cada uma com teste que falha primeiro, na tarefa dona do código, e anotada no ledger).

- [ ] **Step 1: Gerar duas versões de teste (0.0.1 instalada e 0.0.2 publicada) e uma "quebrada" (0.0.3)**

```sh
E2E=/tmp/gte2e; rm -rf $E2E; mkdir -p $E2E/apps $E2E/rel $E2E/home
builtin cd "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal"
npm version 0.0.1 --no-git-tag-version >/dev/null && npm run pack >/dev/null && ditto "dist/mac-arm64/Gerenciador de Terminal.app" "$E2E/apps/Gerenciador de Terminal.app"
npm version 0.0.2 --no-git-tag-version >/dev/null && npm run pack >/dev/null && ditto -c -k --keepParent "dist/mac-arm64/Gerenciador de Terminal.app" $E2E/rel/gerenciador-de-terminal-0.0.2-mac-arm64.zip
# 0.0.3 "quebrada": dentro está a 0.0.2, então ela abre mas nunca confirma como 0.0.3 (como uma versão nova travada) e o script tem de voltar
cp $E2E/rel/gerenciador-de-terminal-0.0.2-mac-arm64.zip $E2E/rel/gerenciador-de-terminal-0.0.3-mac-arm64.zip
git checkout -- package.json package-lock.json
(cd $E2E/rel && shasum -a 256 *.zip > SHA256SUMS)
```

Expected: três `.zip` + `SHA256SUMS` em `/tmp/gte2e/rel`; `git status` limpo.

- [ ] **Step 2: Servidor de release falsa**

```js
// <scratchpad>/pw/fake-release.cjs — uso: node fake-release.cjs <versão servida> <porta>
const http = require('http')
const fs = require('fs')
const path = require('path')
const REL = '/tmp/gte2e/rel'
const [ver, port] = process.argv.slice(2)
http
  .createServer((req, res) => {
    const base = `http://127.0.0.1:${port}`
    if (req.url === '/latest') {
      res.setHeader('content-type', 'application/json')
      return res.end(JSON.stringify({
        tag_name: 'v' + ver, body: `- Novo: teste ${ver}`, html_url: base + '/rel', draft: false, prerelease: false,
        assets: [`gerenciador-de-terminal-${ver}-mac-arm64.zip`, 'SHA256SUMS'].map((n) => ({ name: n, browser_download_url: `${base}/f/${n}`, size: fs.statSync(path.join(REL, n)).size })),
      }))
    }
    const f = path.join(REL, decodeURIComponent((req.url || '').replace(/^\/f\//, '')))
    if (req.url?.startsWith('/f/') && fs.existsSync(f)) return fs.createReadStream(f).pipe(res)
    res.statusCode = 404
    res.end()
  })
  .listen(Number(port), () => console.log('release falsa', ver, 'em', port))
```

- [ ] **Step 3: Roteiro de ponta a ponta**

```js
// <scratchpad>/pw/e2e-update.cjs — uso: node e2e-update.cjs <versão esperada após a troca> [falha]
// abre a cópia instalada (GT_HOME isolado), cria 2 terminais, espera "Versão X pronta", clica Atualizar e confere a troca
const { _electron } = require('playwright-core')
const fs = require('fs')
const { execSync } = require('child_process')
const E2E = '/tmp/gte2e'
const APP = `${E2E}/apps/Gerenciador de Terminal.app`
const HOME = `${E2E}/home`
const [expected] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const plist = () => execSync(`/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "${APP}/Contents/Info.plist"`).toString().trim()

;(async () => {
  const before = plist()
  const app = await _electron.launch({ executablePath: `${APP}/Contents/MacOS/Gerenciador de Terminal`, env: { ...process.env, GT_HOME: HOME, GT_UPDATE_URL: 'http://127.0.0.1:47123/latest' }, timeout: 0 })
  const w = await app.firstWindow()
  await sleep(3000)
  const later = w.getByRole('button', { name: 'Depois', exact: true })
  if (await later.count()) await later.click()
  await w.evaluate(async () => {
    for (let i = 0; i < 2; i++) await window.gt.request({ t: 'pane.create', paneId: crypto.randomUUID(), cwd: '/tmp', accountId: null, cols: 100, rows: 30 })
  })
  const panesBefore = (await w.evaluate(() => window.gt.request({ t: 'state.get' }))).panes.filter((p) => p.alive).length
  console.log('versão antes', before, '· terminais vivos', panesBefore)
  await w.getByText(/Versão .* pronta/).waitFor({ timeout: 60_000 })
  console.log('aviso:', await w.locator('.statusbar').innerText())
  await w.getByRole('button', { name: 'Atualizar', exact: true }).click()
  await new Promise((r) => app.on('close', r))
  console.log('app antigo saiu; esperando o script')
  const log = `${HOME}/updates/helper.log`
  for (let i = 0; i < 180 && !/(ok: |falhou: a versão)/.test(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''); i++) await sleep(500)
  await sleep(6000)
  console.log(fs.readFileSync(log, 'utf8'))
  console.log('versão depois', plist(), '(esperado', expected + ')')
  const st = JSON.parse(fs.readFileSync(`${HOME}/state.json`, 'utf8'))
  console.log('painéis vivos no state.json', st.panes.length, '· retomáveis', st.workspaces.map((x) => x.resumable.length))
  console.log('sobrou .anterior?', fs.existsSync(APP.replace(/\.app$/, '.anterior.app')))
  console.log('pendências', fs.readdirSync(`${HOME}/updates`))
  process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 4: Rodar o caminho feliz (0.0.1 → 0.0.2)**

Run (dois comandos, o servidor em segundo plano): `node <scratchpad>/pw/fake-release.cjs 0.0.2 47123` e `node <scratchpad>/pw/e2e-update.cjs 0.0.2`
Expected:
- antes `0.0.1`, 2 terminais vivos; aparece `● Versão 0.0.2 pronta · Atualizar · Ver novidades`;
- `helper.log` termina com `ok: 0.0.2`; versão depois `0.0.2`;
- `state.json` com 2 painéis vivos e 0 retomáveis (as sessões voltaram sozinhas);
- não sobrou `.anterior.app`; `updates/` sem `pending.json`/`failed.json`;
- a janela reaberta mostra `Atualizado para 0.0.2 · 2 sessões retomadas` (conferir com `screencapture -x <scratchpad>/pw/e2e-depois.png` e ler a imagem).

- [ ] **Step 5: Rodar o caminho de falha (0.0.2 → "0.0.3" que não confirma)**

Matar a cópia de teste aberta (`pkill -f "/tmp/gte2e/apps/"`), parar o servidor, subir `node fake-release.cjs 0.0.3 47123` e rodar `node e2e-update.cjs 0.0.2 falha`.
Expected: `helper.log` com `falhou: a versão 0.0.3 não confirmou em 60s; voltando para 0.0.2`; versão depois `0.0.2`; a janela reaberta mostra `A atualização para 0.0.3 falhou; você continua na 0.0.2` (captura de tela); sessões retomáveis listadas (o usuário retoma com "Retomar todas").

- [ ] **Step 6: Linux**

Run: `npm run pack:linux > .superpowers/linux.log 2>&1; tail -15 .superpowers/linux.log`
Expected: testes no Linux passam (inclui os do script auxiliar em modo AppImage; os do Mac aparecem como "skipped"); `.deb`, `.rpm` e `.AppImage` gerados; instalação limpa `INSTALACAO-OK` no Debian e no Fedora.

- [ ] **Step 7: Limpeza**

Run: `pkill -f "/tmp/gte2e/apps/"; pkill -f "fake-release.cjs"; pkill -f "gerenciador-de-terminal/node_modules/electron/dist"; sleep 1; pgrep -fl "/tmp/gte2e|fake-release|node_modules/electron/dist" | wc -l; git status --porcelain`
Expected: `0` processos; `git status` limpo (package.json restaurado).

- [ ] **Step 8: Commit (só se houve correção)**

Correções achadas aqui já foram commitadas com seus testes; nada a commitar nesta etapa se não houve.

---

## Fora deste plano (próximos passos, cada um com confirmação)

1. **Repositório público** (spec §8): varrer o histórico por chaves/tokens/dados de clientes, mostrar o resultado e só então mudar a visibilidade com confirmação explícita.
2. **Primeira release real**: `npm run release -- 0.2.0` e instalar a 0.2.0 manualmente uma última vez (app fechado, SIGTERM no daemon com backup do `state.json`). A troca da assinatura ad hoc para o certificado fixo pode pedir as permissões de pastas uma última vez.
