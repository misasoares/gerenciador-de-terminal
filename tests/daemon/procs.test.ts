import { describe, expect, it } from 'vitest'
import { cwdOf, descendants, findClaude, foregroundOf, paneOfPid, parseLsofCwd, parsePs, snapshotProcs, underClaudeDaemon } from '../../src/daemon/platform/procs'

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

describe('paneOfPid', () => {
  const tree = [
    { pid: 1, ppid: 0, stat: 'Ss', args: 'launchd' },
    { pid: 100, ppid: 1, stat: 'Ss', args: '-zsh' },
    { pid: 200, ppid: 100, stat: 'S+', args: 'claude' },
    { pid: 300, ppid: 200, stat: 'S', args: 'gt-mcp' },
    { pid: 500, ppid: 1, stat: 'Ss', args: 'claude daemon run' },
    { pid: 600, ppid: 500, stat: 'S', args: 'claude bg-spare' },
  ]
  const shells = [{ id: 'p1', pid: 100 }]
  it('acha o painel cujo shell é ancestral', () => {
    expect(paneOfPid(tree, 200, shells)).toBe('p1')
    expect(paneOfPid(tree, 300, shells)).toBe('p1')
    expect(paneOfPid(tree, 100, shells)).toBe('p1')
  })
  it('processo fora dos terminais do app (daemon do Claude Code) ou que não existe: null', () => {
    expect(paneOfPid(tree, 600, shells)).toBeNull()
    expect(paneOfPid(tree, 9999, shells)).toBeNull()
  })
  it('debaixo do daemon do Claude Code: só a conversa em segundo plano', () => {
    expect(underClaudeDaemon(tree, 600)).toBe(true)
    expect(underClaudeDaemon([...tree, { pid: 700, ppid: 1, stat: 'Ss', args: 'tmux' }, { pid: 701, ppid: 700, stat: 'S+', args: 'claude' }], 701)).toBe(false)
    expect(underClaudeDaemon(tree, 200)).toBe(false)
  })
  it('ciclo de ppid não trava', () => {
    const loop = [{ pid: 7, ppid: 8, stat: 'S', args: 'a' }, { pid: 8, ppid: 7, stat: 'S', args: 'b' }]
    expect(paneOfPid(loop, 7, shells)).toBeNull()
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
