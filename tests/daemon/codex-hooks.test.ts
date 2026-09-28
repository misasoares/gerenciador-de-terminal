import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkTargets, CLAUDE_HOOK_EVENTS, CODEX_HOOK_EVENTS, codexHooksFile, hasHooks, hookCommand, hookTargets, installHooks, writeHookScript } from '../../src/daemon/hooks'
import { startServer, type RpcServer } from '../../src/daemon/server'
import type { ClientRequest } from '../../src/shared/protocol'
import { runWithInput } from '../helpers/run'
import { waitFor } from '../helpers/wait'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-cx-')))
let server: RpcServer | null = null
afterEach(async () => { await server?.close(); server = null })

describe('comandos por agente', () => {
  it('Claude: comando idêntico ao já instalado; Codex: passa o tipo e devolve {}', () => {
    expect(hookCommand('/h/gt-hook')).toBe(`sh -c '[ -x "$0" ] && exec "$0"; cat >/dev/null' "/h/gt-hook"`)
    expect(hookCommand('/h/gt-hook', 'claude')).toBe(hookCommand('/h/gt-hook'))
    expect(hookCommand('/h/gt-hook', 'codex')).toBe(`sh -c '[ -x "$0" ] && exec "$0" codex; cat >/dev/null; printf "{}"' "/h/gt-hook"`)
  })
  it('eventos do Codex', () => {
    expect(CODEX_HOOK_EVENTS).toEqual(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd'])
    expect(CLAUDE_HOOK_EVENTS).toContain('CwdChanged')
  })
})

describe('stdout do hook no Codex é sempre {}', () => {
  it('fora do app, sem daemon e com o script ausente', async () => {
    const dir = tmp()
    const script = path.join(dir, 'bin', 'gt-hook')
    writeHookScript(script)
    const cmd = hookCommand(script, 'codex')
    const env = { PATH: '/usr/bin:/bin' }
    expect(await runWithInput('/bin/sh', ['-c', cmd], '{}', env)).toMatchObject({ code: 0, stdout: '{}' })
    expect(await runWithInput('/bin/sh', ['-c', cmd], '{}', { ...env, GT_PANE_ID: 'p', GT_SOCKET: path.join(dir, 'x.sock') })).toMatchObject({ code: 0, stdout: '{}' })
    fs.rmSync(script)
    expect(await runWithInput('/bin/sh', ['-c', cmd], '{}', env)).toMatchObject({ code: 0, stdout: '{}' })
    // Claude continua sem imprimir nada
    writeHookScript(script)
    expect(await runWithInput('/bin/sh', ['-c', hookCommand(script)], '{}', env)).toMatchObject({ code: 0, stdout: '' })
  })

  it('entrega ao daemon com agent=codex e configDir do CODEX_HOME', async () => {
    const dir = tmp()
    const script = path.join(dir, 'bin', 'gt-hook')
    writeHookScript(script)
    const sock = path.join(dir, 'd.sock')
    const got: ClientRequest[] = []
    server = await startServer(sock, (req, conn) => { got.push(req); conn.end(); return null })
    const r = await runWithInput('/bin/sh', ['-c', hookCommand(script, 'codex')], JSON.stringify({ hook_event_name: 'Stop', session_id: 's', cwd: '/w' }), {
      PATH: '/usr/bin:/bin', GT_PANE_ID: 'p1', GT_SOCKET: sock, CODEX_HOME: '/u/.codex-trabalho', CLAUDE_CONFIG_DIR: '/nao/usar',
    })
    expect(r).toMatchObject({ code: 0, stdout: '{}' })
    await waitFor(() => got.length === 1)
    expect(got[0]).toEqual({ t: 'hook', paneId: 'p1', configDir: '/u/.codex-trabalho', agent: 'codex', payload: { hook_event_name: 'Stop', session_id: 's', cwd: '/w' } })
  })
})

describe('arquivo de hooks do Codex', () => {
  it('usa CODEX_HOME ou ~/.codex; só entra na lista se houver agente Codex', () => {
    expect(codexHooksFile('/Users/u', {})).toBe('/Users/u/.codex/hooks.json')
    expect(codexHooksFile('/Users/u', { CODEX_HOME: '/x/cx' })).toBe('/x/cx/hooks.json')
    expect(hookTargets('/Users/u', new Set(['claude']), {}).some((t) => t.agent === 'codex')).toBe(false)
    expect(hookTargets('/Users/u', new Set(['claude', 'codex']), {}).filter((t) => t.agent === 'codex').map((t) => t.file)).toEqual(['/Users/u/.codex/hooks.json'])
  })

  it('cria o hooks.json, preserva hooks alheios e recusa JSON inválido', () => {
    const dir = tmp()
    const file = path.join(dir, '.codex', 'hooks.json')
    const cmd = hookCommand('/h/gt-hook', 'codex')
    installHooks(file, cmd, CODEX_HOOK_EVENTS)
    expect(hasHooks(JSON.parse(fs.readFileSync(file, 'utf8')), cmd, CODEX_HOOK_EVENTS)).toBe(true)
    const own = { description: 'meus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'python3 meu.py' }] }] } }
    fs.writeFileSync(file, JSON.stringify(own))
    installHooks(file, cmd, CODEX_HOOK_EVENTS)
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(saved.description).toBe('meus')
    expect(saved.hooks.Stop[0]).toEqual(own.hooks.Stop[0])
    expect(hasHooks(saved, cmd, CODEX_HOOK_EVENTS)).toBe(true)
    fs.writeFileSync(file, '{ quebrado')
    expect(() => installHooks(file, cmd, CODEX_HOOK_EVENTS)).toThrow('não é um JSON válido')
    expect(fs.readFileSync(file, 'utf8')).toBe('{ quebrado')
  })

  it('checkTargets aponta só o que falta, por tipo', () => {
    const home = tmp()
    fs.mkdirSync(path.join(home, '.claude'))
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{}')
    const targets = hookTargets(home, new Set(['claude', 'codex']), {})
    const cmdFor = (a: 'claude' | 'codex') => hookCommand('/h/gt-hook', a)
    expect(checkTargets(targets, cmdFor).sort()).toEqual([path.join(home, '.claude', 'settings.json'), path.join(home, '.codex', 'hooks.json')].sort())
    installHooks(path.join(home, '.codex', 'hooks.json'), cmdFor('codex'), CODEX_HOOK_EVENTS)
    expect(checkTargets(targets, cmdFor)).toEqual([path.join(home, '.claude', 'settings.json')])
  })
})
