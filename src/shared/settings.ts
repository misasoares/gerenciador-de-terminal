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
}

export const DEFAULT_SETTINGS: TerminalSettings = {
  appearance: { mode: 'fixed', theme: 'padrao', light: 'claro', dark: 'padrao' },
  terminalTheme: 'match',
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: 13,
  lineHeight: 1.2,
  showGitStatus: true,
  keybindings: {},
  maxHiredPerLeader: 10,
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

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
