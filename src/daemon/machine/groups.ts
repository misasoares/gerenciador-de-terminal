import type { MachineDetail, MachineGroup, MachineProc } from '../../shared/types'
import { descendants } from '../platform/procs'

export interface PsRow {
  pid: number
  ppid: number
  /** bytes */
  rss: number
  cpu: number
  etime: string
  args: string
}

export function parsePsDetail(out: string): PsRow[] {
  const rows: PsRow[] = []
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.,]+)\s+(\S+)\s+(.*)$/.exec(line)
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]) * 1024, cpu: Number(m[4].replace(',', '.')), etime: m[5], args: m[6] })
  }
  return rows
}

/** executável sem pasta, até o primeiro " -" (caminhos com espaço, como /Volumes/SSD MISA/…, ficam inteiros) */
export function procName(args: string): string {
  const head = args.split(/\s+-/)[0].trim()
  const base = head.slice(head.lastIndexOf('/') + 1) || head
  return base.length > 40 ? base.slice(0, 39) + '…' : base
}

const COLIMA = /colima|limactl|com\.docker|Docker Desktop|qemu-system[^\n]*lima/i
// serviços do CoreSimulator ficam parados no fundo; só o Simulator e os simuladores ligados (launchd_sim) contam
const EMULATOR = /qemu-system|\/emulator(\s|$)|Simulator\.app|launchd_sim/
/** Colima com backend vz: a VM é um XPC do Virtualization.framework, filho do launchd e sem "colima" no nome */
const VZ_VM = /com\.apple\.Virtualization\.VirtualMachine/
/** Docker nativo (Linux): daemons e o shim de cada container; os processos do container são filhos do shim */
const DOCKER_NATIVE = /(^|\/)(dockerd|containerd|docker-proxy)(\s|$)/
const DOCKER_SHIM = /(^|\/)containerd-shim[\w-]*(\s|$)/
const BROWSERS = /Google Chrome|Safari\.app|Arc\.app|firefox|Brave Browser/i

const round1 = (n: number) => Math.round(n * 10) / 10

export function groupProcs(rows: PsRow[], panes: { id: string; pid: number }[], platform: NodeJS.Platform = process.platform): MachineDetail {
  const claimed = new Set<number>()
  const perPane: MachineDetail['perPane'] = {}
  const sessions: MachineGroup = { key: 'sessoes', label: 'Sessões do app', count: 0, rss: 0, cpu: 0, paneIds: [] }
  for (const p of panes) {
    const self = rows.find((r) => r.pid === p.pid)
    if (!self) continue
    const tree = [self, ...descendants(rows, p.pid)]
    let rss = 0
    let cpu = 0
    for (const r of tree) {
      claimed.add(r.pid)
      rss += r.rss
      cpu += r.cpu
    }
    perPane[p.id] = { rss, cpu: round1(cpu) }
    sessions.count++
    sessions.rss += rss
    sessions.cpu += cpu
    sessions.paneIds!.push(p.id)
  }
  const mk = (key: MachineGroup['key'], label: string): MachineGroup => ({ key, label, count: 0, rss: 0, cpu: 0 })
  // no Linux o Docker é nativo, não há Colima
  const colima = mk('colima', platform === 'darwin' ? 'Colima / Docker' : 'Docker')
  const emulator = mk('emulador', 'Emulador')
  const browsers = mk('navegadores', 'Navegadores')
  const colimaUp = rows.some((r) => /colima|limactl/.test(r.args))
  const containers = new Set(rows.filter((r) => DOCKER_SHIM.test(r.args)).flatMap((r) => [r, ...descendants(rows, r.pid)]).map((r) => r.pid))
  const isDocker = (r: PsRow) => COLIMA.test(r.args) || DOCKER_NATIVE.test(r.args) || containers.has(r.pid) || (colimaUp && VZ_VM.test(r.args))
  for (const r of rows) {
    if (claimed.has(r.pid)) continue
    const g = isDocker(r) ? colima : EMULATOR.test(r.args) ? emulator : BROWSERS.test(r.args) ? browsers : null
    if (!g) continue
    g.count++
    g.rss += r.rss
    g.cpu += r.cpu
  }
  const groups = [sessions, colima, emulator, browsers]
    .filter((g) => g.count > 0 || g.key === 'colima' || g.key === 'emulador')
    .map((g) => ({ ...g, cpu: round1(g.cpu) }))
    .sort((a, b) => b.rss - a.rss)
  const top: MachineProc[] = [...rows]
    .sort((a, b) => b.cpu - a.cpu || b.rss - a.rss)
    .slice(0, 5)
    .map((r) => ({ pid: r.pid, name: procName(r.args), rss: r.rss, cpu: r.cpu, etime: r.etime }))
  return { groups, top, perPane }
}
