import { describe, expect, it } from 'vitest'
import { hasShellDescendant, shouldHibernate, type Candidate } from '../../src/daemon/hibernator'
import type { Proc } from '../../src/daemon/platform/procs'
import { Hibernator, type HibernatorDeps, type Hibernation } from '../../src/daemon/hibernator'
import type { PaneRecord } from '../../src/daemon/panes'
import { EMPTY_INFERENCE } from '../../src/daemon/agent-worktree'
import type { ClaudeSession } from '../../src/shared/types'

const T = 30 * 60_000
const base: Candidate = { status: 'your-turn', statusSince: 0, focused: false, leader: false, hired: false, shellBusy: false, hibernated: false, waking: false, cooldownUntil: 0 }

describe('shouldHibernate', () => {
  it('ociosa além do limite e fora de foco: hiberna (⚪ e 🔵)', () => {
    expect(shouldHibernate(base, T, T)).toBe(true)
    expect(shouldHibernate({ ...base, status: 'idle' }, T, T)).toBe(true)
  })
  it('antes do limite não hiberna', () => {
    expect(shouldHibernate(base, T - 1, T)).toBe(false)
  })
  it('trabalhando, pedindo permissão ou sem agente não hiberna', () => {
    expect(shouldHibernate({ ...base, status: 'working' }, T, T)).toBe(false)
    expect(shouldHibernate({ ...base, status: 'needs-you' }, T, T)).toBe(false)
    expect(shouldHibernate({ ...base, status: null }, T, T)).toBe(false)
  })
  it('foco, líder, contratado, shell ocupado, já hibernada ou acordando não hiberna', () => {
    for (const k of ['focused', 'leader', 'hired', 'shellBusy', 'hibernated', 'waking'] as const) {
      expect(shouldHibernate({ ...base, [k]: true }, T, T)).toBe(false)
    }
  })
  it('respeita o resfriamento', () => {
    expect(shouldHibernate({ ...base, cooldownUntil: T + 1 }, T, T)).toBe(false)
    expect(shouldHibernate({ ...base, cooldownUntil: T }, T, T)).toBe(true)
  })
})

describe('hasShellDescendant', () => {
  const p = (pid: number, ppid: number, args: string): Proc => ({ pid, ppid, stat: 'S', args })
  it('MCP em node não conta; shell do Bash (mesmo neto) conta', () => {
    const procs = [p(10, 1, 'claude --resume x'), p(11, 10, 'node /x/playwright-mcp/cli.js'), p(12, 10, '/bin/zsh -c source snap.sh && npm run dev'), p(13, 12, 'node server.js')]
    expect(hasShellDescendant(procs, 10)).toBe(true)
    expect(hasShellDescendant(procs.filter((x) => x.pid !== 12 && x.pid !== 13), 10)).toBe(false)
  })
  it('reconhece sh, bash, -zsh e fish; não confunde nomes parecidos', () => {
    for (const a of ['sh -c x', '/bin/bash -lc y', '-zsh', '/opt/homebrew/bin/fish -c z', 'dash']) {
      expect(hasShellDescendant([p(1, 0, 'claude'), p(2, 1, a)], 1)).toBe(true)
    }
    expect(hasShellDescendant([p(1, 0, 'claude'), p(2, 1, 'node /x/shellcheck.js'), p(3, 1, 'zshdb')], 1)).toBe(false)
  })
})

const MIN = 60_000

function rec(id: string, claude: Partial<ClaudeSession> | null = {}): PaneRecord {
  return {
    id, seq: 1, cwd: '/p', alive: true, exitCode: null, launchedAccountId: 'misa', accountId: 'misa', configDir: null, claudeArgv: null,
    claude: claude && { sessionId: `s-${id}`, agent: 'claude', status: 'your-turn', statusSince: 0, title: null, transcriptPath: `/t/${id}.jsonl`, ...claude },
    missingPolls: 0, projectPath: null, worktreePath: null, inference: EMPTY_INFERENCE, inferredProjectPath: null,
    agentProcSince: null, lastHookAt: 0, agentHooksMissing: false, workspaceId: 'principal', hibernated: null, waking: null, hibernateCooldownUntil: 0,
    createdAt: 0, lastUserInputAt: 0, lastOutputAt: 0, sessionStartedAt: null,
  }
}

/** shell 100+i com o agente 200+i; ignoreTerm = agente que não sai com SIGTERM */
function world(recs: PaneRecord[], o: { now?: number; focused?: string[]; extraProcs?: Proc[]; ignoreTerm?: boolean; ignoreKill?: boolean } = {}) {
  const alive = new Set(recs.map((_, i) => 200 + i))
  const signals: [number, string][] = []
  const writes: [string, string][] = []
  let now = o.now ?? 31 * MIN
  const focused = new Set(o.focused ?? [])
  const procs = (): Proc[] => [
    ...recs.map((_, i) => ({ pid: 100 + i, ppid: 1, stat: alive.has(200 + i) ? 'Ss' : 'Ss+', args: '/bin/zsh -il' })),
    ...recs.flatMap((_, i) => (alive.has(200 + i) ? [{ pid: 200 + i, ppid: 100 + i, stat: 'S+', args: 'claude --resume x' }] : [])),
    ...(o.extraProcs ?? []),
  ]
  const deps: HibernatorDeps = {
    records: () => recs,
    shellPid: (id) => 100 + recs.findIndex((r) => r.id === id),
    write: (id, data) => writes.push([id, data]),
    resumeCommand: (_paneId: string, h: Hibernation) => `claude --resume ${h.sessionId}`,
    settings: () => ({ enabled: true, minutes: 30 }),
    meta: () => ({ leader: false, hired: false }),
    focused: () => focused,
    onChange: () => {},
    snapshot: async () => procs(),
    signal: (pid, sig) => {
      signals.push([pid, sig])
      if (sig === 'SIGTERM' && !o.ignoreTerm) alive.delete(pid)
      if (sig === 'SIGKILL' && !o.ignoreKill) alive.delete(pid)
    },
    exists: (pid) => alive.has(pid),
    now: () => now,
    sleep: async (ms) => {
      now += ms
    },
  }
  return { h: new Hibernator(deps), signals, writes, focused, alive, deps }
}

describe('Hibernator', () => {
  it('hiberna a ociosa: SIGTERM no agente e grava sessão, conta, transcript e título', async () => {
    const r = rec('a', { title: 'Refatorar auth' })
    const w = world([r])
    await w.h.tick()
    expect(w.signals).toEqual([[200, 'SIGTERM']])
    expect(r.hibernated).toMatchObject({ sessionId: 's-a', agent: 'claude', accountId: 'misa', transcriptPath: '/t/a.jsonl', title: 'Refatorar auth' })
    expect(r.alive).toBe(true)
  })

  it('desligada, em foco ou com shell descendente não hiberna', async () => {
    const off = world([rec('a')])
    off.deps.settings = () => ({ enabled: false, minutes: 30 })
    await off.h.tick()
    expect(off.signals).toEqual([])
    const foc = world([rec('a')], { focused: ['a'] })
    await foc.h.tick()
    expect(foc.signals).toEqual([])
    const busy = world([rec('a')], { extraProcs: [{ pid: 300, ppid: 200, stat: 'S', args: '/bin/zsh -c npm run dev' }] })
    await busy.h.tick()
    expect(busy.signals).toEqual([])
  })

  it('agente que ignora SIGTERM leva SIGKILL; se nem assim sai, resfria 30 min', async () => {
    const r = rec('a')
    const w = world([r], { ignoreTerm: true })
    await w.h.tick()
    expect(w.signals).toEqual([[200, 'SIGTERM'], [200, 'SIGKILL']])
    expect(r.hibernated).not.toBeNull()

    const r2 = rec('b')
    const w2 = world([r2], { ignoreTerm: true, ignoreKill: true })
    await w2.h.tick()
    expect(r2.hibernated).toBeNull()
    expect(r2.hibernateCooldownUntil).toBeGreaterThan(60 * MIN)
  })

  it('atividade durante a espera cancela: sem SIGKILL e sem hibernar', async () => {
    const r = rec('a')
    const w = world([r], { ignoreTerm: true })
    w.deps.sleep = async () => {
      r.claude = { ...r.claude!, status: 'working' }
    }
    await w.h.tick()
    expect(w.signals).toEqual([[200, 'SIGTERM']])
    expect(r.hibernated).toBeNull()
  })

  it('painel fechado durante a espera: não grava nada', async () => {
    const r = rec('a')
    const w = world([r], { ignoreTerm: true })
    w.deps.sleep = async () => {
      r.alive = false
    }
    await w.h.tick()
    expect(r.hibernated).toBeNull()
  })

  it('acorda: digita o comando no shell ocioso, marca waking e corrige a conta', async () => {
    const r = rec('a')
    const w = world([r])
    await w.h.tick()
    r.accountId = null
    expect(await w.h.wake('a')).toBe(true)
    expect(w.writes).toEqual([['a', '\x15claude --resume s-a\r']])
    expect(r.hibernated).toBeNull()
    expect(r.waking).not.toBeNull()
    expect(r.accountId).toBe('misa')
  })

  it('dois focos juntos digitam o comando uma vez só', async () => {
    const r = rec('a')
    const w = world([r])
    await w.h.tick()
    await Promise.all([w.h.wake('a'), w.h.wake('a')])
    expect(w.writes).toHaveLength(1)
  })

  it('shell ocupado: não digita, só tira o 💤', async () => {
    const r = rec('a')
    const w = world([r], { extraProcs: [{ pid: 400, ppid: 100, stat: 'S+', args: 'vim x' }] })
    await w.h.tick()
    expect(await w.h.wake('a')).toBe(false)
    expect(w.writes).toEqual([])
    expect(r.hibernated).toBeNull()
    expect(r.waking).toBeNull()
  })

  it('foco chega durante a espera: hiberna e acorda em seguida', async () => {
    const r = rec('a')
    const w = world([r], { ignoreTerm: true })
    w.deps.sleep = async () => {
      w.focused.add('a')
    }
    await w.h.tick()
    expect(w.writes).toEqual([['a', '\x15claude --resume s-a\r']])
    expect(r.hibernated).toBeNull()
    expect(r.waking).not.toBeNull()
  })

  it('waking expira em 60 s', async () => {
    const r = rec('a', null)
    r.waking = { since: 0 }
    const w = world([r], { now: 61_000 })
    await w.h.tick()
    expect(r.waking).toBeNull()
  })
})
