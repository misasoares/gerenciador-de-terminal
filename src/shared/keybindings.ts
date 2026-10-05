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
  { id: 'new-workspace', label: 'Novo espaço de trabalho…', group: 'app', mac: 'Cmd+Shift+N', linux: 'Ctrl+Alt+N' },
  { id: 'new-session', label: 'Nova sessão…', group: 'sessao', mac: 'Cmd+T', linux: 'Ctrl+Shift+T' },
  { id: 'split-right', label: 'Dividir à direita', group: 'sessao', mac: 'Cmd+D', linux: 'Ctrl+Shift+D' },
  { id: 'split-down', label: 'Dividir abaixo', group: 'sessao', mac: 'Cmd+Shift+D', linux: 'Ctrl+Shift+E' },
  { id: 'hide-pane', label: 'Esconder painel', group: 'sessao', mac: 'Cmd+W', linux: 'Ctrl+Shift+W' },
  { id: 'toggle-float', label: 'Flutuar / encaixar painel', group: 'sessao', mac: 'Cmd+Shift+F', linux: 'Ctrl+Shift+F' },
  { id: 'next-attention', label: 'Próxima que precisa de mim', group: 'sessao', mac: 'Cmd+J', linux: 'Ctrl+Shift+J' },
  { id: 'palette', label: 'Buscar…', group: 'sessao', mac: 'Cmd+K', linux: 'Ctrl+Shift+K' },
  { id: 'open-file', label: 'Abrir arquivo…', group: 'sessao', mac: 'Cmd+P', linux: 'Ctrl+Shift+P' },
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
