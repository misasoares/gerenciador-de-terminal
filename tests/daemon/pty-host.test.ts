import { afterEach, describe, expect, it } from 'vitest'
import { PtyHost } from '../../src/daemon/pty-host'
import { waitFor } from '../helpers/wait'

const env = { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }
let host: PtyHost | null = null
afterEach(() => { host?.killAll(); host = null })

function make() {
  const out = new Map<string, string>()
  const exits = new Map<string, number>()
  host = new PtyHost({
    data: (id, d) => out.set(id, (out.get(id) ?? '') + d),
    exit: (id, code) => exits.set(id, code),
  })
  return { host, out, exits }
}

describe('PtyHost', () => {
  it('emite saída e a tela serializada contém o texto com acento', async () => {
    const { host, out } = make()
    host.spawn({ id: 'a', shell: '/bin/sh', args: ['-c', "printf 'ação ok\\n'; sleep 30"], cwd: '/', cols: 80, rows: 24, env })
    await waitFor(() => out.get('a')?.includes('ação ok'))
    expect(host.serialize('a')).toContain('ação ok')
  })

  it('escreve no processo', async () => {
    const { host, out } = make()
    host.spawn({ id: 'b', shell: '/bin/cat', args: [], cwd: '/', cols: 80, rows: 24, env })
    host.write('b', 'olá\r')
    await waitFor(() => out.get('b')?.includes('olá'))
  })

  it('avisa a saída com o código e esquece o terminal', async () => {
    const { host, exits } = make()
    host.spawn({ id: 'c', shell: '/bin/sh', args: ['-c', 'exit 3'], cwd: '/', cols: 80, rows: 24, env })
    await waitFor(() => exits.has('c'))
    expect(exits.get('c')).toBe(3)
    expect(host.has('c')).toBe(false)
  })

  it('redimensiona, informa pid e recusa id duplicado', () => {
    const { host } = make()
    const pid = host.spawn({ id: 'd', shell: '/bin/cat', args: [], cwd: '/', cols: 80, rows: 24, env })
    expect(host.pid('d')).toBe(pid)
    expect(() => host.resize('d', 120, 40)).not.toThrow()
    expect(() => host.spawn({ id: 'd', shell: '/bin/cat', args: [], cwd: '/', cols: 80, rows: 24, env })).toThrow('já existe')
  })
})
