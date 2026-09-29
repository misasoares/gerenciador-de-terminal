# Atalhos configuráveis e controle do terminal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atalhos padrão que não brigam com o shell no Linux, tela para configurá-los, foco no terminal novo, painel/aba que fecham sozinhos e cabeçalho de git mais limpo.

**Architecture:** Um registro único de ações (`src/shared/keybindings.ts`) define os padrões por plataforma e a lógica pura (parse, resolução, conflito, formatação). As preferências guardam só as alterações; o renderer resolve os atalhos, avisa o processo principal por IPC (que reconstrói o menu nativo) e decide no xterm quais teclas ficam com o app. O resto são correções pontuais no renderer com a lógica extraída para módulos puros testáveis.

**Tech Stack:** Electron + electron-vite, React, xterm.js, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-atalhos-e-controle-do-terminal-design.md`

## Global Constraints

- Padrões do Mac idênticos aos de hoje (⌘T, ⌘D, ⇧⌘D, ⌘W, ⌘J, ⌘K, ⌥⌘setas, ⇧⌘T, ⌘1…9, ⌘B, ⌘,).
- Padrões do Linux: Ctrl+Shift+T/D/E/W/J/K/N/B, Ctrl+, , Alt+setas, Alt+1…9; copiar/colar/selecionar tudo em Ctrl+Shift+C/V/A.
- Accelerators salvos sempre por extenso e canônicos (`Cmd`, `Super`, `Ctrl`, `Alt`, `Shift`, nessa ordem, e a tecla), nunca `CmdOrCtrl`.
- `settings.keybindings` guarda só as alterações; `null` = ação sem atalho.
- O ⌘W / Ctrl+Shift+W continua **escondendo** (sessão viva); não encerra.
- Textos da UI em português, no tom das telas existentes.
- Testes só de módulos puros (o padrão do repo): nada de React/DOM/Electron nos testes.
- Comandos: `npm test`, `npm run typecheck`. Linux: `sh scripts/linux-container.sh`.

## Review Focus

1. Tecla com layout de teclado não-americano (ABNT2: `ç`, `´`) na gravação → `accelFromEvent` usa `e.code`, então Ctrl+Shift+D é gravado como `Ctrl+Shift+D` e não como o caractere; `ç` (code `Semicolon`) vira `;`. Teste na Task 1.
2. Arquivo de preferências editado à mão com lixo (`keybindings: "x"`, `{ "split-right": 42 }`, dois ids com o mesmo accel, `CmdOrCtrl+D`) → normaliza sem quebrar e sem atalho duplicado no menu. Teste na Task 2.
3. Esconder o último painel da **única** aba → a aba continua (estado vazio), nada de layout sem abas. Teste na Task 7.
4. Esconder um painel de uma aba **em segundo plano** que fica vazia → a aba some, mas a aba ativa e o foco não mudam. Teste na Task 7.
5. Shell que termina com código ≠ 0, ou sessão retomável → o painel **não** fecha sozinho. Teste na Task 7.

---

### Task 1: Registro de ações e lógica de atalhos

**Files:**
- Create: `src/shared/keybindings.ts`
- Test: `tests/shared/keybindings.test.ts`

**Interfaces:**
- Produces:
  - `type Platform = 'mac' | 'linux'`
  - `type KeyOverrides = Record<string, string | null>`, `type Bindings = Record<string, string | null>`
  - `type ActionGroup = 'app' | 'sessao' | 'abas' | 'exibir'`, `GROUP_LABELS: Record<ActionGroup, string>`
  - `interface ActionDef { id; label; group; mac: string | null; linux: string | null }`, `ACTIONS: readonly ActionDef[]`
  - `LINUX_EDIT = { copy: 'Ctrl+Shift+C', paste: 'Ctrl+Shift+V', selectAll: 'Ctrl+Shift+A' }`
  - `platformOf(p: string): Platform`
  - `parseAccel(s: string): string | null`
  - `accelFromEvent(e: KeyLike, platform: Platform): string | null`, com `interface KeyLike { code?: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }`
  - `resolveBindings(platform, overrides): Bindings`
  - `findConflict(bindings, actionId, accel): string | null`
  - `isShellKey(platform, accel): boolean`, `isReserved(platform, accel): boolean`
  - `formatAccel(platform, accel): string`
  - `setBinding(platform, overrides, actionId, accel: string | null, steal: boolean): KeyOverrides`

- [ ] **Step 1: Write the failing test**

```ts
// tests/shared/keybindings.test.ts
import { describe, expect, it } from 'vitest'
import {
  accelFromEvent, ACTIONS, findConflict, formatAccel, isReserved, isShellKey, parseAccel, platformOf, resolveBindings, setBinding,
} from '../../src/shared/keybindings'

const ev = (code: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) => ({
  code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods,
})

describe('keybindings', () => {
  it('padrões sem duplicados e sem Ctrl puro no Linux', () => {
    for (const p of ['mac', 'linux'] as const) {
      const vals = ACTIONS.map((a) => a[p]).filter((v): v is string => !!v)
      expect(new Set(vals).size).toBe(vals.length)
      for (const v of vals) expect(parseAccel(v)).toBe(v) // já canônicos
    }
    for (const a of ACTIONS) if (a.linux) expect(isShellKey('linux', a.linux)).toBe(false)
  })

  it('mac igual ao de hoje', () => {
    const mac = resolveBindings('mac', {})
    expect(mac['new-session']).toBe('Cmd+T')
    expect(mac['split-down']).toBe('Cmd+Shift+D')
    expect(mac['focus-left']).toBe('Cmd+Alt+Left')
    expect(mac['tab-9']).toBe('Cmd+9')
    expect(resolveBindings('linux', {})['split-down']).toBe('Ctrl+Shift+E')
  })

  it('platformOf', () => {
    expect(platformOf('darwin')).toBe('mac')
    expect(platformOf('linux')).toBe('linux')
  })

  it('parseAccel canoniza e rejeita', () => {
    expect(parseAccel('shift+ctrl+d')).toBe('Ctrl+Shift+D')
    expect(parseAccel('Alt+Cmd+left')).toBe('Cmd+Alt+Left')
    expect(parseAccel('F5')).toBe('F5')
    expect(parseAccel('D')).toBeNull() // sem modificador
    expect(parseAccel('Shift+D')).toBeNull() // só maiúscula
    expect(parseAccel('CmdOrCtrl+D')).toBeNull()
    expect(parseAccel('Ctrl+Ctrl+D')).toBeNull()
    expect(parseAccel('Ctrl+')).toBeNull()
    expect(parseAccel('Ctrl+ç')).toBeNull()
  })

  it('accelFromEvent usa o code (independe do layout)', () => {
    expect(accelFromEvent(ev('KeyD', { ctrlKey: true, shiftKey: true }), 'linux')).toBe('Ctrl+Shift+D')
    expect(accelFromEvent(ev('Digit3', { altKey: true }), 'linux')).toBe('Alt+3')
    expect(accelFromEvent(ev('KeyT', { metaKey: true }), 'mac')).toBe('Cmd+T')
    expect(accelFromEvent(ev('KeyT', { metaKey: true }), 'linux')).toBe('Super+T')
    expect(accelFromEvent(ev('ArrowLeft', { metaKey: true, altKey: true }), 'mac')).toBe('Cmd+Alt+Left')
    expect(accelFromEvent(ev('Semicolon', { ctrlKey: true }), 'linux')).toBe('Ctrl+;') // ç no ABNT2
    expect(accelFromEvent(ev('ControlLeft', { ctrlKey: true }), 'linux')).toBeNull()
    expect(accelFromEvent(ev('KeyA'), 'linux')).toBeNull()
  })

  it('resolveBindings: alteração, null, id desconhecido, inválido e disputa com padrão', () => {
    const r = resolveBindings('linux', { 'split-right': 'Ctrl+Shift+R', palette: null, nada: 'Ctrl+Shift+Q', 'new-tab': 'lixo' })
    expect(r['split-right']).toBe('Ctrl+Shift+R')
    expect(r.palette).toBeNull()
    expect(r).not.toHaveProperty('nada')
    expect(r['new-tab']).toBe('Ctrl+Shift+N') // inválido volta ao padrão
    // alteração vence o padrão de outra ação, que fica sem atalho
    const s = resolveBindings('linux', { 'split-right': 'Ctrl+Shift+K' })
    expect(s['split-right']).toBe('Ctrl+Shift+K')
    expect(s.palette).toBeNull()
  })

  it('findConflict', () => {
    const b = resolveBindings('linux', {})
    expect(findConflict(b, 'split-right', 'Ctrl+Shift+K')).toBe('palette')
    expect(findConflict(b, 'palette', 'Ctrl+Shift+K')).toBeNull()
    expect(findConflict(b, 'palette', 'Ctrl+Shift+Z')).toBeNull()
  })

  it('isShellKey e isReserved', () => {
    expect(isShellKey('linux', 'Ctrl+W')).toBe(true)
    expect(isShellKey('linux', 'Ctrl+[')).toBe(true)
    expect(isShellKey('linux', 'Ctrl+Shift+W')).toBe(false)
    expect(isShellKey('linux', 'Alt+W')).toBe(false)
    expect(isShellKey('mac', 'Ctrl+W')).toBe(false)
    expect(isReserved('linux', 'Ctrl+Shift+C')).toBe(true)
    expect(isReserved('mac', 'Cmd+C')).toBe(true)
    expect(isReserved('linux', 'Ctrl+Shift+D')).toBe(false)
  })

  it('formatAccel', () => {
    expect(formatAccel('mac', 'Cmd+Shift+D')).toBe('⇧⌘D')
    expect(formatAccel('mac', 'Cmd+Alt+Left')).toBe('⌥⌘←')
    expect(formatAccel('linux', 'Ctrl+Shift+D')).toBe('Ctrl+Shift+D')
    expect(formatAccel('linux', 'Alt+Up')).toBe('Alt+↑')
  })

  it('setBinding: padrão apaga a alteração; steal tira da outra ação', () => {
    expect(setBinding('linux', { 'split-right': 'Ctrl+Shift+R' }, 'split-right', 'Ctrl+Shift+D', false)).toEqual({})
    expect(setBinding('linux', {}, 'palette', null, false)).toEqual({ palette: null })
    expect(setBinding('linux', {}, 'split-right', 'Ctrl+Shift+K', true)).toEqual({ 'split-right': 'Ctrl+Shift+K', palette: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/keybindings.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/shared/keybindings"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/shared/keybindings.ts
/** Atalhos do app: lista única de ações (menu + Preferências), padrões por plataforma e lógica pura. */

export type Platform = 'mac' | 'linux'
/** só as alterações do usuário; null = ação sem atalho */
export type KeyOverrides = Record<string, string | null>
export type Bindings = Record<string, string | null>
export type ActionGroup = 'app' | 'sessao' | 'abas' | 'exibir'

export interface ActionDef {
  /** igual à string de ação que o menu envia ao renderer */
  id: string
  label: string
  group: ActionGroup
  mac: string | null
  linux: string | null
}

export const GROUP_LABELS: Record<ActionGroup, string> = { app: 'App', sessao: 'Sessão', abas: 'Abas', exibir: 'Exibir' }

const focus = (dir: string, label: string, key: string): ActionDef => ({ id: `focus-${dir}`, label, group: 'sessao', mac: `Cmd+Alt+${key}`, linux: `Alt+${key}` })

export const ACTIONS: readonly ActionDef[] = [
  { id: 'preferences', label: 'Preferências…', group: 'app', mac: 'Cmd+,', linux: 'Ctrl+,' },
  { id: 'new-session', label: 'Nova sessão…', group: 'sessao', mac: 'Cmd+T', linux: 'Ctrl+Shift+T' },
  { id: 'split-right', label: 'Dividir à direita', group: 'sessao', mac: 'Cmd+D', linux: 'Ctrl+Shift+D' },
  { id: 'split-down', label: 'Dividir abaixo', group: 'sessao', mac: 'Cmd+Shift+D', linux: 'Ctrl+Shift+E' },
  { id: 'hide-pane', label: 'Esconder painel', group: 'sessao', mac: 'Cmd+W', linux: 'Ctrl+Shift+W' },
  { id: 'next-attention', label: 'Próxima que precisa de mim', group: 'sessao', mac: 'Cmd+J', linux: 'Ctrl+Shift+J' },
  { id: 'palette', label: 'Buscar…', group: 'sessao', mac: 'Cmd+K', linux: 'Ctrl+Shift+K' },
  focus('left', 'Foco à esquerda', 'Left'),
  focus('right', 'Foco à direita', 'Right'),
  focus('up', 'Foco acima', 'Up'),
  focus('down', 'Foco abaixo', 'Down'),
  { id: 'new-tab', label: 'Nova aba', group: 'abas', mac: 'Cmd+Shift+T', linux: 'Ctrl+Shift+N' },
  ...Array.from({ length: 9 }, (_, i): ActionDef => ({ id: `tab-${i + 1}`, label: `Aba ${i + 1}`, group: 'abas', mac: `Cmd+${i + 1}`, linux: `Alt+${i + 1}` })),
  { id: 'toggle-sidebar', label: 'Mostrar/recolher sidebar', group: 'exibir', mac: 'Cmd+B', linux: 'Ctrl+Shift+B' },
]

/** copiar/colar/selecionar tudo no Linux (o Ctrl puro fica com o shell) */
export const LINUX_EDIT = { copy: 'Ctrl+Shift+C', paste: 'Ctrl+Shift+V', selectAll: 'Ctrl+Shift+A' } as const

const RESERVED: Record<Platform, readonly string[]> = {
  mac: ['Cmd+C', 'Cmd+V', 'Cmd+X', 'Cmd+A', 'Cmd+Z', 'Cmd+Shift+Z', 'Cmd+Q', 'Cmd+H'],
  linux: Object.values(LINUX_EDIT),
}

export function platformOf(p: string): Platform {
  return p === 'darwin' ? 'mac' : 'linux'
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

const MOD_ORDER = ['Cmd', 'Super', 'Ctrl', 'Alt', 'Shift'] as const
const MOD_ALIASES: Record<string, string> = { cmd: 'Cmd', command: 'Cmd', super: 'Super', meta: 'Super', ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', option: 'Alt', shift: 'Shift' }
const NAMED_KEYS = ['Left', 'Right', 'Up', 'Down', 'Space', 'Tab', 'Enter', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete']
const PUNCT = [',', '.', '/', ';', "'", '[', ']', '-', '=', '`', '\\']
const isFn = (k: string) => /^F([1-9]|1\d|2[0-4])$/.test(k)

function normKey(k: string): string | null {
  if (/^[a-z0-9]$/i.test(k)) return k.toUpperCase()
  if (isFn(k.toUpperCase())) return k.toUpperCase()
  const named = NAMED_KEYS.find((n) => n.toLowerCase() === k.toLowerCase())
  if (named) return named
  return PUNCT.includes(k) ? k : null
}

/** valida e canoniza ("shift+ctrl+d" → "Ctrl+Shift+D"); null se não for um atalho aceito */
export function parseAccel(s: string): string | null {
  const parts = s.split('+')
  const key = normKey((parts.pop() ?? '').trim())
  if (!key) return null
  const mods = new Set<string>()
  for (const p of parts) {
    const m = MOD_ALIASES[p.trim().toLowerCase()]
    if (!m || mods.has(m)) return null
    mods.add(m)
  }
  // sem modificador (ou só Shift) é digitação, exceto F1…F24
  if (!isFn(key) && (mods.size === 0 || (mods.size === 1 && mods.has('Shift')))) return null
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+')
}

const CODE_KEYS: Record<string, string> = {
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete',
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', Backslash: '\\',
}

export interface KeyLike {
  code?: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/** atalho de um evento de teclado, pela posição física (e.code): não depende do layout (ABNT2, acentos) */
export function accelFromEvent(e: KeyLike, platform: Platform): string | null {
  const c = e.code ?? ''
  const key = /^Key[A-Z]$/.test(c) ? c.slice(3) : /^Digit\d$/.test(c) ? c.slice(5) : isFn(c) ? c : CODE_KEYS[c]
  if (!key) return null
  const mods = [e.metaKey && (platform === 'mac' ? 'Cmd' : 'Super'), e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean)
  return parseAccel([...mods, key].join('+'))
}

/** atalho efetivo de cada ação: alterações válidas primeiro; um padrão já tomado por uma alteração fica sem atalho */
export function resolveBindings(platform: Platform, overrides: KeyOverrides): Bindings {
  const out: Bindings = {}
  const used = new Set<string>()
  for (const a of ACTIONS) {
    if (!hasOwn(overrides, a.id)) continue
    const v = overrides[a.id]
    if (v === null) out[a.id] = null
    else {
      const p = typeof v === 'string' ? parseAccel(v) : null
      if (p && !used.has(p)) {
        out[a.id] = p
        used.add(p)
      }
    }
  }
  for (const a of ACTIONS) {
    if (hasOwn(out, a.id)) continue
    const d = a[platform]
    out[a.id] = d && !used.has(d) ? d : null
    if (d) used.add(d)
  }
  return out
}

/** outra ação que já usa este atalho */
export function findConflict(bindings: Bindings, actionId: string, accel: string): string | null {
  return Object.entries(bindings).find(([id, v]) => id !== actionId && v === accel)?.[0] ?? null
}

/** combinação que o shell/programas do terminal usam (Ctrl+letra sem Shift no Linux); no Mac o ⌘ não chega ao terminal */
export function isShellKey(platform: Platform, accel: string): boolean {
  if (platform !== 'linux') return false
  const [mod, key, ...rest] = accel.split('+')
  if (mod !== 'Ctrl' || key === undefined || rest.length > 0) return false
  return /^[A-Z]$/.test(key) || key === '[' || key === '\\' || key === 'Space'
}

/** copiar/colar e afins: não podem virar atalho de ação */
export function isReserved(platform: Platform, accel: string): boolean {
  return RESERVED[platform].includes(accel)
}

const MAC_SYMBOLS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Cmd: '⌘', Super: '◆' }
const ARROWS: Record<string, string> = { Left: '←', Right: '→', Up: '↑', Down: '↓' }

export function formatAccel(platform: Platform, accel: string): string {
  const parts = accel.split('+')
  const raw = parts.pop() ?? ''
  const key = ARROWS[raw] ?? raw
  if (platform === 'mac') return ['Ctrl', 'Alt', 'Shift', 'Cmd', 'Super'].filter((m) => parts.includes(m)).map((m) => MAC_SYMBOLS[m]).join('') + key
  return [...parts, key].join('+')
}

/** grava um atalho; igual ao padrão apaga a alteração. steal: a ação que usava o atalho fica sem nenhum */
export function setBinding(platform: Platform, overrides: KeyOverrides, actionId: string, accel: string | null, steal: boolean): KeyOverrides {
  const next: KeyOverrides = { ...overrides }
  const def = ACTIONS.find((a) => a.id === actionId)?.[platform] ?? null
  if (accel === def) delete next[actionId]
  else next[actionId] = accel
  if (accel && steal) {
    const other = findConflict(resolveBindings(platform, overrides), actionId, accel)
    if (other) next[other] = null
  }
  return next
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/shared/keybindings.test.ts`
Expected: PASS (10 testes).

- [ ] **Step 5: Commit**

```bash
git add src/shared/keybindings.ts tests/shared/keybindings.test.ts
git commit -m "feat: registro de ações e lógica de atalhos por plataforma"
```

---

### Task 2: Preferências — `keybindings` e `showGitStatus`

**Files:**
- Modify: `src/shared/settings.ts`
- Test: `tests/shared/settings.test.ts`

**Interfaces:**
- Consumes: `ACTIONS`, `parseAccel`, `KeyOverrides` (Task 1)
- Produces: `TerminalSettings.keybindings: KeyOverrides`, `TerminalSettings.showGitStatus: boolean`, `normalizeKeybindings(v: unknown): KeyOverrides`

- [ ] **Step 1: Write the failing test** — acrescentar em `tests/shared/settings.test.ts`, dentro do `describe('preferências')`, e importar `normalizeKeybindings`:

```ts
  it('atalhos: só ids conhecidos, canônicos, sem duplicados', () => {
    expect(DEFAULT_SETTINGS.keybindings).toEqual({})
    expect(DEFAULT_SETTINGS.showGitStatus).toBe(true)
    expect(normalizeKeybindings('x')).toEqual({})
    expect(normalizeKeybindings(['a'])).toEqual({})
    expect(normalizeKeybindings({ 'split-right': 42, nada: 'Ctrl+Shift+Q', palette: 'CmdOrCtrl+K' })).toEqual({})
    expect(normalizeKeybindings({ 'split-right': 'shift+ctrl+r', palette: null })).toEqual({ 'split-right': 'Ctrl+Shift+R', palette: null })
    // dois com o mesmo atalho: o segundo (na ordem de ACTIONS) fica sem
    expect(normalizeKeybindings({ 'split-right': 'Ctrl+Shift+R', 'split-down': 'Ctrl+Shift+R' })).toEqual({ 'split-right': 'Ctrl+Shift+R', 'split-down': null })
  })
  it('showGitStatus', () => {
    expect(normalizeSettings({ showGitStatus: false }).showGitStatus).toBe(false)
    expect(normalizeSettings({ showGitStatus: 'não' as never }).showGitStatus).toBe(true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/shared/settings.test.ts`
Expected: FAIL — `normalizeKeybindings is not a function` / `keybindings` undefined.

- [ ] **Step 3: Implement** — em `src/shared/settings.ts`:

```ts
import { ACTIONS, parseAccel, type KeyOverrides } from './keybindings'
```

Em `TerminalSettings` acrescentar:

```ts
  /** mostrar ● alterados e ↑↓ no cabeçalho do painel */
  showGitStatus: boolean
  /** só as alterações de atalho; null = sem atalho */
  keybindings: KeyOverrides
```

Em `DEFAULT_SETTINGS` acrescentar `showGitStatus: true, keybindings: {},`.

Nova função (antes de `normalizeSettings`):

```ts
export function normalizeKeybindings(v: unknown): KeyOverrides {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const src = v as Record<string, unknown>
  const out: KeyOverrides = {}
  const used = new Set<string>()
  for (const a of ACTIONS) {
    if (!Object.prototype.hasOwnProperty.call(src, a.id)) continue
    const raw = src[a.id]
    if (raw === null) {
      out[a.id] = null
      continue
    }
    const p = typeof raw === 'string' ? parseAccel(raw) : null
    if (!p) continue
    out[a.id] = used.has(p) ? null : p
    used.add(p)
  }
  return out
}
```

No objeto devolvido por `normalizeSettings` acrescentar:

```ts
    showGitStatus: typeof v.showGitStatus === 'boolean' ? v.showGitStatus : DEFAULT_SETTINGS.showGitStatus,
    keybindings: normalizeKeybindings(v.keybindings),
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/shared && npm run typecheck`
Expected: PASS; typecheck sem erros (se algum teste/fixture montar `TerminalSettings` à mão e quebrar, use `DEFAULT_SETTINGS` com spread nele).

- [ ] **Step 5: Commit**

```bash
git add src/shared/settings.ts tests/shared/settings.test.ts
git commit -m "feat: preferências de atalhos e de status do git"
```

---

### Task 3: Menu a partir dos atalhos resolvidos (processo principal)

**Files:**
- Create: `src/main/menu-template.ts`
- Modify: `src/main/menu.ts` (arquivo inteiro), `src/main/index.ts`, `src/preload/index.ts`, `src/shared/bridge.ts`
- Test: `tests/main/menu-template.test.ts`

**Interfaces:**
- Consumes: `ACTIONS`, `LINUX_EDIT`, `Bindings`, `Platform`, `platformOf`, `resolveBindings` (Task 1)
- Produces:
  - `menuTemplate(o: MenuOptions): MenuItemConstructorOptions[]`, `interface MenuOptions { send(action: string): void; quitAll(): void; platform: Platform; bindings: Bindings }`
  - `GtApi.platform: string`, `GtApi.setKeybindings(b: Record<string, string | null>): void` (IPC `gt:keybindings`)

- [ ] **Step 1: Write the failing test**

```ts
// tests/main/menu-template.test.ts
import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'
import { menuTemplate } from '../../src/main/menu-template'
import { resolveBindings } from '../../src/shared/keybindings'

function flat(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])])
}
const build = (platform: 'mac' | 'linux', overrides = {}) =>
  flat(menuTemplate({ send: () => {}, quitAll: () => {}, platform, bindings: resolveBindings(platform, overrides) }))
const accelOf = (items: MenuItemConstructorOptions[], label: string) => items.find((i) => i.label === label)?.accelerator

describe('menuTemplate', () => {
  it('Mac: atalhos de hoje e editMenu padrão', () => {
    const m = build('mac')
    expect(accelOf(m, 'Dividir à direita')).toBe('Cmd+D')
    expect(accelOf(m, 'Aba 3')).toBe('Cmd+3')
    expect(m.some((i) => i.role === 'editMenu')).toBe(true)
  })
  it('Linux: nenhum Ctrl puro, editar em Ctrl+Shift', () => {
    const m = build('linux')
    const accels = m.map((i) => i.accelerator).filter(Boolean)
    for (const bad of ['Ctrl+C', 'Ctrl+V', 'Ctrl+D', 'Ctrl+W', 'Ctrl+T', 'Ctrl+K', 'Ctrl+B', 'Ctrl+J']) expect(accels).not.toContain(bad)
    expect(m.some((i) => i.role === 'editMenu')).toBe(false)
    expect(m.find((i) => i.role === 'copy')?.accelerator).toBe('Ctrl+Shift+C')
    expect(m.find((i) => i.role === 'paste')?.accelerator).toBe('Ctrl+Shift+V')
  })
  it('usa as alterações e deixa sem atalho quando null', () => {
    const m = build('linux', { 'split-right': 'Ctrl+Shift+R', palette: null })
    expect(accelOf(m, 'Dividir à direita')).toBe('Ctrl+Shift+R')
    expect(accelOf(m, 'Buscar…')).toBeUndefined()
  })
  it('clique manda o id da ação', () => {
    const sent: string[] = []
    const m = flat(menuTemplate({ send: (a) => sent.push(a), quitAll: () => {}, platform: 'linux', bindings: resolveBindings('linux', {}) }))
    ;(m.find((i) => i.label === 'Nova aba')?.click as () => void)()
    expect(sent).toEqual(['new-tab'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/main/menu-template.test.ts`
Expected: FAIL — import não resolve.

- [ ] **Step 3: Implement**

```ts
// src/main/menu-template.ts
import type { MenuItemConstructorOptions } from 'electron'
import { ACTIONS, LINUX_EDIT, type Bindings, type Platform } from '../shared/keybindings'

export interface MenuOptions {
  send(action: string): void
  quitAll(): void
  platform: Platform
  bindings: Bindings
}

/** template do menu (sem Electron em tempo de execução: testável) */
export function menuTemplate(o: MenuOptions): MenuItemConstructorOptions[] {
  const item = (action: string): MenuItemConstructorOptions => ({
    label: ACTIONS.find((a) => a.id === action)?.label ?? action,
    accelerator: o.bindings[action] ?? undefined,
    click: () => o.send(action),
  })
  // no Linux o Ctrl puro é do shell: copiar/colar vão para Ctrl+Shift, como nos terminais de lá
  const edit: MenuItemConstructorOptions =
    o.platform === 'mac'
      ? { role: 'editMenu' }
      : {
          label: 'Editar',
          submenu: [
            { role: 'copy', label: 'Copiar', accelerator: LINUX_EDIT.copy },
            { role: 'paste', label: 'Colar', accelerator: LINUX_EDIT.paste },
            { role: 'selectAll', label: 'Selecionar tudo', accelerator: LINUX_EDIT.selectAll },
          ],
        }
  return [
    {
      label: 'Gerenciador de Terminal',
      submenu: [
        { role: 'about', label: 'Sobre' },
        { type: 'separator' },
        item('preferences'),
        { label: 'Configurar agentes…', click: () => o.send('setup') },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar' },
        { role: 'hideOthers', label: 'Ocultar outros' },
        { type: 'separator' },
        { label: 'Encerrar tudo (inclusive as sessões)…', click: () => o.quitAll() },
        { role: 'quit', label: 'Sair (as sessões continuam rodando)' },
      ],
    },
    edit,
    {
      label: 'Sessão',
      submenu: [
        item('new-session'),
        item('split-right'),
        item('split-down'),
        item('hide-pane'),
        item('next-attention'),
        item('palette'),
        { type: 'separator' },
        item('focus-left'),
        item('focus-right'),
        item('focus-up'),
        item('focus-down'),
      ],
    },
    {
      label: 'Abas',
      submenu: [item('new-tab'), { type: 'separator' }, ...Array.from({ length: 9 }, (_, i) => item(`tab-${i + 1}`))],
    },
    {
      label: 'Exibir',
      submenu: [
        item('toggle-sidebar'),
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Janela',
      submenu: [{ role: 'minimize', label: 'Minimizar' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
  ]
}
```

Substituir `src/main/menu.ts` inteiro por:

```ts
import { Menu } from 'electron'
import { menuTemplate, type MenuOptions } from './menu-template'

export function buildMenu(o: MenuOptions): Menu {
  return Menu.buildFromTemplate(menuTemplate(o))
}
```

Em `src/main/index.ts`:
- imports: `import { platformOf, resolveBindings, type Bindings } from '../shared/keybindings'`
- depois de `const notifications = …`:

```ts
const platform = platformOf(process.platform)
/** atalhos em vigor; o renderer manda os resolvidos pelas preferências (gt:keybindings) */
let bindings: Bindings = resolveBindings(platform, {})

function applyMenu(): void {
  Menu.setApplicationMenu(buildMenu({ send: (a) => win?.webContents.send('gt:menu', a), quitAll: () => void quitAll(), platform, bindings }))
}
```

- junto dos outros `ipcMain.on`:

```ts
ipcMain.on('gt:keybindings', (_e, b: Bindings) => {
  bindings = b
  applyMenu()
})
```

- no `app.whenReady`, trocar a linha `Menu.setApplicationMenu(buildMenu({ … }))` por `applyMenu()`.

Em `src/shared/bridge.ts`, no `GtApi`:

```ts
  /** process.platform do Electron ('darwin', 'linux'…) */
  platform: string
  /** atalhos resolvidos: o processo principal reconstrói o menu */
  setKeybindings(b: Record<string, string | null>): void
```

Em `src/preload/index.ts`, no objeto `api`:

```ts
  platform: process.platform,
  setKeybindings: (b) => ipcRenderer.send('gt:keybindings', b),
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/main && npm run typecheck`
Expected: PASS; typecheck sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/main src/preload/index.ts src/shared/bridge.ts tests/main/menu-template.test.ts
git commit -m "feat: menu montado pelos atalhos resolvidos; editar em Ctrl+Shift no Linux"
```

---

### Task 4: Teclado no terminal e sincronização dos atalhos (renderer)

**Files:**
- Modify: `src/renderer/src/keys.ts`, `src/renderer/src/main.tsx`
- Create: `src/renderer/src/shortcuts.ts`
- Test: `tests/renderer/keys.test.ts`

**Interfaces:**
- Consumes: `accelFromEvent`, `isReserved`, `resolveBindings`, `platformOf`, `Platform`, `Bindings`, `KeyOverrides` (Task 1); `window.gt.platform`, `window.gt.setKeybindings` (Task 3)
- Produces:
  - `keys.ts`: `interface KeyContext { platform: Platform; bound: ReadonlySet<string> }`, `setKeyContext(c: KeyContext): void`, `decideKey(e, c?: KeyContext)` (o evento ganha `code?: string`)
  - `shortcuts.ts`: `platform: Platform`, `syncKeybindings(overrides: KeyOverrides): void`, `suspendShortcuts(on: boolean): void`

- [ ] **Step 1: Write the failing test** — acrescentar em `tests/renderer/keys.test.ts`:

```ts
const linux = (bound: string[] = []) => ({ platform: 'linux' as const, bound: new Set(bound) })
const kl = (over: Partial<Parameters<typeof decideKey>[0]>, bound: string[] = []) =>
  decideKey({ type: 'keydown', key: 'a', code: 'KeyA', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, ...over }, linux(bound))

describe('decideKey no Linux', () => {
  it('Ctrl puro vai para o shell', () => {
    expect(kl({ key: 'd', code: 'KeyD', ctrlKey: true }, ['Ctrl+Shift+D'])).toBe('xterm')
    expect(kl({ key: 'c', code: 'KeyC', ctrlKey: true })).toBe('xterm')
  })
  it('copiar/colar e atalhos do app ficam com o menu', () => {
    expect(kl({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true })).toBe('swallow')
    expect(kl({ key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true })).toBe('swallow')
    expect(kl({ key: 'D', code: 'KeyD', ctrlKey: true, shiftKey: true }, ['Ctrl+Shift+D'])).toBe('swallow')
    expect(kl({ key: '1', code: 'Digit1', altKey: true }, ['Alt+1'])).toBe('swallow')
  })
  it('atalho personalizado com Ctrl puro vence o shell', () => {
    expect(kl({ key: 'w', code: 'KeyW', ctrlKey: true }, ['Ctrl+W'])).toBe('swallow')
  })
  it('Super sem atalho segue para o xterm; Shift+Enter igual ao Mac', () => {
    expect(kl({ key: 't', code: 'KeyT', metaKey: true })).toBe('xterm')
    expect(kl({ key: 'Enter', code: 'Enter', shiftKey: true })).toBe('send-shift-enter')
  })
})

describe('decideKey no Mac com atalho sem ⌘', () => {
  it('atalho personalizado sem ⌘ fica com o menu', () => {
    const mac = { platform: 'mac' as const, bound: new Set(['Ctrl+Alt+X']) }
    expect(decideKey({ type: 'keydown', key: 'x', code: 'KeyX', shiftKey: false, metaKey: false, ctrlKey: true, altKey: true }, mac)).toBe('swallow')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/keys.test.ts`
Expected: FAIL — os casos de Linux devolvem `'xterm'`/tipo errado.

- [ ] **Step 3: Implement** — `src/renderer/src/keys.ts` inteiro:

```ts
import { accelFromEvent, isReserved, type Platform } from '../../shared/keybindings'

/** ESC + CR: o Claude Code interpreta como quebra de linha (igual ao Option+Enter) */
export const SHIFT_ENTER_SEQUENCE = '\x1b\r'

export type KeyDecision = 'send-shift-enter' | 'swallow' | 'xterm'

export interface KeyContext {
  platform: Platform
  /** atalhos do app em vigor (resolvidos) */
  bound: ReadonlySet<string>
}

let context: KeyContext = { platform: 'mac', bound: new Set() }

export function setKeyContext(c: KeyContext): void {
  context = c
}

export function decideKey(
  e: { type: string; key: string; code?: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  c: KeyContext = context,
): KeyDecision {
  if (e.key === 'Enter' && e.shiftKey && !e.metaKey && !e.ctrlKey) return e.type === 'keydown' ? 'send-shift-enter' : 'swallow'
  // Mac: ⌘ fica com o menu do app (⌘T, ⌘D, ⌘W, ⌘C, ⌘V…); o paste continua pelo evento nativo
  if (c.platform === 'mac' && e.metaKey) return 'swallow'
  // atalho do app, ou copiar/colar do Linux (Ctrl+Shift+C/V): o menu trata e o xterm não manda a tecla ao shell
  const accel = accelFromEvent(e, c.platform)
  if (accel && (c.bound.has(accel) || isReserved(c.platform, accel))) return 'swallow'
  return 'xterm'
}
```

(No Mac, `isReserved` só lista combinações com ⌘, que já caíram no `if` acima; o comportamento de hoje não muda.)

```ts
// src/renderer/src/shortcuts.ts
import { platformOf, resolveBindings, type Bindings, type KeyOverrides } from '../../shared/keybindings'
import { setKeyContext } from './keys'

export const platform = platformOf(window.gt.platform)

let active: Bindings = resolveBindings(platform, {})
let suspended = false

function push(): void {
  const b: Bindings = suspended ? Object.fromEntries(Object.keys(active).map((k) => [k, null])) : active
  window.gt.setKeybindings(b)
  setKeyContext({ platform, bound: new Set(Object.values(b).filter((v): v is string => !!v)) })
}

/** preferências mudaram: resolve, reconstrói o menu e atualiza o que o xterm deixa passar */
export function syncKeybindings(overrides: KeyOverrides): void {
  active = resolveBindings(platform, overrides)
  push()
}

/** gravando um atalho na tela de Preferências: desliga os atalhos para a combinação não disparar a ação */
export function suspendShortcuts(on: boolean): void {
  if (suspended === on) return
  suspended = on
  push()
}
```

Em `src/renderer/src/main.tsx`:
- import: `import { syncKeybindings } from './shortcuts'`
- no `case 'state'`, depois da linha do `applySettings`:

```ts
      if (JSON.stringify(e.state.settings.keybindings) !== JSON.stringify(prev?.settings.keybindings)) syncKeybindings(e.state.settings.keybindings)
```

- no `.then` do `state.get`, depois do `terminals.applySettings(...)`:

```ts
    syncKeybindings((getUi().app?.settings ?? app.settings).keybindings)
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/renderer/keys.test.ts && npm run typecheck`
Expected: PASS (casos antigos do Mac continuam passando, pois o contexto padrão é Mac); typecheck ok.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/keys.ts src/renderer/src/shortcuts.ts src/renderer/src/main.tsx tests/renderer/keys.test.ts
git commit -m "feat: xterm deixa Ctrl puro para o shell no Linux e respeita atalhos configurados"
```

---

### Task 5: Aba "Atalhos" nas Preferências

**Files:**
- Create: `src/renderer/src/components/KeybindingsPanel.tsx`
- Modify: `src/renderer/src/components/Preferences.tsx`, `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `ACTIONS`, `GROUP_LABELS`, `ActionGroup`, `accelFromEvent`, `findConflict`, `formatAccel`, `isReserved`, `isShellKey`, `resolveBindings`, `setBinding`, `KeyOverrides` (Task 1); `platform`, `suspendShortcuts` (Task 4); `TerminalSettings.keybindings` (Task 2)
- Produces: `KeybindingsPanel({ overrides, onChange })`

A lógica (conflito, shell, reservado, padrão, steal) já está testada na Task 1; esta task é só UI. Verificação manual no Step 4.

- [ ] **Step 1: Criar o componente**

```tsx
// src/renderer/src/components/KeybindingsPanel.tsx
import { useEffect, useState } from 'react'
import {
  accelFromEvent, ACTIONS, findConflict, formatAccel, GROUP_LABELS, isReserved, isShellKey, resolveBindings, setBinding, type ActionGroup, type KeyOverrides,
} from '../../../shared/keybindings'
import { platform, suspendShortcuts } from '../shortcuts'

type Ask = { actionId: string; accel: string; kind: 'conflict'; other: string } | { actionId: string; accel: string; kind: 'shell'; conflictOk: boolean }

const labelOf = (id: string) => ACTIONS.find((a) => a.id === id)?.label ?? id

export function KeybindingsPanel({ overrides, onChange }: { overrides: KeyOverrides; onChange: (next: KeyOverrides) => void }) {
  const [recording, setRecording] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [error, setError] = useState<{ actionId: string; text: string } | null>(null)
  const bindings = resolveBindings(platform, overrides)

  useEffect(() => suspendShortcuts(recording !== null), [recording])
  useEffect(() => () => suspendShortcuts(false), [])

  const assign = (actionId: string, accel: string | null, ok: { conflict?: boolean; shell?: boolean } = {}) => {
    setError(null)
    setAsk(null)
    if (accel) {
      if (isReserved(platform, accel)) {
        setError({ actionId, text: `${formatAccel(platform, accel)} é reservado para copiar/colar e afins` })
        return
      }
      const other = findConflict(bindings, actionId, accel)
      if (other && !ok.conflict) {
        setAsk({ actionId, accel, kind: 'conflict', other })
        return
      }
      if (isShellKey(platform, accel) && !ok.shell) {
        setAsk({ actionId, accel, kind: 'shell', conflictOk: !!ok.conflict })
        return
      }
    }
    onChange(setBinding(platform, overrides, actionId, accel, true))
  }

  const groups = Object.keys(GROUP_LABELS) as ActionGroup[]
  return (
    <div className="keys-panel">
      {groups.map((g) => (
        <div key={g} className="keys-group">
          <div className="field-label">{GROUP_LABELS[g].toUpperCase()}</div>
          {ACTIONS.filter((a) => a.group === g).map((a) => {
            const accel = bindings[a.id]
            const changed = Object.prototype.hasOwnProperty.call(overrides, a.id)
            const q = ask?.actionId === a.id ? ask : null
            const isRec = recording === a.id
            return (
              <div key={a.id} className={`keys-row${changed ? ' changed' : ''}`}>
                <span className="keys-label">{a.label}</span>
                <button
                  className={`keys-accel${isRec ? ' recording' : ''}`}
                  onClick={() => {
                    setAsk(null)
                    setError(null)
                    setRecording(a.id)
                  }}
                  onBlur={() => isRec && setRecording(null)}
                  onKeyDown={(e) => {
                    if (!isRec) return
                    e.preventDefault()
                    e.stopPropagation()
                    if (e.key === 'Escape') return setRecording(null)
                    if (e.key === 'Backspace' || e.key === 'Delete') {
                      setRecording(null)
                      return assign(a.id, null)
                    }
                    const next = accelFromEvent(e, platform)
                    if (!next) return // só modificadores (ou tecla sem suporte): continua gravando
                    setRecording(null)
                    assign(a.id, next)
                  }}
                >
                  {isRec ? 'aperte a combinação…' : accel ? formatAccel(platform, accel) : '—'}
                </button>
                {changed ? (
                  <button className="keys-reset" title="Voltar ao padrão" onClick={() => assign(a.id, a[platform])}>
                    ↺
                  </button>
                ) : (
                  <span />
                )}
                {q?.kind === 'conflict' && (
                  <div className="keys-note">
                    {formatAccel(platform, q.accel)} já é usado por <b>{labelOf(q.other)}</b> —{' '}
                    <button className="ph-link" onClick={() => assign(a.id, q.accel, { conflict: true })}>
                      Trocar
                    </button>{' '}
                    <button className="ph-link" onClick={() => setAsk(null)}>
                      Cancelar
                    </button>
                  </div>
                )}
                {q?.kind === 'shell' && (
                  <div className="keys-note">
                    o terminal deixará de receber {formatAccel(platform, q.accel)} —{' '}
                    <button className="ph-link" onClick={() => assign(a.id, q.accel, { conflict: q.conflictOk, shell: true })}>
                      Usar mesmo assim
                    </button>{' '}
                    <button className="ph-link" onClick={() => setAsk(null)}>
                      Cancelar
                    </button>
                  </div>
                )}
                {error?.actionId === a.id && <div className="keys-note">{error.text}</div>}
              </div>
            )
          })}
        </div>
      ))}
      <button
        className="keys-restore"
        onClick={() => {
          setAsk(null)
          setError(null)
          onChange({})
        }}
      >
        Restaurar todos os padrões
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Ligar nas Preferências** — em `src/renderer/src/components/Preferences.tsx`:
- import: `import { KeybindingsPanel } from './KeybindingsPanel'`
- estado: `useState<'terminal' | 'agents' | 'shortcuts'>('terminal')`
- terceiro botão nas `pref-tabs`, depois de "Agentes":

```tsx
          <button className={tab === 'shortcuts' ? 'active' : ''} onClick={() => setTab('shortcuts')}>
            Atalhos
          </button>
```

- trocar `{tab === 'agents' ? (<AgentsPanel />) : (<> …terminal… </>)}` por:

```tsx
        {tab === 'agents' ? (
          <AgentsPanel />
        ) : tab === 'shortcuts' ? (
          <KeybindingsPanel overrides={draft.keybindings} onChange={(keybindings) => update({ keybindings })} />
        ) : (
          <>
            {/* …campos de Terminal como estão… */}
          </>
        )}
```

- [ ] **Step 3: CSS** — acrescentar ao fim de `src/renderer/src/styles.css`:

```css
/* Preferências → Atalhos */
.keys-panel { max-height: 60vh; overflow-y: auto; padding-right: 4px; }
.keys-group { margin-bottom: 12px; }
.keys-row { display: grid; grid-template-columns: 1fr auto 22px; align-items: center; gap: 8px; padding: 3px 0; }
.keys-row.changed .keys-label { color: var(--accent); }
.keys-accel { min-width: 140px; text-align: center; font-family: Menlo, monospace; font-size: 12px; }
.keys-accel.recording { outline: 1px solid var(--accent); color: var(--fg-dim); }
.keys-reset { background: none; border: 0; padding: 0; cursor: pointer; color: var(--fg-dim); }
.keys-note { grid-column: 1 / -1; font-size: 12px; color: var(--warn); }
.keys-restore { margin-top: 4px; }
```

- [ ] **Step 4: Verificar**

Run: `npm run typecheck && npm test`
Expected: sem erros; suíte passa.

Manual (`npm run dev`, no Mac): Preferências → Atalhos. (a) Clicar "Dividir à direita", apertar ⌥⌘R → vira `⌥⌘R`, linha destacada, ↺ aparece, menu Sessão mostra ⌥⌘R. (b) Gravar ⌘K em "Dividir à direita" → aviso "já é usado por Buscar…"; Trocar → Buscar fica "—". (c) ↺ volta ao padrão. (d) Esc durante a gravação cancela sem fechar a janela de Preferências. (e) Gravar ⌘C → aviso de reservado. (f) "Restaurar todos os padrões". (g) Enquanto grava, ⌘D não divide.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/KeybindingsPanel.tsx src/renderer/src/components/Preferences.tsx src/renderer/src/styles.css
git commit -m "feat: aba Atalhos nas Preferências (gravar, conflito, aviso do shell, restaurar)"
```

---

### Task 6: Terminal novo já com foco

**Files:**
- Create: `src/renderer/src/pending-focus.ts`
- Modify: `src/renderer/src/terminals.ts`
- Test: `tests/renderer/pending-focus.test.ts`

**Interfaces:**
- Produces: `class PendingFocus { request(id, tryFocus): void; ready(id, tryFocus): void; clear(id): void }`, com `tryFocus: (id: string) => boolean`

Causa: `focusPane` chama `terminals.focus` no próximo frame, mas o xterm só nasce quando o `TerminalView` monta (depois que o estado volta do daemon); `focus` não acha a entrada e o pedido se perde.

- [ ] **Step 1: Write the failing test**

```ts
// tests/renderer/pending-focus.test.ts
import { describe, expect, it } from 'vitest'
import { PendingFocus } from '../../src/renderer/src/pending-focus'

describe('PendingFocus', () => {
  it('guarda o pedido quando o terminal ainda não existe e aplica quando fica pronto', () => {
    const ready = new Set<string>()
    const focused: string[] = []
    const tryFocus = (id: string) => (ready.has(id) ? (focused.push(id), true) : false)
    const p = new PendingFocus()
    p.request('a', tryFocus)
    expect(focused).toEqual([])
    ready.add('a')
    p.ready('a', tryFocus)
    expect(focused).toEqual(['a'])
    p.ready('a', tryFocus) // já aplicado: não repete
    expect(focused).toEqual(['a'])
  })
  it('um pedido novo substitui o anterior', () => {
    const ready = new Set(['a', 'b'])
    const focused: string[] = []
    const tryFocus = (id: string) => (ready.has(id) ? (focused.push(id), true) : false)
    const p = new PendingFocus()
    ready.delete('a')
    p.request('a', tryFocus)
    p.request('b', tryFocus) // b existe: foca na hora e descarta o pedido de a
    ready.add('a')
    p.ready('a', tryFocus)
    expect(focused).toEqual(['b'])
  })
  it('clear descarta o pedido do painel descartado', () => {
    const focused: string[] = []
    let ok = false
    const tryFocus = (id: string) => (ok ? (focused.push(id), true) : false)
    const p = new PendingFocus()
    p.request('a', tryFocus)
    p.clear('a')
    ok = true
    p.ready('a', tryFocus)
    expect(focused).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/pending-focus.test.ts`
Expected: FAIL — import não resolve.

- [ ] **Step 3: Implement**

```ts
// src/renderer/src/pending-focus.ts
/** pedido de foco para um terminal que ainda não existe (o xterm nasce quando o estado volta do daemon) */
export class PendingFocus {
  private id: string | null = null

  /** tenta focar agora; se não der, guarda o pedido (substituindo o anterior) */
  request(id: string, tryFocus: (id: string) => boolean): void {
    this.id = tryFocus(id) ? null : id
  }

  /** o terminal de `id` ficou pronto: aplica o pedido guardado, se for dele */
  ready(id: string, tryFocus: (id: string) => boolean): void {
    if (this.id === id && tryFocus(id)) this.id = null
  }

  clear(id: string): void {
    if (this.id === id) this.id = null
  }
}
```

Em `src/renderer/src/terminals.ts`:
- import: `import { PendingFocus } from './pending-focus'`
- na classe `TerminalRegistry`, campos novos:

```ts
  private pendingFocus = new PendingFocus()
  private tryFocus = (paneId: string): boolean => {
    const e = this.entries.get(paneId)
    if (!e || !e.el.isConnected) return false
    e.term.focus()
    return true
  }
```

- `focus` passa a ser:

```ts
  focus(paneId: string): void {
    this.pendingFocus.request(paneId, this.tryFocus)
  }
```

- em `mount`, logo depois de `container.appendChild(e.el)`: `this.pendingFocus.ready(paneId, this.tryFocus)`
- em `attach`, logo depois de `e.state = 'live'`: `this.pendingFocus.ready(paneId, this.tryFocus)`
- em `dispose`, na primeira linha: `this.pendingFocus.clear(paneId)`

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/renderer/pending-focus.test.ts && npm run typecheck`
Expected: PASS.

Manual (`npm run dev`): ⌘T → criar sessão → digitar sem clicar: o texto entra no terminal novo. ⌘D e ⇧⌘D idem. "Retomar sessão" num painel perdido idem.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pending-focus.ts src/renderer/src/terminals.ts tests/renderer/pending-focus.test.ts
git commit -m "fix: terminal novo recebe o foco quando o xterm fica pronto"
```

---

### Task 7: Fechar painel e aba

**Files:**
- Modify: `src/renderer/src/layout.ts`, `src/renderer/src/focus.ts`, `src/renderer/src/actions.ts`, `src/renderer/src/main.tsx`
- Test: `tests/renderer/layout.test.ts`, `tests/renderer/focus.test.ts`

**Interfaces:**
- Produces: `removePane(l: Layout, paneId: string): Layout` (layout.ts); `panesToAutoClose(app: Pick<AppState, 'panes' | 'resumable'>): string[]` (focus.ts)

- [ ] **Step 1: Write the failing tests**

Em `tests/renderer/layout.test.ts` (importar `removePane` junto dos outros de `layout`, e `Layout` de `../../src/shared/types` se ainda não estiver):

```ts
describe('removePane', () => {
  const leaf = (paneId: string) => ({ type: 'leaf' as const, paneId })
  const two: Layout = {
    tabs: [
      { id: 't1', name: 'Aba 1', root: leaf('a') },
      { id: 't2', name: 'Aba 2', root: { type: 'split', dir: 'row', children: [leaf('b'), leaf('c')], sizes: [] } },
    ],
    activeTabId: 't1',
  }
  it('aba que fica vazia fecha e a ativa passa para a vizinha', () => {
    const l = removePane(two, 'a')
    expect(l.tabs.map((t) => t.id)).toEqual(['t2'])
    expect(l.activeTabId).toBe('t2')
  })
  it('aba em segundo plano vazia fecha sem mudar a ativa', () => {
    const l = removePane(removePane(two, 'b'), 'c')
    expect(l.tabs.map((t) => t.id)).toEqual(['t1'])
    expect(l.activeTabId).toBe('t1')
  })
  it('a única aba nunca fecha', () => {
    const one: Layout = { tabs: [{ id: 't1', name: 'Aba 1', root: leaf('a') }], activeTabId: 't1' }
    expect(removePane(one, 'a')).toEqual({ tabs: [{ id: 't1', name: 'Aba 1', root: null }], activeTabId: 't1' })
  })
  it('aba que ainda tem painéis continua', () => {
    const l = removePane(two, 'b')
    expect(l.tabs).toHaveLength(2)
    expect(l.tabs[1].root).toEqual(leaf('c'))
  })
  it('painel fora do layout: nada muda além da cópia', () => {
    expect(removePane(two, 'zzz').tabs.map((t) => t.id)).toEqual(['t1', 't2'])
  })
})
```

Em `tests/renderer/focus.test.ts` (importar `panesToAutoClose`; `PaneView` de `../../src/shared/types`):

```ts
describe('panesToAutoClose', () => {
  const pane = (id: string, alive: boolean, exitCode: number | null) =>
    ({ id, seq: 1, cwd: '/', alive, exitCode, accountId: null, claude: null, projectPath: null, worktreePath: null, name: null, color: null, agentHooksMissing: false }) as PaneView
  it('só os que terminaram com código 0 e não são retomáveis', () => {
    const app = {
      panes: [pane('vivo', true, null), pane('ok', false, 0), pane('erro', false, 1), pane('sinal', false, null), pane('retomavel', false, 0)],
      resumable: [{ paneId: 'retomavel', cwd: '/', accountId: null, sessionId: 's' }],
    }
    expect(panesToAutoClose(app)).toEqual(['ok'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/renderer/layout.test.ts tests/renderer/focus.test.ts`
Expected: FAIL — `removePane` / `panesToAutoClose` não existem.

- [ ] **Step 3: Implement**

Em `src/renderer/src/layout.ts` (depois de `removeLeaf`):

```ts
/** tira o painel do layout; a aba que fica vazia fecha junto, a não ser que seja a única */
export function removePane(l: Layout, paneId: string): Layout {
  const owner = findTab(l, paneId)
  const tabs = l.tabs.map((t) => ({ ...t, root: t.root ? removeLeaf(t.root, paneId) : null }))
  const idx = owner ? tabs.findIndex((t) => t.id === owner.id) : -1
  if (idx < 0 || tabs[idx].root !== null || tabs.length === 1) return { ...l, tabs }
  const rest = tabs.filter((_, i) => i !== idx)
  const activeTabId = l.activeTabId === owner!.id ? rest[Math.max(0, idx - 1)].id : l.activeTabId
  return { tabs: rest, activeTabId }
}
```

Em `src/renderer/src/focus.ts` (import `AppState` já existe):

```ts
/** shells/agentes que terminaram sem erro (código 0) e não são retomáveis: o painel fecha sozinho */
export function panesToAutoClose(app: Pick<AppState, 'panes' | 'resumable'>): string[] {
  const resumable = new Set(app.resumable.map((r) => r.paneId))
  return app.panes.filter((p) => !p.alive && p.exitCode === 0 && !resumable.has(p.id)).map((p) => p.id)
}
```

Em `src/renderer/src/actions.ts`, acrescentar `removePane` ao import de `./layout` e trocar `hidePane` por:

```ts
export function hidePane(paneId: string): void {
  const before = getUi().app?.layout
  const next = before && getUi().focusedPaneId === paneId ? focusAfterHide(before, paneId) : undefined
  updateLayout((l) => removePane(l, paneId))
  const after = getUi().app?.layout
  // a aba ativa fechou (ficou vazia): o foco vai para a aba que ficou ativa
  if (before && after?.activeTabId && after.activeTabId !== before.activeTabId) activateTab(after.activeTabId)
  else if (next !== undefined) {
    if (next) focusPane(next)
    else setUi({ focusedPaneId: null })
  }
}
```

(`activateTab` é uma function declaration mais abaixo no mesmo arquivo; o hoisting cobre.)

Em `src/renderer/src/main.tsx`:
- imports: `closeDeadPane` junto de `markSeenIfLooking, revealPane, runMenuAction`; `import { panesToAutoClose } from './focus'`
- perto de `sentNotices`: `const autoClosed = new Set<string>()`
- em `onStateArrived`, logo depois de `if (!app) return`:

```ts
  // terminou sem erro: o painel (e a aba, se ficar vazia) fecha sozinho
  for (const id of panesToAutoClose(app)) {
    if (autoClosed.has(id)) continue
    autoClosed.add(id)
    closeDeadPane(id)
  }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/renderer && npm run typecheck`
Expected: PASS.

Manual (`npm run dev`): (a) Aba com um terminal, digitar `exit` → painel e aba somem (se houver outra aba), foco na aba vizinha. (b) `exit 3` → fica "terminal encerrado (código 3)". (c) ⌘W no último painel de uma aba, com outras abas → a aba fecha; a sessão continua na sidebar. (d) ⌘W no último painel da única aba → estado vazio.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/layout.ts src/renderer/src/focus.ts src/renderer/src/actions.ts src/renderer/src/main.tsx tests/renderer/layout.test.ts tests/renderer/focus.test.ts
git commit -m "feat: painel fecha ao sair do shell sem erro e aba vazia fecha junto"
```

---

### Task 8: Cabeçalho do painel sem zeros e preferência de status do git

**Files:**
- Modify: `src/renderer/src/header.ts`, `src/renderer/src/components/PaneHeader.tsx`, `src/renderer/src/components/Preferences.tsx`, `src/renderer/src/styles.css`
- Test: `tests/renderer/header.test.ts`

**Interfaces:**
- Consumes: `TerminalSettings.showGitStatus` (Task 2)
- Produces: `gitBadges(h: Pick<HeaderView, 'changed' | 'ahead' | 'behind'>, show: boolean): { changed: number | null; ahead: number | null; behind: number | null }`

- [ ] **Step 1: Write the failing test** — em `tests/renderer/header.test.ts` (importar `gitBadges`):

```ts
describe('gitBadges', () => {
  it('zeros somem', () => {
    expect(gitBadges({ changed: 0, ahead: 0, behind: 0 }, true)).toEqual({ changed: null, ahead: null, behind: null })
    expect(gitBadges({ changed: 3, ahead: 0, behind: 2 }, true)).toEqual({ changed: 3, ahead: null, behind: 2 })
  })
  it('preferência desligada esconde tudo', () => {
    expect(gitBadges({ changed: 3, ahead: 1, behind: 2 }, false)).toEqual({ changed: null, ahead: null, behind: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/renderer/header.test.ts`
Expected: FAIL — `gitBadges` não existe.

- [ ] **Step 3: Implement**

Em `src/renderer/src/header.ts`:

```ts
export interface GitBadges {
  changed: number | null
  ahead: number | null
  behind: number | null
}

/** peças do git no cabeçalho: só aparecem quando dizem algo (> 0) e a preferência está ligada */
export function gitBadges(h: Pick<HeaderView, 'changed' | 'ahead' | 'behind'>, show: boolean): GitBadges {
  const keep = (n: number) => (show && n > 0 ? n : null)
  return { changed: keep(h.changed), ahead: keep(h.ahead), behind: keep(h.behind) }
}
```

Em `src/renderer/src/components/PaneHeader.tsx`:
- import: `import { gitBadges, headerView, textOn } from '../header'`
- depois do `useMemo` do `h`: 

```tsx
  const showGit = useUi((s) => s.app!.settings.showGitStatus)
  const g = gitBadges(h, showGit)
```

- no ramo "dentro de projeto" da `ph-row2`, trocar o `span.ph-branch` e o `span.ph-fixed` por:

```tsx
            <span className="ph-branch" title={h.hasUpstream ? (h.branch ?? 'HEAD destacado') : `${h.branch ?? 'HEAD destacado'} · branch sem upstream`}>
              {h.branch ?? 'HEAD destacado'}
            </span>
            <span className="ph-fixed">
              {g.changed !== null && (
                <span className="ph-changed dirty">
                  ● {g.changed}
                  {!compact && ' alterados'}
                </span>
              )}
              {(g.ahead !== null || g.behind !== null) && (
                <span className="ph-sync">{[g.ahead !== null && `↑${g.ahead}`, g.behind !== null && `↓${g.behind}`].filter(Boolean).join(' ')}</span>
              )}
              {h.warning && (
                <span className="ph-warn" title={h.warning}>
                  ⚠
                </span>
              )}
            </span>
```

Em `src/renderer/src/components/Preferences.tsx`, na aba Terminal, depois do campo "ALTURA DE LINHA":

```tsx
        <label className="field pref-check">
          <input type="checkbox" checked={draft.showGitStatus} onChange={(e) => update({ showGitStatus: e.target.checked })} />
          Mostrar status do git no cabeçalho (● alterados, ↑↓ commits)
        </label>
```

Em `src/renderer/src/styles.css`, acrescentar depois de `.ph-changed.dirty { … }`:

```css
.ph-changed, .ph-sync { font-size: 11.5px; opacity: 0.8; }
.pref-check { display: flex; align-items: center; gap: 8px; cursor: pointer; }
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/renderer/header.test.ts && npm run typecheck`
Expected: PASS.

Manual: painel numa worktree limpa e em dia não mostra `● 0 ↑0 ↓0`; editar um arquivo → aparece `● 1 alterados`; desmarcar a opção nas Preferências → some; tooltip da branch sem upstream diz "branch sem upstream".

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/header.ts src/renderer/src/components/PaneHeader.tsx src/renderer/src/components/Preferences.tsx src/renderer/src/styles.css tests/renderer/header.test.ts
git commit -m "feat: cabeçalho sem zeros de git e opção para esconder o status"
```

---

### Task 9: Verificação final (Mac e Linux)

**Files:** nenhum novo (só correções que aparecerem)

- [ ] **Step 1: Suíte e tipos no Mac**

Run: `npm run typecheck && npm test`
Expected: tudo passa.

- [ ] **Step 2: Suíte no Linux**

Run: `sh scripts/linux-container.sh`
Expected: suíte passa no container.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build sem erros.

- [ ] **Step 4: Manual no Mac (`npm run dev`)** — atalhos idênticos aos de hoje no menu; tarefas 5–8 conforme os roteiros manuais delas.

- [ ] **Step 5: AppImage para o Victor**

Run: `npm run pack:linux`
Expected: AppImage gerado. Roteiro para ele: Ctrl+C interrompe, Ctrl+D fecha o shell (e o painel), Ctrl+W apaga palavra; Ctrl+Shift+C/V copia/cola; Ctrl+Shift+T/D/E/W funcionam; Preferências → Atalhos troca um atalho e o menu muda na hora; terminal novo já digita.

- [ ] **Step 6: Commit (se houve correções)**

```bash
git add -A
git commit -m "fix: ajustes da verificação final de atalhos e controle do terminal"
```
