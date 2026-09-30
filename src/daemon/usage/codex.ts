import fs from 'node:fs'
import path from 'node:path'
import type { UsageWindow } from '../../shared/types'
import type { Login, ReadResult } from './types'

const TAIL_BYTES = 256 * 1024
const KIND_BY_MINUTES: Record<number, UsageWindow['kind']> = { 300: '5h', 10080: 'week' }

function findRateLimits(o: unknown, depth = 0): Record<string, unknown> | null {
  if (!o || typeof o !== 'object' || depth > 4) return null
  const rec = o as Record<string, unknown>
  if (rec.rate_limits && typeof rec.rate_limits === 'object') return rec.rate_limits as Record<string, unknown>
  for (const v of Object.values(rec)) {
    const found = findRateLimits(v, depth + 1)
    if (found) return found
  }
  return null
}

function toWindow(w: unknown): UsageWindow | null {
  if (!w || typeof w !== 'object') return null
  const r = w as { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown }
  const kind = typeof r.window_minutes === 'number' ? KIND_BY_MINUTES[r.window_minutes] : undefined
  if (!kind || typeof r.used_percent !== 'number') return null
  return { kind, percent: r.used_percent, resetsAt: typeof r.resets_at === 'number' ? r.resets_at * 1000 : null }
}

/** último rate_limits do texto (linhas JSONL); linhas que não são JSON são ignoradas */
export function parseCodexRateLimits(text: string): { windows: UsageWindow[]; plan: string | null } | null {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue
    let obj: unknown
    try {
      obj = JSON.parse(lines[i])
    } catch {
      continue
    }
    const rl = findRateLimits(obj)
    if (!rl) continue
    const windows = [toWindow(rl.primary), toWindow(rl.secondary)].filter((w): w is UsageWindow => w !== null)
    return { windows, plan: typeof rl.plan_type === 'string' ? rl.plan_type : null }
  }
  return null
}

async function sortedDirs(dir: string): Promise<string[]> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse()
}

/** sessions/AAAA/MM/DD/rollout-*.jsonl mais recente */
export async function latestRollout(sessionsDir: string): Promise<string | null> {
  for (const y of await sortedDirs(sessionsDir))
    for (const m of await sortedDirs(path.join(sessionsDir, y)))
      for (const d of await sortedDirs(path.join(sessionsDir, y, m))) {
        const dayDir = path.join(sessionsDir, y, m, d)
        const files = (await fs.promises.readdir(dayDir).catch(() => [] as string[])).filter((f) => f.startsWith('rollout-') && f.endsWith('.jsonl'))
        let best: { f: string; t: number } | null = null
        for (const f of files) {
          const st = await fs.promises.stat(path.join(dayDir, f)).catch(() => null)
          if (st && (!best || st.mtimeMs > best.t)) best = { f: path.join(dayDir, f), t: st.mtimeMs }
        }
        if (best) return best.f
      }
  return null
}

async function readTail(file: string): Promise<string> {
  const fh = await fs.promises.open(file, 'r')
  try {
    const { size } = await fh.stat()
    const len = Math.min(size, TAIL_BYTES)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, size - len)
    return buf.toString('utf8')
  } finally {
    await fh.close()
  }
}

export async function readCodex(login: Login, o: { userHome: string }): Promise<ReadResult> {
  const dir = login.configDir || path.join(o.userHome, '.codex')
  const file = await latestRollout(path.join(dir, 'sessions'))
  if (!file) return { kind: 'no-data' }
  const parsed = parseCodexRateLimits(await readTail(file).catch(() => ''))
  return parsed ? { kind: 'ok', ...parsed } : { kind: 'no-data' }
}
