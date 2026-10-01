import fs from 'node:fs'
import path from 'node:path'
import type { Account, AgentKind, ConversationInfo } from '../../shared/types'
import { claudeFilesFor, findClaudeFile, readClaudeConversation, type RawConversation } from './claude'
import { codexFiles, findCodexFile, readCodexConversation } from './codex'
import { pool, projectDirName } from './files'

/** contas que retomam conversas daquele perfil, na ordem da lista de agentes */
export function candidateAccounts(accounts: Account[], agent: AgentKind, profile: string, defaultProfile: string, loginDirs: Record<string, string>): string[] {
  return accounts
    .filter((a) => a.agent === agent)
    .filter((a) => {
      if (a.id in loginDirs) return (loginDirs[a.id] || defaultProfile) === profile
      if (profile === defaultProfile) return a.isDefault || a.configDirMatch.length === 0
      return a.configDirMatch.some((m) => profile.includes(m))
    })
    .map((a) => a.id)
}

export interface IndexDeps {
  userHome: string
  claudeProfiles: () => string[]
  codexHomes: () => string[]
  accounts: () => Account[]
  loginDirs: () => Record<string, string>
  openSessions: () => Map<string, string>
  /** worktrees cadastradas: candidatas a pasta de retomada */
  knownPaths: () => string[]
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))]
const title80 = (c: RawConversation) => (c.title ?? c.firstPrompt ?? '').slice(0, 80)

export class ConversationIndex {
  private cache = new Map<string, { size: number; mtimeMs: number; conv: RawConversation | null }>()
  /** arquivos lidos de verdade (para teste do cache) */
  reads = 0

  constructor(private d: IndexDeps) {}

  private defaultProfile(agent: AgentKind): string {
    return path.join(this.d.userHome, agent === 'claude' ? '.claude' : '.codex')
  }

  profiles(agent: AgentKind): string[] {
    const learned = this.d.accounts().filter((a) => a.agent === agent).map((a) => this.d.loginDirs()[a.id]).filter((v): v is string => !!v)
    return uniq([this.defaultProfile(agent), ...(agent === 'claude' ? this.d.claudeProfiles() : this.d.codexHomes()), ...learned])
  }

  private async read(file: string, profile: string, agent: AgentKind): Promise<RawConversation | null> {
    const st = await fs.promises.stat(file).catch(() => null)
    if (!st) return null
    const hit = this.cache.get(file)
    if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.conv
    this.reads++
    const conv = agent === 'claude' ? await readClaudeConversation(file, profile) : await readCodexConversation(file, profile)
    this.cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, conv })
    return conv
  }

  async list(paths: string[]): Promise<ConversationInfo[]> {
    // Claude: a pasta onde o arquivo está é a pasta de retomada (o cwd de dentro do arquivo pode ser outro)
    const jobs: { file: string; profile: string; agent: AgentKind; dirCwd: string | null }[] = []
    for (const profile of this.profiles('claude')) for (const p of paths) for (const file of await claudeFilesFor(profile, p)) jobs.push({ file, profile, agent: 'claude', dirCwd: p })
    for (const home of this.profiles('codex')) for (const file of await codexFiles(home)) jobs.push({ file, profile: home, agent: 'codex', dirCwd: null })
    const read = await pool(jobs, 8, async (j) => ({ c: await this.read(j.file, j.profile, j.agent), dirCwd: j.dirCwd }))
    const raws = read.filter((r): r is { c: RawConversation; dirCwd: string | null } => r.c !== null)
    const wanted = new Set(paths)
    const accounts = this.d.accounts()
    const loginDirs = this.d.loginDirs()
    const open = this.d.openSessions()
    const byId = new Map<string, ConversationInfo>()
    for (const { c, dirCwd } of raws) {
      if (c.agent === 'codex' && (!c.startCwd || !wanted.has(c.startCwd))) continue
      const ids = candidateAccounts(accounts, c.agent, c.profile, this.defaultProfile(c.agent), loginDirs)
      const key = `${c.agent}:${c.sessionId}`
      const prev = byId.get(key)
      if (prev) {
        prev.accountIds = accounts.map((a) => a.id).filter((id) => prev.accountIds.includes(id) || ids.includes(id))
        continue
      }
      byId.set(key, {
        agent: c.agent,
        sessionId: c.sessionId,
        cwd: dirCwd ?? c.startCwd ?? paths[0],
        title: title80(c),
        branch: c.branch,
        lastActivity: c.lastActivity,
        messages: c.messages,
        accountIds: ids,
        openPaneId: open.get(c.sessionId) ?? null,
      })
    }
    return [...byId.values()].sort((a, b) => b.lastActivity - a.lastActivity)
  }

  async locate(agent: AgentKind, sessionId: string, transcriptPath: string | null): Promise<{ file: string; startCwd: string | null } | null> {
    let found: { file: string; profile: string } | null = null
    if (transcriptPath && fs.existsSync(transcriptPath)) found = { file: transcriptPath, profile: path.dirname(path.dirname(path.dirname(transcriptPath))) }
    if (!found) found = agent === 'claude' ? await findClaudeFile(this.profiles('claude'), sessionId) : await findCodexFile(this.profiles('codex'), sessionId)
    if (!found) return null
    const conv = await this.read(found.file, found.profile, agent)
    if (agent === 'claude') {
      const dir = path.basename(path.dirname(found.file))
      const hit = [...(conv?.cwds ?? []), ...this.d.knownPaths()].find((c) => projectDirName(c) === dir)
      if (hit) return { file: found.file, startCwd: hit }
    }
    return { file: found.file, startCwd: conv?.startCwd ?? null }
  }
}
