import { describe, expect, it } from 'vitest'
import { groupProcs, parsePsDetail, procName } from '../../src/daemon/machine/groups'
import { gateRefusal, machineReport } from '../../src/daemon/machine/report'
import type { MachineView } from '../../src/shared/types'

const G = 1024 ** 3
// pid ppid rss(KB) pcpu etime args
const PS = [
  '  100     1   1024   0.5 1-00:00:00 /bin/zsh -il',
  '  101   100 348000   9.8      10:17 claude --resume abc',
  '  102   101  50000   1.0      10:00 node /Users/x/.npm/_npx/1/node_modules/.bin/playwright-mcp',
  '  200     1   1024   0.0      05:00 /bin/zsh -il',
  '  201   200 300000   3.0      04:00 claude',
  '  300     1 2000000 41.0     1:00:00 /opt/homebrew/bin/qemu-system-aarch64 -M virt -drive file=/Users/x/.lima/colima/disk',
  '  301     1  80000   1.0     1:00:00 /opt/homebrew/bin/limactl hostagent colima',
  '  400     1 3800000 41.0      30:00 /Users/x/Library/Android/sdk/emulator/qemu/darwin-aarch64/qemu-system-aarch64 -avd Pixel',
  '  500     1 900000   4.0      20:00 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '  501   500 400000   2.0      20:00 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer',
  '  600     1    448 364,5 05-19:10:57 /Volumes/SSD MISA/MEUS-JOGOS/automacao-grepolis/node_modules/@esbuild/darwin-arm64/bin/esbuild --service=0.21.5 --ping',
  '  700     1 992816 326.2      01:43 /Users/x/Library/Java/JavaVirtualMachines/corretto-17/Contents/Home/bin/java -Xmx2g',
  'lixo',
].join('\n')

describe('processos', () => {
  it('parser do ps: rss em bytes, vírgula decimal, caminho com espaço', () => {
    const rows = parsePsDetail(PS)
    expect(rows).toHaveLength(12)
    expect(rows.find((r) => r.pid === 600)).toEqual({ pid: 600, ppid: 1, rss: 448 * 1024, cpu: 364.5, etime: '05-19:10:57', args: '/Volumes/SSD MISA/MEUS-JOGOS/automacao-grepolis/node_modules/@esbuild/darwin-arm64/bin/esbuild --service=0.21.5 --ping' })
  })
  it('nome curto do processo', () => {
    expect(procName('/Volumes/SSD MISA/MEUS-JOGOS/x/bin/esbuild --service=0.21.5 --ping')).toBe('esbuild')
    expect(procName('claude --resume abc')).toBe('claude')
    expect(procName('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (Renderer) --type=renderer')).toBe('Google Chrome Helper (Renderer)')
    expect(procName('/x/' + 'a'.repeat(60))).toHaveLength(40)
  })
  it('grupos: sessões pela árvore do pane, Colima, emulador, navegadores; top 5 por CPU', () => {
    const d = groupProcs(parsePsDetail(PS), [{ id: 'p1', pid: 100 }, { id: 'p2', pid: 200 }, { id: 'p3', pid: 999 }])
    const g = Object.fromEntries(d.groups.map((x) => [x.key, x]))
    expect(g.sessoes).toMatchObject({ label: 'Sessões do app', count: 2, paneIds: ['p1', 'p2'] })
    expect(g.sessoes.rss).toBe((1024 + 348000 + 50000 + 1024 + 300000) * 1024)
    expect(g.colima).toMatchObject({ label: 'Colima / Docker', count: 2 })
    expect(g.emulador).toMatchObject({ label: 'Emulador', count: 1, rss: 3800000 * 1024 })
    expect(g.navegadores).toMatchObject({ count: 2 })
    expect(d.perPane.p1).toEqual({ rss: (1024 + 348000 + 50000) * 1024, cpu: 11.3 })
    expect(d.perPane.p3).toBeUndefined()
    expect(d.top.map((p) => p.name)).toEqual(['esbuild', 'java', 'qemu-system-aarch64', 'qemu-system-aarch64', 'claude'])
    expect(d.top[0]).toMatchObject({ pid: 600, etime: '05-19:10:57' })
  })
  it('Colima e emulador aparecem desligados; navegadores e sessões somem sem processos', () => {
    const d = groupProcs(parsePsDetail('  1 0 10 0.0 01:00 /sbin/launchd'), [])
    expect(d.groups.map((x) => [x.key, x.count])).toEqual([['colima', 0], ['emulador', 0]])
  })
})

describe('relatórios', () => {
  const v: MachineView = { cpu: 64, cpu1m: 61, ram: { used: 22.1 * G, total: 24 * G }, swap: { used: 18.2 * G, total: 20 * G }, pressure: 'critica', level: 'bad', reasons: ['swap 18,2 GB', 'pressão crítica'], at: 1, stale: false }
  const d = groupProcs(parsePsDetail(PS), [{ id: 'p1', pid: 100 }, { id: 'p2', pid: 200 }])
  it('recusa do gate: motivo, números, maiores consumidores e o forcar', () => {
    const t = gateRefusal(v, d)
    expect(t).toContain('Máquina sobrecarregada: swap 18,2 GB · pressão crítica')
    expect(t).toContain('CPU 64%, RAM 22,1/24,0 GB')
    expect(t).toContain('Emulador 3,6 GB')
    expect(t).toContain('esbuild 365% CPU')
    expect(t).toContain('forcar: true')
  })
  it('uso_da_maquina: média por sessão do Claude e quantas cabem até 85% da RAM', () => {
    const r = machineReport({ ...v, ram: { used: 16 * G, total: 24 * G } }, d, [{ rss: 0.5 * G }, { rss: 1.5 * G }])
    expect(r).toMatchObject({ nivel: 'bad', cpu: '64%', ram: '16,0/24,0 GB', swap: '18,2 GB', pressao: 'pressão crítica', media_por_sessao_claude: '1,0 GB', cabem_ate_amarelo: 4 })
    expect(machineReport(v, d, [])).not.toHaveProperty('cabem_ate_amarelo')
    expect(machineReport(v, d, [{ rss: 1 * G }]).cabem_ate_amarelo).toBe(0)
  })
})
