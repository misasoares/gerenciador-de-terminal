import { describe, expect, it } from 'vitest'
import { cwdOf, descendants, findClaude, foregroundOf, parseLsofCwd, parsePs, snapshotProcs } from '../../src/daemon/platform/procs'

const PS = [
  '  100     1 Ss   /Applications/Gerenciador.app/Contents/MacOS/Gerenciador',
  '  200   100 Ss   -zsh',
  '  300   200 S+   /Users/u/.local/bin/cswap run misael@mslabs-dev.com --',
  '  301   300 S+   /Users/u/.local/bin/claude --settings /Users/u/.config/claude/weboption-max.json',
  '  302   301 S    /bin/zsh -c source /Users/u/.claude/shell-snapshots/x.sh',
  '  400   100 Ss+  -zsh',
  '  500     1 SNs  claude bg-pty-host --bg-pty-host /tmp/x.sock',
].join('\n')

describe('parsePs e árvore', () => {
  const procs = parsePs(PS)
  it('lê pid, ppid, stat e args com espaços', () => {
    expect(procs).toHaveLength(7)
    expect(procs[3]).toEqual({ pid: 301, ppid: 300, stat: 'S+', args: '/Users/u/.local/bin/claude --settings /Users/u/.config/claude/weboption-max.json' })
  })
  it('descendentes', () => {
    expect(descendants(procs, 200).map((p) => p.pid).sort()).toEqual([300, 301, 302])
  })
  it('primeiro plano mais profundo', () => {
    expect(foregroundOf(procs, 200)?.pid).toBe(301)
    expect(foregroundOf(procs, 400)?.pid).toBe(400)
  })
  it('acha o claude embaixo do shell do painel e ignora os de fora', () => {
    expect(findClaude(procs, 200)?.pid).toBe(301)
    expect(findClaude(procs, 400)).toBeNull()
  })
})

describe('parseLsofCwd', () => {
  it('mapeia pid → cwd, inclusive com espaço', () => {
    const out = 'p301\nfcwd\nn/Volumes/SSD MISA/apps/meu projeto\np400\nfcwd\nn/Users/u\n'
    expect(parseLsofCwd(out)).toEqual(new Map([[301, '/Volumes/SSD MISA/apps/meu projeto'], [400, '/Users/u']]))
  })
})

describe('no sistema de verdade', () => {
  it('encontra o próprio processo e o cwd dele', async () => {
    const procs = await snapshotProcs()
    expect(procs.some((p) => p.pid === process.pid)).toBe(true)
    const cwds = await cwdOf([process.pid])
    expect(cwds.get(process.pid)).toBe(process.cwd())
  })
  it('lista vazia não chama lsof', async () => {
    expect((await cwdOf([])).size).toBe(0)
  })
})
