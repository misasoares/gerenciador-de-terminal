import fs from 'node:fs'
import path from 'node:path'
import type { RawConversation } from './claude'
import { jsonLines, readHead } from './files'

const HEAD = 256 * 1024

function userText(o: Record<string, unknown>): string | null {
  const p = o.payload as { type?: unknown; role?: unknown; content?: unknown } | undefined
  if (o.type !== 'response_item' || !p || p.type !== 'message' || p.role !== 'user' || !Array.isArray(p.content)) return null
  const t = p.content.find((c) => c && typeof c === 'object' && (c as { type?: unknown }).type === 'input_text') as { text?: unknown } | undefined
  const text = typeof t?.text === 'string' ? t.text.trim() : ''
  return text && !text.startsWith('<') ? text : null
}

export async function readCodexConversation(file: string, home: string): Promise<RawConversation | null> {
  let st: fs.Stats
  try {
    st = await fs.promises.stat(file)
  } catch {
    return null
  }
  const lines = jsonLines(await readHead(file, HEAD).catch(() => ''))
  const metaLine = lines.find((o) => o.type === 'session_meta')
  const meta = metaLine?.payload as { id?: unknown; cwd?: unknown; git?: { branch?: unknown } } | undefined
  if (!meta || typeof meta.id !== 'string') return null
  let firstPrompt: string | null = null
  let messages = 0
  for (const o of lines) {
    const t = userText(o)
    if (!t) continue
    messages++
    if (!firstPrompt) firstPrompt = t
  }
  if (!firstPrompt) return null
  return {
    agent: 'codex',
    sessionId: meta.id,
    file,
    profile: home,
    startCwd: typeof meta.cwd === 'string' ? meta.cwd : null,
    cwds: typeof meta.cwd === 'string' ? [meta.cwd] : [],
    title: null,
    firstPrompt,
    branch: typeof meta.git?.branch === 'string' ? meta.git.branch : null,
    lastActivity: st.mtimeMs,
    messages,
  }
}

async function dirs(p: string): Promise<string[]> {
  const e = await fs.promises.readdir(p, { withFileTypes: true }).catch(() => [])
  return e.filter((d) => d.isDirectory()).map((d) => d.name).sort()
}

export async function codexFiles(home: string): Promise<string[]> {
  const root = path.join(home, 'sessions')
  const out: string[] = []
  for (const y of await dirs(root))
    for (const m of await dirs(path.join(root, y)))
      for (const d of await dirs(path.join(root, y, m))) {
        const dayDir = path.join(root, y, m, d)
        const names = await fs.promises.readdir(dayDir).catch(() => [] as string[])
        for (const n of names.sort()) if (n.startsWith('rollout-') && n.endsWith('.jsonl')) out.push(path.join(dayDir, n))
      }
  return out
}

export async function findCodexFile(homes: string[], sessionId: string): Promise<{ file: string; profile: string } | null> {
  for (const home of homes) {
    const f = (await codexFiles(home)).find((x) => x.endsWith(`-${sessionId}.jsonl`))
    if (f) return { file: f, profile: home }
  }
  return null
}
