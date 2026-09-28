import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cwdOf, parseLsofCwd } from '../../src/daemon/platform/procs'
import { buildPaneEnv, nextMissingPolls } from '../../src/daemon/panes'
import { reduceSession } from '../../src/daemon/session'
import { hookCommand, writeHookScript } from '../../src/daemon/hooks'
import { git } from '../../src/daemon/git/run'
import { runWithInput } from '../helpers/run'
import { makeRepo, type TestRepo } from '../helpers/repo'

let repo: TestRepo | null = null
afterEach(() => { repo?.cleanup(); repo = null })

describe('I1: lsof com acento e sem LANG', () => {
  it('parseLsofCwd decodifica \\xNN', () => {
    expect(parseLsofCwd('p1\nfcwd\nn/tmp/a\\xc3\\xa7\\xc3\\xa3o x\n').get(1)).toBe('/tmp/ação x')
  })
  it('cwdOf devolve o caminho com acento mesmo sem LANG no daemon', async () => {
    const dir = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-l-'))), 'ação x')
    fs.mkdirSync(dir)
    const saved = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL, LC_CTYPE: process.env.LC_CTYPE }
    delete process.env.LANG; delete process.env.LC_ALL; delete process.env.LC_CTYPE
    const child = spawn('/bin/sleep', ['10'], { cwd: dir })
    try {
      await new Promise((r) => setTimeout(r, 100))
      expect((await cwdOf([child.pid!])).get(child.pid!)).toBe(dir)
    } finally {
      child.kill()
      Object.assign(process.env, Object.fromEntries(Object.entries(saved).filter(([, v]) => v !== undefined)))
    }
  })
})

describe('I2: ambiente herdado de uma sessão do Claude', () => {
  it('remove CLAUDE*, AI_AGENT, GIT_EDITOR, PAGER, NODE_OPTIONS, ELECTRON_*, VSCODE_*, npm_*', () => {
    const env = buildPaneEnv({
      PATH: '/bin', HOME: '/h', CLAUDE_EFFORT: 'medium', CLAUDE_PID: '1', AI_AGENT: 'claude-code_x', GIT_EDITOR: 'true', PAGER: 'cat',
      NODE_OPTIONS: '--x', ELECTRON_RENDERER_URL: 'u', VSCODE_PID: '2', npm_lifecycle_event: 'dev',
    })
    expect(Object.keys(env).sort()).toEqual(['COLORTERM', 'HOME', 'LANG', 'PATH', 'TERM', 'TERM_PROGRAM'])
  })
})

describe('I4: interrupção com Esc não deixa 🟢/🟡 preso', () => {
  it('idle_prompt depois de Esc vira sua vez', () => {
    const s = reduceSession(null, { hook_event_name: 'UserPromptSubmit', session_id: 's', cwd: '/' })
    expect(reduceSession(s, { hook_event_name: 'Notification', session_id: 's', cwd: '/', notification_type: 'idle_prompt' })?.status).toBe('your-turn')
  })
})

describe('I7: hook tolera o script ausente', () => {
  it('sem o script: sai 0, sem stdout; com o script: executa', async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-c-')))
    const script = path.join(dir, 'pasta com espaço', 'gt-hook')
    const cmd = hookCommand(script)
    expect(cmd).toContain('gt-hook')
    const missing = await runWithInput('/bin/sh', ['-c', cmd], '{"hook_event_name":"Stop"}', { PATH: '/usr/bin:/bin', GT_PANE_ID: 'p' })
    expect(missing).toMatchObject({ code: 0, stdout: '' })
    writeHookScript(script)
    const present = await runWithInput('/bin/sh', ['-c', cmd], '{}', { PATH: '/usr/bin:/bin' })
    expect(present).toMatchObject({ code: 0, stdout: '' })
  })
})

describe('I8: git respeita core.sshCommand', () => {
  it('não força GIT_SSH_COMMAND', async () => {
    repo = makeRepo()
    const r = await git(repo.dir, ['-c', 'alias.envx=!env', 'envx'])
    expect(r.ok).toBe(true)
    expect(r.stdout).not.toMatch(/^GIT_SSH_COMMAND=/m)
    expect(r.stdout).toMatch(/^GIT_TERMINAL_PROMPT=0$/m)
  })
})

describe('I9: contagem de leituras sem o processo claude', () => {
  it('zera quando o processo aparece e ignora snapshot vazio', () => {
    expect(nextMissingPolls(1, { found: true, snapshotEmpty: false })).toBe(0)
    expect(nextMissingPolls(1, { found: false, snapshotEmpty: false })).toBe(2)
    expect(nextMissingPolls(1, { found: false, snapshotEmpty: true })).toBe(1)
  })
})
