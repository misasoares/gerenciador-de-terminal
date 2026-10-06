import type { Appearance, AppThemeId, TerminalSettings, ThemeId } from '../../shared/settings'
import type { MotionPersonality } from './motion-presets'
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
  'app-backdrop', 'surface-blur', 'pane-gap', 'pane-radius', 'pane-shadow',
] as const
export type TokenName = (typeof TOKEN_NAMES)[number]

export interface AppTheme {
  id: AppThemeId
  label: string
  /** esquema dos elementos nativos (barras de rolagem, players, pdf, vidro) */
  scheme: 'light' | 'dark'
  /** tema de terminal pareado (usado quando terminalTheme = 'match') */
  terminal: ThemeId
  /** tema premium: fundo escolhível, vidro nas barras, painéis com respiro */
  premium: boolean
  /** personalidade do movimento (motion-presets.ts) */
  motion: MotionPersonality
  tokens: Record<TokenName, string>
}

/** forma, tipografia, densidade e movimento comuns aos dois temas desta parte */
const BASE = {
  'radius-sm': '3px', 'radius-md': '4px', 'radius-lg': '6px', 'radius-xl': '8px',
  'font-ui': "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", 'font-mono': 'Menlo, monospace',
  'text-xs': '10px', 'text-sm': '11.5px', 'text-md': '12px', 'text-base': '13px', 'text-lg': '15px',
  'tabbar-height': '32px', 'header-height': '26px',
  'dur-fast': '120ms', 'dur-base': '200ms', 'dur-slow': '700ms', 'ease-standard': 'ease-out', 'ease-spring': 'cubic-bezier(0.2, 0, 0, 1)',
} satisfies Partial<Record<TokenName, string>>

/** Padrão e Claro: sem fundo próprio, sem vidro, painéis colados (o visual de sempre) */
const NEUTRAL = { 'surface-blur': '0px', 'pane-gap': '0px', 'pane-radius': '0px', 'pane-shadow': 'none' } satisfies Partial<Record<TokenName, string>>

/** temas premium: cantos mais generosos e barras um pouco mais altas */
const PREMIUM_BASE = {
  ...BASE,
  'radius-sm': '6px', 'radius-md': '8px', 'radius-lg': '10px', 'radius-xl': '14px', 'tabbar-height': '34px', 'header-height': '28px',
} satisfies Partial<Record<TokenName, string>>

export const PREMIUM_THEME_IDS = ['vidro', 'noite', 'aurora'] as const
/** superfícies que viram vidro nos temas premium */
export const GLASS_TOKENS = ['bg-side', 'bg-bar', 'bg-status'] as const
/** opacidade do vidro sobre fundos imprevisíveis (imagens, mesa do macOS): legível sobre preto e branco */
export const SAFE_GLASS_ALPHA = 0.82

export const APP_THEMES: Record<AppThemeId, AppTheme> = {
  padrao: {
    id: 'padrao', label: 'Padrão', scheme: 'dark', terminal: 'vscode-dark', premium: false, motion: 'subtle',
    tokens: {
      ...BASE,
      ...NEUTRAL,
      'app-backdrop': '#1e1e1e',
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
    id: 'claro', label: 'Claro', scheme: 'light', terminal: 'github-light', premium: false, motion: 'subtle',
    tokens: {
      ...BASE,
      ...NEUTRAL,
      'app-backdrop': '#ffffff',
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
  vidro: {
    id: 'vidro', label: 'Vidro calmo', scheme: 'light', terminal: 'github-light', premium: true, motion: 'calm',
    tokens: {
      ...PREMIUM_BASE,
      'bg': '#ffffff', 'bg-side': 'rgba(255, 255, 255, 0.55)', 'bg-bar': 'rgba(255, 255, 255, 0.55)', 'bg-raised': '#ffffff', 'bg-sunken': '#f5f5f7',
      'bg-hover': 'rgba(0, 0, 0, 0.05)', 'bg-selected': 'rgba(10, 132, 255, 0.14)', 'bg-status': 'rgba(255, 255, 255, 0.55)',
      'bg-control': 'rgba(0, 0, 0, 0.06)', 'bg-control-hover': 'rgba(0, 0, 0, 0.1)', 'bg-input': '#ffffff', 'border-input': '#c7c7cc',
      'fg': '#1d1d1f', 'fg-dim': '#545458', 'fg-on-accent': '#ffffff', 'link': '#0066cc',
      'border': 'rgba(0, 0, 0, 0.08)', 'border-strong': 'rgba(0, 0, 0, 0.12)',
      'accent': '#0a84ff', 'accent-soft': 'rgba(10, 132, 255, 0.2)', 'flash': '#0a84ff',
      'warn': '#9a6700', 'error': '#d70015', 'success': '#1a7f37', 'conflict': '#c2410c', 'danger': '#d70015',
      'banner-warn-bg': '#fff4ce', 'banner-warn-fg': '#6b4e00', 'banner-warn-border': '#f0d58a', 'banner-ok-bg': '#e6f4ea', 'banner-ok-fg': '#1a5e2a',
      'state-needs-you': '#c99700', 'state-your-turn': '#0a84ff',
      'chip-project-bg': '#1d1d1f', 'chip-project-fg': '#ffffff', 'chip-worktree-bg': '#d9f99d', 'chip-worktree-fg': '#1a2e05',
      'chip-unknown-bg': '#8e8e93', 'chip-unknown-fg': '#ffffff',
      'tab-colored-dim': 'rgba(255, 255, 255, 0.55)', 'tab-colored-dim-hover': 'rgba(255, 255, 255, 0.35)', 'tab-colored-fg': 'rgba(0, 0, 0, 0.72)',
      'checker-a': '#f0f0f0', 'checker-b': '#e0e0e0', 'scrim': 'rgba(240, 244, 250, 0.4)',
      'shadow-sm': '0 4px 14px rgba(31, 45, 61, 0.1)', 'shadow-side': '6px 0 18px rgba(31, 45, 61, 0.1)', 'shadow-lg': '0 20px 60px rgba(31, 45, 61, 0.18)',
      'app-backdrop': 'linear-gradient(135deg, #dfe9f5, #f4efe8 60%, #e9e4f3)', 'surface-blur': '24px', 'pane-gap': '10px', 'pane-radius': '14px',
      'pane-shadow': '0 6px 24px rgba(31, 45, 61, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.6)',
    },
  },
  noite: {
    id: 'noite', label: 'Noite afiada', scheme: 'dark', terminal: 'noite', premium: true, motion: 'crisp',
    tokens: {
      ...PREMIUM_BASE,
      'bg': '#111219', 'bg-side': 'rgba(20, 21, 30, 0.55)', 'bg-bar': 'rgba(20, 21, 30, 0.55)', 'bg-raised': '#1c1e2a', 'bg-sunken': '#0d0e14',
      'bg-hover': 'rgba(255, 255, 255, 0.05)', 'bg-selected': 'rgba(94, 106, 210, 0.22)', 'bg-status': 'rgba(20, 21, 30, 0.55)',
      'bg-control': 'rgba(255, 255, 255, 0.07)', 'bg-control-hover': 'rgba(255, 255, 255, 0.12)', 'bg-input': '#16171f', 'border-input': 'rgba(255, 255, 255, 0.14)',
      'fg': '#e6e6ea', 'fg-dim': '#a8aab8', 'fg-on-accent': '#ffffff', 'link': '#8b95ff',
      'border': 'rgba(255, 255, 255, 0.07)', 'border-strong': 'rgba(255, 255, 255, 0.12)',
      'accent': '#5e6ad2', 'accent-soft': 'rgba(94, 106, 210, 0.25)', 'flash': '#8b95ff',
      'warn': '#f2c94c', 'error': '#eb5757', 'success': '#4cb782', 'conflict': '#f2994a', 'danger': '#eb5757',
      'banner-warn-bg': '#2d2614', 'banner-warn-fg': '#f2c94c', 'banner-warn-border': '#4a3d18', 'banner-ok-bg': '#13291f', 'banner-ok-fg': '#7ee2b0',
      'state-needs-you': '#f2c94c', 'state-your-turn': '#5e6ad2',
      'chip-project-bg': '#e6e6ea', 'chip-project-fg': '#111219', 'chip-worktree-bg': '#d9f99d', 'chip-worktree-fg': '#1a2e05',
      'chip-unknown-bg': '#3a3c4a', 'chip-unknown-fg': '#e6e6ea',
      'tab-colored-dim': 'rgba(20, 20, 20, 0.55)', 'tab-colored-dim-hover': 'rgba(20, 20, 20, 0.35)', 'tab-colored-fg': 'rgba(255, 255, 255, 0.72)',
      'checker-a': '#1a1b24', 'checker-b': '#15161e', 'scrim': 'rgba(0, 0, 0, 0.45)',
      'shadow-sm': '0 4px 14px rgba(0, 0, 0, 0.45)', 'shadow-side': '6px 0 18px rgba(0, 0, 0, 0.5)', 'shadow-lg': '0 24px 80px rgba(0, 0, 0, 0.6)',
      'app-backdrop': 'radial-gradient(120% 90% at 0% 0%, #23263a, #0c0d12 60%)', 'surface-blur': '24px', 'pane-gap': '8px', 'pane-radius': '12px',
      'pane-shadow': '0 0 0 1px rgba(255, 255, 255, 0.07), 0 10px 30px rgba(0, 0, 0, 0.45)',
    },
  },
  aurora: {
    id: 'aurora', label: 'Aurora', scheme: 'light', terminal: 'github-light', premium: true, motion: 'lively',
    tokens: {
      ...PREMIUM_BASE,
      'ease-spring': 'cubic-bezier(0.34, 1.3, 0.64, 1)',
      'bg': '#ffffff', 'bg-side': 'rgba(255, 255, 255, 0.55)', 'bg-bar': 'rgba(255, 255, 255, 0.55)', 'bg-raised': '#ffffff', 'bg-sunken': '#f7f3ff',
      'bg-hover': 'rgba(142, 60, 255, 0.07)', 'bg-selected': 'rgba(142, 60, 255, 0.16)', 'bg-status': 'rgba(255, 255, 255, 0.55)',
      'bg-control': 'rgba(0, 0, 0, 0.06)', 'bg-control-hover': 'rgba(0, 0, 0, 0.1)', 'bg-input': '#ffffff', 'border-input': '#c7c7cc',
      'fg': '#1d1d1f', 'fg-dim': '#4a4a4f', 'fg-on-accent': '#ffffff', 'link': '#6e2bd9',
      'border': 'rgba(0, 0, 0, 0.08)', 'border-strong': 'rgba(0, 0, 0, 0.12)',
      'accent': '#8e3cff', 'accent-soft': 'rgba(142, 60, 255, 0.2)', 'flash': '#8e3cff',
      'warn': '#9a6700', 'error': '#d70015', 'success': '#1a7f37', 'conflict': '#c2410c', 'danger': '#d70015',
      'banner-warn-bg': '#fff4ce', 'banner-warn-fg': '#6b4e00', 'banner-warn-border': '#f0d58a', 'banner-ok-bg': '#e6f4ea', 'banner-ok-fg': '#1a5e2a',
      'state-needs-you': '#c99700', 'state-your-turn': '#2563eb',
      'chip-project-bg': '#1d1d1f', 'chip-project-fg': '#ffffff', 'chip-worktree-bg': '#d9f99d', 'chip-worktree-fg': '#1a2e05',
      'chip-unknown-bg': '#8e8e93', 'chip-unknown-fg': '#ffffff',
      'tab-colored-dim': 'rgba(255, 255, 255, 0.55)', 'tab-colored-dim-hover': 'rgba(255, 255, 255, 0.35)', 'tab-colored-fg': 'rgba(0, 0, 0, 0.72)',
      'checker-a': '#f0f0f0', 'checker-b': '#e0e0e0', 'scrim': 'rgba(255, 255, 255, 0.15)',
      'shadow-sm': '0 4px 14px rgba(80, 40, 120, 0.15)', 'shadow-side': '6px 0 18px rgba(80, 40, 120, 0.18)', 'shadow-lg': '0 20px 60px rgba(80, 40, 120, 0.35)',
      'app-backdrop': 'linear-gradient(140deg, #ff9a8b 0%, #ff6a88 30%, #8e7cff 65%, #5ac8fa 100%)', 'surface-blur': '26px', 'pane-gap': '12px', 'pane-radius': '16px',
      'pane-shadow': '0 12px 34px rgba(80, 40, 120, 0.28)',
    },
  },
}

/** cor (hex ou rgba) composta sobre uma base hex → hex */
export function composite(color: string, base: string): string {
  const m = color.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/)
  if (!m) return color
  const a = Number(m[4])
  const b = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16))
  return '#' + [1, 2, 3].map((i, k) => Math.round(Number(m[i]) * a + b[k] * (1 - a)).toString(16).padStart(2, '0')).join('')
}

/** cores #rrggbb de um gradiente CSS, na ordem */
export function gradientStops(css: string): string[] {
  return css.match(/#[0-9a-f]{6}\b/gi) ?? []
}

/** tema efetivo: fixo, ou automático conforme o sistema; terminal = par do tema ou o fixado */
/** opacidade do terminal em vidro: o texto passa no AA sobre qualquer coisa atrás */
export const TERMINAL_GLASS_ALPHA = 0.85

/** terminal de cada tom: o próprio do tema quando o tom bate com o esquema dele; senão o par claro/escuro */
function terminalForTone(app: AppTheme, tone: 'auto' | 'light' | 'dark'): ThemeId {
  if (tone === 'auto' || tone === app.scheme) return app.terminal
  return tone === 'light' ? 'github-light' : app.premium ? 'noite' : 'vscode-dark'
}

/** tema efetivo: fixo, ou automático conforme o sistema; terminal = fixado, ou o do tom escolhido para o tema */
export function resolveTheme(
  s: Pick<TerminalSettings, 'appearance' | 'terminalTheme'>,
  systemDark: boolean,
): { app: AppTheme; terminal: ThemeId; glass: boolean } {
  const a = s.appearance
  const app = APP_THEMES[a.mode === 'auto' ? (systemDark ? a.dark : a.light) : a.theme]
  const style = a.terminals?.[app.id] ?? { tone: 'auto', glass: false }
  return {
    app,
    terminal: s.terminalTheme === 'match' ? terminalForTone(app, style.tone) : s.terminalTheme,
    // vidro só onde há fundo atrás para desfocar (temas premium)
    glass: app.premium && style.glass,
  }
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
