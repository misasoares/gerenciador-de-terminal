import { ACTIONS, parseAccel, type KeyOverrides } from './keybindings'

export const THEME_IDS = ['vscode-dark', 'one-dark', 'dracula', 'solarized-dark', 'github-dark', 'nord'] as const
export type ThemeId = (typeof THEME_IDS)[number]

export interface TerminalSettings {
  theme: ThemeId
  fontFamily: string
  fontSize: number
  lineHeight: number
  /** mostrar ● alterados e ↑↓ no cabeçalho do painel */
  showGitStatus: boolean
  /** só as alterações de atalho; null = sem atalho */
  keybindings: KeyOverrides
}

export const DEFAULT_SETTINGS: TerminalSettings = {
  theme: 'vscode-dark',
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: 13,
  lineHeight: 1.2,
  showGitStatus: true,
  keybindings: {},
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

export function normalizeSettings(s: Partial<TerminalSettings> | undefined): TerminalSettings {
  const v = s ?? {}
  return {
    theme: THEME_IDS.includes(v.theme as ThemeId) ? (v.theme as ThemeId) : DEFAULT_SETTINGS.theme,
    fontFamily: typeof v.fontFamily === 'string' && v.fontFamily.trim() ? v.fontFamily.trim() : DEFAULT_SETTINGS.fontFamily,
    fontSize: typeof v.fontSize === 'number' && Number.isFinite(v.fontSize) ? clamp(Math.round(v.fontSize), 10, 24) : DEFAULT_SETTINGS.fontSize,
    lineHeight: typeof v.lineHeight === 'number' && Number.isFinite(v.lineHeight) ? clamp(Math.round(v.lineHeight * 10) / 10, 1, 1.6) : DEFAULT_SETTINGS.lineHeight,
    showGitStatus: typeof v.showGitStatus === 'boolean' ? v.showGitStatus : DEFAULT_SETTINGS.showGitStatus,
    keybindings: normalizeKeybindings(v.keybindings),
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
