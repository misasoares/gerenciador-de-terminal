import { execFile } from 'node:child_process'

export interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
}

const GIT_ENV = {
  GIT_TERMINAL_PROMPT: '0',
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
