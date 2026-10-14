import { describe, expect, it } from 'vitest'
import { hasShellDescendant, shouldHibernate, type Candidate } from '../../src/daemon/hibernator'
import type { Proc } from '../../src/daemon/platform/procs'

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
