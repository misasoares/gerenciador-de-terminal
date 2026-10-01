import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { existing, FileWatcher, listFiles, MAX_BYTES, readFile, writeFile } from '../../src/daemon/files'

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

describe('existing com bases extras', () => {
  it('procura também a partir da raiz da worktree e da principal', async () => {
    const d = tmp()
    fs.mkdirSync(path.join(d, 'docs'))
    fs.writeFileSync(path.join(d, 'docs', 'r.md'), '')
    fs.mkdirSync(path.join(d, 'sub'))
    expect(await existing(path.join(d, 'sub'), ['docs/r.md'])).toEqual([])
    expect(await existing(path.join(d, 'sub'), ['docs/r.md'], [d])).toEqual([{ path: 'docs/r.md', abs: path.join(d, 'docs', 'r.md') }])
  })
})

