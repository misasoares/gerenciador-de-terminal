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
