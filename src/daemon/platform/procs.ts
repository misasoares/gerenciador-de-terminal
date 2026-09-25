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

/** sem locale UTF-8 o lsof escreve bytes não-ASCII como \xNN */
function decodeLsofEscapes(s: string): string {
  if (!s.includes('\\x')) return s
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) {
    const m = /^\\x([0-9a-fA-F]{2})/.exec(s.slice(i, i + 4))
    if (m) {
      bytes.push(parseInt(m[1], 16))
      i += 3
    } else {
      bytes.push(...Buffer.from(s[i], 'utf8'))
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

export function parseLsofCwd(out: string): Map<number, string> {
  const result = new Map<number, string>()
  let pid: number | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid !== null) result.set(pid, decodeLsofEscapes(line.slice(1)))
  }
  return result
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    // lsof sai com código 1 se algum pid sumiu; a saída parcial ainda vale.
    // App aberto pelo Finder não tem LANG: força UTF-8 para caminhos com acento.
    const env = { ...process.env, LC_ALL: 'en_US.UTF-8' }
    execFile(cmd, args, { timeout: 5000, maxBuffer: 8 * 1024 * 1024, env }, (_err, stdout) => resolve(String(stdout ?? '')))
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
