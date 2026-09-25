import { describe, expect, it } from 'vitest'
import * as pty from 'node-pty'

describe('node-pty', () => {
  it('abre um processo e lê a saída com acento', async () => {
    const p = pty.spawn('/bin/echo', ['ação'], { cols: 80, rows: 24, cwd: process.cwd(), env: { LANG: 'en_US.UTF-8' } })
    const out = await new Promise<string>((resolve) => {
      let buf = ''
      p.onData((d) => { buf += d })
      p.onExit(() => resolve(buf))
    })
    expect(out).toContain('ação')
  })
})
