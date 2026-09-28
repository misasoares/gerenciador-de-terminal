import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireLock, releaseLock } from '../../src/daemon/lock'
import { createTitleReader } from '../../src/daemon/title'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-a-')))

describe('título incremental', () => {
  it('acompanha o que é acrescentado, inclusive com UTF-8 partido entre gravações', async () => {
    const f = path.join(tmp(), 't.jsonl')
    const read = createTitleReader()
    fs.writeFileSync(f, JSON.stringify({ type: 'ai-title', aiTitle: 'Primeiro' }) + '\n')
    expect(await read(f)).toBe('Primeiro')
    const line = Buffer.from(JSON.stringify({ type: 'custom-title', customTitle: 'ação 🚀' }) + '\n')
    const cut = line.indexOf(Buffer.from('ç')) + 1 // no meio do "ç"
    fs.appendFileSync(f, line.subarray(0, cut))
    expect(await read(f)).toBe('Primeiro')
    fs.appendFileSync(f, line.subarray(cut))
    expect(await read(f)).toBe('ação 🚀')
    expect(await read(path.join(tmp(), 'nao-existe.jsonl'))).toBeNull()
  })
})

describe('trava do daemon', () => {
  it('pega a trava livre; recusa se o dono está vivo; recupera trava de processo morto', async () => {
    const dir = tmp()
    const lock = path.join(dir, 'daemon.lock')
    expect(acquireLock(lock)).toBe(true)
    releaseLock(lock)
    expect(fs.existsSync(lock)).toBe(false)

    const alive = spawn('/bin/sleep', ['10'])
    fs.writeFileSync(lock, String(alive.pid))
    expect(acquireLock(lock)).toBe(false)
    alive.kill()
    await new Promise((r) => alive.on('exit', r))
    expect(acquireLock(lock)).toBe(true)
    expect(fs.readFileSync(lock, 'utf8')).toBe(String(process.pid))
  })
})

describe('I3: trava velha depois de reboot/crash', () => {
  it('trava com pid vivo mas antiga (> 30 s) é recuperada; recente é respeitada', async () => {
    const dir = tmp()
    const lock = path.join(dir, 'daemon.lock')
    const alive = spawn('/bin/sleep', ['10'])
    try {
      fs.writeFileSync(lock, String(alive.pid))
      expect(acquireLock(lock)).toBe(false)
      const old = new Date(Date.now() - 60_000)
      fs.utimesSync(lock, old, old)
      expect(acquireLock(lock)).toBe(true)
      expect(fs.readFileSync(lock, 'utf8')).toBe(String(process.pid))
    } finally {
      alive.kill()
    }
  })
  it('trava vazia recente (outro processo gravando) é respeitada', () => {
    const lock = path.join(tmp(), 'daemon.lock')
    fs.writeFileSync(lock, '')
    expect(acquireLock(lock)).toBe(false)
  })
})
