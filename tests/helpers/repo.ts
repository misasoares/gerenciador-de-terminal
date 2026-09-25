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
