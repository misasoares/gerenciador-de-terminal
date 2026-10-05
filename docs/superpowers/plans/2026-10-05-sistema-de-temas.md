# Sistema de temas (parte 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O usuário escolhe um tema do app (cores + estilo visual) nas Preferências, fixo ou automático com o macOS, e o terminal acompanha; entregam-se o tema Padrão (o visual de hoje) e o Claro.

**Architecture:** Temas são objetos TypeScript tipados (`app-themes.ts`) com todos os tokens; uma função pura resolve o tema efetivo a partir das configurações e da aparência do sistema; o renderer grava os tokens como variáveis CSS no `<html>` (com cache em `localStorage` para não piscar) e avisa o processo principal do esquema claro/escuro. O `styles.css` passa a usar só variáveis.

**Tech Stack:** TypeScript, Electron 44, React 19, xterm 6, CodeMirror 6, vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-sistema-de-temas-design.md`

## Global Constraints

- Ids de tema do app: `'padrao' | 'claro'` (estáveis; nomes de tela: "Padrão", "Claro").
- Configurações novas em `TerminalSettings`: `appearance: { mode: 'fixed' | 'auto'; theme: AppThemeId; light: AppThemeId; dark: AppThemeId }` (padrão `{ mode: 'fixed', theme: 'padrao', light: 'claro', dark: 'padrao' }`) e `terminalTheme: 'match' | ThemeId` (padrão `'match'`). O campo antigo `theme` sai.
- Migração: `theme` antigo `'vscode-dark'` ou ausente → `terminalTheme: 'match'`; outro `theme` válido → `terminalTheme` = ele.
- Novo tema de terminal `github-light`; Padrão pareia com `vscode-dark`, Claro com `github-light`.
- Contraste AA ≥ 4,5:1 de `fg` e `fg-dim` sobre `bg`, `bg-side`, `bg-bar`, `bg-raised`, em todo tema.
- Padrão: `fg-dim` = `#8c8c8c`; amarelo de "precisa de você" único `#e2a500`; raio 2px → 3px.
- Cache do último tema: `localStorage['gt-theme']`; leitura/escrita sempre em try/catch.
- IPC novo: `gt:appearance` (send) com `{ scheme: 'light' | 'dark'; follow: boolean; bg: string }`.
- Testes: `rtk proxy npx vitest run --reporter=dot <arquivos>`; `npx tsc --noEmit`; `npx electron-vite build`.
- NÃO tocar no app instalado nem no daemon real. Teste real com `GT_HOME` curto (o socket Unix tem limite de 104 caracteres), ex.: `/tmp/gtt/<nome>`; apagar ao final.
- Commits semânticos em português, uma linha, como o histórico (`feat(temas): …`).

## Review Focus

1. **Configurações antigas sem `appearance` nem `terminalTheme`** (usuário atualizando): app abre no Padrão com o terminal de antes — teste de migração na Task 1.
2. **`localStorage` indisponível ou com JSON quebrado** (primeira abertura, armazenamento limpo): a janela abre no Padrão do CSS sem erro — teste de `readCache` na Task 3.
3. **Trocar a aparência do macOS com o modal de Preferências aberto** no modo automático: o app troca de tema e o modal acompanha — verificação real na Task 6.
4. **"Reduzir movimento" ligado**: as durações efetivas ficam 0 mesmo com tokens gravados inline — teste de `cssVars` na Task 2.
5. **Cor literal nova no `styles.css`** (alguém volta a escrever `#333`): o teste falha apontando a linha — Task 4.

---

## Estrutura de arquivos

- Create `src/renderer/src/app-themes.ts` — tokens (`TOKEN_NAMES`), tipos, temas Padrão e Claro, `resolveTheme`, `cssVars`, `contrast`.
- Create `src/renderer/src/appearance.ts` — aplica o tema no documento, cache, escuta do sistema, aviso ao processo principal.
- Create `src/renderer/src/components/AppearancePanel.tsx` — aba "Aparência".
- Modify `src/shared/settings.ts` — `appearance`, `terminalTheme`, migração, `github-light`.
- Modify `src/renderer/src/themes.ts` — tema de terminal `github-light`.
- Modify `src/renderer/src/terminals.ts` — `applySettings(s, terminal)`.
- Modify `src/renderer/src/main.tsx` — boot usa `applyAppearance`.
- Modify `src/shared/bridge.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/windows.ts`, `src/main/float-model.ts` — IPC `gt:appearance`, `nativeTheme`, fundo das janelas novas.
- Modify `src/renderer/src/styles.css` — só variáveis; `:root` com os valores do Padrão.
- Modify `src/renderer/src/components/FilePane.tsx` — linha ativa do CodeMirror por token.
- Modify `src/renderer/src/components/Preferences.tsx` — aba Aparência; "Acompanhar o tema" no Terminal.
- Tests: `tests/shared/settings.test.ts`, `tests/renderer/themes.test.ts`, `tests/renderer/app-themes.test.ts` (novo), `tests/renderer/appearance.test.ts` (novo), `tests/renderer/styles-tokens.test.ts` (novo), `tests/main/float-model.test.ts`, `tests/daemon/daemon.test.ts`.

---

### Task 1: Configurações de aparência e tema de terminal claro

**Files:**
- Modify: `src/shared/settings.ts:1-62`
- Modify: `src/renderer/src/themes.ts`
- Modify: `src/renderer/src/terminals.ts:37-58`
- Modify: `src/renderer/src/components/Preferences.tsx:40-49`
- Test: `tests/shared/settings.test.ts`, `tests/renderer/themes.test.ts`, `tests/daemon/daemon.test.ts:~395-402`

**Interfaces:**
- Produces: `THEME_IDS` (com `'github-light'`), `ThemeId`, `APP_THEME_IDS = ['padrao', 'claro'] as const`, `AppThemeId`, `Appearance`, `TerminalSettings.appearance`, `TerminalSettings.terminalTheme: 'match' | ThemeId`, `normalizeSettings` com migração.

- [ ] **Step 1: Escrever os testes que falham** — em `tests/shared/settings.test.ts`, substituir o teste que usa `.theme` e acrescentar:

```ts
  it('migração: tema de terminal antigo padrão vira "acompanhar"; outro fica fixado; sem nada → padrões', () => {
    expect(normalizeSettings({ theme: 'vscode-dark' } as never).terminalTheme).toBe('match')
    expect(normalizeSettings({ theme: 'dracula' } as never).terminalTheme).toBe('dracula')
    expect(normalizeSettings({}).terminalTheme).toBe('match')
    expect(normalizeSettings({}).appearance).toEqual({ mode: 'fixed', theme: 'padrao', light: 'claro', dark: 'padrao' })
    expect('theme' in normalizeSettings({ theme: 'dracula' } as never)).toBe(false)
  })
  it('aparência: valores inválidos caem no padrão campo a campo', () => {
    const a = normalizeSettings({ appearance: { mode: 'x', theme: 'claro', light: 'nao-existe', dark: 'claro' } as never }).appearance
    expect(a).toEqual({ mode: 'fixed', theme: 'claro', light: 'claro', dark: 'claro' })
    expect(normalizeSettings({ terminalTheme: 'inexistente' as never }).terminalTheme).toBe('match')
    expect(normalizeSettings({ terminalTheme: 'nord' }).terminalTheme).toBe('nord')
  })
```

E trocar `expect(THEME_IDS).toHaveLength(6)` por `toHaveLength(7)`; remover a linha `expect(normalizeSettings({ theme: 'inexistente' as never }).theme).toBe('vscode-dark')`.

Em `tests/daemon/daemon.test.ts` (~linha 395–402), onde o teste salva `theme: 'dracula'`, trocar para `terminalTheme: 'dracula'` e a espera para `s.settings.terminalTheme === 'dracula'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run --reporter=dot tests/shared/settings.test.ts tests/renderer/themes.test.ts`
Expected: FAIL (`terminalTheme` undefined; THEME_IDS com 6; `github-light` ausente em THEMES).

- [ ] **Step 3: Implementar** — em `src/shared/settings.ts`:

```ts
export const THEME_IDS = ['vscode-dark', 'one-dark', 'dracula', 'solarized-dark', 'github-dark', 'nord', 'github-light'] as const
export type ThemeId = (typeof THEME_IDS)[number]

/** temas do app (cores + estilo visual); ids estáveis, nomes de tela em app-themes.ts */
export const APP_THEME_IDS = ['padrao', 'claro'] as const
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
  // …(campos restantes inalterados)
}

export const DEFAULT_SETTINGS: TerminalSettings = {
  appearance: { mode: 'fixed', theme: 'padrao', light: 'claro', dark: 'padrao' },
  terminalTheme: 'match',
  // …(restantes inalterados)
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
```

Em `normalizeSettings`: trocar a linha `theme: …` por `appearance: normalizeAppearance(v.appearance), terminalTheme: normalizeTerminalTheme(v as Record<string, unknown>),`.

Em `src/renderer/src/themes.ts`, acrescentar:

```ts
  'github-light': { label: 'GitHub Light', xterm: { background: '#ffffff', foreground: '#24292f', cursor: '#0969da', selectionBackground: '#add6ff', black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#4d2d00', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781', brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f' } },
```

Provisório até a Task 3 (só para compilar): em `terminals.ts`, `THEMES[s.theme]` → `THEMES[s.terminalTheme === 'match' ? 'vscode-dark' : s.terminalTheme]` (nas duas ocorrências). Em `Preferences.tsx`, o `<select>` do tema passa a usar `draft.terminalTheme` e `update({ terminalTheme: … })`, com a opção `<option value="match">Acompanhar o tema</option>` primeiro.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot tests/shared/settings.test.ts tests/renderer/themes.test.ts tests/daemon/daemon.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/settings.ts src/renderer/src/themes.ts src/renderer/src/terminals.ts src/renderer/src/components/Preferences.tsx tests/shared/settings.test.ts tests/daemon/daemon.test.ts
git commit -m "feat(temas): configurações de aparência (fixo/automático) e terminal que acompanha o tema; migra o tema antigo; terminal GitHub Light"
```

---

### Task 2: Registro de temas, resolução e contraste

**Files:**
- Create: `src/renderer/src/app-themes.ts`
- Test: `tests/renderer/app-themes.test.ts`

**Interfaces:**
- Consumes: `AppThemeId`, `APP_THEME_IDS`, `ThemeId`, `TerminalSettings` (Task 1).
- Produces:
  - `TOKEN_NAMES` (tupla `as const`), `type TokenName`
  - `interface AppTheme { id: AppThemeId; label: string; scheme: 'light' | 'dark'; terminal: ThemeId; tokens: Record<TokenName, string> }`
  - `APP_THEMES: Record<AppThemeId, AppTheme>`
  - `resolveTheme(s: Pick<TerminalSettings, 'appearance' | 'terminalTheme'>, systemDark: boolean): { app: AppTheme; terminal: ThemeId }`
  - `cssVars(t: AppTheme, o: { reducedMotion: boolean }): Record<string, string>` (chaves `--<token>`)
  - `contrast(a: string, b: string): number` (hex `#rrggbb`)

- [ ] **Step 1: Escrever os testes que falham** — `tests/renderer/app-themes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { APP_THEMES, contrast, cssVars, resolveTheme, TOKEN_NAMES } from '../../src/renderer/src/app-themes'
import { APP_THEME_IDS, DEFAULT_SETTINGS } from '../../src/shared/settings'

const s = (over = {}) => ({ appearance: { ...DEFAULT_SETTINGS.appearance, ...over }, terminalTheme: 'match' as const })

describe('app-themes', () => {
  it('todo tema define exatamente todos os tokens, sem valor vazio', () => {
    expect(Object.keys(APP_THEMES).sort()).toEqual([...APP_THEME_IDS].sort())
    for (const t of Object.values(APP_THEMES)) {
      expect(Object.keys(t.tokens).sort(), t.id).toEqual([...TOKEN_NAMES].sort())
      for (const k of TOKEN_NAMES) expect(t.tokens[k].trim(), `${t.id}.${k}`).not.toBe('')
    }
  })
  it('contraste AA (4,5:1) de fg e fg-dim sobre as superfícies principais, em todo tema', () => {
    for (const t of Object.values(APP_THEMES))
      for (const fg of ['fg', 'fg-dim'] as const)
        for (const bg of ['bg', 'bg-side', 'bg-bar', 'bg-raised'] as const)
          expect(contrast(t.tokens[fg], t.tokens[bg]), `${t.id}: ${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5)
  })
  it('contraste: preto/branco = 21; igual = 1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrast('#777777', '#777777')).toBe(1)
  })
  it('resolução: fixo usa o tema; automático segue o sistema', () => {
    expect(resolveTheme(s({ theme: 'claro' }), true).app.id).toBe('claro')
    expect(resolveTheme(s({ mode: 'auto' }), false).app.id).toBe('claro')
    expect(resolveTheme(s({ mode: 'auto' }), true).app.id).toBe('padrao')
  })
  it('terminal: "match" usa o par do tema; fixado vence', () => {
    expect(resolveTheme(s({ theme: 'claro' }), false).terminal).toBe('github-light')
    expect(resolveTheme(s(), false).terminal).toBe('vscode-dark')
    expect(resolveTheme({ ...s({ theme: 'claro' }), terminalTheme: 'dracula' }, false).terminal).toBe('dracula')
  })
  it('cssVars: --token para cada token; reduzir movimento zera as durações', () => {
    const v = cssVars(APP_THEMES.padrao, { reducedMotion: false })
    expect(Object.keys(v)).toHaveLength(TOKEN_NAMES.length)
    expect(v['--bg']).toBe('#1e1e1e')
    const r = cssVars(APP_THEMES.padrao, { reducedMotion: true })
    expect([r['--dur-fast'], r['--dur-base'], r['--dur-slow']]).toEqual(['0ms', '0ms', '0ms'])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run --reporter=dot tests/renderer/app-themes.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar** — `src/renderer/src/app-themes.ts`:

```ts
import type { AppThemeId, TerminalSettings, ThemeId } from '../../shared/settings'

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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot tests/renderer/app-themes.test.ts`
Expected: PASS (6 testes). Se o AA falhar, ajustar o token apontado na mensagem (não baixar o limite).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/app-themes.ts tests/renderer/app-themes.test.ts
git commit -m "feat(temas): registro de temas tipado (Padrão e Claro), resolução fixo/automático e contraste AA garantido por teste"
```

---

### Task 3: Aplicar o tema em toda janela (sem piscar) e no processo principal

**Files:**
- Create: `src/renderer/src/appearance.ts`
- Modify: `src/renderer/src/terminals.ts:37-60`, `src/renderer/src/main.tsx:60-175`
- Modify: `src/shared/bridge.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/windows.ts:119,175,~294`, `src/main/float-model.ts:43-47`
- Test: `tests/renderer/appearance.test.ts`, `tests/main/float-model.test.ts`

**Interfaces:**
- Consumes: `resolveTheme`, `cssVars`, `APP_THEMES`, `AppTheme` (Task 2); `TerminalSettings` (Task 1).
- Produces:
  - `applyAppearance(s: TerminalSettings): void` — resolve, grava variáveis, `data-theme`, `color-scheme`, terminal, cache e aviso ao principal.
  - `initAppearance(): void` — no boot: aplica o cache de forma síncrona e passa a escutar `prefers-color-scheme` e `prefers-reduced-motion`.
  - `readCache(storage: Pick<Storage, 'getItem'> | null): ThemeCache | null`, `type ThemeCache = { id: string; scheme: 'light' | 'dark'; vars: Record<string, string> }`
  - `terminals.applySettings(s: TerminalSettings, terminal: ThemeId): void`
  - `GtApi.setAppearance(o: { scheme: 'light' | 'dark'; follow: boolean; bg: string }): void`
  - `floatWindowOptions(bounds: Bounds, mac: boolean, bg: string)`

- [ ] **Step 1: Escrever os testes que falham** — `tests/renderer/appearance.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readCache } from '../../src/renderer/src/appearance'

const st = (v: string | null) => ({ getItem: () => v })

describe('appearance', () => {
  it('cache válido volta inteiro', () => {
    const c = { id: 'claro', scheme: 'light', vars: { '--bg': '#ffffff' } }
    expect(readCache(st(JSON.stringify(c)))).toEqual(c)
  })
  it('sem storage, vazio, JSON quebrado ou formato errado → null (fica o Padrão do CSS)', () => {
    expect(readCache(null)).toBeNull()
    expect(readCache(st(null))).toBeNull()
    expect(readCache(st('{quebrado'))).toBeNull()
    expect(readCache(st(JSON.stringify({ id: 'x' })))).toBeNull()
    expect(readCache({ getItem: () => { throw new Error('bloqueado') } })).toBeNull()
  })
})
```

Em `tests/main/float-model.test.ts`: toda chamada `floatWindowOptions(b, x)` ganha o 3º argumento `'#1e1e1e'`, e acrescentar:

```ts
  it('linux: fundo da janela vem do tema (sem retângulo escuro no Claro)', () => {
    expect(floatWindowOptions({ x: 0, y: 0, width: 640, height: 400 }, false, '#ffffff')).toMatchObject({ backgroundColor: '#ffffff' })
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run --reporter=dot tests/renderer/appearance.test.ts tests/main/float-model.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`src/renderer/src/appearance.ts`:

```ts
import type { TerminalSettings } from '../../shared/settings'
import { cssVars, resolveTheme } from './app-themes'
import { terminals } from './terminals'

const KEY = 'gt-theme'
export type ThemeCache = { id: string; scheme: 'light' | 'dark'; vars: Record<string, string> }

const dark = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null
const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
let last: TerminalSettings | null = null

/** cache do último tema: falha de storage ou formato errado = null (fica o Padrão do CSS) */
export function readCache(storage: Pick<Storage, 'getItem'> | null): ThemeCache | null {
  try {
    const raw = storage?.getItem(KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as ThemeCache
    return typeof c?.id === 'string' && (c.scheme === 'light' || c.scheme === 'dark') && c.vars && typeof c.vars === 'object' ? c : null
  } catch {
    return null
  }
}

function paint(c: ThemeCache): void {
  const el = document.documentElement
  for (const [k, v] of Object.entries(c.vars)) el.style.setProperty(k, v)
  el.dataset.theme = c.id
  el.style.colorScheme = c.scheme
}

const storage = (): Storage | null => {
  try {
    return localStorage
  } catch {
    return null
  }
}

/** resolve o tema efetivo e aplica: variáveis, terminal, cache e esquema nativo no processo principal */
export function applyAppearance(s: TerminalSettings): void {
  last = s
  const { app, terminal } = resolveTheme(s, dark?.matches ?? true)
  const c: ThemeCache = { id: app.id, scheme: app.scheme, vars: cssVars(app, { reducedMotion: reduced?.matches ?? false }) }
  paint(c)
  terminals.applySettings(s, terminal)
  try {
    storage()?.setItem(KEY, JSON.stringify(c))
  } catch {
    // sem armazenamento: só não terá o atalho na próxima abertura
  }
  window.gt?.setAppearance({ scheme: app.scheme, follow: s.appearance.mode === 'auto', bg: app.tokens.bg })
}

/** boot: pinta o último tema antes do React montar; reaplica quando o macOS muda aparência ou movimento */
export function initAppearance(): void {
  const c = readCache(storage())
  if (c) paint(c)
  const again = () => last && applyAppearance(last)
  dark?.addEventListener('change', again)
  reduced?.addEventListener('change', again)
}
```

`terminals.ts`: `optionsFor(s)` passa a receber o tema efetivo; guardar `let currentTerminal: ThemeId = 'vscode-dark'`; `applySettings(s, terminal)` faz `currentTerminal = terminal`, grava `--term-bg` com `THEMES[terminal].xterm.background` e reaplica `optionsFor(s, terminal)` nos terminais; `new Terminal(...)` usa `optionsFor(current, currentTerminal)`. Remover o provisório da Task 1.

`main.tsx`: chamar `initAppearance()` na primeira linha do módulo (antes de `bootWorkspace/bootFloat/render`, inclusive na tela de reabrir). Trocar as três chamadas `terminals.applySettings(x)` por `applyAppearance(x)`; nos handlers de `state`, a condição `JSON.stringify(e.state.settings) !== JSON.stringify(prev?.settings)` passa a chamar `applyAppearance(e.state.settings)`.

`bridge.ts` (em `GtApi`):

```ts
  /** esquema claro/escuro do tema efetivo (follow = automático) e fundo para janelas novas */
  setAppearance(o: { scheme: 'light' | 'dark'; follow: boolean; bg: string }): void
```

`preload/index.ts`: `setAppearance: (o) => ipcRenderer.send('gt:appearance', o),`

`main/index.ts` (importar `nativeTheme` de `electron`):

```ts
// tema do app: elementos nativos (rolagem, players, pdf, vidro) no mesmo esquema; janelas novas com o fundo do tema
ipcMain.on('gt:appearance', (_e, o: { scheme: 'light' | 'dark'; follow: boolean; bg: string }) => {
  nativeTheme.themeSource = o.follow ? 'system' : o.scheme
  if (/^#[0-9a-f]{6}$/i.test(o.bg)) manager.background = o.bg
})
```

`windows.ts`: campo público `background = '#1e1e1e'` na `WindowManager`; as duas `backgroundColor: '#1e1e1e'` (linhas ~119 e ~175) viram `backgroundColor: this.background`; `floatWindowOptions(bounds, process.platform === 'darwin')` vira `floatWindowOptions(bounds, process.platform === 'darwin', this.background)`.

`float-model.ts`: `export function floatWindowOptions(bounds: Bounds, mac: boolean, bg: string)`; o ramo não-mac usa `backgroundColor: bg`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot`
Expected: PASS (suíte inteira).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/appearance.ts src/renderer/src/terminals.ts src/renderer/src/main.tsx src/shared/bridge.ts src/preload/index.ts src/main/index.ts src/main/windows.ts src/main/float-model.ts tests/renderer/appearance.test.ts tests/main/float-model.test.ts
git commit -m "feat(temas): aplica o tema em toda janela sem piscar (cache local), segue a aparência do macOS e alinha elementos nativos e fundo das janelas"
```

---

### Task 4: Migrar o CSS para tokens

**Files:**
- Modify: `src/renderer/src/styles.css` (arquivo inteiro)
- Modify: `src/renderer/src/components/FilePane.tsx:36`
- Test: `tests/renderer/styles-tokens.test.ts`

**Interfaces:**
- Consumes: `APP_THEMES.padrao.tokens`, `TOKEN_NAMES` (Task 2).
- Produces: `styles.css` sem cores literais; `:root` = valores do Padrão.

- [ ] **Step 1: Capturas "antes"** (com o build atual, antes de mexer no CSS). Rodar o roteiro do teste real (ver Task 6, script `temas-capturas.cjs`) com o argumento `antes`, que salva `antes-{espaco,prefs,arquivo,flutuante}.png` no scratchpad.

- [ ] **Step 2: Escrever o teste que falha** — `tests/renderer/styles-tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { APP_THEMES, TOKEN_NAMES } from '../../src/renderer/src/app-themes'

const css = readFileSync('src/renderer/src/styles.css', 'utf8')
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
const body = css.slice(css.indexOf('}', css.indexOf(':root {')) + 1)
/** cores que são da mídia, não do tema: fundo de vídeo e de pdf */
const ALLOWED = [/\.media-video video \{[^}]*#000/, /\.media-pdf \{[^}]*#fff/]

describe('styles.css usa só tokens', () => {
  it('sem cor literal fora do :root (exceto as de mídia documentadas)', () => {
    const bad = body
      .split('\n')
      .map((l, i) => ({ l, n: i }))
      .filter(({ l }) => /#[0-9a-f]{3,8}\b|rgba?\(\s*\d/i.test(l) && !ALLOWED.some((re) => re.test(l)))
      .map(({ l }) => l.trim())
    expect(bad).toEqual([])
  })
  it(':root traz exatamente os valores do tema Padrão (primeira pintura sem JS = Padrão)', () => {
    for (const k of TOKEN_NAMES) expect(root, k).toContain(`--${k}: ${APP_THEMES.padrao.tokens[k]};`)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `rtk proxy npx vitest run --reporter=dot tests/renderer/styles-tokens.test.ts`
Expected: FAIL listando as linhas com cor literal.

- [ ] **Step 4: Migrar** — substituir o bloco `:root { … }` por um com **todos** os tokens do Padrão no formato `--<token>: <valor>;` (um por linha, na ordem de `TOKEN_NAMES`), mais `font-family: var(--font-ui); font-size: var(--text-base); color: var(--fg);`. Variáveis antigas renomeadas: `--amber` → `--state-needs-you`; `--project-bg/fg` → `--chip-project-bg/fg`; `--worktree-bg/fg` → `--chip-worktree-bg/fg`. Depois, no resto do arquivo, aplicar esta tabela (todas as ocorrências):

| Literal / atual | Token |
|---|---|
| `#3a3d41` (button, `.ph-worktree`, `.sb-wt-name`, `kbd`) | `var(--bg-control)` |
| `#45494e` | `var(--bg-control-hover)` |
| `#3c3c3c` como fundo (`.tab input`, `.field select`, `.ph-rename`, `.text-input`, `.ws-name-input`) | `var(--bg-input)` |
| `#3c3c3c` como borda (`.modal`, `.palette`) | `var(--border-strong)` |
| `#555` como borda (`.field select`, `.text-input`, `.ws-name-input`, `.sb-session.hidden`, `.sb-add`) | `var(--border-input)` |
| `#555` / `#fff` em `.ph-unknown` | `var(--chip-unknown-bg)` / `var(--chip-unknown-fg)` |
| `#fff` em `button.primary`, `button.danger`, `.pref-tabs button.active` | `var(--fg-on-accent)` |
| `#b3261e` | `var(--danger)` |
| `#fff` em `@keyframes outline-flash` e `wt-flash` | `var(--flash)` |
| `0.7s ease-out` / `0.6s ease-out` | `var(--dur-slow) var(--ease-standard)` |
| `rgba(0, 0, 0, 0.25)` em `.tab.colored` | `var(--border)` |
| `rgba(20, 20, 20, 0.55)` / `0.35)` / `rgba(255, 255, 255, 0.72)` | `var(--tab-colored-dim)` / `var(--tab-colored-dim-hover)` / `var(--tab-colored-fg)` |
| `#4fc1ff` | `var(--link)` |
| `rgba(0, 120, 212, 0.25)` (`.drop-zone`) | `var(--accent-soft)` |
| `box-shadow: 6px 0 18px rgba(0, 0, 0, 0.5)` | `var(--shadow-side)` |
| `box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5)` | `var(--shadow-lg)` |
| `box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4)` | `var(--shadow-sm)` |
| `#04395e` | `var(--bg-selected)` |
| `#007acc22` | `var(--bg-status)` |
| `rgba(0, 0, 0, 0.5)` (`.modal-backdrop`) | `var(--scrim)` |
| `#1b1b1b` | `var(--bg-sunken)` |
| `#2b2f36` (`.account-card.selected`) | `var(--bg-selected)` |
| `#89d185` | `var(--success)` |
| `#f97316` | `var(--conflict)` |
| `#3b82f6` (`.pane.your-turn`, `.tab-dot.your-turn`, `.float-root.your-turn`) | `var(--state-your-turn)` |
| `#eab308` (`.float-root.needs-you`) | `var(--state-needs-you)` |
| `#4b3d10` / `#ffe08a` / `#6b5616` | `var(--banner-warn-bg)` / `var(--banner-warn-fg)` / `var(--banner-warn-border)` |
| `#1e3a24` / `#b5f0c0` | `var(--banner-ok-bg)` / `var(--banner-ok-fg)` |
| `#2a2a2a` / `#222` (xadrez da imagem) | `var(--checker-a)` / `var(--checker-b)` |
| `rgba(255,255,255,0.05)` (`.file-md pre`) | `var(--bg-sunken)` |
| `var(--term-bg, #1e1e1e)` | `var(--term-bg, var(--bg))` |
| `border-radius: 2px` / `3px` / `4px` / `6px` / `8px` | `var(--radius-sm)` / `var(--radius-sm)` / `var(--radius-md)` / `var(--radius-lg)` / `var(--radius-xl)` |
| `font-family: Menlo, monospace` | `var(--font-mono)` |
| `font-size: 9px`, `10px`, `10.5px` | `var(--text-xs)` |
| `font-size: 11px`, `11.5px` | `var(--text-sm)` |
| `font-size: 12px`, `12.5px` | `var(--text-md)` |
| `font-size: 14px`, `15px`, `16px` | `var(--text-lg)` |
| `height: 32px` (`.tabbar`) | `var(--tabbar-height)` |
| `height: 26px` / `line-height: 26px` (`.ph-row1`, `.modal-context`, `.ph-row1 .ph-block`) | `var(--header-height)` |

Fica de fora (mídia, não tema): `.media-video video { background: #000 }` e `.media-pdf { background: #fff }`.

`FilePane.tsx:36`: `backgroundColor: 'rgba(255,255,255,0.04)'` → `backgroundColor: 'var(--bg-hover)'`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot`
Expected: PASS.

- [ ] **Step 6: Capturas "depois" e comparação** — rodar `temas-capturas.cjs depois` e comparar par a par com as de "antes" (abrir as duas imagens). Diferenças aceitas: tamanhos 11→11,5 / 12,5→12 / 14,16→15 px, `fg-dim` um nível, moldura amarela da flutuante, raios 2→3 px. Qualquer outra diferença de cor é bug da tabela: corrigir antes de commitar.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/styles.css src/renderer/src/components/FilePane.tsx tests/renderer/styles-tokens.test.ts
git commit -m "refactor(temas): CSS só com tokens (o :root é o tema Padrão); teste impede cor literal nova"
```

---

### Task 5: Aba "Aparência" nas Preferências

**Files:**
- Create: `src/renderer/src/components/AppearancePanel.tsx`
- Modify: `src/renderer/src/components/Preferences.tsx`
- Modify: `src/renderer/src/styles.css` (estilos dos cartões, só com tokens)

**Interfaces:**
- Consumes: `APP_THEMES`, `cssVars`, `AppTheme` (Task 2); `Appearance`, `AppThemeId`, `TerminalSettings` (Task 1); `THEMES` (themes.ts).
- Produces: `AppearancePanel({ value, onChange }: { value: Appearance; onChange(a: Appearance): void })`.

- [ ] **Step 1: Implementar o painel** — `AppearancePanel.tsx`:

```tsx
import type React from 'react'
import { APP_THEME_IDS, type Appearance, type AppThemeId } from '../../../shared/settings'
import { APP_THEMES, cssVars } from '../app-themes'

/** miniatura desenhada com os tokens reais do tema (variáveis só dentro do cartão) */
function ThemeCard({ id, selected, onPick }: { id: AppThemeId; selected: boolean; onPick(): void }) {
  const t = APP_THEMES[id]
  return (
    <button className={`theme-card${selected ? ' selected' : ''}`} onClick={onPick} aria-pressed={selected}>
      <div className="theme-mini" style={cssVars(t, { reducedMotion: true }) as React.CSSProperties}>
        <div className="tm-side" />
        <div className="tm-main">
          <div className="tm-tabs"><span className="tm-tab on" /><span className="tm-tab" /></div>
          <div className="tm-term"><i /><i /><i className="short" /></div>
        </div>
      </div>
      <span className="theme-name">{t.label}</span>
    </button>
  )
}

function Row({ value, onPick }: { value: AppThemeId; onPick(id: AppThemeId): void }) {
  return (
    <div className="theme-row">
      {APP_THEME_IDS.map((id) => (
        <ThemeCard key={id} id={id} selected={value === id} onPick={() => onPick(id)} />
      ))}
    </div>
  )
}

export function AppearancePanel({ value, onChange }: { value: Appearance; onChange(a: Appearance): void }) {
  return (
    <div className="appearance-panel">
      <div className="seg">
        <button className={value.mode === 'fixed' ? 'active' : ''} onClick={() => onChange({ ...value, mode: 'fixed' })}>Fixo</button>
        <button className={value.mode === 'auto' ? 'active' : ''} onClick={() => onChange({ ...value, mode: 'auto' })}>Automático</button>
      </div>
      {value.mode === 'fixed' ? (
        <Row value={value.theme} onPick={(theme) => onChange({ ...value, theme })} />
      ) : (
        <>
          <div className="field-label">QUANDO O MACOS ESTIVER CLARO</div>
          <Row value={value.light} onPick={(light) => onChange({ ...value, light })} />
          <div className="field-label">QUANDO ESTIVER ESCURO</div>
          <Row value={value.dark} onPick={(dark) => onChange({ ...value, dark })} />
        </>
      )}
    </div>
  )
}
```

`Preferences.tsx`: o estado `tab` ganha `'appearance'` e começa nele; primeiro botão das abas "Aparência"; o conteúdo dessa aba é `<AppearancePanel value={draft.appearance} onChange={(appearance) => update({ appearance })} />`. Na aba Terminal, o `<option value="match">` mostra o par atual: `Acompanhar o tema ({THEMES[APP_THEMES[draft.appearance.theme].terminal].label})` (no automático, usar o par do tema escuro e claro: `Acompanhar o tema`).

CSS (no fim do `styles.css`, só tokens):

```css
/* Preferências → Aparência */
.appearance-panel { display: flex; flex-direction: column; gap: 10px; }
.seg { display: inline-flex; align-self: flex-start; background: var(--bg-sunken); border-radius: var(--radius-lg); padding: 2px; gap: 2px; }
.seg button { background: none; padding: 4px 14px; }
.seg button.active { background: var(--accent); color: var(--fg-on-accent); }
.theme-row { display: flex; flex-wrap: wrap; gap: 12px; }
.theme-card { display: flex; flex-direction: column; gap: 6px; background: none; padding: 0; width: 140px; }
.theme-card:hover { background: none; }
.theme-mini { display: flex; height: 84px; border-radius: var(--radius-xl); overflow: hidden; border: 1px solid var(--border-strong); background: var(--bg); box-shadow: var(--shadow-sm); }
.theme-card.selected .theme-mini { outline: 2px solid var(--accent); outline-offset: 2px; }
.tm-side { width: 28%; background: var(--bg-side); border-right: 1px solid var(--border); }
.tm-main { flex: 1; display: flex; flex-direction: column; }
.tm-tabs { display: flex; gap: 3px; height: 14px; background: var(--bg-bar); padding: 3px 4px 0; }
.tm-tab { width: 26px; border-radius: var(--radius-sm) var(--radius-sm) 0 0; background: var(--bg-control); }
.tm-tab.on { background: var(--bg); box-shadow: inset 0 -2px 0 var(--accent); }
.tm-term { flex: 1; background: var(--term-bg, var(--bg)); padding: 6px; display: flex; flex-direction: column; gap: 4px; }
.tm-term i { display: block; height: 4px; border-radius: var(--radius-sm); background: var(--fg-dim); width: 80%; }
.tm-term i.short { width: 45%; background: var(--accent); }
.theme-name { color: var(--fg); font-size: var(--text-md); text-align: center; }
```

Nota: `--term-bg` dentro do cartão vem do `<html>` (tema atual). Para a miniatura mostrar o terminal do **próprio** tema, o `style` do `.theme-mini` também recebe `'--term-bg': THEMES[t.terminal].xterm.background`.

- [ ] **Step 2: Verificar tipos e testes**

Run: `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot`
Expected: PASS (inclui `styles-tokens`: os estilos novos não têm cor literal).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/AppearancePanel.tsx src/renderer/src/components/Preferences.tsx src/renderer/src/styles.css
git commit -m "feat(temas): aba Aparência nas Preferências (fixo/automático, cartões com miniatura real) e terminal 'Acompanhar o tema'"
```

---

### Task 6: Verificação real no Electron isolado

**Files:**
- Create (scratchpad, fora do repo): `temas-capturas.cjs` (playwright-core já instalado no scratchpad `pw/`)

- [ ] **Step 1: Roteiro** — `temas-capturas.cjs <rótulo> [tema]`: sobe o build (`out/main/index.js`) com `GT_HOME=/tmp/gtt/<rótulo>`, adiciona o projeto do repo, cria 2 sessões e uma flutuante, abre `README.md`; se `[tema]` vier, grava `settings.save` com `appearance.theme` = tema; salva capturas `<rótulo>-espaco.png`, `<rótulo>-prefs.png` (abre Preferências via `gt:menu 'preferences'`), `<rótulo>-arquivo.png`, `<rótulo>-flutuante.png`; fecha e apaga o `GT_HOME`.

- [ ] **Step 2: Padrão vs antes** — `depois` (Task 4) já comparado; repetir após a Task 5 para confirmar a aba nova sem regressão no resto.

- [ ] **Step 3: Claro** — `temas-capturas.cjs claro claro`: conferir nas capturas fundo claro em todas as telas, terminal GitHub Light, etiquetas e estados legíveis, players/PDF/rolagem em esquema claro.

- [ ] **Step 4: Automático** — com `appearance.mode='auto'`, alternar a emulação de esquema da página (`page.emulateMedia({ colorScheme: 'light' | 'dark' })`) e conferir `document.documentElement.dataset.theme` mudar de `claro` para `padrao` sem recarregar; com o modal de Preferências aberto.

- [ ] **Step 5: Sem piscar** — com Claro salvo, fechar e reabrir a janela; capturar a primeira pintura (`page.screenshot` logo após `firstWindow`) e conferir que não está escura (`getComputedStyle(document.body).backgroundColor` ≠ `rgb(30, 30, 30)` no primeiro frame).

- [ ] **Step 6: Suíte e build finais**

Run: `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot && npx electron-vite build`
Expected: tudo PASS; apagar `/tmp/gtt`.
