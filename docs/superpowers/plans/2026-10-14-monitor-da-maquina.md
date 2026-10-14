# Monitor da máquina (CPU/RAM) + gate do contratar_dev — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar CPU/RAM/swap da máquina na barra de status (com painel de consumidores) e fazer `contratar_dev` recusar quando a máquina está sobrecarregada.

**Architecture:** O daemon ganha um `MachineMonitor` (`src/daemon/machine/`) que lê CPU (`os.cpus()`), memória (`vm_stat`/`sysctl` no macOS, `/proc` no Linux) a cada 3 s e manda uma mensagem leve `{t:'machine'}` às janelas, fora do `AppState`. A visão por processo (`ps`) roda só com o painel aberto (`machine.watch`) ou quando o gate/`uso_da_maquina` é chamado. O gate fica em `Daemon.hire`, antes de qualquer efeito.

**Tech Stack:** TypeScript, Electron + electron-vite, React (renderer), vitest, Node `child_process`/`os`.

**Spec:** `docs/superpowers/specs/2026-10-14-monitor-da-maquina-design.md`

## Global Constraints

- Textos de UI e mensagens em português do Brasil, com acentos; números em GB com vírgula e 1 casa (`19,4`).
- Nenhuma dependência nova (sem `systeminformation`).
- Swap medida em **% da RAM física** (não do total de swap). Padrões: `cpuWarn 70`, `cpuBad 90`, `swapWarn 25`, `swapBad 75`, `pressureGate true`.
- Pressão do macOS: `kern.memorystatus_vm_pressure_level` 1 = normal, 2 = alerta, 4 = crítica. Linux: `/proc/pressure/memory` `some avg10` ≥ 10 alerta, ≥ 40 crítica.
- Intervalo de leitura 3 s; heartbeat 30 s; média de CPU de 1 min (20 leituras).
- `ps` nunca roda em segundo plano sem watcher; o `AppState` não carrega a métrica.
- Gate sem leitura válida (nenhuma, ou `stale` há > 60 s): **deixa passar** com `aviso`.
- Sem botão de matar processo nesta fase.
- `PROTOCOL_VERSION` não muda (mensagens novas são aditivas; daemon antigo só não manda `machine`).
- Comandos externos via `run()` de `src/daemon/platform/procs.ts` (timeout 5 s, `LC_ALL=en_US.UTF-8`).
- No shell deste Mac, `grep` é `rg` e `cd` com espaço quebra: use caminhos absolutos entre aspas e `git -C`.

## Review Focus

1. **Swap dinâmica do macOS** — o total de swap cresce sozinho e fica ~95% cheio; o nível deve ignorar `swap.total` e usar `swap.used / ram.total`. Teste em Task 3.
2. **Gate nos primeiros segundos do daemon** (sem leitura ainda) — contratar deve passar com `aviso: 'não consegui medir a máquina'`, não falhar. Teste em Task 7.
3. **Janela fechada com o painel aberto** (conexão cai sem `machine.unwatch`) — o `ps` periódico tem que parar. Teste em Task 6.
4. **`state.json` editado à mão ou antigo** com `warn ≥ bad`, valores fora de faixa ou sem `machine` — normaliza para valores coerentes. Teste em Task 1.
5. **Caminho com espaço no `ps`** (`/Volumes/SSD MISA/.../bin/esbuild --service`) — nome do processo sai `esbuild`, e uma leitura lenta (`vm_stat` > 3 s) não empilha ticks. Testes em Task 4 e Task 5.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/shared/types.ts` (mod) | `MachineLevel`, `MemPressure`, `MachineView`, `MachineGroup`, `MachineProc`, `MachineDetail` |
| `src/shared/settings.ts` (mod) | `MachineLimits`, padrão e normalização em `TerminalSettings.machine` |
| `src/shared/machine-format.ts` (novo) | `gb()`, `formatEtime()`, `pressureLabel()` — usados por daemon e renderer |
| `src/daemon/machine/parse.ts` (novo) | parsers puros de `vm_stat`, `swapusage`, pressão, `/proc/meminfo`, PSI |
| `src/daemon/machine/level.ts` (novo) | nível + motivos a partir da amostra e dos limites |
| `src/daemon/machine/monitor.ts` (novo) | `MachineMonitor`: CPU por delta, média 1 min, stale, emissão |
| `src/daemon/machine/groups.ts` (novo) | parser do `ps` detalhado, grupos, top 5, por pane |
| `src/daemon/machine/report.ts` (novo) | texto da recusa do gate e resposta de `uso_da_maquina` |
| `src/daemon/machine/read.ts` (novo) | leitores reais (`makeMemReader`, `snapshotPsDetail`) |
| `src/daemon/platform/procs.ts` (mod) | exporta `run`; `descendants` genérico |
| `src/shared/protocol.ts` (mod) | `machine` (servidor→app), `machine.watch`/`machine.unwatch` |
| `src/daemon/daemon.ts` (mod) | liga o monitor, watchers, gate, `uso_da_maquina` |
| `src/daemon/main.ts` (mod) | passa os leitores reais |
| `src/mcp/protocol.ts` (mod) | `forcar`, ferramenta `uso_da_maquina`, linha nas INSTRUCTIONS |
| `src/renderer/src/store.ts` (mod) | `machine`, `machineDetail` |
| `src/renderer/src/main.tsx` (mod) | trata `machine` |
| `src/renderer/src/machine-model.ts` (novo) | modelo puro do chip |
| `src/renderer/src/components/MachineChip.tsx` (novo) | chip + painel (portal) |
| `src/renderer/src/components/MachinePrefs.tsx` (novo) | aba Máquina nas Preferências |
| `src/renderer/src/components/StatusBar.tsx`, `Preferences.tsx`, `styles.css` (mod) | encaixe |
| `tests/helpers/app-client.ts` (mod) | guarda as mensagens `machine` |

---

### Task 1: Tipos, formatação e limites nas configurações

**Files:**
- Modify: `src/shared/types.ts` (fim do arquivo)
- Modify: `src/shared/settings.ts:60-152`
- Create: `src/shared/machine-format.ts`
- Test: `tests/shared/machine-settings.test.ts`, `tests/shared/machine-format.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `MachineLevel = 'ok' | 'warn' | 'bad'`; `MemPressure = 'normal' | 'alerta' | 'critica' | null`; `MachineView { cpu; cpu1m; ram: {used,total}; swap: {used,total}; pressure; level; reasons: string[]; at; stale }`; `MachineGroup { key; label; count; rss; cpu; paneIds?: string[] }`; `MachineProc { pid; name; rss; cpu; etime }`; `MachineDetail { groups; top; perPane: Record<string,{rss;cpu}> }`.
  - `settings.ts`: `MachineLimits { cpuWarn; cpuBad; swapWarn; swapBad; pressureGate }`, `DEFAULT_SETTINGS.machine`, `normalizeMachineLimits(v: unknown): MachineLimits`.
  - `machine-format.ts`: `gb(bytes: number): string` → `"19,4"`; `formatEtime(ps: string): string` → `"5d19h" | "1h02m" | "1m43s" | "12s"`; `pressureLabel(p: MemPressure): string`.

- [ ] **Step 1: Write the failing tests**

`tests/shared/machine-settings.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeMachineLimits, normalizeSettings } from '../../src/shared/settings'

describe('limites da máquina', () => {
  it('padrões', () => {
    expect(DEFAULT_SETTINGS.machine).toEqual({ cpuWarn: 70, cpuBad: 90, swapWarn: 25, swapBad: 75, pressureGate: true })
    expect(normalizeSettings(undefined).machine).toEqual(DEFAULT_SETTINGS.machine)
  })
  it('state.json antigo sem machine ganha os padrões', () => {
    expect(normalizeSettings({ fontSize: 14 } as never).machine).toEqual(DEFAULT_SETTINGS.machine)
  })
  it('faixas: CPU 10–100, swap 5–150, arredonda', () => {
    expect(normalizeMachineLimits({ cpuWarn: 2, cpuBad: 400, swapWarn: 1, swapBad: 999, pressureGate: false })).toEqual({ cpuWarn: 10, cpuBad: 100, swapWarn: 5, swapBad: 150, pressureGate: false })
    expect(normalizeMachineLimits({ cpuWarn: 70.6, cpuBad: 90, swapWarn: 25, swapBad: 75, pressureGate: true }).cpuWarn).toBe(71)
  })
  it('warn ≥ bad: warn desce para bad − 5', () => {
    expect(normalizeMachineLimits({ cpuWarn: 95, cpuBad: 90, swapWarn: 80, swapBad: 80, pressureGate: true })).toMatchObject({ cpuWarn: 85, cpuBad: 90, swapWarn: 75, swapBad: 80 })
    expect(normalizeMachineLimits({ cpuWarn: 10, cpuBad: 10, swapWarn: 5, swapBad: 5, pressureGate: true })).toMatchObject({ cpuWarn: 10, cpuBad: 15, swapWarn: 5, swapBad: 10 })
  })
  it('lixo vira padrão', () => {
    expect(normalizeMachineLimits('x')).toEqual(DEFAULT_SETTINGS.machine)
    expect(normalizeMachineLimits({ cpuWarn: 'a', pressureGate: 1 })).toEqual(DEFAULT_SETTINGS.machine)
  })
})
```

`tests/shared/machine-format.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { formatEtime, gb, pressureLabel } from '../../src/shared/machine-format'

describe('formatação da máquina', () => {
  it('gb com vírgula e 1 casa', () => {
    expect(gb(19.4 * 1024 ** 3)).toBe('19,4')
    expect(gb(0)).toBe('0,0')
  })
  it('etime do ps vira texto curto', () => {
    expect(formatEtime('05-19:10:57')).toBe('5d19h')
    expect(formatEtime('43-09:24:51')).toBe('43d9h')
    expect(formatEtime('1:02:03')).toBe('1h02m')
    expect(formatEtime('01:43')).toBe('1m43s')
    expect(formatEtime('00:12')).toBe('12s')
    expect(formatEtime('lixo')).toBe('lixo')
  })
  it('rótulo da pressão', () => {
    expect(pressureLabel('normal')).toBe('pressão normal')
    expect(pressureLabel('alerta')).toBe('pressão em alerta')
    expect(pressureLabel('critica')).toBe('pressão crítica')
    expect(pressureLabel(null)).toBe('pressão indisponível')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/shared/machine-settings.test.ts tests/shared/machine-format.test.ts`
Expected: FAIL (`normalizeMachineLimits` não exportado; módulo `machine-format` não existe)

- [ ] **Step 3: Implement**

Append to `src/shared/types.ts`:
```ts
export type MachineLevel = 'ok' | 'warn' | 'bad'
/** pressão de memória do sistema; null = indisponível (Linux sem PSI) */
export type MemPressure = 'normal' | 'alerta' | 'critica' | null

/** leitura da máquina mandada às janelas pela mensagem 'machine' (fora do AppState) */
export interface MachineView {
  /** 0–100, leitura atual */
  cpu: number
  /** média do último minuto (usada no nível) */
  cpu1m: number
  /** bytes */
  ram: { used: number; total: number }
  /** bytes; total 0 = sem swap */
  swap: { used: number; total: number }
  pressure: MemPressure
  level: MachineLevel
  /** critérios que dispararam, ex.: ['swap 18,2 GB', 'pressão crítica'] */
  reasons: string[]
  /** ms epoch da última leitura boa */
  at: number
  /** a última leitura falhou */
  stale: boolean
}

export interface MachineGroup {
  key: 'sessoes' | 'colima' | 'emulador' | 'navegadores'
  label: string
  count: number
  rss: number
  cpu: number
  paneIds?: string[]
}

export interface MachineProc {
  pid: number
  name: string
  rss: number
  cpu: number
  etime: string
}

export interface MachineDetail {
  groups: MachineGroup[]
  top: MachineProc[]
  perPane: Record<string, { rss: number; cpu: number }>
}
```

Create `src/shared/machine-format.ts`:
```ts
import type { MemPressure } from './types'

export const gb = (bytes: number): string => (bytes / 1024 ** 3).toFixed(1).replace('.', ',')

/** etime do ps ([dd-]hh:mm:ss ou mm:ss) em texto curto */
export function formatEtime(ps: string): string {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(ps.trim())
  if (!m) return ps
  const [d, h, min, s] = [m[1], m[2], m[3], m[4]].map((x) => Number(x ?? 0))
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${String(min).padStart(2, '0')}m`
  if (min > 0) return `${min}m${String(s).padStart(2, '0')}s`
  return `${s}s`
}

export function pressureLabel(p: MemPressure): string {
  return p === 'critica' ? 'pressão crítica' : p === 'alerta' ? 'pressão em alerta' : p === 'normal' ? 'pressão normal' : 'pressão indisponível'
}
```

In `src/shared/settings.ts`, add before `export interface TerminalSettings`:
```ts
/** limites do monitor da máquina; swap em % da RAM física (o macOS cresce o arquivo de swap sozinho) */
export interface MachineLimits {
  cpuWarn: number
  cpuBad: number
  swapWarn: number
  swapBad: number
  /** pressão do sistema: alerta = amarelo, crítica = bloqueia */
  pressureGate: boolean
}
```
Add field to `TerminalSettings` (after `maxHiredPerLeader`):
```ts
  /** limites do indicador de CPU/RAM e do gate do contratar_dev */
  machine: MachineLimits
```
Add to `DEFAULT_SETTINGS` (after `maxHiredPerLeader: 10,`):
```ts
  machine: { cpuWarn: 70, cpuBad: 90, swapWarn: 25, swapBad: 75, pressureGate: true },
```
Add after `const clamp = ...`:
```ts
function limitPair(w: unknown, b: unknown, dw: number, db: number, min: number, max: number): [number, number] {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), min, max) : d)
  let warn = num(w, dw)
  let bad = num(b, db)
  if (warn >= bad) {
    if (bad - 5 >= min) warn = bad - 5
    else bad = Math.min(max, warn + 5)
  }
  return [warn, bad]
}

export function normalizeMachineLimits(v: unknown): MachineLimits {
  const d = DEFAULT_SETTINGS.machine
  const m = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const [cpuWarn, cpuBad] = limitPair(m.cpuWarn, m.cpuBad, d.cpuWarn, d.cpuBad, 10, 100)
  const [swapWarn, swapBad] = limitPair(m.swapWarn, m.swapBad, d.swapWarn, d.swapBad, 5, 150)
  return { cpuWarn, cpuBad, swapWarn, swapBad, pressureGate: typeof m.pressureGate === 'boolean' ? m.pressureGate : d.pressureGate }
}
```
In `normalizeSettings`, add after `maxHiredPerLeader: ...,`:
```ts
    machine: normalizeMachineLimits(v.machine),
```

- [ ] **Step 4: Run tests to verify they pass, plus the existing suite for settings**

Run: `npx vitest run tests/shared && npm run typecheck`
Expected: PASS; typecheck sem erros (se algum teste existente compara `DEFAULT_SETTINGS` literal, ajuste-o para incluir `machine`).

- [ ] **Step 5: Commit**

```bash
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" add src/shared tests/shared
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" commit -m "feat(maquina): tipos, formatação e limites do monitor nas preferências"
```

---

### Task 2: Parsers de memória (macOS e Linux)

**Files:**
- Create: `src/daemon/machine/parse.ts`
- Test: `tests/daemon/machine-parse.test.ts`

**Interfaces:**
- Consumes: `MemPressure` (Task 1).
- Produces: `parseVmStatUsed(out: string): number | null` (bytes); `parseSwapUsage(out: string): { used: number; total: number } | null` (bytes); `parsePressureLevel(out: string): MemPressure`; `parseMeminfo(text: string): { ramUsed; ramTotal; swapUsed; swapTotal } | null` (bytes); `parsePsi(text: string): MemPressure`.

- [ ] **Step 1: Write the failing test** (saídas reais deste Mac em 2026-10-14)

```ts
import { describe, expect, it } from 'vitest'
import { parseMeminfo, parsePressureLevel, parsePsi, parseSwapUsage, parseVmStatUsed } from '../../src/daemon/machine/parse'

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     2917.
Pages active:                                 223105.
Pages inactive:                               207049.
Pages speculative:                             14574.
Pages throttled:                                   0.
Pages wired down:                             455150.
Pages purgeable:                                   0.
"Translation faults":                  1645371187190.
Pages copy-on-write:                      4350582940.
File-backed pages:                            161739.
Anonymous pages:                              282989.
Pages stored in compressor:                  3247708.
Pages occupied by compressor:                 627010.
Swapins:                                   521498890.
Swapouts:                                  581629978.
`
const SYSCTL = `vm.swapusage: total = 15360.00M  used = 14692.94M  free = 667.06M  (encrypted)
kern.memorystatus_vm_pressure_level: 2
`
const MEMINFO = `MemTotal:       16303428 kB
MemFree:          812344 kB
MemAvailable:    6303428 kB
Buffers:          123456 kB
SwapTotal:       4194300 kB
SwapFree:        3145724 kB
`

describe('parsers de memória', () => {
  it('vm_stat: (active + wired + ocupadas pelo compressor) × página', () => {
    expect(parseVmStatUsed(VM_STAT)).toBe((223105 + 455150 + 627010) * 16384)
    expect(parseVmStatUsed('')).toBeNull()
  })
  it('swapusage em M e G', () => {
    expect(parseSwapUsage(SYSCTL)).toEqual({ total: 15360 * 1024 ** 2, used: 14692.94 * 1024 ** 2 })
    expect(parseSwapUsage('vm.swapusage: total = 2.00G  used = 0.50G  free = 1.50G')).toEqual({ total: 2 * 1024 ** 3, used: 0.5 * 1024 ** 3 })
    expect(parseSwapUsage('vm.swapusage: total = 0.00M  used = 0.00M  free = 0.00M')).toEqual({ total: 0, used: 0 })
    expect(parseSwapUsage('nada')).toBeNull()
  })
  it('pressão do macOS: 1 normal, 2 alerta, 4 crítica', () => {
    expect(parsePressureLevel(SYSCTL)).toBe('alerta')
    expect(parsePressureLevel('kern.memorystatus_vm_pressure_level: 1')).toBe('normal')
    expect(parsePressureLevel('kern.memorystatus_vm_pressure_level: 4')).toBe('critica')
    expect(parsePressureLevel('')).toBeNull()
  })
  it('/proc/meminfo: usada = total − disponível', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({ ramTotal: 16303428 * 1024, ramUsed: (16303428 - 6303428) * 1024, swapTotal: 4194300 * 1024, swapUsed: (4194300 - 3145724) * 1024 })
    expect(parseMeminfo('MemTotal: 1 kB')).toBeNull()
  })
  it('PSI: some avg10 ≥ 10 alerta, ≥ 40 crítica', () => {
    const psi = (n: number) => `some avg10=${n} avg60=0.00 avg300=0.00 total=1\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n`
    expect(parsePsi(psi(0.5))).toBe('normal')
    expect(parsePsi(psi(12.3))).toBe('alerta')
    expect(parsePsi(psi(55))).toBe('critica')
    expect(parsePsi('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/machine-parse.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implement** `src/daemon/machine/parse.ts`

```ts
import type { MemPressure } from '../../shared/types'

const MB = 1024 ** 2
const GB = 1024 ** 3

/** "Memória usada" do Monitor de Atividade ≈ ativa + fixa + comprimida; os.freemem() subestima no Mac */
export function parseVmStatUsed(out: string): number | null {
  const page = /page size of (\d+) bytes/.exec(out)
  const n = (label: string) => {
    const m = new RegExp(`^${label}:\\s+(\\d+)\\.`, 'm').exec(out)
    return m ? Number(m[1]) : null
  }
  const active = n('Pages active')
  const wired = n('Pages wired down')
  const comp = n('Pages occupied by compressor')
  if (!page || active === null || wired === null || comp === null) return null
  return (active + wired + comp) * Number(page[1])
}

export function parseSwapUsage(out: string): { used: number; total: number } | null {
  const m = /vm\.swapusage:\s*total = ([\d.]+)([MG])\s+used = ([\d.]+)([MG])/.exec(out)
  if (!m) return null
  const b = (v: string, u: string) => Number(v) * (u === 'G' ? GB : MB)
  return { total: b(m[1], m[2]), used: b(m[3], m[4]) }
}

export function parsePressureLevel(out: string): MemPressure {
  const m = /kern\.memorystatus_vm_pressure_level:\s*(\d+)/.exec(out)
  if (!m) return null
  const v = Number(m[1])
  return v >= 4 ? 'critica' : v >= 2 ? 'alerta' : 'normal'
}

export function parseMeminfo(text: string): { ramUsed: number; ramTotal: number; swapUsed: number; swapTotal: number } | null {
  const kb = (k: string) => {
    const m = new RegExp(`^${k}:\\s+(\\d+) kB`, 'm').exec(text)
    return m ? Number(m[1]) * 1024 : null
  }
  const total = kb('MemTotal')
  const avail = kb('MemAvailable')
  if (total === null || avail === null) return null
  const swapTotal = kb('SwapTotal') ?? 0
  const swapFree = kb('SwapFree') ?? swapTotal
  return { ramTotal: total, ramUsed: total - avail, swapTotal, swapUsed: swapTotal - swapFree }
}

export function parsePsi(text: string): MemPressure {
  const m = /^some avg10=([\d.]+)/m.exec(text)
  if (!m) return null
  const v = Number(m[1])
  return v >= 40 ? 'critica' : v >= 10 ? 'alerta' : 'normal'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/daemon/machine-parse.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" add src/daemon/machine/parse.ts tests/daemon/machine-parse.test.ts
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" commit -m "feat(maquina): parsers de memória do macOS e do Linux"
```

---

### Task 3: Nível e motivos

**Files:**
- Create: `src/daemon/machine/level.ts`
- Test: `tests/daemon/machine-level.test.ts`

**Interfaces:**
- Consumes: `MachineLimits` (Task 1), `MemPressure`, `MachineLevel`, `gb`, `pressureLabel`.
- Produces: `machineLevel(s: { cpu1m: number; ramTotal: number; swapUsed: number; pressure: MemPressure }, lim: MachineLimits): { level: MachineLevel; reasons: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { machineLevel } from '../../src/daemon/machine/level'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'

const L = DEFAULT_SETTINGS.machine
const G = 1024 ** 3
const base = { cpu1m: 20, ramTotal: 24 * G, swapUsed: 0, pressure: 'normal' as const }

describe('nível da máquina', () => {
  it('tudo baixo: ok sem motivos', () => {
    expect(machineLevel(base, L)).toEqual({ level: 'ok', reasons: [] })
  })
  it('CPU de 1 min: 70 amarelo, 90 bloqueia', () => {
    expect(machineLevel({ ...base, cpu1m: 75 }, L)).toEqual({ level: 'warn', reasons: ['CPU 75%'] })
    expect(machineLevel({ ...base, cpu1m: 93.4 }, L)).toEqual({ level: 'bad', reasons: ['CPU 93%'] })
  })
  it('swap em % da RAM: 25% de 24 GB = 6 GB amarelo, 75% = 18 GB bloqueia', () => {
    expect(machineLevel({ ...base, swapUsed: 5.9 * G }, L).level).toBe('ok')
    expect(machineLevel({ ...base, swapUsed: 14.3 * G }, L)).toEqual({ level: 'warn', reasons: ['swap 14,3 GB'] })
    expect(machineLevel({ ...base, swapUsed: 18.2 * G }, L)).toEqual({ level: 'bad', reasons: ['swap 18,2 GB'] })
  })
  it('pressão: alerta amarelo, crítica bloqueia; desligada nas preferências não conta', () => {
    expect(machineLevel({ ...base, pressure: 'alerta' }, L)).toEqual({ level: 'warn', reasons: ['pressão em alerta'] })
    expect(machineLevel({ ...base, pressure: 'critica' }, L)).toEqual({ level: 'bad', reasons: ['pressão crítica'] })
    expect(machineLevel({ ...base, pressure: 'critica' }, { ...L, pressureGate: false }).level).toBe('ok')
    expect(machineLevel({ ...base, pressure: null }, L).level).toBe('ok')
  })
  it('combinação: bad vence, motivos de bad e warn listados', () => {
    expect(machineLevel({ ...base, cpu1m: 75, pressure: 'critica' }, L)).toEqual({ level: 'bad', reasons: ['CPU 75%', 'pressão crítica'] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/machine-level.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implement** `src/daemon/machine/level.ts`

```ts
import type { MachineLevel, MemPressure } from '../../shared/types'
import type { MachineLimits } from '../../shared/settings'
import { gb, pressureLabel } from '../../shared/machine-format'

const RANK: Record<MachineLevel, number> = { ok: 0, warn: 1, bad: 2 }

/** swap conta em % da RAM física: o total de swap do macOS cresce sozinho e fica sempre quase cheio */
export function machineLevel(s: { cpu1m: number; ramTotal: number; swapUsed: number; pressure: MemPressure }, lim: MachineLimits): { level: MachineLevel; reasons: string[] } {
  let level: MachineLevel = 'ok'
  const reasons: string[] = []
  const hit = (l: MachineLevel, reason: string) => {
    if (l === 'ok') return
    reasons.push(reason)
    if (RANK[l] > RANK[level]) level = l
  }
  const by = (v: number, warn: number, bad: number): MachineLevel => (v >= bad ? 'bad' : v >= warn ? 'warn' : 'ok')
  hit(by(s.cpu1m, lim.cpuWarn, lim.cpuBad), `CPU ${Math.round(s.cpu1m)}%`)
  if (s.ramTotal > 0) hit(by((s.swapUsed / s.ramTotal) * 100, lim.swapWarn, lim.swapBad), `swap ${gb(s.swapUsed)} GB`)
  if (lim.pressureGate && s.pressure) hit(s.pressure === 'critica' ? 'bad' : s.pressure === 'alerta' ? 'warn' : 'ok', pressureLabel(s.pressure))
  return { level, reasons }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/daemon/machine-level.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" add src/daemon/machine/level.ts tests/daemon/machine-level.test.ts
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" commit -m "feat(maquina): nível e motivos a partir dos limites"
```

---

### Task 4: MachineMonitor + leitor real de memória

**Files:**
- Create: `src/daemon/machine/monitor.ts`, `src/daemon/machine/read.ts`
- Modify: `src/daemon/platform/procs.ts:91` (exportar `run`)
- Test: `tests/daemon/machine-monitor.test.ts`

**Interfaces:**
- Consumes: `machineLevel` (Task 3), parsers (Task 2), `MachineLimits`, `MachineView`.
- Produces:
  - `interface MemSample { ramUsed: number; ramTotal: number; swapUsed: number; swapTotal: number; pressure: MemPressure }` (exportado de `monitor.ts`)
  - `cpuTotals(cpus: os.CpuInfo[]): { idle: number; total: number }`, `cpuPercent(a, b): number`
  - `class MachineMonitor { constructor(d: MachineMonitorDeps); start(): void; stop(): void; tick(): Promise<void>; view(): MachineView | null; recompute(): void }`
  - `interface MachineMonitorDeps { readMem: () => Promise<MemSample>; cpus?: () => os.CpuInfo[]; limits: () => MachineLimits; onChange: (v: MachineView) => void; intervalMs?: number; heartbeatMs?: number; now?: () => number; log?: (m: string) => void }`
  - `read.ts`: `makeMemReader(platform?: NodeJS.Platform): () => Promise<MemSample>`
  - `procs.ts`: `export function run(cmd: string, args: string[]): Promise<string>`

- [ ] **Step 1: Write the failing test**

```ts
import type os from 'node:os'
import { describe, expect, it } from 'vitest'
import { cpuPercent, cpuTotals, MachineMonitor, type MemSample } from '../../src/daemon/machine/monitor'
import { makeMemReader } from '../../src/daemon/machine/read'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import type { MachineView } from '../../src/shared/types'

const G = 1024 ** 3
const cpu = (idle: number, total: number): os.CpuInfo[] => [{ model: '', speed: 0, times: { user: total - idle, nice: 0, sys: 0, idle, irq: 0 } }]
const mem = (p: Partial<MemSample> = {}): MemSample => ({ ramUsed: 10 * G, ramTotal: 24 * G, swapUsed: 0, swapTotal: 0, pressure: 'normal', ...p })

function setup(cpus: os.CpuInfo[][], read: () => Promise<MemSample>, now = { t: 1000 }) {
  const seen: MachineView[] = []
  let i = 0
  const m = new MachineMonitor({
    readMem: read,
    cpus: () => cpus[Math.min(i++, cpus.length - 1)],
    limits: () => DEFAULT_SETTINGS.machine,
    onChange: (v) => seen.push(v),
    now: () => now.t,
  })
  return { m, seen, now }
}

describe('MachineMonitor', () => {
  it('CPU por delta dos tempos', () => {
    expect(cpuTotals(cpu(30, 100))).toEqual({ idle: 30, total: 100 })
    expect(cpuPercent({ idle: 0, total: 0 }, { idle: 25, total: 100 })).toBe(75)
    expect(cpuPercent({ idle: 5, total: 10 }, { idle: 5, total: 10 })).toBe(0)
  })
  it('1ª leitura só guarda a base; a 2ª emite', async () => {
    const { m, seen } = setup([cpu(0, 0), cpu(50, 100)], async () => mem())
    await m.tick()
    expect(m.view()).toBeNull()
    await m.tick()
    expect(seen).toHaveLength(1)
    expect(m.view()).toMatchObject({ cpu: 50, cpu1m: 50, ram: { used: 10 * G, total: 24 * G }, level: 'ok', stale: false, at: 1000 })
  })
  it('média de 1 min e nível pela média', async () => {
    const { m } = setup([cpu(0, 0), cpu(0, 100), cpu(100, 200)], async () => mem())
    await m.tick()
    await m.tick() // 100%
    await m.tick() // 0%
    expect(m.view()).toMatchObject({ cpu: 0, cpu1m: 50 })
  })
  it('só emite quando muda ou a cada 30 s', async () => {
    const { m, seen, now } = setup([cpu(0, 0), cpu(50, 100), cpu(100, 200), cpu(150, 300)], async () => mem())
    await m.tick()
    await m.tick()
    await m.tick() // igual
    expect(seen).toHaveLength(1)
    now.t += 30_000
    await m.tick() // heartbeat
    expect(seen).toHaveLength(2)
  })
  it('falha na leitura: mantém a última com stale e avisa', async () => {
    let fail = false
    const { m, seen } = setup([cpu(0, 0), cpu(50, 100), cpu(100, 200)], async () => {
      if (fail) throw new Error('vm_stat sumiu')
      return mem()
    })
    await m.tick()
    await m.tick()
    fail = true
    await m.tick()
    expect(m.view()).toMatchObject({ stale: true, at: 1000 })
    expect(seen.at(-1)?.stale).toBe(true)
  })
  it('falha antes da 1ª leitura boa: continua sem visão', async () => {
    const { m } = setup([cpu(0, 0), cpu(50, 100)], async () => {
      throw new Error('x')
    })
    await m.tick()
    await m.tick()
    expect(m.view()).toBeNull()
  })
  it('leitura lenta não empilha ticks', async () => {
    let calls = 0
    let release!: () => void
    const { m } = setup([cpu(0, 0), cpu(50, 100), cpu(100, 200)], () => {
      calls++
      return new Promise((r) => (release = () => r(mem())))
    })
    await m.tick()
    const a = m.tick()
    const b = m.tick() // ainda lendo: ignora
    release()
    await Promise.all([a, b])
    expect(calls).toBe(1)
  })
  it('recompute aplica limites novos sem nova leitura', async () => {
    let lim = DEFAULT_SETTINGS.machine
    const seen: MachineView[] = []
    let i = 0
    const cpus = [cpu(0, 0), cpu(25, 100)]
    const m = new MachineMonitor({ readMem: async () => mem(), cpus: () => cpus[Math.min(i++, 1)], limits: () => lim, onChange: (v) => seen.push(v), now: () => 1 })
    await m.tick()
    await m.tick() // 75% → warn
    expect(m.view()?.level).toBe('warn')
    lim = { ...lim, cpuWarn: 80, cpuBad: 95 }
    m.recompute()
    expect(m.view()?.level).toBe('ok')
    expect(seen).toHaveLength(2)
  })
  it.runIf(process.platform === 'darwin')('leitor real do macOS devolve números plausíveis', async () => {
    const s = await makeMemReader('darwin')()
    expect(s.ramTotal).toBeGreaterThan(G)
    expect(s.ramUsed).toBeGreaterThan(0)
    expect(s.ramUsed).toBeLessThanOrEqual(s.ramTotal * 1.05)
    expect(['normal', 'alerta', 'critica']).toContain(s.pressure)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/machine-monitor.test.ts`
Expected: FAIL (módulos não existem)

- [ ] **Step 3: Implement**

In `src/daemon/platform/procs.ts`, change `function run(` to `export function run(` (line ~91). Nothing else.

Create `src/daemon/machine/monitor.ts`:
```ts
import os from 'node:os'
import type { MachineView, MemPressure } from '../../shared/types'
import type { MachineLimits } from '../../shared/settings'
import { machineLevel } from './level'

export interface MemSample {
  ramUsed: number
  ramTotal: number
  swapUsed: number
  swapTotal: number
  pressure: MemPressure
}

export interface MachineMonitorDeps {
  readMem: () => Promise<MemSample>
  cpus?: () => os.CpuInfo[]
  limits: () => MachineLimits
  onChange: (v: MachineView) => void
  intervalMs?: number
  heartbeatMs?: number
  now?: () => number
  log?: (m: string) => void
}

type Totals = { idle: number; total: number }

export function cpuTotals(cpus: os.CpuInfo[]): Totals {
  let idle = 0
  let total = 0
  for (const c of cpus) {
    const t = c.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  return { idle, total }
}

export function cpuPercent(a: Totals, b: Totals): number {
  const dt = b.total - a.total
  if (dt <= 0) return 0
  return Math.min(100, Math.max(0, 100 * (1 - (b.idle - a.idle) / dt)))
}

/** CPU/RAM da máquina a cada 3 s; o gate do contratar_dev e o chip da barra leem daqui */
export class MachineMonitor {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private stopped = false
  private base: Totals | null = null
  private hist: number[] = []
  private raw: { cpu: number; mem: MemSample; at: number } | null = null
  private current: MachineView | null = null
  private lastKey = ''
  private lastEmitAt = -Infinity
  private loggedAt = -Infinity
  private interval: number
  private heartbeat: number
  private window: number

  constructor(private d: MachineMonitorDeps) {
    this.interval = d.intervalMs ?? 3000
    this.heartbeat = d.heartbeatMs ?? 30_000
    this.window = Math.max(1, Math.round(60_000 / this.interval))
  }

  start(): void {
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.interval)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
  }

  view(): MachineView | null {
    return this.current
  }

  /** limites mudaram nas preferências: recalcula o nível com a última leitura */
  recompute(): void {
    if (!this.raw) return
    this.current = { ...this.build(), stale: this.current?.stale ?? false }
    this.emit()
  }

  async tick(): Promise<void> {
    if (this.stopped || this.running) return
    const now = this.d.now ?? Date.now
    const t = cpuTotals((this.d.cpus ?? os.cpus)())
    const prev = this.base
    this.base = t
    if (!prev) return // 1ª leitura: só a base do delta
    const cpu = cpuPercent(prev, t)
    this.hist.push(cpu)
    if (this.hist.length > this.window) this.hist.shift()
    this.running = true
    let mem: MemSample | null = null
    try {
      mem = await this.d.readMem()
    } catch (e) {
      if (now() - this.loggedAt > 3_600_000) {
        this.loggedAt = now()
        this.d.log?.(`monitor da máquina: leitura falhou (${e instanceof Error ? e.message : String(e)})`)
      }
    } finally {
      this.running = false
    }
    if (this.stopped) return
    if (!mem) {
      if (this.current && !this.current.stale) {
        this.current = { ...this.current, stale: true }
        this.emit()
      }
      return
    }
    this.raw = { cpu, mem, at: now() }
    this.current = this.build()
    this.emit()
  }

  private build(): MachineView {
    const { cpu, mem, at } = this.raw!
    const cpu1m = this.hist.reduce((a, b) => a + b, 0) / this.hist.length
    const { level, reasons } = machineLevel({ cpu1m, ramTotal: mem.ramTotal, swapUsed: mem.swapUsed, pressure: mem.pressure }, this.d.limits())
    return { cpu, cpu1m, ram: { used: mem.ramUsed, total: mem.ramTotal }, swap: { used: mem.swapUsed, total: mem.swapTotal }, pressure: mem.pressure, level, reasons, at, stale: false }
  }

  /** só quando muda o que aparece (CPU inteira, 0,1 GB, nível, pressão, stale) ou a cada heartbeat */
  private emit(): void {
    const v = this.current
    if (!v) return
    const now = (this.d.now ?? Date.now)()
    const r = (b: number) => Math.round(b / 1e8)
    const key = [Math.round(v.cpu), Math.round(v.cpu1m), r(v.ram.used), r(v.swap.used), v.level, v.pressure, v.stale, v.reasons.join()].join('|')
    if (key === this.lastKey && now - this.lastEmitAt < this.heartbeat) return
    this.lastKey = key
    this.lastEmitAt = now
    this.d.onChange(v)
  }
}
```

Create `src/daemon/machine/read.ts`:
```ts
import fs from 'node:fs'
import os from 'node:os'
import type { MemPressure } from '../../shared/types'
import { run } from '../platform/procs'
import type { MemSample } from './monitor'
import { parseMeminfo, parsePressureLevel, parsePsi, parseSwapUsage, parseVmStatUsed } from './parse'

export function makeMemReader(platform: NodeJS.Platform = process.platform): () => Promise<MemSample> {
  if (platform === 'linux') {
    return async () => {
      const mem = parseMeminfo(fs.readFileSync('/proc/meminfo', 'utf8'))
      if (!mem) throw new Error('/proc/meminfo inesperado')
      let pressure: MemPressure = null
      try {
        pressure = parsePsi(fs.readFileSync('/proc/pressure/memory', 'utf8'))
      } catch {
        // kernel sem PSI: nível só por CPU e swap
      }
      return { ...mem, pressure }
    }
  }
  return async () => {
    const [vm, sc] = await Promise.all([run('/usr/bin/vm_stat', []), run('/usr/sbin/sysctl', ['vm.swapusage', 'kern.memorystatus_vm_pressure_level'])])
    const ramUsed = parseVmStatUsed(vm)
    const swap = parseSwapUsage(sc)
    if (ramUsed === null || swap === null) throw new Error('saída inesperada de vm_stat/sysctl')
    return { ramUsed, ramTotal: os.totalmem(), swapUsed: swap.used, swapTotal: swap.total, pressure: parsePressureLevel(sc) }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/daemon/machine-monitor.test.ts tests/daemon/procs.test.ts`
Expected: PASS (o teste do leitor real roda neste Mac)

- [ ] **Step 5: Commit**

```bash
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" add src/daemon/machine src/daemon/platform/procs.ts tests/daemon/machine-monitor.test.ts
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" commit -m "feat(maquina): monitor de CPU/RAM com média de 1 min e leitor do macOS/Linux"
```

---

### Task 5: Processos — parser do ps, grupos, top 5, relatório

**Files:**
- Create: `src/daemon/machine/groups.ts`, `src/daemon/machine/report.ts`
- Modify: `src/daemon/platform/procs.ts` (`descendants` genérico), `src/daemon/machine/read.ts` (+ `snapshotPsDetail`)
- Test: `tests/daemon/machine-groups.test.ts`

**Interfaces:**
- Consumes: `MachineDetail`, `MachineGroup`, `MachineProc`, `MachineView`, `gb`, `formatEtime`, `run`.
- Produces:
  - `procs.ts`: `descendants<T extends { pid: number; ppid: number }>(procs: T[], rootPid: number): T[]`
  - `groups.ts`: `interface PsRow { pid; ppid; rss /*bytes*/; cpu; etime: string; args: string }`; `parsePsDetail(out: string): PsRow[]`; `procName(args: string): string`; `groupProcs(rows: PsRow[], panes: { id: string; pid: number }[]): MachineDetail`
  - `read.ts`: `snapshotPsDetail(): Promise<PsRow[]>`
  - `report.ts`: `gateRefusal(v: MachineView, d: MachineDetail): string`; `machineReport(v: MachineView, d: MachineDetail, claudePanes: { rss: number }[]): Record<string, unknown>`

- [ ] **Step 1: Write the failing test**

```ts
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
```

Note on expected numbers: `cabem_ate_amarelo` = `floor((0,85·24 − 16) / 1,0)` = `floor(4,4)` = 4; with RAM 22,1 GB used it is `floor(-1,7)` → clamped 0. Emulador RSS `3800000 KB` = 3,62 GB → `"3,6"`. esbuild `364,5` → `Math.round` = 365.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/machine-groups.test.ts`
Expected: FAIL (módulos não existem)

- [ ] **Step 3: Implement**

In `src/daemon/platform/procs.ts`, make `descendants` generic (body unchanged):
```ts
export function descendants<T extends { pid: number; ppid: number }>(procs: T[], rootPid: number): T[] {
  const children = new Map<number, T[]>()
  for (const p of procs) {
    const list = children.get(p.ppid) ?? []
    list.push(p)
    children.set(p.ppid, list)
  }
  const out: T[] = []
  const queue = [rootPid]
  while (queue.length) {
    const pid = queue.shift()!
    for (const c of children.get(pid) ?? []) {
      out.push(c)
      queue.push(c.pid)
    }
  }
  return out
}
```

Create `src/daemon/machine/groups.ts`:
```ts
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
const EMULATOR = /qemu-system|\/emulator(\s|$)|Simulator\.app|CoreSimulator/
const BROWSERS = /Google Chrome|Safari\.app|Arc\.app|firefox|Brave Browser/i

const round1 = (n: number) => Math.round(n * 10) / 10

export function groupProcs(rows: PsRow[], panes: { id: string; pid: number }[]): MachineDetail {
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
  const colima = mk('colima', 'Colima / Docker')
  const emulator = mk('emulador', 'Emulador')
  const browsers = mk('navegadores', 'Navegadores')
  for (const r of rows) {
    if (claimed.has(r.pid)) continue
    const g = COLIMA.test(r.args) ? colima : EMULATOR.test(r.args) ? emulator : BROWSERS.test(r.args) ? browsers : null
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
```

Append to `src/daemon/machine/read.ts`:
```ts
import { parsePsDetail, type PsRow } from './groups'

/** só sob demanda (painel aberto, gate, uso_da_maquina) */
export async function snapshotPsDetail(): Promise<PsRow[]> {
  return parsePsDetail(await run('/bin/ps', ['-A', '-o', 'pid=,ppid=,rss=,pcpu=,etime=,args=']))
}
```
(put the `import` at the top of the file with the other imports.)

Create `src/daemon/machine/report.ts`:
```ts
import type { MachineDetail, MachineView } from '../../shared/types'
import { formatEtime, gb, pressureLabel } from '../../shared/machine-format'

function consumers(d: MachineDetail): string[] {
  const groups = d.groups.filter((g) => g.count > 0).slice(0, 2).map((g) => `${g.label}${g.key === 'sessoes' ? ` (${g.count})` : ''} ${gb(g.rss)} GB`)
  const procs = d.top.slice(0, 2).map((p) => `${p.name} ${Math.round(p.cpu)}% CPU`)
  return [...groups, ...procs]
}

export function gateRefusal(v: MachineView, d: MachineDetail): string {
  return [
    `Máquina sobrecarregada: ${v.reasons.join(' · ')} (CPU ${Math.round(v.cpu)}%, RAM ${gb(v.ram.used)}/${gb(v.ram.total)} GB).`,
    `Maiores consumidores: ${consumers(d).join(' · ')}.`,
    'Contratar agora pode travar o computador. Pergunte ao usuário; só repita com forcar: true se ele autorizar.',
  ].join(' ')
}

export function machineReport(v: MachineView, d: MachineDetail, claudePanes: { rss: number }[]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    nivel: v.level,
    motivos: v.reasons,
    cpu: `${Math.round(v.cpu)}%`,
    cpu_1min: `${Math.round(v.cpu1m)}%`,
    ram: `${gb(v.ram.used)}/${gb(v.ram.total)} GB`,
    swap: `${gb(v.swap.used)} GB`,
    pressao: pressureLabel(v.pressure),
    grupos: d.groups.map((g) => ({ nome: g.label, processos: g.count, ram: `${gb(g.rss)} GB`, cpu: `${Math.round(g.cpu)}%` })),
    maiores_processos: d.top.map((p) => ({ nome: p.name, pid: p.pid, cpu: `${Math.round(p.cpu)}%`, ram: `${gb(p.rss)} GB`, tempo: formatEtime(p.etime) })),
  }
  if (claudePanes.length > 0) {
    const avg = claudePanes.reduce((a, p) => a + p.rss, 0) / claudePanes.length
    out.media_por_sessao_claude = `${gb(avg)} GB`
    if (avg > 0) out.cabem_ate_amarelo = Math.max(0, Math.floor((0.85 * v.ram.total - v.ram.used) / avg))
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/daemon/machine-groups.test.ts tests/daemon/procs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" add src/daemon/machine src/daemon/platform/procs.ts tests/daemon/machine-groups.test.ts
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" commit -m "feat(maquina): consumidores por grupo, top 5 e textos do gate"
```

---

### Task 6: Daemon — monitor ligado, mensagem `machine` e watchers

**Files:**
- Modify: `src/shared/protocol.ts` (ClientRequest e ServerMessage)
- Modify: `src/daemon/daemon.ts` (opções 28-53, campos 55-75, `start` ~175, `stop` ~238, `handle` ~530 e `case 'settings.save'`)
- Modify: `src/daemon/main.ts:54`
- Modify: `tests/helpers/app-client.ts`
- Test: `tests/daemon/daemon.test.ts` (novo `describe` no fim)

**Interfaces:**
- Consumes: `MachineMonitor`, `MemSample` (Task 4), `groupProcs`, `PsRow` (Task 5), `makeMemReader`, `snapshotPsDetail`.
- Produces:
  - Protocol: `ServerMessage` += `{ t: 'machine'; machine: MachineView; detail?: MachineDetail }`; `ClientRequest` += `{ t: 'machine.watch' } | { t: 'machine.unwatch' }`.
  - `DaemonOptions` += `machineMem?: () => Promise<MemSample>`, `machinePs?: () => Promise<PsRow[]>`, `machineCpus?: () => os.CpuInfo[]`, `machineIntervalMs?: number`.
  - Daemon privates used by Task 7: `this.machine: MachineMonitor`, `this.panePids(): { id: string; pid: number }[]`, `this.readDetail(): Promise<MachineDetail>`.
  - `connectApp(...)` returns also `machine(): { machine: MachineView; detail?: MachineDetail }[]` (all received, in order).

- [ ] **Step 1: Write the failing test**

In `tests/helpers/app-client.ts`, add capture (before `client.onMessage`): `const machine: { machine: MachineView; detail?: MachineDetail }[] = []`; inside `onMessage`: `if (m.t === 'machine') machine.push({ machine: m.machine, detail: m.detail })`; return field `machine: () => machine,`; import `MachineDetail, MachineView` from `../../src/shared/types`.

Append to `tests/daemon/daemon.test.ts`:
```ts
describe('monitor da máquina', () => {
  const G = 1024 ** 3
  const fakeCpus = () => {
    let n = 0
    return () => {
      n++
      return [{ model: '', speed: 0, times: { user: n * 50, nice: 0, sys: 0, idle: n * 50, irq: 0 } }]
    }
  }
  const mem = (p: Record<string, unknown> = {}) => async () => ({ ramUsed: 10 * G, ramTotal: 24 * G, swapUsed: 0, swapTotal: 0, pressure: 'normal' as const, ...p })

  it('manda machine às janelas e a última leitura a quem conecta depois', async () => {
    const { o, app } = await boot({ machineMem: mem(), machineCpus: fakeCpus(), machineIntervalMs: 40 })
    await waitFor(() => (app.machine().length > 0 ? true : null), 3000)
    expect(app.machine()[0].machine).toMatchObject({ cpu: 50, level: 'ok', ram: { total: 24 * G } })
    expect(app.machine()[0].detail).toBeUndefined()
    const late = await connectApp(o.socketPath)
    await waitFor(() => (late.machine().length > 0 ? true : null), 3000)
  })

  it('watch traz o detalhe; unwatch e conexão fechada param o ps', async () => {
    let psCalls = 0
    const machinePs = async () => {
      psCalls++
      return [{ pid: 1, ppid: 0, rss: 1024, cpu: 1, etime: '01:00', args: '/sbin/launchd' }]
    }
    const { o, app } = await boot({ machineMem: mem(), machineCpus: fakeCpus(), machineIntervalMs: 40, machinePs })
    await waitFor(() => (app.machine().length > 0 ? true : null), 3000)
    expect(psCalls).toBe(0) // sem painel aberto, sem ps
    app.client.send({ t: 'machine.watch' })
    await waitFor(() => (app.machine().some((m) => m.detail) ? true : null), 3000)
    expect(app.machine().find((m) => m.detail)!.detail!.groups.map((g) => g.key)).toEqual(['colima', 'emulador'])
    app.client.send({ t: 'machine.unwatch' })
    await new Promise((r) => setTimeout(r, 100))
    const after = psCalls
    await new Promise((r) => setTimeout(r, 200))
    expect(psCalls).toBe(after)
    // janela fecha com o painel aberto: para também
    const other = await connectApp(o.socketPath)
    other.client.send({ t: 'machine.watch' })
    await waitFor(() => (other.machine().some((m) => m.detail) ? true : null), 3000)
    other.client.close()
    await new Promise((r) => setTimeout(r, 100))
    const closed = psCalls
    await new Promise((r) => setTimeout(r, 200))
    expect(psCalls).toBe(closed)
  })

  it('limites novos nas preferências recalculam o nível', async () => {
    const { app } = await boot({ machineMem: mem({ swapUsed: 10 * G }), machineCpus: fakeCpus(), machineIntervalMs: 40 })
    await waitFor(() => (app.machine().at(-1)?.machine.level === 'warn' ? true : null), 3000)
    const s0 = (await app.client.request<{ settings: TerminalSettings }>({ t: 'state.get' })).settings
    await app.client.request({ t: 'settings.save', settings: { ...s0, machine: { ...s0.machine, swapWarn: 50, swapBad: 80 } } })
    await waitFor(() => (app.machine().at(-1)?.machine.level === 'ok' ? true : null), 3000)
  })
})
```
Check: `RpcClient` exposes `send` (fire-and-forget) and `close`; run `rg -n "send\(|close\(" src/shared/rpc-client.ts`. If the names differ, use the existing ones (e.g. `request` with `id 0`, `destroy`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/daemon/daemon.test.ts -t "monitor da máquina"`
Expected: FAIL (opções e mensagens não existem; typecheck do teste falha)

- [ ] **Step 3: Implement**

`src/shared/protocol.ts`: add to the type import `MachineDetail, MachineView`; add to `ClientRequest`:
```ts
  | { t: 'machine.watch' }
  | { t: 'machine.unwatch' }
```
add to `ServerMessage`:
```ts
  | { t: 'machine'; machine: MachineView; detail?: MachineDetail }
```

`src/daemon/daemon.ts`:
- imports:
```ts
import type os from 'node:os'
import { MachineMonitor, type MemSample } from './machine/monitor'
import { groupProcs, type PsRow } from './machine/groups'
import type { MachineDetail } from '../shared/types'
```
(merge `MachineDetail` into the existing `../shared/types` import if there is one.)
- `DaemonOptions` (after `usageIntervalMs`):
```ts
  /** leitor de memória da máquina; padrão inerte (testes não dependem da máquina). O main.ts passa o real */
  machineMem?: () => Promise<MemSample>
  /** ps detalhado (sob demanda); padrão inerte */
  machinePs?: () => Promise<PsRow[]>
  machineCpus?: () => os.CpuInfo[]
  machineIntervalMs?: number
```
- fields (after `private conflictTimers ...`):
```ts
  private machine!: MachineMonitor
  private machineWatchers = new Set<Conn>()
  private machineDetailTimer: NodeJS.Timeout | null = null
```
- in `start`, right after the `this.usage = new UsageMonitor({...})` block:
```ts
    this.machine = new MachineMonitor({
      readMem: this.o.machineMem ?? (async () => Promise.reject(new Error('sem leitor da máquina'))),
      cpus: this.o.machineCpus,
      limits: () => this.persisted.settings.machine,
      intervalMs: this.o.machineIntervalMs,
      log: (m) => console.error(m),
      // mensagem própria, fora do state: o AppState inteiro a cada 3 s faria as janelas renderizarem à toa
      onChange: (machine) => {
        for (const c of this.server?.conns ?? []) if (c.role === 'app') c.send({ t: 'machine', machine })
      },
    })
```
  and after `this.server = await startServer(...)`:
```ts
    // sem leitor (testes que não injetam um): nunca há leitura, e o gate segue com aviso
    if (this.o.machineMem) this.machine.start()
```
- in `stop` (after `this.usage.stop()`):
```ts
    this.machine.stop()
    if (this.machineDetailTimer) clearInterval(this.machineDetailTimer)
```
- new private methods (next to `floatOwner`):
```ts
  private panePids(): { id: string; pid: number }[] {
    const out: { id: string; pid: number }[] = []
    for (const r of this.panes.records()) {
      const pid = r.alive ? this.panes.host.pid(r.id) : undefined
      if (pid) out.push({ id: r.id, pid })
    }
    return out
  }

  private async readDetail(): Promise<MachineDetail> {
    return groupProcs(await (this.o.machinePs ?? (async () => []))(), this.panePids())
  }

  private async pushMachineDetail(): Promise<void> {
    const machine = this.machine.view()
    if (!machine || this.machineWatchers.size === 0) return
    const detail = await this.readDetail()
    for (const c of this.machineWatchers) c.send({ t: 'machine', machine: this.machine.view() ?? machine, detail })
  }

  private unwatchMachine(conn: Conn): void {
    this.machineWatchers.delete(conn)
    if (this.machineWatchers.size === 0 && this.machineDetailTimer) {
      clearInterval(this.machineDetailTimer)
      this.machineDetailTimer = null
    }
  }
```
- in `handle`, `case 'hello'`: after the existing `if (req.role === 'app') setImmediate(...)` line add:
```ts
        if (req.role === 'app') {
          const machine = this.machine.view()
          if (machine) setImmediate(() => conn.send({ t: 'machine', machine }))
        }
```
- new cases in `handle` (next to `file.watch`):
```ts
      case 'machine.watch':
        if (!this.machineWatchers.has(conn)) {
          this.machineWatchers.add(conn)
          conn.onClose(() => this.unwatchMachine(conn))
        }
        if (!this.machineDetailTimer) {
          this.machineDetailTimer = setInterval(() => void this.pushMachineDetail().catch((e) => console.error('ps da máquina falhou', e)), this.o.machineIntervalMs ?? 3000)
        }
        void this.pushMachineDetail().catch((e) => console.error('ps da máquina falhou', e))
        return null
      case 'machine.unwatch':
        this.unwatchMachine(conn)
        return null
```
- `case 'settings.save'`: after `this.persisted.settings = normalizeSettings(req.settings)` add `this.machine.recompute()`.

`src/daemon/main.ts`: import `{ makeMemReader, snapshotPsDetail } from './machine/read'` and add to the options (after `usageRead`):
```ts
    machineMem: makeMemReader(),
    machinePs: snapshotPsDetail,
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/daemon/daemon.test.ts && npm run typecheck`
Expected: PASS (toda a suíte do daemon, não só o bloco novo)

- [ ] **Step 5: Commit**

```bash
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" add src/shared/protocol.ts src/daemon tests/helpers/app-client.ts tests/daemon/daemon.test.ts
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" commit -m "feat(maquina): daemon mede a máquina e manda às janelas; ps só com o painel aberto"
```

---

### Task 7: Gate no `contratar_dev` e ferramenta `uso_da_maquina`

**Files:**
- Modify: `src/daemon/daemon.ts` (`mcpCall` ~362-405, `hire` ~407-445)
- Modify: `src/mcp/protocol.ts` (INSTRUCTIONS, TOOLS)
- Test: `tests/daemon/daemon.test.ts` (no bloco `monitor da máquina`), `tests/mcp/protocol.test.ts`

**Interfaces:**
- Consumes: `this.machine.view()`, `this.readDetail()`, `this.panePids()` (Task 6); `gateRefusal`, `machineReport` (Task 5).
- Produces: `contratar_dev` aceita `forcar: boolean`, recusa em `bad`, devolve `aviso?: string`; tool `uso_da_maquina` (sem parâmetros, não exige líder).

- [ ] **Step 1: Write the failing tests**

In `tests/daemon/daemon.test.ts`, change the helper signature so the gate tests can inject the monitor:
```ts
  async function leaderIn(repoDir: string, extra: Partial<DaemonOptions> = {}) {
    const b = await boot(extra)
```
(rest unchanged). `leaderIn` is declared inside an earlier `describe`; move it to file scope (just after `function hook(...)`) so the new block can use it, keeping its body identical.

Add inside `describe('monitor da máquina', ...)`:
```ts
  const critical = { machineMem: mem({ pressure: 'critica' }), machineCpus: fakeCpus(), machineIntervalMs: 40, machinePs: async () => [] }

  it('gate: máquina no vermelho recusa sem criar nada; forcar passa com aviso', async () => {
    repo = makeRepo()
    const { app, leader, call } = await leaderIn(repo.dir, critical)
    await app.client.request({ t: 'pane.setLeader', paneId: leader, leader: true })
    await waitFor(() => (app.machine().at(-1)?.machine.level === 'bad' ? true : null), 3000)
    await expect(call('contratar_dev', { nome: 'dev-1' })).rejects.toThrow(/Máquina sobrecarregada: pressão crítica .*forcar: true/)
    expect(fs.existsSync(path.join(repo.dir, '.claude', 'worktrees', 'dev-1'))).toBe(false)
    expect((await app.client.request<{ panes: unknown[] }>({ t: 'state.get' })).panes).toHaveLength(1)
    const r = await call('contratar_dev', { nome: 'dev-1', worktree: false, forcar: true })
    expect(r).toMatchObject({ nome: 'dev-1', aviso: 'contratado com a máquina sobrecarregada (pressão crítica)' })
  })

  it('gate: amarelo contrata com aviso; sem leitura contrata com aviso', async () => {
    repo = makeRepo()
    const warn = await leaderIn(repo.dir, { machineMem: mem({ pressure: 'alerta' }), machineCpus: fakeCpus(), machineIntervalMs: 40 })
    await warn.app.client.request({ t: 'pane.setLeader', paneId: warn.leader, leader: true })
    await waitFor(() => (warn.app.machine().length > 0 ? true : null), 3000)
    expect(await warn.call('contratar_dev', { nome: 'dev-1', worktree: false })).toMatchObject({ aviso: 'máquina no limite: pressão em alerta' })
    const blind = await leaderIn(repo.dir) // leitor padrão inerte: nunca há leitura
    await blind.app.client.request({ t: 'pane.setLeader', paneId: blind.leader, leader: true })
    expect(await blind.call('contratar_dev', { nome: 'dev-2', worktree: false })).toMatchObject({ aviso: 'não consegui medir a máquina' })
  })

  it('uso_da_maquina: qualquer sessão consulta (sem ser líder)', async () => {
    repo = makeRepo()
    const { app, call } = await leaderIn(repo.dir, critical)
    await waitFor(() => (app.machine().length > 0 ? true : null), 3000)
    expect(await call('uso_da_maquina', {})).toMatchObject({ nivel: 'bad', pressao: 'pressão crítica', ram: '10,0/24,0 GB' })
  })
```

In `tests/mcp/protocol.test.ts`, update the tools test and add:
```ts
  it('tools/list traz as 5 ferramentas; contratar aceita forcar', async () => {
    const r = (await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, noCall)) as { result: { tools: { name: string }[] } }
    expect(r.result.tools.map((t) => t.name)).toEqual(['contratar_dev', 'listar_equipe', 'renomear_dev', 'demitir_dev', 'uso_da_maquina'])
    expect(TOOLS[0].inputSchema).toMatchObject({ type: 'object', required: ['nome'], properties: { forcar: { type: 'boolean' } } })
  })
  it('instruções mandam consultar uso_da_maquina e só forçar com autorização', async () => {
    const r = (await handleMessage({ jsonrpc: '2.0', id: 9, method: 'initialize', params: {} }, noCall)) as { result: { instructions: string } }
    for (const k of ['uso_da_maquina', 'forcar: true', 'autorizar']) expect(r.result.instructions).toContain(k)
  })
```
(replace the existing `'tools/list traz as 4 ferramentas'` test with the first one.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/protocol.test.ts tests/daemon/daemon.test.ts -t "máquina|ferramentas|instruções"`
Expected: FAIL

- [ ] **Step 3: Implement**

`src/mcp/protocol.ts`:
- add to `INSTRUCTIONS` (before the line about "Só a sessão marcada"):
```ts
  'Antes de contratar mais de um dev, consulte uso_da_maquina e ajuste quantos contratar. Se contratar_dev recusar por máquina sobrecarregada, mostre o motivo ao usuário e só use forcar: true se ele autorizar.',
```
- in `contratar_dev.inputSchema.properties` add:
```ts
        forcar: { type: 'boolean', description: 'contratar mesmo com a máquina sobrecarregada; só com autorização explícita do usuário' },
```
- append to `TOOLS`:
```ts
  {
    name: 'uso_da_maquina',
    description:
      'Uso atual de CPU, RAM, swap e pressão de memória da máquina, os maiores consumidores (sessões do app, Colima/Docker, emulador, navegadores, top 5 processos), a RAM média por sessão do Claude e quantas sessões ainda cabem. Consulte antes de contratar devs.',
    inputSchema: { type: 'object', properties: {} },
  },
```

`src/daemon/daemon.ts`:
- import `{ gateRefusal, machineReport } from './machine/report'`.
- in `mcpCall`, **before** the line `// todas as ferramentas, inclusive listar, são só do líder`:
```ts
    // só leitura: qualquer sessão pode consultar
    if (tool === 'uso_da_maquina') {
      const v = this.machine.view()
      if (!v) return { aviso: 'ainda sem leitura da máquina; tente de novo em alguns segundos' }
      const d = await this.readDetail()
      const claude = this.panes.records().filter((r) => r.alive && r.claude).flatMap((r) => (d.perPane[r.id] ? [d.perPane[r.id]] : []))
      return machineReport(v, d, claude)
    }
```
- new private method next to `hire`:
```ts
  /** null = segue sem aviso; string = segue com aviso; lança = recusa (antes de qualquer efeito) */
  private async machineGate(force: boolean): Promise<string | null> {
    const v = this.machine.view()
    if (!v || (v.stale && Date.now() - v.at > 60_000)) return 'não consegui medir a máquina'
    if (v.level === 'bad') {
      if (force) return `contratado com a máquina sobrecarregada (${v.reasons.join(' · ')})`
      throw new Error(gateRefusal(v, await this.readDetail()))
    }
    if (v.level === 'warn') return `máquina no limite: ${v.reasons.join(' · ')}`
    return null
  }
```
- in `hire`, after the `maxHiredPerLeader` check line (before `const name = ...`):
```ts
    const aviso = await this.machineGate(args.forcar === true)
```
  and change the final `return { nome: name, ... }` to include `...(aviso ? { aviso } : {})` as the last property.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/mcp tests/daemon/daemon.test.ts && npm run typecheck`
Expected: PASS (inclusive os testes antigos de contratar: `toMatchObject` tolera o `aviso` extra)

- [ ] **Step 5: Commit**

```bash
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" add src/daemon/daemon.ts src/mcp/protocol.ts tests/daemon/daemon.test.ts tests/mcp/protocol.test.ts
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" commit -m "feat(maquina): contratar_dev recusa com a máquina sobrecarregada; ferramenta uso_da_maquina"
```

---

### Task 8: Renderer — store, mensagem e modelo do chip

**Files:**
- Modify: `src/renderer/src/store.ts`
- Modify: `src/renderer/src/main.tsx:75-117` (`bootWorkspace`)
- Create: `src/renderer/src/machine-model.ts`
- Test: `tests/renderer/machine-model.test.ts`

**Interfaces:**
- Consumes: `MachineView`, `MachineDetail`, `MachineLimits`, `gb`, `pressureLabel`.
- Produces:
  - `UiState.machine: MachineView | null`, `UiState.machineDetail: MachineDetail | null` (iniciais `null`)
  - `machine-model.ts`: `interface MachineBar { label: 'CPU' | 'RAM'; percent: number; filled: number; level: MachineLevel }`; `interface MachineChipVm { bars: MachineBar[]; swap: { text: string; level: MachineLevel } | null; dim: boolean; tooltip: string }`; `machineChip(v: MachineView, lim: MachineLimits): MachineChipVm`; `segments(percent: number): number`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { machineChip, segments } from '../../src/renderer/src/machine-model'
import { DEFAULT_SETTINGS } from '../../src/shared/settings'
import type { MachineView } from '../../src/shared/types'

const G = 1024 ** 3
const L = DEFAULT_SETTINGS.machine
const v = (p: Partial<MachineView> = {}): MachineView => ({ cpu: 34, cpu1m: 30, ram: { used: 19.4 * G, total: 24 * G }, swap: { used: 2 * G, total: 4 * G }, pressure: 'normal', level: 'ok', reasons: [], at: 0, stale: false, ...p })

describe('chip da máquina', () => {
  it('segmentos: 0 vazio, qualquer uso acende 1, cheio 5', () => {
    expect([0, 1, 20, 34, 81, 100, 130].map(segments)).toEqual([0, 1, 1, 2, 4, 5, 5])
  })
  it('barras de CPU e RAM com porcentagem', () => {
    const c = machineChip(v(), L)
    expect(c.bars).toEqual([
      { label: 'CPU', percent: 34, filled: 2, level: 'ok' },
      { label: 'RAM', percent: 81, filled: 4, level: 'ok' },
    ])
    expect(c.swap).toBeNull()
    expect(c.dim).toBe(false)
  })
  it('cor da CPU pelos limites; cor da RAM pela pressão', () => {
    expect(machineChip(v({ cpu: 75 }), L).bars[0].level).toBe('warn')
    expect(machineChip(v({ cpu: 95 }), L).bars[0].level).toBe('bad')
    expect(machineChip(v({ pressure: 'alerta' }), L).bars[1].level).toBe('warn')
    expect(machineChip(v({ pressure: 'critica' }), L).bars[1].level).toBe('bad')
  })
  it('RAM sem pressão (Linux sem PSI): 85% amarelo, 95% vermelho', () => {
    expect(machineChip(v({ pressure: null, ram: { used: 21 * G, total: 24 * G } }), L).bars[1].level).toBe('warn')
    expect(machineChip(v({ pressure: null, ram: { used: 23 * G, total: 24 * G } }), L).bars[1].level).toBe('bad')
  })
  it('swap só aparece fora do normal (em % da RAM) ou com pressão', () => {
    expect(machineChip(v({ swap: { used: 8.7 * G, total: 10 * G } }), L).swap).toEqual({ text: 'swap 8,7G', level: 'warn' })
    expect(machineChip(v({ swap: { used: 18.5 * G, total: 20 * G } }), L).swap).toEqual({ text: 'swap 18,5G', level: 'bad' })
    expect(machineChip(v({ pressure: 'alerta' }), L).swap).toEqual({ text: 'swap 2,0G', level: 'ok' })
  })
  it('leitura velha: apagado e tooltip avisa', () => {
    const c = machineChip(v({ stale: true }), L)
    expect(c.dim).toBe(true)
    expect(c.tooltip).toContain('leitura indisponível')
  })
  it('tooltip com os números', () => {
    expect(machineChip(v(), L).tooltip).toBe('CPU 34% (1 min 30%)\nRAM 19,4/24,0 GB\nswap 2,0 GB\npressão normal')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/machine-model.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implement**

Create `src/renderer/src/machine-model.ts`:
```ts
import type { MachineLevel, MachineView } from '../../shared/types'
import type { MachineLimits } from '../../shared/settings'
import { gb, pressureLabel } from '../../shared/machine-format'

export interface MachineBar {
  label: 'CPU' | 'RAM'
  percent: number
  filled: number
  level: MachineLevel
}

export interface MachineChipVm {
  bars: MachineBar[]
  swap: { text: string; level: MachineLevel } | null
  dim: boolean
  tooltip: string
}

export const segments = (percent: number): number => (percent <= 0 ? 0 : Math.min(5, Math.max(1, Math.round(percent / 20))))

const by = (v: number, warn: number, bad: number): MachineLevel => (v >= bad ? 'bad' : v >= warn ? 'warn' : 'ok')

export function machineChip(v: MachineView, lim: MachineLimits): MachineChipVm {
  const cpu = Math.round(v.cpu)
  const ram = v.ram.total > 0 ? Math.round((v.ram.used / v.ram.total) * 100) : 0
  // no Mac a RAM "usada" vive alta; quem diz se aperta é a pressão do sistema
  const ramLevel: MachineLevel = v.pressure === 'critica' ? 'bad' : v.pressure === 'alerta' ? 'warn' : v.pressure === null ? by(ram, 85, 95) : 'ok'
  const swapPct = v.ram.total > 0 ? (v.swap.used / v.ram.total) * 100 : 0
  const swapLevel = by(swapPct, lim.swapWarn, lim.swapBad)
  const showSwap = swapLevel !== 'ok' || v.pressure === 'alerta' || v.pressure === 'critica'
  const lines = [`CPU ${cpu}% (1 min ${Math.round(v.cpu1m)}%)`, `RAM ${gb(v.ram.used)}/${gb(v.ram.total)} GB`, `swap ${gb(v.swap.used)} GB`, pressureLabel(v.pressure)]
  if (v.stale) lines.push('leitura indisponível')
  return {
    bars: [
      { label: 'CPU', percent: cpu, filled: segments(cpu), level: by(cpu, lim.cpuWarn, lim.cpuBad) },
      { label: 'RAM', percent: ram, filled: segments(ram), level: ramLevel },
    ],
    swap: showSwap ? { text: `swap ${gb(v.swap.used)}G`, level: swapLevel } : null,
    dim: v.stale,
    tooltip: lines.join('\n'),
  }
}
```

`src/renderer/src/store.ts`:
- import `MachineDetail, MachineView` with the other types;
- add to `UiState`:
```ts
  /** leitura da máquina (mensagem 'machine' do daemon, fora do AppState) */
  machine: MachineView | null
  /** consumidores: só chega com o painel do chip aberto */
  machineDetail: MachineDetail | null
```
- add `machine: null, machineDetail: null` to the initial `state` literal.

`src/renderer/src/main.tsx`, in `bootWorkspace`'s `switch (e.t)` (after `case 'file.changed'`):
```ts
      case 'machine':
        setUi(e.detail ? { machine: e.machine, machineDetail: e.detail } : { machine: e.machine })
        break
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/renderer/machine-model.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" add src/renderer/src/machine-model.ts src/renderer/src/store.ts src/renderer/src/main.tsx tests/renderer/machine-model.test.ts
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" commit -m "feat(maquina): renderer recebe a leitura e monta o modelo do chip"
```

---

### Task 9: Chip na barra de status + painel de consumidores

**Files:**
- Create: `src/renderer/src/components/MachineChip.tsx`
- Modify: `src/renderer/src/components/StatusBar.tsx` (antes do `usageChips(...)`, depois do `<span className="st-spacer" />`)
- Modify: `src/renderer/src/styles.css` (após `.u-dim`)

**Interfaces:**
- Consumes: `useUi` (`machine`, `machineDetail`, `app.settings.machine`, `app.panes`), `machineChip` (Task 8), `revealPane` (`actions.ts`), `gb`, `formatEtime`, `pressureLabel`.
- Produces: `<MachineChip />` (sem props).

UI sem lógica nova testável além do modelo (Task 8); a verificação é visual no Step 3.

- [ ] **Step 1: Implement the component** `src/renderer/src/components/MachineChip.tsx`

```tsx
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { revealPane } from '../actions'
import { machineChip } from '../machine-model'
import { setUi, useUi } from '../store'
import { formatEtime, gb, pressureLabel } from '../../../shared/machine-format'
import type { MachineLevel } from '../../../shared/types'

const tone = (l: MachineLevel) => (l === 'bad' ? 'u-bad' : l === 'warn' ? 'u-warn' : undefined)

/** CPU/RAM na barra de status; clique abre os consumidores (o daemon só roda ps enquanto aberto) */
export function MachineChip() {
  const v = useUi((s) => s.machine)
  const lim = useUi((s) => s.app?.settings.machine)
  const [open, setOpen] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    window.gt.send({ t: 'machine.watch' })
    return () => {
      window.gt.send({ t: 'machine.unwatch' })
      setUi({ machineDetail: null })
    }
  }, [open])
  if (!v || !lim) return null
  const vm = machineChip(v, lim)
  return (
    <>
      <button ref={chipRef} className={`st-machine${vm.dim ? ' u-dim' : ''}`} title={vm.tooltip} onClick={() => setOpen((o) => !o)}>
        {vm.bars.map((b) => (
          <span key={b.label} className={tone(b.level)}>
            {b.label}
            <span className="m-bar" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className={`m-seg${i < b.filled ? ' on' : ''}`} />
              ))}
            </span>
            {b.percent}%
          </span>
        ))}
        {vm.swap && <span className={tone(vm.swap.level)}>{vm.swap.text} ⚠</span>}
      </button>
      {open && chipRef.current && createPortal(<MachinePanel anchor={chipRef.current} onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function MachinePanel({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const v = useUi((s) => s.machine)!
  const detail = useUi((s) => s.machineDetail)
  const panes = useUi((s) => s.app?.panes ?? [])
  const [showSessions, setShowSessions] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !anchor.contains(t)) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [anchor, onClose])
  const r = anchor.getBoundingClientRect()
  const style = { bottom: window.innerHeight - r.top + 6, right: Math.max(8, window.innerWidth - r.right) }
  const nameOf = (id: string) => {
    const p = panes.find((x) => x.id === id)
    return p?.name ?? (p ? `sessão ${p.seq}` : id.slice(0, 6))
  }
  return (
    <div ref={ref} className="machine-panel" style={style} role="dialog" aria-label="Uso da máquina">
      <div className="mp-title">Uso da máquina</div>
      <div>
        CPU {Math.round(v.cpu)}% · RAM {gb(v.ram.used)}/{gb(v.ram.total)} GB
      </div>
      <div className="mp-dim">
        swap {gb(v.swap.used)} GB · {pressureLabel(v.pressure)}
        {v.reasons.length > 0 && <span className={v.level === 'bad' ? 'u-bad' : 'u-warn'}> · {v.reasons.join(' · ')}</span>}
      </div>
      {!detail ? (
        <div className="mp-dim mp-sub">medindo processos…</div>
      ) : (
        <>
          <div className="mp-sub">Consumidores</div>
          {detail.groups.map((g) => (
            <div key={g.key}>
              <div className="mp-row">
                {g.key === 'sessoes' ? (
                  <button className="mp-link" onClick={() => setShowSessions((s) => !s)}>
                    {showSessions ? '▾' : '▸'} {g.label} ({g.count})
                  </button>
                ) : (
                  <span>{g.label}</span>
                )}
                {g.count === 0 ? (
                  <span className="mp-dim mp-span2">— desligado</span>
                ) : (
                  <>
                    <span>{gb(g.rss)} GB</span>
                    <span>{Math.round(g.cpu)}%</span>
                  </>
                )}
              </div>
              {g.key === 'sessoes' &&
                showSessions &&
                (g.paneIds ?? []).map((id) => (
                  <div key={id} className="mp-row mp-indent">
                    <button
                      className="mp-link"
                      onClick={() => {
                        revealPane(id)
                        onClose()
                      }}
                    >
                      {nameOf(id)}
                    </button>
                    <span>{gb(detail.perPane[id]?.rss ?? 0)} GB</span>
                    <span>{Math.round(detail.perPane[id]?.cpu ?? 0)}%</span>
                  </div>
                ))}
            </div>
          ))}
          <div className="mp-sub">Maiores processos</div>
          {detail.top.map((p) => (
            <div key={p.pid} className="mp-row mp-row4" title={`pid ${p.pid}`}>
              <span className="mp-name">{p.name}</span>
              <span>{Math.round(p.cpu)}%</span>
              <span>{gb(p.rss)} GB</span>
              <span className="mp-dim">{formatEtime(p.etime)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
```

In `StatusBar.tsx`: `import { MachineChip } from './MachineChip'` and insert `<MachineChip />` right after `<span className="st-spacer" />`.

In `styles.css`, after `.u-dim { opacity: 0.55; }`:
```css
.st-machine { display: flex; align-items: center; gap: 10px; background: none; color: inherit; padding: 0 2px; font-size: var(--text-sm); white-space: nowrap; }
.st-machine > span { display: inline-flex; align-items: center; }
.m-bar { display: inline-flex; gap: 1px; margin: 0 4px; }
.m-seg { width: 4px; height: 9px; border-radius: 1px; background: currentColor; opacity: 0.2; }
.m-seg.on { opacity: 0.9; }
.machine-panel { position: fixed; z-index: 1000; width: 320px; max-height: 70vh; overflow-y: auto; padding: 10px 12px; background: var(--bg-bar); border: 1px solid var(--border-strong); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); font-size: var(--text-sm); color: var(--fg); }
.mp-title { font-weight: 600; margin-bottom: 6px; }
.mp-sub { margin: 10px 0 4px; font-size: var(--text-xs); color: var(--fg-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.mp-dim { color: var(--fg-dim); }
.mp-row { display: grid; grid-template-columns: 1fr 64px 40px; gap: 8px; padding: 2px 0; align-items: center; }
.mp-row > span:not(:first-child) { text-align: right; }
.mp-row4 { grid-template-columns: 1fr 44px 56px 48px; }
.mp-span2 { grid-column: span 2; }
.mp-indent { padding-left: 14px; }
.mp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-link { background: none; color: inherit; padding: 0; text-align: left; font-size: inherit; }
.mp-link:hover { color: var(--link); }
```

- [ ] **Step 2: Typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Verify visually (sem trocar o app instalado)**

Run in background (isolated home, so it doesn't touch the installed app's daemon):
```bash
GT_HOME="$TMPDIR/gt-machine-test" npm run dev
```
Check: the chip shows `CPU ▮▮▯▯▯ n%  RAM ▮▮▮▮▯ n%` on the right of the status bar, with colors; with the current swap (≥ 6 GB) `swap …G ⚠` appears in yellow; clicking opens the panel above the chip with groups and top processes, refreshing every ~3 s; Esc and clicking outside close it; expanding "Sessões do app" and clicking one focuses its pane. Take a screenshot. Then stop the dev process and run `pkill -f node_modules/electron/dist` and confirm with `pgrep -fl node_modules/electron/dist` (no output).

- [ ] **Step 4: Commit**

```bash
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" add src/renderer/src/components/MachineChip.tsx src/renderer/src/components/StatusBar.tsx src/renderer/src/styles.css
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" commit -m "feat(maquina): indicador de CPU/RAM na barra de status com painel de consumidores"
```

---

### Task 10: Aba "Máquina" nas Preferências

**Files:**
- Create: `src/renderer/src/components/MachinePrefs.tsx`
- Modify: `src/renderer/src/components/Preferences.tsx:14,25-45`

**Interfaces:**
- Consumes: `MachineLimits`, `DEFAULT_SETTINGS`, `gb`, `useUi((s) => s.machine)`.
- Produces: `<MachinePrefs value={MachineLimits} onChange={(m: MachineLimits) => void} />`.

A normalização (Task 1) já garante `warn < bad`; aqui é só UI.

- [ ] **Step 1: Implement** `src/renderer/src/components/MachinePrefs.tsx`

```tsx
import { DEFAULT_SETTINGS, type MachineLimits } from '../../../shared/settings'
import { gb } from '../../../shared/machine-format'
import { useUi } from '../store'

export function MachinePrefs({ value, onChange }: { value: MachineLimits; onChange: (m: MachineLimits) => void }) {
  const ramTotal = useUi((s) => s.machine?.ram.total ?? 0)
  const set = (patch: Partial<MachineLimits>) => onChange({ ...value, ...patch })
  const ofRam = (pct: number) => (ramTotal > 0 ? ` (${gb((ramTotal * pct) / 100)} GB)` : '')
  return (
    <>
      <p className="field-hint">Amarelo avisa na barra de status. Bloqueio faz o contratar_dev recusar até você autorizar.</p>
      <div className="field">
        <div className="field-label">CPU (MÉDIA DE 1 MIN) · AMARELO A PARTIR DE {value.cpuWarn}%</div>
        <input type="range" min={10} max={100} value={value.cpuWarn} onChange={(e) => set({ cpuWarn: Number(e.target.value) })} />
      </div>
      <div className="field">
        <div className="field-label">CPU · BLOQUEIA CONTRATAR A PARTIR DE {value.cpuBad}%</div>
        <input type="range" min={10} max={100} value={value.cpuBad} onChange={(e) => set({ cpuBad: Number(e.target.value) })} />
      </div>
      <div className="field">
        <div className="field-label">SWAP · AMARELO A PARTIR DE {value.swapWarn}% DA RAM{ofRam(value.swapWarn)}</div>
        <input type="range" min={5} max={150} step={5} value={value.swapWarn} onChange={(e) => set({ swapWarn: Number(e.target.value) })} />
      </div>
      <div className="field">
        <div className="field-label">SWAP · BLOQUEIA CONTRATAR A PARTIR DE {value.swapBad}% DA RAM{ofRam(value.swapBad)}</div>
        <input type="range" min={5} max={150} step={5} value={value.swapBad} onChange={(e) => set({ swapBad: Number(e.target.value) })} />
      </div>
      <label className="field pref-check">
        <input type="checkbox" checked={value.pressureGate} onChange={(e) => set({ pressureGate: e.target.checked })} />
        Usar a pressão de memória do sistema (alerta = amarelo, crítica = bloqueia)
      </label>
      <button className="btn" onClick={() => onChange(DEFAULT_SETTINGS.machine)}>
        Restaurar padrões
      </button>
    </>
  )
}
```
Check the class names exist: `rg -n "field-hint|\.btn \{|\.btn\{" src/renderer/src/styles.css`. If `field-hint` doesn't exist, use a `<div className="field-label">` without uppercase text or the hint class used elsewhere in Preferences/AgentsPanel; if `.btn` doesn't exist, use the button class the other panels use (e.g. in `AppearancePanel.tsx`).

In `Preferences.tsx`:
- import `{ MachinePrefs } from './MachinePrefs'`;
- tab type: `useState<'appearance' | 'terminal' | 'agents' | 'shortcuts' | 'machine'>('appearance')`;
- new tab button after "Atalhos":
```tsx
        <button className={tab === 'machine' ? 'active' : ''} onClick={() => setTab('machine')}>
          Máquina
        </button>
```
- in the conditional, before `) : tab === 'shortcuts' ? (`:
```tsx
      ) : tab === 'machine' ? (
        <MachinePrefs value={draft.machine} onChange={(machine) => update({ machine })} />
```

- [ ] **Step 2: Typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 3: Verify visually**

Same isolated run as Task 9 Step 3 (`GT_HOME="$TMPDIR/gt-machine-test" npm run dev`): open Preferências → Máquina; drag "SWAP · AMARELO" above the current swap % and confirm the chip's swap warning disappears within ~3 s; "Restaurar padrões" brings it back. Close and `pkill -f node_modules/electron/dist`, confirm with `pgrep`.

- [ ] **Step 4: Commit**

```bash
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" add src/renderer/src/components/MachinePrefs.tsx src/renderer/src/components/Preferences.tsx
git -C "/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal" commit -m "feat(maquina): limites do monitor ajustáveis nas Preferências"
```

---

### Task 11: Verificação final

- [ ] **Step 1:** `npm run typecheck && npm test` — tudo verde; cole o resumo do vitest.
- [ ] **Step 2:** `npm run build` — sem erros.
- [ ] **Step 3:** Gate de ponta a ponta no app isolado (`GT_HOME`): marcar uma sessão como líder, baixar nas Preferências `CPU · BLOQUEIA` para 10% e pedir no terminal "contrata 1 dev"; esperado: o Claude recebe a recusa com motivo e pergunta antes de usar `forcar: true`. Restaurar padrões. Fechar e `pkill`/`pgrep` como antes.
- [ ] **Step 4:** Não instalar no `/Applications` nem lançar release: o usuário decide (ver CLAUDE.md, "Lançar uma atualização").
