import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkProfiles, HOOK_EVENTS, hasHooks, hookCommand, installHooks, mergeHooks, writeHookScript } from '../../src/daemon/hooks'
import { startServer, type RpcServer } from '../../src/daemon/server'
import type { ClientRequest } from '../../src/shared/protocol'
import { runWithInput } from '../helpers/run'
import { waitFor } from '../helpers/wait'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-h-')))
const CMD = '"/Users/u/.gerenciador-terminal/bin/gt-hook"'
const RTK = { matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook' }] }

describe('mergeHooks', () => {
  it('acrescenta em todos os eventos e preserva o hook existente', () => {
    const out = mergeHooks({ model: 'x', hooks: { PreToolUse: [RTK] } }, CMD) as { model: string; hooks: Record<string, unknown[]> }
    expect(out.model).toBe('x')
    expect(out.hooks.PreToolUse[0]).toEqual(RTK)
    for (const ev of HOOK_EVENTS) expect(out.hooks[ev]).toContainEqual({ hooks: [{ type: 'command', command: CMD, timeout: 5 }] })
    expect(hasHooks(out, CMD)).toBe(true)
  })

  it('é idempotente e substitui versão antiga do próprio hook', () => {
    const once = mergeHooks({}, '"/velho/gt-hook"')
    const twice = mergeHooks(mergeHooks(once, CMD), CMD) as { hooks: Record<string, unknown[]> }
    for (const ev of HOOK_EVENTS) expect(twice.hooks[ev]).toHaveLength(1)
    expect(hasHooks(twice, '"/velho/gt-hook"')).toBe(false)
  })

  it('nunca registra WorktreeCreate/WorktreeRemove', () => {
    expect(HOOK_EVENTS).not.toContain('WorktreeCreate')
    expect(HOOK_EVENTS).not.toContain('WorktreeRemove')
  })
})

describe('installHooks', () => {
  it('escreve no alvo do symlink, mantém o symlink e faz backup', () => {
    const dir = tmp()
    const real = path.join(dir, 'real.json')
    const link = path.join(dir, 'settings.json')
    fs.writeFileSync(real, JSON.stringify({ hooks: { PreToolUse: [RTK] } }))
    fs.symlinkSync(real, link)
    const { backup } = installHooks(link, CMD)
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    const saved = JSON.parse(fs.readFileSync(real, 'utf8'))
    expect(saved.hooks.PreToolUse[0]).toEqual(RTK)
    expect(hasHooks(saved, CMD)).toBe(true)
    expect(backup && fs.existsSync(backup)).toBe(true)
  })

  it('JSON inválido: lança e não toca no arquivo', () => {
    const f = path.join(tmp(), 'settings.json')
    fs.writeFileSync(f, '{ ruim')
    expect(() => installHooks(f, CMD)).toThrow('não é um JSON válido')
    expect(fs.readFileSync(f, 'utf8')).toBe('{ ruim')
  })

  it('cria o arquivo quando não existe', () => {
    const f = path.join(tmp(), 'nova', 'settings.json')
    installHooks(f, CMD)
    expect(hasHooks(JSON.parse(fs.readFileSync(f, 'utf8')), CMD)).toBe(true)
  })
})

describe('checkProfiles', () => {
  it('lista cada arquivo real sem hooks uma única vez (symlinks dos perfis do cswap)', () => {
    const home = tmp()
    const main = path.join(home, '.claude', 'settings.json')
    fs.mkdirSync(path.dirname(main), { recursive: true })
    fs.writeFileSync(main, '{}')
    const profileA = path.join(home, '.claude-swap-backup', 'sessions', '1-a')
    const profileB = path.join(home, '.claude-swap-backup', 'sessions', '2-b')
    fs.mkdirSync(profileA, { recursive: true })
    fs.mkdirSync(profileB, { recursive: true })
    fs.symlinkSync(main, path.join(profileA, 'settings.json'))
    fs.writeFileSync(path.join(profileB, 'settings.json'), '{}')

    expect(checkProfiles(home, CMD)).toEqual([main, path.join(profileB, 'settings.json')])
    for (const f of checkProfiles(home, CMD)) installHooks(f, CMD)
    expect(checkProfiles(home, CMD)).toEqual([])
  })
})

describe('script gt-hook', () => {
  let server: RpcServer | null = null
  afterEach(async () => { await server?.close(); server = null })

  function setup() {
    const dir = tmp()
    const script = path.join(dir, 'bin', 'gt-hook')
    writeHookScript(script)
    expect(hookCommand(script)).toBe(`"${script}"`)
    return { dir, script }
  }

  it('fora do app: sai 0, rápido e sem stdout', async () => {
    const { script } = setup()
    const r = await runWithInput('/bin/sh', [script], '{"hook_event_name":"Stop"}', { PATH: '/usr/bin:/bin' })
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(r.ms).toBeLessThan(1000)
  })

  it('daemon ausente: sai 0, rápido e sem stdout', async () => {
    const { dir, script } = setup()
    const r = await runWithInput('/bin/sh', [script], '{}', { PATH: '/usr/bin:/bin', GT_PANE_ID: 'p1', GT_SOCKET: path.join(dir, 'nada.sock') })
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(r.ms).toBeLessThan(1000)
  })

  it('entrega o evento ao daemon, com JSON em várias linhas e config dir com aspas', async () => {
    const { dir, script } = setup()
    const sock = path.join(dir, 'd.sock')
    const got: ClientRequest[] = []
    server = await startServer(sock, (req, conn) => { got.push(req); conn.end(); return null })
    const payload = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 's1', cwd: '/Volumes/SSD MISA/x' }, null, 2)
    const r = await runWithInput('/bin/sh', [script], payload, {
      PATH: '/usr/bin:/bin', GT_PANE_ID: 'p1', GT_SOCKET: sock, CLAUDE_CONFIG_DIR: '/tmp/perfil "estranho"',
    })
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(r.ms).toBeLessThan(1500)
    await waitFor(() => got.length === 1)
    expect(got[0]).toEqual({
      t: 'hook', paneId: 'p1', configDir: '/tmp/perfil "estranho"',
      payload: { hook_event_name: 'SessionStart', session_id: 's1', cwd: '/Volumes/SSD MISA/x' },
    })
  })
})
