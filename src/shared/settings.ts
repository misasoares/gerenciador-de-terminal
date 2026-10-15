import { ACTIONS, parseAccel, type KeyOverrides } from './keybindings'

export const THEME_IDS = ['vscode-dark', 'one-dark', 'dracula', 'solarized-dark', 'github-dark', 'nord', 'github-light', 'noite'] as const
export type ThemeId = (typeof THEME_IDS)[number]

/** temas do app (cores + estilo visual); ids estáveis, nomes de tela em app-themes.ts */
export const APP_THEME_IDS = ['padrao', 'claro', 'vidro', 'noite', 'aurora'] as const
export type AppThemeId = (typeof APP_THEME_IDS)[number]

export interface Appearance {
  /** fixed: um tema só; auto: segue a aparência do macOS */
  mode: 'fixed' | 'auto'
  theme: AppThemeId
  light: AppThemeId
  dark: AppThemeId
  /** fundo escolhido por tema premium (sem entrada = gradiente do tema) */
  backgrounds: Partial<Record<AppThemeId, Background>>
  /** terminais encaixados por tema: tom (automático = o do tema) e superfície (vidro só nos premium) */
  terminals: Partial<Record<AppThemeId, TerminalStyle>>
}

export interface TerminalStyle {
  tone: 'auto' | 'light' | 'dark'
  glass: boolean
}

export function normalizeTerminalStyle(v: unknown): TerminalStyle {
  const t = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return { tone: t.tone === 'light' || t.tone === 'dark' ? t.tone : 'auto', glass: t.glass === true }
}

export type Background = { kind: 'theme' } | { kind: 'none' } | { kind: 'desktop' } | { kind: 'image'; image: string }
/** imagens que vêm com o app (src/renderer/public/fundos/<id>.jpg) */
export const BUNDLED_BACKGROUNDS = ['vidro-1', 'vidro-2', 'noite-1', 'noite-2', 'aurora-1', 'aurora-2'] as const
/** imagem do usuário: nome gerado pelo app (hash do conteúdo) */
export const USER_BG_RE = /^[a-f0-9]{16}\.jpg$/
const PREMIUM: readonly AppThemeId[] = ['vidro', 'noite', 'aurora']

export function normalizeBackground(v: unknown): Background {
  const b = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  if (b.kind === 'none' || b.kind === 'desktop' || b.kind === 'theme') return { kind: b.kind }
  if (b.kind === 'image' && typeof b.image === 'string') {
    const [src, name] = b.image.split(':')
    if (src === 'bundled' && BUNDLED_BACKGROUNDS.includes(name as (typeof BUNDLED_BACKGROUNDS)[number])) return { kind: 'image', image: b.image }
    if (src === 'user' && USER_BG_RE.test(name ?? '')) return { kind: 'image', image: b.image }
  }
  return { kind: 'theme' }
}

/** fundo que vale de fato: só temas premium têm fundo; a mesa só existe no mac */
export function effectiveBackground(a: Appearance, theme: AppThemeId, premium: boolean, platform: string): Background {
  const b: Background = premium ? a.backgrounds[theme] ?? { kind: 'theme' } : { kind: 'theme' }
  return b.kind === 'desktop' && platform !== 'darwin' ? { kind: 'theme' } : b
}

export function wantsDesktop(a: Appearance, theme: AppThemeId, premium: boolean, platform: string): boolean {
  return effectiveBackground(a, theme, premium, platform).kind === 'desktop'
}

/** limites do monitor da máquina; swap em % da RAM física (o macOS cresce o arquivo de swap sozinho) */
export interface MachineLimits {
  cpuWarn: number
  cpuBad: number
  swapWarn: number
  swapBad: number
  /** pressão do sistema: alerta = amarelo, crítica = bloqueia */
  pressureGate: boolean
}

/** encerra o agente de sessões ociosas e retoma ao focar */
export interface HibernateSettings {
  enabled: boolean
  /** minutos ociosa (⚪/🔵) e fora de foco até hibernar */
  minutes: number
}

export interface TerminalSettings {
  appearance: Appearance
  /** 'match' = acompanha o tema do app */
  terminalTheme: 'match' | ThemeId
  fontFamily: string
  fontSize: number
  lineHeight: number
  /** mostrar ● alterados e ↑↓ no cabeçalho do painel */
  showGitStatus: boolean
  /** só as alterações de atalho; null = sem atalho */
  keybindings: KeyOverrides
  /** teto de sessões vivas criadas por um líder pelo MCP */
  maxHiredPerLeader: number
  /** limites do indicador de CPU/RAM e do gate do contratar_dev */
  machine: MachineLimits
  /** hibernação de sessões ociosas */
  hibernate: HibernateSettings
}

export const DEFAULT_SETTINGS: TerminalSettings = {
  appearance: { mode: 'fixed', theme: 'padrao', light: 'claro', dark: 'padrao', backgrounds: {}, terminals: {} },
  terminalTheme: 'match',
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: 13,
  lineHeight: 1.2,
  showGitStatus: true,
  keybindings: {},
  maxHiredPerLeader: 10,
  machine: { cpuWarn: 70, cpuBad: 90, swapWarn: 25, swapBad: 75, pressureGate: true },
  hibernate: { enabled: false, minutes: 30 },
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

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

export function normalizeHibernate(v: unknown): HibernateSettings {
  const d = DEFAULT_SETTINGS.hibernate
  const h = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    enabled: typeof h.enabled === 'boolean' ? h.enabled : d.enabled,
    minutes: typeof h.minutes === 'number' && Number.isFinite(h.minutes) ? clamp(Math.round(h.minutes), 5, 240) : d.minutes,
  }
}

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

const isApp = (v: unknown): v is AppThemeId => APP_THEME_IDS.includes(v as AppThemeId)

function normalizeAppearance(v: unknown): Appearance {
  const d = DEFAULT_SETTINGS.appearance
  const a = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  return {
    mode: a.mode === 'auto' || a.mode === 'fixed' ? a.mode : d.mode,
    theme: isApp(a.theme) ? a.theme : d.theme,
    light: isApp(a.light) ? a.light : d.light,
    dark: isApp(a.dark) ? a.dark : d.dark,
    backgrounds: Object.fromEntries(
      Object.entries(a.backgrounds && typeof a.backgrounds === 'object' ? (a.backgrounds as Record<string, unknown>) : {})
        .filter(([k]) => PREMIUM.includes(k as AppThemeId))
        .map(([k, v]) => [k, normalizeBackground(v)]),
    ),
    terminals: Object.fromEntries(
      Object.entries(a.terminals && typeof a.terminals === 'object' ? (a.terminals as Record<string, unknown>) : {})
        .filter(([k]) => isApp(k))
        .map(([k, v]) => [k, normalizeTerminalStyle(v)]),
    ),
  }
}

/** terminalTheme novo; senão o `theme` antigo (o padrão antigo vira 'match', outro fica fixado) */
function normalizeTerminalTheme(v: Record<string, unknown>): 'match' | ThemeId {
  if (v.terminalTheme === 'match' || THEME_IDS.includes(v.terminalTheme as ThemeId)) return v.terminalTheme as 'match' | ThemeId
  if (v.terminalTheme === undefined && THEME_IDS.includes(v.theme as ThemeId) && v.theme !== 'vscode-dark') return v.theme as ThemeId
  return 'match'
}

export function normalizeSettings(s: Partial<TerminalSettings> | undefined): TerminalSettings {
  const v = s ?? {}
  return {
    appearance: normalizeAppearance(v.appearance),
    terminalTheme: normalizeTerminalTheme(v as Record<string, unknown>),
    fontFamily: typeof v.fontFamily === 'string' && v.fontFamily.trim() ? v.fontFamily.trim() : DEFAULT_SETTINGS.fontFamily,
    fontSize: typeof v.fontSize === 'number' && Number.isFinite(v.fontSize) ? clamp(Math.round(v.fontSize), 10, 24) : DEFAULT_SETTINGS.fontSize,
    lineHeight: typeof v.lineHeight === 'number' && Number.isFinite(v.lineHeight) ? clamp(Math.round(v.lineHeight * 10) / 10, 1, 1.6) : DEFAULT_SETTINGS.lineHeight,
    showGitStatus: typeof v.showGitStatus === 'boolean' ? v.showGitStatus : DEFAULT_SETTINGS.showGitStatus,
    keybindings: normalizeKeybindings(v.keybindings),
    maxHiredPerLeader:
      typeof v.maxHiredPerLeader === 'number' && Number.isFinite(v.maxHiredPerLeader) ? clamp(Math.round(v.maxHiredPerLeader), 1, 50) : DEFAULT_SETTINGS.maxHiredPerLeader,
    machine: normalizeMachineLimits(v.machine),
    hibernate: normalizeHibernate(v.hibernate),
  }
}

export const SESSION_COLORS = [
  { id: 'vermelho', label: 'vermelho', hex: '#ef4444' },
  { id: 'laranja', label: 'laranja', hex: '#f97316' },
  { id: 'amarelo', label: 'amarelo', hex: '#eab308' },
  { id: 'verde', label: 'verde', hex: '#22c55e' },
  { id: 'petroleo', label: 'azul-petróleo', hex: '#14b8a6' },
  { id: 'azul', label: 'azul', hex: '#3b82f6' },
  { id: 'roxo', label: 'roxo', hex: '#a855f7' },
  { id: 'rosa', label: 'rosa', hex: '#ec4899' },
]
