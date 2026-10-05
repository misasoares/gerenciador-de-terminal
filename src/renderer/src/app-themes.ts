import type { Appearance, AppThemeId, TerminalSettings, ThemeId } from '../../shared/settings'
import { THEMES } from './themes'

/** vocabulário de um tema: viram variáveis CSS --<nome> (ver spec, seção 2) */
export const TOKEN_NAMES = [
  'bg', 'bg-side', 'bg-bar', 'bg-raised', 'bg-sunken', 'bg-hover', 'bg-selected', 'bg-status',
  'bg-control', 'bg-control-hover', 'bg-input', 'border-input',
  'fg', 'fg-dim', 'fg-on-accent', 'link',
  'border', 'border-strong',
  'accent', 'accent-soft', 'flash',
  'warn', 'error', 'success', 'conflict', 'danger',
  'banner-warn-bg', 'banner-warn-fg', 'banner-warn-border', 'banner-ok-bg', 'banner-ok-fg',
  'state-needs-you', 'state-your-turn',
  'chip-project-bg', 'chip-project-fg', 'chip-worktree-bg', 'chip-worktree-fg', 'chip-unknown-bg', 'chip-unknown-fg',
  'tab-colored-dim', 'tab-colored-dim-hover', 'tab-colored-fg',
  'checker-a', 'checker-b', 'scrim',
  'radius-sm', 'radius-md', 'radius-lg', 'radius-xl', 'shadow-sm', 'shadow-side', 'shadow-lg',
  'font-ui', 'font-mono', 'text-xs', 'text-sm', 'text-md', 'text-base', 'text-lg',
  'tabbar-height', 'header-height',
  'dur-fast', 'dur-base', 'dur-slow', 'ease-standard', 'ease-spring',
] as const
export type TokenName = (typeof TOKEN_NAMES)[number]

export interface AppTheme {
  id: AppThemeId
  label: string
  /** esquema dos elementos nativos (barras de rolagem, players, pdf, vidro) */
  scheme: 'light' | 'dark'
  /** tema de terminal pareado (usado quando terminalTheme = 'match') */
  terminal: ThemeId
  tokens: Record<TokenName, string>
}

/** forma, tipografia, densidade e movimento comuns aos dois temas desta parte */
const BASE = {
  'radius-sm': '3px', 'radius-md': '4px', 'radius-lg': '6px', 'radius-xl': '8px',
  'font-ui': "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", 'font-mono': 'Menlo, monospace',
  'text-xs': '10px', 'text-sm': '11.5px', 'text-md': '12px', 'text-base': '13px', 'text-lg': '15px',
  'tabbar-height': '32px', 'header-height': '26px',
  'dur-fast': '120ms', 'dur-base': '200ms', 'dur-slow': '700ms', 'ease-standard': 'ease-out', 'ease-spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} satisfies Partial<Record<TokenName, string>>

export const APP_THEMES: Record<AppThemeId, AppTheme> = {
  padrao: {
    id: 'padrao', label: 'Padrão', scheme: 'dark', terminal: 'vscode-dark',
    tokens: {
      ...BASE,
      'bg': '#1e1e1e', 'bg-side': '#181818', 'bg-bar': '#252526', 'bg-raised': '#252526', 'bg-sunken': '#1b1b1b',
      'bg-hover': '#2a2d2e', 'bg-selected': '#04395e', 'bg-status': '#007acc22',
      'bg-control': '#3a3d41', 'bg-control-hover': '#45494e', 'bg-input': '#3c3c3c', 'border-input': '#555555',
      'fg': '#cccccc', 'fg-dim': '#8c8c8c', 'fg-on-accent': '#ffffff', 'link': '#4fc1ff',
      'border': '#2b2b2b', 'border-strong': '#3c3c3c',
      'accent': '#0078d4', 'accent-soft': 'rgba(0, 120, 212, 0.25)', 'flash': '#ffffff',
      'warn': '#cca700', 'error': '#f14c4c', 'success': '#89d185', 'conflict': '#f97316', 'danger': '#b3261e',
      'banner-warn-bg': '#4b3d10', 'banner-warn-fg': '#ffe08a', 'banner-warn-border': '#6b5616', 'banner-ok-bg': '#1e3a24', 'banner-ok-fg': '#b5f0c0',
      'state-needs-you': '#e2a500', 'state-your-turn': '#3b82f6',
      'chip-project-bg': '#e5e5e5', 'chip-project-fg': '#111111', 'chip-worktree-bg': '#d9f99d', 'chip-worktree-fg': '#1a2e05',
      'chip-unknown-bg': '#555555', 'chip-unknown-fg': '#ffffff',
      'tab-colored-dim': 'rgba(20, 20, 20, 0.55)', 'tab-colored-dim-hover': 'rgba(20, 20, 20, 0.35)', 'tab-colored-fg': 'rgba(255, 255, 255, 0.72)',
      'checker-a': '#2a2a2a', 'checker-b': '#222222', 'scrim': 'rgba(0, 0, 0, 0.5)',
      'shadow-sm': '0 4px 14px rgba(0, 0, 0, 0.4)', 'shadow-side': '6px 0 18px rgba(0, 0, 0, 0.5)', 'shadow-lg': '0 12px 40px rgba(0, 0, 0, 0.5)',
    },
  },
  claro: {
    id: 'claro', label: 'Claro', scheme: 'light', terminal: 'github-light',
    tokens: {
      ...BASE,
      'bg': '#ffffff', 'bg-side': '#f5f5f7', 'bg-bar': '#f0f0f2', 'bg-raised': '#ffffff', 'bg-sunken': '#f5f5f7',
      'bg-hover': '#e8e8ed', 'bg-selected': '#d6e4ff', 'bg-status': '#eef3fb',
      'bg-control': '#e8e8ed', 'bg-control-hover': '#dcdce1', 'bg-input': '#ffffff', 'border-input': '#c7c7cc',
      'fg': '#1d1d1f', 'fg-dim': '#68686d', 'fg-on-accent': '#ffffff', 'link': '#0066cc',
      'border': '#e0e0e5', 'border-strong': '#d1d1d6',
      'accent': '#0071e3', 'accent-soft': 'rgba(0, 113, 227, 0.2)', 'flash': '#0071e3',
      'warn': '#9a6700', 'error': '#d70015', 'success': '#1a7f37', 'conflict': '#c2410c', 'danger': '#d70015',
      'banner-warn-bg': '#fff4ce', 'banner-warn-fg': '#6b4e00', 'banner-warn-border': '#f0d58a', 'banner-ok-bg': '#e6f4ea', 'banner-ok-fg': '#1a5e2a',
      'state-needs-you': '#c99700', 'state-your-turn': '#2563eb',
      'chip-project-bg': '#1d1d1f', 'chip-project-fg': '#ffffff', 'chip-worktree-bg': '#d9f99d', 'chip-worktree-fg': '#1a2e05',
      'chip-unknown-bg': '#8e8e93', 'chip-unknown-fg': '#ffffff',
      'tab-colored-dim': 'rgba(255, 255, 255, 0.55)', 'tab-colored-dim-hover': 'rgba(255, 255, 255, 0.35)', 'tab-colored-fg': 'rgba(0, 0, 0, 0.72)',
      'checker-a': '#f0f0f0', 'checker-b': '#e0e0e0', 'scrim': 'rgba(0, 0, 0, 0.25)',
      'shadow-sm': '0 4px 14px rgba(0, 0, 0, 0.12)', 'shadow-side': '6px 0 18px rgba(0, 0, 0, 0.12)', 'shadow-lg': '0 12px 40px rgba(0, 0, 0, 0.18)',
    },
  },
}

/** tema efetivo: fixo, ou automático conforme o sistema; terminal = par do tema ou o fixado */
export function resolveTheme(s: Pick<TerminalSettings, 'appearance' | 'terminalTheme'>, systemDark: boolean): { app: AppTheme; terminal: ThemeId } {
  const a = s.appearance
  const app = APP_THEMES[a.mode === 'auto' ? (systemDark ? a.dark : a.light) : a.theme]
  return { app, terminal: s.terminalTheme === 'match' ? app.terminal : s.terminalTheme }
}

const DURATIONS: TokenName[] = ['dur-fast', 'dur-base', 'dur-slow']

/** variáveis CSS do tema; com "reduzir movimento" as durações valem 0 (inline venceria qualquer @media) */
export function cssVars(t: AppTheme, o: { reducedMotion: boolean }): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of TOKEN_NAMES) out[`--${k}`] = o.reducedMotion && DURATIONS.includes(k) ? '0ms' : t.tokens[k]
  return out
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** razão de contraste WCAG entre duas cores #rrggbb */
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** opção "acompanhar" do tema de terminal: no fixo diz qual terminal vem junto; no automático depende do sistema */
export function matchLabel(a: Appearance): string {
  return a.mode === 'auto' ? 'Acompanhar o tema' : `Acompanhar o tema (${THEMES[APP_THEMES[a.theme].terminal].label})`
}
