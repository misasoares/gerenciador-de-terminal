import fs from 'node:fs'
import path from 'node:path'
import type { AgentKind } from '../../shared/types'
import { jsonLines, projectDirName, readHead, readTail } from './files'

const HEAD = 64 * 1024
const TAIL = 64 * 1024

export interface RawConversation {
  agent: AgentKind
  sessionId: string
  file: string
  profile: string
  /** cwd de início: a pasta onde o arquivo foi gravado e onde o --resume encontra a conversa */
  startCwd: string | null
  /** todos os cwd vistos no arquivo (para achar a pasta de onde retomar) */
  cwds: string[]
  title: string | null
  firstPrompt: string | null
  branch: string | null
  lastActivity: number
  /** mensagens do usuário vistas no começo+fim (aproximado em arquivos grandes) */
  messages: number
}

/** texto de uma mensagem do usuário, ou null se for de sistema/ferramenta */
function userText(o: Record<string, unknown>): string | null {
  if (o.type !== 'user' || o.isMeta === true) return null
  const msg = o.message as { role?: unknown; content?: unknown } | undefined
  if (!msg || msg.role !== 'user') return null
  let text: string | null = null
  if (typeof msg.content === 'string') text = msg.content
  else if (Array.isArray(msg.content)) {
    const t = msg.content.find((c) => c && typeof c === 'object' && (c as { type?: unknown }).type === 'text') as { text?: unknown } | undefined
    if (typeof t?.text === 'string') text = t.text
  }
  if (!text) return null
  const trimmed = text.trim()
  return trimmed && !trimmed.startsWith('<') ? trimmed : null
}

export async function readClaudeConversation(file: string, profile: string): Promise<RawConversation | null> {
  let st: fs.Stats
  try {
    st = await fs.promises.stat(file)
  } catch {
    return null
  }
  if (st.size === 0) return null
  const head = jsonLines(await readHead(file, HEAD))
  const tail = st.size > HEAD ? jsonLines(await readTail(file, TAIL)) : []
  const all = [...head, ...tail]
  let startCwd: string | null = null
  const cwds = new Set<string>()
  let branch: string | null = null
  let firstPrompt: string | null = null
  let custom: string | null = null
  let ai: string | null = null
  let messages = 0
  for (const o of all) {
    if (typeof o.cwd === 'string') {
      if (!startCwd) startCwd = o.cwd
      cwds.add(o.cwd)
    }
    if (!branch && typeof o.gitBranch === 'string' && o.gitBranch) branch = o.gitBranch
    if (o.type === 'custom-title' && typeof o.customTitle === 'string') custom = o.customTitle
    if (o.type === 'ai-title' && typeof o.aiTitle === 'string') ai = o.aiTitle
    const t = userText(o)
    if (t) {
      messages++
      if (!firstPrompt) firstPrompt = t
    }
  }
  const title = custom ?? ai
  if (!firstPrompt && !title) return null
  return { agent: 'claude', sessionId: path.basename(file, '.jsonl'), file, profile, startCwd, cwds: [...cwds], title, firstPrompt, branch, lastActivity: st.mtimeMs, messages }
}

export async function claudeFilesFor(profile: string, cwd: string): Promise<string[]> {
  const dir = path.join(profile, 'projects', projectDirName(cwd))
  const names = await fs.promises.readdir(dir).catch(() => [] as string[])
  return names.filter((n) => n.endsWith('.jsonl')).sort().map((n) => path.join(dir, n))
}

export async function findClaudeFile(profiles: string[], sessionId: string): Promise<{ file: string; profile: string } | null> {
  for (const profile of profiles) {
    const root = path.join(profile, 'projects')
    const dirs = await fs.promises.readdir(root).catch(() => [] as string[])
    for (const d of dirs) {
      const f = path.join(root, d, `${sessionId}.jsonl`)
      if (fs.existsSync(f)) return { file: f, profile }
    }
  }
  return null
}
