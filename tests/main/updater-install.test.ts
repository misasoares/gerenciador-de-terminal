import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { canWriteTarget, helperEnv, installTarget, runInstall, stamp, waitSocketGone } from '../../src/main/updater/install'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gt-inst-'))

describe('instalação', () => {
  it('na ordem: backup, pending, script copiado, daemon encerrado, script chamado, app sai', async () => {
    const home = tmp()
    const upd = path.join(home, 'updates')
    fs.writeFileSync(path.join(home, 'state.json'), '{"v":1}')
    fs.mkdirSync(upd)
    fs.writeFileSync(path.join(upd, 'failed.json'), '{}')
    const helperSource = path.join(home, 'helper-original.sh')
    fs.writeFileSync(helperSource, 'echo oi')
    const order: string[] = []
    let spawned: { cmd: string; args: string[]; env: NodeJS.ProcessEnv } | null = null
    await runInstall({
      updatesDir: upd,
      stateFile: path.join(home, 'state.json'),
      helperSource,
      from: '0.1.0',
      ready: { version: '0.2.0', kind: 'mac-zip', file: '/u/0.2.0/a.zip' },
      target: '/Applications/Gerenciador de Terminal.app',
      appPid: 4242,
      env: { PATH: '/bin', APPIMAGE: '/x', ELECTRON_RUN_AS_NODE: '1' },
      now: () => new Date('2026-10-08T12:34:56Z'),
      stopDaemon: async () => {
        order.push('daemon')
        expect(fs.existsSync(path.join(upd, 'pending.json'))).toBe(true)
      },
      spawnDetached: (cmd, args, env) => {
        order.push('spawn')
        spawned = { cmd, args, env }
      },
      quit: () => order.push('quit'),
    })
    expect(order).toEqual(['daemon', 'spawn', 'quit'])
    expect(fs.readFileSync(path.join(upd, 'state-20261008-123456.json'), 'utf8')).toBe('{"v":1}')
    expect(JSON.parse(fs.readFileSync(path.join(upd, 'pending.json'), 'utf8'))).toEqual({ from: '0.1.0', to: '0.2.0', at: '2026-10-08T12:34:56.000Z' })
    expect(fs.existsSync(path.join(upd, 'failed.json'))).toBe(false)
    expect(fs.readFileSync(path.join(upd, 'update-helper.sh'), 'utf8')).toBe('echo oi')
    expect(spawned!.cmd).toBe('/bin/sh')
    expect(spawned!.args).toEqual([path.join(upd, 'update-helper.sh'), 'mac-zip', '4242', '/Applications/Gerenciador de Terminal.app', '/u/0.2.0/a.zip', upd, '0.2.0', '0.1.0'])
    expect(spawned!.env).toEqual({ PATH: '/bin' })
  })
  it('sem state.json: segue sem backup', async () => {
    const upd = path.join(tmp(), 'updates')
    const src = path.join(tmp(), 'h.sh')
    fs.writeFileSync(src, '')
    await runInstall({ updatesDir: upd, stateFile: '/nao/existe.json', helperSource: src, from: '0.1.0', ready: { version: '0.2.0', kind: 'appimage', file: 'f' }, target: 't', appPid: 1, env: {}, stopDaemon: async () => {}, spawnDetached: () => {}, quit: () => {} })
    expect(fs.readdirSync(upd).sort()).toEqual(['pending.json', 'update-helper.sh'])
  })
  it('carimbo de horário', () => {
    expect(stamp(new Date('2026-01-02T03:04:05Z'))).toBe('20260102-030405')
  })
  it('ambiente do script sem as variáveis do AppImage e do modo Node', () => {
    expect(helperEnv({ A: '1', APPDIR: 'x', APPIMAGE: 'y', ARGV0: 'z', OWD: 'w', ELECTRON_RUN_AS_NODE: '1' })).toEqual({ A: '1' })
  })
})

describe('daemon encerrado', () => {
  it('true quando o socket para de aceitar; false se continuar no limite', async () => {
    const sock = path.join(tmp(), 's.sock')
    const srv = net.createServer((c) => c.end())
    await new Promise<void>((r) => srv.listen(sock, r))
    expect(await waitSocketGone(sock, 300)).toBe(false)
    setTimeout(() => srv.close(), 100)
    expect(await waitSocketGone(sock, 3000)).toBe(true)
  })
})

describe('onde trocar', () => {
  it('Mac: o .app a partir do executável; Linux: o AppImage; .deb/.rpm: nada', () => {
    expect(installTarget('darwin', '/Applications/Gerenciador de Terminal.app/Contents/MacOS/Gerenciador de Terminal', undefined)).toBe('/Applications/Gerenciador de Terminal.app')
    expect(installTarget('darwin', '/usr/local/bin/electron', undefined)).toBeNull()
    expect(installTarget('linux', '/tmp/.mount_x/gt', '/home/u/Apps/gt.AppImage')).toBe('/home/u/Apps/gt.AppImage')
    expect(installTarget('linux', '/opt/gerenciador-de-terminal/gt', undefined)).toBeNull()
  })
  it('pasta gravável sim; translocado ou sem escrita não', () => {
    const d = tmp()
    expect(canWriteTarget(path.join(d, 'X.app'))).toBe(true)
    expect(canWriteTarget('/private/var/folders/x/AppTranslocation/abc/d/X.app')).toBe(false)
    // como root (testes Linux no Docker) toda pasta aceita escrita
    if (process.getuid?.() !== 0) {
      const ro = tmp()
      fs.chmodSync(ro, 0o500)
      expect(canWriteTarget(path.join(ro, 'X.app'))).toBe(false)
      fs.chmodSync(ro, 0o700)
    }
  })
})
