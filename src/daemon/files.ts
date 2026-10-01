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

/** relativos: tenta o cwd e depois as bases extras (raiz da worktree, pasta principal do projeto) */
export async function existing(cwd: string, paths: string[], bases: string[] = []): Promise<{ path: string; abs: string }[]> {
  const out: { path: string; abs: string }[] = []
  for (const p of paths) {
    const tries = path.isAbsolute(p) ? [p] : [cwd, ...bases].map((b) => path.resolve(b, p))
    for (const abs of tries) {
      const st = await fs.promises.stat(abs).catch(() => null)
      if (st?.isFile()) {
        out.push({ path: p, abs })
        break
      }
    }
  }
  return out
}

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
