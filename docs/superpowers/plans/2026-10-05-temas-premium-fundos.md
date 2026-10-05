# Temas premium e fundos (parte 2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Três temas premium (Vidro calmo, Noite afiada, Aurora) com fundo escolhido por tema — gradiente, imagem incluída, imagem do usuário, nenhum ou a mesa do macOS — vidro fosco nas barras, painéis com respiro e cantos, terminais sólidos.

**Architecture:** Os temas novos entram no registro tipado da parte 1 com 5 tokens novos (`app-backdrop`, `surface-blur`, `pane-gap`, `pane-radius`, `pane-shadow`). O fundo escolhido vive em `appearance.backgrounds` (configurações do daemon); o renderer resolve o fundo efetivo, grava `--app-backdrop` e, para imagens e mesa, sobe o vidro para a opacidade segura. O processo principal importa imagens do usuário para `GT_HOME/fundos/` e, no modo mesa, cria as janelas de espaço transparentes com o Liquid Glass, reabrindo-as quando o modo muda.

**Tech Stack:** TypeScript, Electron 44 (`nativeImage`, `dialog`, `electron-liquid-glass`), React 19, CSS `backdrop-filter`, vitest, MCP do Artlist (geração das imagens).

**Spec:** `docs/superpowers/specs/2026-10-05-temas-premium-fundos-design.md`

## Global Constraints

- Ids novos (estáveis): `'vidro' | 'noite' | 'aurora'`; nomes de tela "Vidro calmo", "Noite afiada", "Aurora". `PREMIUM_THEME_IDS = ['vidro', 'noite', 'aurora']`.
- Tokens novos em TODO tema: `app-backdrop`, `surface-blur`, `pane-gap`, `pane-radius`, `pane-shadow`. Padrão/Claro: `app-backdrop` = valor de `bg`, `0px`, `0px`, `0px`, `none`.
- Vidro: `bg-side`, `bg-bar`, `bg-status` dos premium são `rgba(…, 0.55)`; com fundo `image` ou `desktop`, o renderer troca o alfa por `SAFE_GLASS_ALPHA = 0.82`.
- Contraste AA (4,5:1) de `fg` e `fg-dim`: (a) sobre superfícies opacas (hex) como na parte 1; (b) vidro composto sobre cada parada do gradiente do tema e sobre `bg`; (c) vidro seguro composto sobre `#000000` e `#ffffff`.
- `Background = { kind: 'theme' } | { kind: 'none' } | { kind: 'desktop' } | { kind: 'image'; image: string }`; `image` = `bundled:<id>` (ids em `BUNDLED_BACKGROUNDS`) ou `user:<nome>` com nome `^[a-f0-9]{16}\.jpg$`.
- Imagens incluídas: `src/renderer/public/fundos/{vidro,noite,aurora}-{1,2}.jpg`, ~2560 px de largura, ≤ 400 KB.
- Imagens do usuário: `GT_HOME/fundos/<sha256 16 hex>.jpg`, largura ≤ 2560 px, JPEG qualidade 85.
- Mesa do macOS só em `process.platform === 'darwin'`; fora dele o fundo efetivo vira `theme`.
- IPC novos: `gt:backgrounds` (invoke → `{ dir: string; list: string[] }`), `gt:importBackground` (invoke → `string | null`), `gt:removeBackground` (invoke, nome), `gt:reopenWindows` (invoke). `gt:appearance` ganha `desktop: boolean`.
- Mudança de modo mesa pelo usuário → confirmar ("As janelas vão ser reabertas; as sessões continuam."); pelo sistema → aviso na barra de status com botão "Reabrir janelas".
- Padrão e Claro: nenhuma mudança visual (o teste do `:root` e as capturas continuam iguais).
- Testes: `rtk proxy npx vitest run --reporter=dot <arquivos>`; `npx tsc --noEmit`; `npx electron-vite build`. Teste real só com `GT_HOME` curto (`/tmp/gtt/<nome>`), apagado ao final; nunca no app instalado.
- Commits semânticos em português, uma linha.

## Review Focus

1. **Imagem do usuário apagada por fora** (alguém remove o arquivo de `fundos/`): a janela cai no gradiente do tema, sem erro na tela — teste de `backdropCss` com arquivo ausente (Task 4) + checagem real (Task 7).
2. **Configuração vinda de outra máquina/Linux com `desktop`**: no Linux nunca tenta janela transparente — teste de `effectiveBackground` (Task 3).
3. **Reabrir janelas com flutuante aberta e modal aberto**: flutuantes continuam; o espaço volta com o mesmo layout — checagem real (Task 7).
4. **Imagem enorme ou inválida** (HEIC de 48 MP, arquivo corrompido): reduz para 2560 px; inválida é recusada com mensagem — teste de `fitWidth` + checagem real (Tasks 5/7).
5. **Automático alternando entre tema com mesa e sem mesa**: nada fecha sozinho; aparece o aviso — teste de `wantsDesktop` (Task 3) + checagem real (Task 7).

---

## Estrutura de arquivos

- Create `src/main/backgrounds.ts` — import/listagem/remoção das imagens do usuário (`fitWidth`, `userBgName`, `importBackground`, `listBackgrounds`, `removeBackground`).
- Create `src/renderer/src/backdrop.ts` — fundo efetivo em CSS (`backdropCss`) e vidro seguro (`safeGlass`).
- Create `src/renderer/src/components/BackgroundRow.tsx` — fileira "Fundo" da aba Aparência.
- Create `src/renderer/public/fundos/*.jpg` — 6 imagens (Task 1).
- Modify `src/shared/settings.ts` — ids premium, `Background`, `BUNDLED_BACKGROUNDS`, `appearance.backgrounds`, normalização, `effectiveBackground`, `wantsDesktop`.
- Modify `src/renderer/src/app-themes.ts` — tokens novos, três temas, `composite`, `SAFE_GLASS_ALPHA`, `gradientStops`.
- Modify `src/renderer/src/themes.ts` — tema de terminal `noite`.
- Modify `src/renderer/src/appearance.ts`, `src/renderer/src/view.ts`, `src/renderer/src/store.ts`, `src/renderer/src/components/{Workspace,AppearancePanel,StatusBar}.tsx`, `src/renderer/src/styles.css`.
- Modify `src/shared/bridge.ts`, `src/preload/index.ts`, `src/main/index.ts`, `src/main/windows.ts`.
- Tests: `tests/renderer/app-themes.test.ts`, `tests/shared/settings.test.ts`, `tests/renderer/backdrop.test.ts` (novo), `tests/main/backgrounds.test.ts` (novo), `tests/renderer/themes.test.ts`.

---

### Task 1: Imagens incluídas (Artlist) — com aprovação do usuário

**Files:**
- Create: `src/renderer/public/fundos/vidro-1.jpg`, `vidro-2.jpg`, `noite-1.jpg`, `noite-2.jpg`, `aurora-1.jpg`, `aurora-2.jpg`

**Interfaces:**
- Produces: os 6 arquivos com os nomes exatos de `BUNDLED_BACKGROUNDS` (Task 3).

- [ ] **Step 1: Custo e saldo** — carregar as ferramentas do Artlist (`ToolSearch` com `select:mcp__artlist__get_balance,mcp__artlist__list_models,mcp__artlist__get_generation_cost,mcp__artlist__generate_image,mcp__artlist__get_generation_status`), escolher um modelo de imagem que gere 16:9 em alta resolução, consultar `get_generation_cost` para 6 imagens e `get_balance`. **PARAR e mostrar ao usuário custo e saldo; só seguir com o "ok" dele.**

- [ ] **Step 2: Gerar** — 6 imagens 16:9, abstratas, sem texto, sem pessoas, sem logotipo. Prompts:
  - `vidro-1`: "soft abstract pastel gradient of milky blue, warm sand and lavender, gentle frosted glass light, very calm, minimal, high-end macOS wallpaper, no text"
  - `vidro-2`: "abstract translucent glass waves in pale blue and cream, soft diffuse daylight, airy, minimal, premium wallpaper, no text"
  - `noite-1`: "deep midnight navy to near-black abstract gradient with subtle indigo glow at the top left, fine grain, sophisticated, minimal, no text"
  - `noite-2`: "dark abstract aurora of faint indigo and violet light streaks over black, elegant, minimal, premium wallpaper, no text"
  - `aurora-1`: "vibrant abstract gradient of coral, pink, violet and sky blue, smooth flowing shapes, joyful, glossy, premium wallpaper, no text"
  - `aurora-2`: "abstract holographic flowing ribbons in peach, magenta, purple and cyan, soft focus, playful, premium wallpaper, no text"

  Acompanhar com `get_generation_status` até concluir; baixar cada arquivo para o scratchpad.

- [ ] **Step 3: Aprovação** — mostrar as 6 imagens ao usuário (companheiro visual: uma tela com as 6 lado a lado, rótulos com o tema). **PARAR até o "ok"**; refazer as recusadas com o prompt ajustado pelo usuário.

- [ ] **Step 4: Converter** — para cada aprovada: `sips -s format jpeg -s formatOptions 82 --resampleWidth 2560 <origem> --out src/renderer/public/fundos/<nome>.jpg`; se passar de 400 KB, repetir com `formatOptions 72`. Conferir: `ls -la src/renderer/public/fundos` (6 arquivos, cada ≤ 400 KB).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/public/fundos
git commit -m "feat(temas): imagens de fundo incluídas para Vidro calmo, Noite afiada e Aurora (geradas no Artlist)"
```

---

### Task 2: Os três temas premium no registro

**Files:**
- Modify: `src/shared/settings.ts` (APP_THEME_IDS)
- Modify: `src/renderer/src/app-themes.ts`
- Modify: `src/renderer/src/themes.ts`, `src/shared/settings.ts` (THEME_IDS + `'noite'`)
- Test: `tests/renderer/app-themes.test.ts`, `tests/shared/settings.test.ts`, `tests/renderer/themes.test.ts`

**Interfaces:**
- Produces: `APP_THEME_IDS = ['padrao', 'claro', 'vidro', 'noite', 'aurora']`; `PREMIUM_THEME_IDS`; `AppTheme.premium: boolean`; tokens novos; `SAFE_GLASS_ALPHA = 0.82`; `GLASS_TOKENS = ['bg-side', 'bg-bar', 'bg-status']`; `composite(rgba: string, baseHex: string): string`; `gradientStops(css: string): string[]`; terminal `noite`.

- [ ] **Step 1: Testes que falham** — em `tests/renderer/app-themes.test.ts`:
  - trocar o teste de contraste das superfícies para pular valores não-hex: `if (!t.tokens[bg].startsWith('#')) continue`;
  - acrescentar:

```ts
import { composite, gradientStops, GLASS_TOKENS, PREMIUM_THEME_IDS, SAFE_GLASS_ALPHA } from '../../src/renderer/src/app-themes'

  it('composite: rgba sobre uma base vira hex; gradientStops extrai as cores do gradiente', () => {
    expect(composite('rgba(255, 255, 255, 0.5)', '#000000')).toBe('#808080')
    expect(composite('#123456', '#ffffff')).toBe('#123456')
    expect(gradientStops('linear-gradient(135deg, #dfe9f5, #f4efe8 60%, #e9e4f3)')).toEqual(['#dfe9f5', '#f4efe8', '#e9e4f3'])
  })
  it('Padrão e Claro: tokens novos neutros (nada muda neles)', () => {
    for (const id of ['padrao', 'claro'] as const) {
      const t = APP_THEMES[id].tokens
      expect([t['app-backdrop'], t['surface-blur'], t['pane-gap'], t['pane-radius'], t['pane-shadow']]).toEqual([t.bg, '0px', '0px', '0px', 'none'])
      expect(APP_THEMES[id].premium).toBe(false)
    }
  })
  it('premium: vidro legível sobre o gradiente do tema e sobre bg (AA)', () => {
    for (const id of PREMIUM_THEME_IDS) {
      const t = APP_THEMES[id].tokens
      for (const g of GLASS_TOKENS) for (const base of [...gradientStops(t['app-backdrop']), t.bg]) {
        const c = composite(t[g], base)
        expect(contrast(t.fg, c), `${id} ${g} fg sobre ${base}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t['fg-dim'], c), `${id} ${g} fg-dim sobre ${base}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  it('premium: vidro seguro legível sobre qualquer imagem (extremos preto e branco)', () => {
    for (const id of PREMIUM_THEME_IDS) {
      const t = APP_THEMES[id].tokens
      for (const g of GLASS_TOKENS) for (const base of ['#000000', '#ffffff']) {
        const safe = t[g].replace(/[\d.]+\)$/, `${SAFE_GLASS_ALPHA})`)
        const c = composite(safe, base)
        expect(contrast(t.fg, c), `${id} ${g} fg seguro sobre ${base}`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(t['fg-dim'], c), `${id} ${g} fg-dim seguro sobre ${base}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
```

  Em `tests/shared/settings.test.ts`: `expect(THEME_IDS).toHaveLength(8)` (com `noite`). Em `tests/renderer/themes.test.ts` nada muda (já exige todo `THEME_IDS` em `THEMES`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run --reporter=dot tests/renderer/app-themes.test.ts tests/shared/settings.test.ts tests/renderer/themes.test.ts`
Expected: FAIL (exports inexistentes; THEME_IDS com 7).

- [ ] **Step 3: Implementar**

`src/shared/settings.ts`: `THEME_IDS` ganha `'noite'` (8 itens); `APP_THEME_IDS = ['padrao', 'claro', 'vidro', 'noite', 'aurora'] as const`.

`src/renderer/src/themes.ts`, acrescentar:

```ts
  noite: { label: 'Noite', xterm: { background: '#111219', foreground: '#c9cad6', cursor: '#8b95ff', selectionBackground: '#2a2f55', black: '#1c1e2a', red: '#eb5757', green: '#4cb782', yellow: '#f2c94c', blue: '#5e6ad2', magenta: '#b07cff', cyan: '#4ec9d6', white: '#c9cad6', brightBlack: '#5a5d72', brightRed: '#ff7b7b', brightGreen: '#6fd3a0', brightYellow: '#ffd96b', brightBlue: '#8b95ff', brightMagenta: '#c9a2ff', brightCyan: '#7fe0ea', brightWhite: '#f2f2f7' } },
```

`src/renderer/src/app-themes.ts`:
- `TOKEN_NAMES` ganha, no fim: `'app-backdrop', 'surface-blur', 'pane-gap', 'pane-radius', 'pane-shadow'`.
- `AppTheme` ganha `premium: boolean`. Padrão e Claro: `premium: false` e, nos tokens, `'app-backdrop': '<o mesmo valor de bg>', 'surface-blur': '0px', 'pane-gap': '0px', 'pane-radius': '0px', 'pane-shadow': 'none'`.
- Constantes e helpers:

```ts
export const PREMIUM_THEME_IDS = ['vidro', 'noite', 'aurora'] as const
/** superfícies que viram vidro nos temas premium */
export const GLASS_TOKENS = ['bg-side', 'bg-bar', 'bg-status'] as const
/** opacidade do vidro sobre fundos imprevisíveis (imagens, mesa do macOS): legível sobre preto e branco */
export const SAFE_GLASS_ALPHA = 0.82

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
```

- Três temas novos (todos `premium: true`). `PREMIUM_BASE` = `BASE` com `'radius-sm': '6px', 'radius-md': '8px', 'radius-lg': '10px', 'radius-xl': '14px', 'tabbar-height': '34px', 'header-height': '28px'`.

```ts
  vidro: {
    id: 'vidro', label: 'Vidro calmo', scheme: 'light', terminal: 'github-light', premium: true,
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
    id: 'noite', label: 'Noite afiada', scheme: 'dark', terminal: 'noite', premium: true,
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
    id: 'aurora', label: 'Aurora', scheme: 'light', terminal: 'github-light', premium: true,
    tokens: {
      ...PREMIUM_BASE,
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
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot`
Expected: PASS — desde que o `:root` do `styles.css` ganhe, neste passo, as 5 linhas do Padrão na ordem de `TOKEN_NAMES` (`--app-backdrop: #1e1e1e;`, `--surface-blur: 0px;`, `--pane-gap: 0px;`, `--pane-radius: 0px;`, `--pane-shadow: none;`), exigidas pelo teste `styles-tokens`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/settings.ts src/renderer/src/app-themes.ts src/renderer/src/themes.ts src/renderer/src/styles.css tests/renderer/app-themes.test.ts tests/shared/settings.test.ts
git commit -m "feat(temas): temas Vidro calmo, Noite afiada e Aurora; tokens de fundo, vidro e respiro; contraste do vidro garantido sobre o gradiente e sobre qualquer imagem"
```

---

### Task 3: Modelo do fundo por tema

**Files:**
- Modify: `src/shared/settings.ts`
- Test: `tests/shared/settings.test.ts`

**Interfaces:**
- Consumes: `APP_THEME_IDS`, `AppThemeId` (Task 2).
- Produces: `Background`, `BUNDLED_BACKGROUNDS`, `USER_BG_RE`, `Appearance.backgrounds: Partial<Record<AppThemeId, Background>>`, `normalizeBackground(v: unknown): Background`, `effectiveBackground(a: Appearance, theme: AppThemeId, premium: boolean, platform: string): Background`, `wantsDesktop(a: Appearance, theme: AppThemeId, premium: boolean, platform: string): boolean`.

- [ ] **Step 1: Testes que falham** — em `tests/shared/settings.test.ts`:

```ts
import { effectiveBackground, normalizeBackground, wantsDesktop } from '../../src/shared/settings'

  it('fundo: formatos válidos passam; inválidos viram "tema"', () => {
    expect(normalizeBackground({ kind: 'image', image: 'bundled:aurora-1' })).toEqual({ kind: 'image', image: 'bundled:aurora-1' })
    expect(normalizeBackground({ kind: 'image', image: 'user:0123456789abcdef.jpg' })).toEqual({ kind: 'image', image: 'user:0123456789abcdef.jpg' })
    for (const bad of [{ kind: 'image', image: 'bundled:nao-existe' }, { kind: 'image', image: 'user:../../etc/passwd' }, { kind: 'xyz' }, null, 'none'])
      expect(normalizeBackground(bad)).toEqual({ kind: 'theme' })
    expect(normalizeBackground({ kind: 'desktop' })).toEqual({ kind: 'desktop' })
    expect(normalizeSettings({ appearance: { backgrounds: { aurora: { kind: 'none' }, padrao: { kind: 'none' }, inventado: { kind: 'none' } } } as never }).appearance.backgrounds).toEqual({ aurora: { kind: 'none' } })
    expect(normalizeSettings({}).appearance.backgrounds).toEqual({})
  })
  it('fundo efetivo: tema não premium = "tema"; mesa fora do mac = "tema"', () => {
    const a = { ...DEFAULT_SETTINGS.appearance, backgrounds: { noite: { kind: 'desktop' as const } } }
    expect(effectiveBackground(a, 'noite', true, 'darwin')).toEqual({ kind: 'desktop' })
    expect(effectiveBackground(a, 'noite', true, 'linux')).toEqual({ kind: 'theme' })
    expect(effectiveBackground(a, 'padrao', false, 'darwin')).toEqual({ kind: 'theme' })
    expect(effectiveBackground(a, 'aurora', true, 'darwin')).toEqual({ kind: 'theme' })
  })
  it('wantsDesktop: só quando o fundo efetivo é a mesa', () => {
    const a = { ...DEFAULT_SETTINGS.appearance, backgrounds: { vidro: { kind: 'desktop' as const } } }
    expect(wantsDesktop(a, 'vidro', true, 'darwin')).toBe(true)
    expect(wantsDesktop(a, 'noite', true, 'darwin')).toBe(false)
    expect(wantsDesktop(a, 'vidro', true, 'linux')).toBe(false)
  })
```

E o teste existente de padrões: `expect(normalizeSettings({}).appearance).toEqual({ mode: 'fixed', theme: 'padrao', light: 'claro', dark: 'padrao', backgrounds: {} })`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run --reporter=dot tests/shared/settings.test.ts`
Expected: FAIL (funções inexistentes).

- [ ] **Step 3: Implementar** — em `src/shared/settings.ts`:

```ts
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
  const b = premium ? a.backgrounds[theme] ?? { kind: 'theme' } : { kind: 'theme' }
  return b.kind === 'desktop' && platform !== 'darwin' ? { kind: 'theme' } : b
}

export function wantsDesktop(a: Appearance, theme: AppThemeId, premium: boolean, platform: string): boolean {
  return effectiveBackground(a, theme, premium, platform).kind === 'desktop'
}
```

`Appearance` ganha `backgrounds: Partial<Record<AppThemeId, Background>>`; `DEFAULT_SETTINGS.appearance.backgrounds = {}`; em `normalizeAppearance`:

```ts
    backgrounds: Object.fromEntries(
      Object.entries(a.backgrounds && typeof a.backgrounds === 'object' ? (a.backgrounds as Record<string, unknown>) : {})
        .filter(([k]) => PREMIUM.includes(k as AppThemeId))
        .map(([k, v]) => [k, normalizeBackground(v)]),
    ),
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/settings.ts tests/shared/settings.test.ts
git commit -m "feat(temas): fundo por tema nas configurações (tema, nenhum, imagem incluída ou própria, mesa do macOS) com validação"
```

---

### Task 4: Pintar o fundo, o vidro e o respiro

**Files:**
- Create: `src/renderer/src/backdrop.ts`
- Modify: `src/renderer/src/appearance.ts`, `src/renderer/src/view.ts`, `src/renderer/src/components/Workspace.tsx:26`, `src/renderer/src/styles.css`
- Modify: `src/shared/bridge.ts`, `src/preload/index.ts`, `src/main/index.ts` (só o `gt:backgrounds`, para o renderer saber a pasta)
- Test: `tests/renderer/backdrop.test.ts`

**Interfaces:**
- Consumes: `effectiveBackground`, `Background` (Task 3); `APP_THEMES`, `SAFE_GLASS_ALPHA`, `GLASS_TOKENS` (Task 2); `mediaUrl` (`src/shared/media.ts`).
- Produces:
  - `backdropCss(b: Background, t: AppTheme, o: { userDir: string | null; userList: string[]; windowDesktop: boolean }): { css: string; safe: boolean }`
  - `safeGlass(vars: Record<string, string>): Record<string, string>`
  - `WINDOW_DESKTOP: boolean` (view.ts, de `?desktop=1`)
  - `GtApi.backgrounds(): Promise<{ dir: string; list: string[] }>`

- [ ] **Step 1: Testes que falham** — `tests/renderer/backdrop.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { APP_THEMES } from '../../src/renderer/src/app-themes'
import { backdropCss, safeGlass } from '../../src/renderer/src/backdrop'

const o = { userDir: '/Users/u/.gerenciador-terminal/fundos', userList: ['0123456789abcdef.jpg'], windowDesktop: false }
const t = APP_THEMES.aurora

describe('backdrop', () => {
  it('tema = gradiente do tema; nenhum = cor bg; ambos sem vidro seguro', () => {
    expect(backdropCss({ kind: 'theme' }, t, o)).toEqual({ css: t.tokens['app-backdrop'], safe: false })
    expect(backdropCss({ kind: 'none' }, t, o)).toEqual({ css: t.tokens.bg, safe: false })
  })
  it('imagem incluída e do usuário: url com cover sobre bg; vidro seguro', () => {
    expect(backdropCss({ kind: 'image', image: 'bundled:aurora-1' }, t, o)).toEqual({ css: `url("./fundos/aurora-1.jpg") center / cover no-repeat, ${t.tokens.bg}`, safe: true })
    const u = backdropCss({ kind: 'image', image: 'user:0123456789abcdef.jpg' }, t, o)
    expect(u.safe).toBe(true)
    expect(u.css).toMatch(/^url\("gt-file:\/\/local\/Users\/u\/\.gerenciador-terminal\/fundos\/0123456789abcdef\.jpg\?v=0"\) center \/ cover no-repeat, #ffffff$/)
  })
  it('imagem do usuário que sumiu (ou pasta desconhecida) cai no gradiente do tema', () => {
    expect(backdropCss({ kind: 'image', image: 'user:ffffffffffffffff.jpg' }, t, o)).toEqual({ css: t.tokens['app-backdrop'], safe: false })
    expect(backdropCss({ kind: 'image', image: 'user:0123456789abcdef.jpg' }, t, { ...o, userDir: null })).toEqual({ css: t.tokens['app-backdrop'], safe: false })
  })
  it('mesa: transparente só se a janela foi criada transparente; senão o gradiente', () => {
    expect(backdropCss({ kind: 'desktop' }, t, { ...o, windowDesktop: true })).toEqual({ css: 'transparent', safe: true })
    expect(backdropCss({ kind: 'desktop' }, t, o)).toEqual({ css: t.tokens['app-backdrop'], safe: false })
  })
  it('safeGlass: sobe o alfa das superfícies de vidro para 0.82 e não mexe em hex', () => {
    const v = safeGlass({ '--bg-side': 'rgba(255, 255, 255, 0.55)', '--bg-bar': '#252526', '--bg-status': 'rgba(20, 21, 30, 0.55)', '--bg': '#ffffff' })
    expect(v).toEqual({ '--bg-side': 'rgba(255, 255, 255, 0.82)', '--bg-bar': '#252526', '--bg-status': 'rgba(20, 21, 30, 0.82)', '--bg': '#ffffff' })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run --reporter=dot tests/renderer/backdrop.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

`src/renderer/src/backdrop.ts`:

```ts
import type { Background } from '../../shared/settings'
import { mediaUrl } from '../../shared/media'
import { GLASS_TOKENS, SAFE_GLASS_ALPHA, type AppTheme } from './app-themes'

/** valor de --app-backdrop para o fundo efetivo; safe = fundo imprevisível (vidro mais opaco) */
export function backdropCss(b: Background, t: AppTheme, o: { userDir: string | null; userList: string[]; windowDesktop: boolean }): { css: string; safe: boolean } {
  const theme = { css: t.tokens['app-backdrop'], safe: false }
  if (b.kind === 'none') return { css: t.tokens.bg, safe: false }
  if (b.kind === 'desktop') return o.windowDesktop ? { css: 'transparent', safe: true } : theme
  if (b.kind === 'image') {
    const [src, name] = b.image.split(':')
    if (src === 'bundled') return { css: `url("./fundos/${name}.jpg") center / cover no-repeat, ${t.tokens.bg}`, safe: true }
    if (o.userDir && o.userList.includes(name)) return { css: `url("${mediaUrl(`${o.userDir}/${name}`, 0)}") center / cover no-repeat, ${t.tokens.bg}`, safe: true }
  }
  return theme
}

/** vidro sobre fundo imprevisível: alfa das superfícies de vidro sobe para o seguro */
export function safeGlass(vars: Record<string, string>): Record<string, string> {
  const out = { ...vars }
  for (const k of GLASS_TOKENS) {
    const v = out[`--${k}`]
    if (v?.startsWith('rgba(')) out[`--${k}`] = v.replace(/[\d.]+\)$/, `${SAFE_GLASS_ALPHA})`)
  }
  return out
}
```

`view.ts`: `export const WINDOW_DESKTOP = q.get('desktop') === '1'`.

`bridge.ts` (`GtApi`): `backgrounds(): Promise<{ dir: string; list: string[] }>`; `preload`: `backgrounds: () => ipcRenderer.invoke('gt:backgrounds')`; `main/index.ts`:

```ts
ipcMain.handle('gt:backgrounds', () => listBackgrounds(path.join(home, 'fundos')))
```

(com `listBackgrounds` da Task 5 — nesta task, criar `src/main/backgrounds.ts` só com ela:)

```ts
import fs from 'node:fs'
import { USER_BG_RE } from '../shared/settings'

/** imagens do usuário já importadas (nomes válidos, mais novas primeiro) */
export function listBackgrounds(dir: string): { dir: string; list: string[] } {
  try {
    const list = fs.readdirSync(dir).filter((n) => USER_BG_RE.test(n))
    list.sort((a, b) => fs.statSync(`${dir}/${b}`).mtimeMs - fs.statSync(`${dir}/${a}`).mtimeMs)
    return { dir, list }
  } catch {
    return { dir, list: [] }
  }
}
```

`appearance.ts`: guardar `let userBg: { dir: string | null; list: string[] } = { dir: null, list: [] }`, carregado uma vez no `initAppearance` (`window.gt?.backgrounds().then((r) => { userBg = r; again() })`) e exportar `refreshBackgrounds()` que recarrega e reaplica. Em `applyAppearance`, depois de resolver o tema:

```ts
  const bg = effectiveBackground(s.appearance, app.id, app.premium, window.gt?.platform ?? 'darwin')
  const bd = backdropCss(bg, app, { userDir: userBg.dir, userList: userBg.list, windowDesktop: WINDOW_DESKTOP })
  let vars = cssVars(app, { reducedMotion: reduced?.matches ?? false })
  vars['--app-backdrop'] = bd.css
  if (bd.safe) vars = safeGlass(vars)
```

e `setAppearance({ …, desktop: wantsDesktop(s.appearance, app.id, app.premium, window.gt?.platform ?? 'darwin') })` (o campo `desktop` entra no tipo do `setAppearance` em `bridge.ts`/`preload`; o processo principal o usa na Task 6).

`Workspace.tsx` (folha da grade): envolver o painel —

```tsx
  if (node.type === 'leaf')
    return <div className="pane-slot">{isFilePane(node.paneId) ? <FilePane paneId={node.paneId} /> : <PaneFrame paneId={node.paneId} onAddProject={addProject} />}</div>
```

`styles.css`:
- `html, body, #root { …; background: var(--app-backdrop); }` (no lugar de `var(--bg)`).
- Acrescentar:

```css
/* temas premium: vidro sobre o fundo, painéis com respiro e cantos (no Padrão/Claro tudo vale 0) */
.sidebar, .tabbar, .statusbar, .tabbar > .tab-add { backdrop-filter: blur(var(--surface-blur)) saturate(1.4); }
.tab-body { padding: calc(var(--pane-gap) / 2); }
.pane-slot { height: 100%; padding: calc(var(--pane-gap) / 2); }
.pane-slot > .pane { border-radius: var(--pane-radius); box-shadow: var(--pane-shadow); overflow: hidden; background: var(--bg); }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot`
Expected: PASS (inclusive `styles-tokens`: nada de cor literal nova; `:root` = Padrão com os 5 tokens).

- [ ] **Step 5: Conferir Padrão sem mudança** — `node <scratchpad>/pw/temas-capturas.cjs padrao-2a` e comparar lado a lado com `depois-espaco.png`/`depois-prefs.png` da parte 1: idênticos (respiro 0, sem sombra, sem fundo).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/backdrop.ts src/renderer/src/appearance.ts src/renderer/src/view.ts src/renderer/src/components/Workspace.tsx src/renderer/src/styles.css src/shared/bridge.ts src/preload/index.ts src/main/index.ts src/main/backgrounds.ts tests/renderer/backdrop.test.ts
git commit -m "feat(temas): pinta o fundo do tema (gradiente, imagem ou nenhum) com vidro fosco nas barras e respiro com cantos nos painéis; vidro mais opaco sobre imagens"
```

---

### Task 5: Imagens do usuário (importar e remover)

**Files:**
- Modify: `src/main/backgrounds.ts`, `src/main/index.ts`, `src/shared/bridge.ts`, `src/preload/index.ts`
- Test: `tests/main/backgrounds.test.ts`

**Interfaces:**
- Consumes: `USER_BG_RE` (Task 3), `listBackgrounds` (Task 4).
- Produces: `fitWidth(w: number, h: number, max?: number): { width: number; height: number }`; `userBgName(jpeg: Buffer): string`; `removeBackground(dir: string, name: string): boolean`; `GtApi.importBackground(): Promise<string | null>`; `GtApi.removeBackground(name: string): Promise<void>`.

- [ ] **Step 1: Testes que falham** — `tests/main/backgrounds.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fitWidth, listBackgrounds, removeBackground, userBgName } from '../../src/main/backgrounds'

describe('imagens de fundo do usuário', () => {
  it('fitWidth: reduz mantendo a proporção; menor que o limite fica como está', () => {
    expect(fitWidth(8064, 6048)).toEqual({ width: 2560, height: 1920 })
    expect(fitWidth(1920, 1080)).toEqual({ width: 1920, height: 1080 })
  })
  it('nome = 16 hex do sha256 do conteúdo (a mesma imagem não duplica)', () => {
    const a = userBgName(Buffer.from('x')), b = userBgName(Buffer.from('x'))
    expect(a).toMatch(/^[a-f0-9]{16}\.jpg$/)
    expect(a).toBe(b)
    expect(userBgName(Buffer.from('y'))).not.toBe(a)
  })
  it('listar ignora nomes fora do formato; remover só apaga nome válido', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-fundos-'))
    fs.writeFileSync(path.join(dir, '0123456789abcdef.jpg'), 'a')
    fs.writeFileSync(path.join(dir, 'outra.png'), 'b')
    expect(listBackgrounds(dir).list).toEqual(['0123456789abcdef.jpg'])
    expect(removeBackground(dir, '../outra.png')).toBe(false)
    expect(removeBackground(dir, '0123456789abcdef.jpg')).toBe(true)
    expect(listBackgrounds(dir).list).toEqual([])
    expect(listBackgrounds(path.join(dir, 'nao-existe')).list).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run --reporter=dot tests/main/backgrounds.test.ts`
Expected: FAIL (exports inexistentes).

- [ ] **Step 3: Implementar** — em `src/main/backgrounds.ts`:

```ts
import { createHash } from 'node:crypto'

const MAX_WIDTH = 2560

export function fitWidth(w: number, h: number, max = MAX_WIDTH): { width: number; height: number } {
  return w <= max ? { width: w, height: h } : { width: max, height: Math.round((h * max) / w) }
}

export function userBgName(jpeg: Buffer): string {
  return createHash('sha256').update(jpeg).digest('hex').slice(0, 16) + '.jpg'
}

export function removeBackground(dir: string, name: string): boolean {
  if (!USER_BG_RE.test(name)) return false
  try {
    fs.unlinkSync(`${dir}/${name}`)
    return true
  } catch {
    return false
  }
}
```

Em `src/main/index.ts` (importar `nativeImage` de `electron`):

```ts
// fundo do usuário: copia e reduz para GT_HOME/fundos (o original pode sumir sem afetar o app)
ipcMain.handle('gt:importBackground', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
  const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'heic'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  const img = nativeImage.createFromPath(r.filePaths[0])
  if (img.isEmpty()) throw new Error('Não foi possível ler essa imagem.')
  const { width, height } = img.getSize()
  const jpeg = img.resize(fitWidth(width, height)).toJPEG(85)
  const dir = path.join(home, 'fundos')
  fs.mkdirSync(dir, { recursive: true })
  const name = userBgName(jpeg)
  fs.writeFileSync(path.join(dir, name), jpeg)
  return name
})
ipcMain.handle('gt:removeBackground', (_e, name: string) => void removeBackground(path.join(home, 'fundos'), name))
```

(`import fs from 'node:fs'` se ainda não houver.) `bridge.ts`: `importBackground(): Promise<string | null>`, `removeBackground(name: string): Promise<void>`; `preload`: `importBackground: () => ipcRenderer.invoke('gt:importBackground')`, `removeBackground: (name) => ipcRenderer.invoke('gt:removeBackground', name)`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/backgrounds.ts src/main/index.ts src/shared/bridge.ts src/preload/index.ts tests/main/backgrounds.test.ts
git commit -m "feat(temas): importa imagem do usuário como fundo (cópia reduzida em GT_HOME/fundos, sem duplicar) e permite remover"
```

---

### Task 6: Mesa do macOS (janelas transparentes) e reabertura

**Files:**
- Modify: `src/main/windows.ts`, `src/main/index.ts`, `src/main/window-bg.ts`
- Modify: `src/shared/bridge.ts`, `src/preload/index.ts`
- Test: `tests/main/window-bg.test.ts`

**Interfaces:**
- Consumes: `applyGlass` (`src/main/glass.ts`), `setAppearance({ …, desktop })` (Task 4).
- Produces: `readWindowDesktop(file): boolean`, `writeWindowDesktop(file, v: boolean)`; `WindowManager.desktop: boolean`; `WindowManager.reopenAll(): Promise<void>`; `GtApi.reopenWindows(): Promise<void>`.

- [ ] **Step 1: Testes que falham** — em `tests/main/window-bg.test.ts`:

```ts
import { readWindowDesktop, writeWindowDesktop } from '../../src/main/window-bg'

  it('modo mesa lembrado entre aberturas; sem arquivo ou lixo = opaco', () => {
    const f = tmp()
    expect(readWindowDesktop(f)).toBe(false)
    writeWindowDesktop(f, true)
    expect(readWindowDesktop(f)).toBe(true)
    fs.writeFileSync(f, 'talvez')
    expect(readWindowDesktop(f)).toBe(false)
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `rtk proxy npx vitest run --reporter=dot tests/main/window-bg.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`window-bg.ts`:

```ts
/** janela de espaço transparente (fundo "mesa do macOS"): lembrado para a primeira janela da abertura */
export function readWindowDesktop(file: string): boolean {
  try {
    return fs.readFileSync(file, 'utf8').trim() === '1'
  } catch {
    return false
  }
}

export function writeWindowDesktop(file: string, v: boolean): void {
  try {
    fs.writeFileSync(file, v ? '1' : '0')
  } catch {
    // sem gravar: a próxima abertura nasce opaca
  }
}
```

`windows.ts`:
- campo `desktop = false` (doc: "janelas de espaço novas nascem transparentes com Liquid Glass (fundo mesa do macOS)");
- em `open(id)`, o `new BrowserWindow({...})` passa a espalhar `...(this.desktop && process.platform === 'darwin' ? { transparent: true, backgroundColor: '#00000000' } : { backgroundColor: this.background })` no lugar de `backgroundColor: this.background`; depois de criar, se transparente:

```ts
    if (this.desktop && process.platform === 'darwin') {
      win.webContents.once('did-finish-load', () => {
        if (!win.isDestroyed() && !applyGlass(win, () => require('electron-liquid-glass') as GlassLib)) win.setVibrancy('under-window')
      })
    }
```

- `this.load(win, { ws: id })` → `this.load(win, { ws: id, desktop: this.desktop && process.platform === 'darwin' ? '1' : '0' })`;
- novo método:

```ts
  /** fundo mudou entre opaco e mesa do macOS: fecha e reabre as janelas de espaço (sessões e layout vêm do daemon) */
  async reopenAll(): Promise<void> {
    const ids = [...this.entries.keys()]
    await Promise.all(
      ids.map(
        (id) =>
          new Promise<void>((done) => {
            const e = this.entries.get(id)
            if (!e || e.win.isDestroyed()) return done()
            e.closing = true
            e.win.once('closed', () => done())
            e.win.close()
          }),
      ),
    )
    for (const id of ids) await this.open(id)
  }
```

`index.ts`:
- `const windowDesktopFile = path.join(home, 'window-desktop')`; `manager.desktop = readWindowDesktop(windowDesktopFile)` logo após o `readWindowBg`;
- no `gt:appearance`, o tipo ganha `desktop: boolean` e: `if (o.desktop !== manager.desktop) { manager.desktop = o.desktop; writeWindowDesktop(windowDesktopFile, o.desktop) }` (só muda janelas **novas**);
- `ipcMain.handle('gt:reopenWindows', () => manager.reopenAll())`.

`bridge.ts`/`preload`: `reopenWindows(): Promise<void>` → `ipcRenderer.invoke('gt:reopenWindows')`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/window-bg.ts src/main/windows.ts src/main/index.ts src/shared/bridge.ts src/preload/index.ts tests/main/window-bg.test.ts
git commit -m "feat(temas): fundo 'mesa do macOS' — janelas de espaço transparentes com Liquid Glass, modo lembrado e reabertura das janelas"
```

---

### Task 7: Fileira "Fundo", avisos de reabertura e verificação real

**Files:**
- Create: `src/renderer/src/components/BackgroundRow.tsx`
- Modify: `src/renderer/src/components/AppearancePanel.tsx`, `src/renderer/src/components/StatusBar.tsx`, `src/renderer/src/store.ts`, `src/renderer/src/appearance.ts`, `src/renderer/src/styles.css`
- Test: real (Electron isolado)

**Interfaces:**
- Consumes: tudo das Tasks 2–6.
- Produces: `UiState.desktopMismatch: boolean`; `BackgroundRow({ theme, value, onChange })`.

- [ ] **Step 1: Aviso de reabertura** — `store.ts`: `UiState` ganha `desktopMismatch: boolean` (inicial `false`). `appearance.ts`, no fim de `applyAppearance` (só em janela de espaço: `!FLOAT_PANE && VIEW !== 'reopen'`): `setUi({ desktopMismatch: wantsDesktop(...) !== WINDOW_DESKTOP })`. `StatusBar.tsx`: quando `desktopMismatch`, um item `st-item warn`: "O fundo mudou" + `<button className="st-btn" onClick={() => void window.gt.reopenWindows()}>Reabrir janelas</button>`.

- [ ] **Step 2: Fileira "Fundo"** — `BackgroundRow.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { BUNDLED_BACKGROUNDS, type AppThemeId, type Background } from '../../../shared/settings'
import { mediaUrl } from '../../../shared/media'
import { APP_THEMES } from '../app-themes'
import { refreshBackgrounds } from '../appearance'
import { showError } from '../store'

const same = (a: Background, b: Background) => JSON.stringify(a) === JSON.stringify(b)

/** fundos do tema premium: tema, nenhum, as 2 incluídas, as do usuário, escolher imagem, mesa do macOS */
export function BackgroundRow({ theme, value, onChange }: { theme: AppThemeId; value: Background; onChange(b: Background): void }) {
  const t = APP_THEMES[theme]
  const [user, setUser] = useState<{ dir: string; list: string[] }>({ dir: '', list: [] })
  const load = () => window.gt.backgrounds().then(setUser).catch(showError)
  useEffect(() => void load(), [])
  const opts: { b: Background; label: string; style: React.CSSProperties; user?: string }[] = [
    { b: { kind: 'theme' }, label: 'Tema', style: { background: t.tokens['app-backdrop'] } },
    { b: { kind: 'none' }, label: 'Nenhum', style: { background: t.tokens.bg } },
    ...BUNDLED_BACKGROUNDS.filter((id) => id.startsWith(theme)).map((id) => ({ b: { kind: 'image', image: `bundled:${id}` } as Background, label: id.endsWith('1') ? 'Imagem 1' : 'Imagem 2', style: { background: `url("./fundos/${id}.jpg") center / cover` } })),
    ...user.list.map((n) => ({ b: { kind: 'image', image: `user:${n}` } as Background, label: 'Sua imagem', user: n, style: { background: `url("${mediaUrl(`${user.dir}/${n}`, 0)}") center / cover` } })),
  ]
  return (
    <div className="bg-row">
      {opts.map((o) => (
        <div key={JSON.stringify(o.b)} className={`bg-opt${same(o.b, value) ? ' selected' : ''}`}>
          <button className="bg-thumb" style={o.style} title={o.label} onClick={() => onChange(o.b)} />
          {o.user && (
            <button className="bg-x" title="Remover imagem" onClick={async () => {
              await window.gt.removeBackground(o.user!).catch(showError)
              if (same(o.b, value)) onChange({ kind: 'theme' })
              await load()
              refreshBackgrounds()
            }}>✕</button>
          )}
          <span>{o.label}</span>
        </div>
      ))}
      <div className="bg-opt">
        <button className="bg-thumb bg-add" title="Escolher imagem…" onClick={async () => {
          const name = await window.gt.importBackground().catch((e) => (showError(e), null))
          if (!name) return
          await load()
          refreshBackgrounds()
          onChange({ kind: 'image', image: `user:${name}` })
        }}>＋</button>
        <span>Escolher imagem…</span>
      </div>
      {window.gt.platform === 'darwin' && (
        <div className={`bg-opt${value.kind === 'desktop' ? ' selected' : ''}`}>
          <button className="bg-thumb bg-desktop" title="Mesa do macOS (vidro sobre a sua área de trabalho)" onClick={() => onChange({ kind: 'desktop' })}>◎</button>
          <span>Mesa do macOS</span>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Ligar no painel com confirmação** — `AppearancePanel.tsx`: abaixo de cada `Row` cujo tema selecionado for premium, `<div className="field-label">FUNDO</div><BackgroundRow theme={…} value={value.backgrounds[…] ?? { kind: 'theme' }} onChange={(b) => pick({ ...value, backgrounds: { ...value.backgrounds, [id]: b } })} />`. A função `pick(next)` (usada também pelos cartões e pelo Fixo/Automático) faz:

```tsx
  const pick = async (next: Appearance) => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    const id = next.mode === 'auto' ? (dark ? next.dark : next.light) : next.theme
    const want = wantsDesktop(next, id, APP_THEMES[id].premium, window.gt.platform)
    if (want !== WINDOW_DESKTOP && !FLOAT_PANE) {
      const r = await window.gt.confirm({ message: 'As janelas vão ser reabertas para aplicar o fundo.', detail: 'As sessões continuam rodando.', confirmLabel: 'Reabrir' })
      if (!r.ok) return
      onChange(next)
      await window.gt.reopenWindows()
      return
    }
    onChange(next)
  }
```

(`onChange` grava as configurações — via `update` das Preferências — e o `gt:appearance` resultante atualiza `manager.desktop` antes do `reopenWindows`; para garantir a ordem, `reopenWindows` só é chamado depois de um `await new Promise((r) => setTimeout(r, 150))`.) A miniatura do cartão do tema (`ThemeCard`) usa o fundo escolhido: passar `'--app-backdrop'` com `backdropCss(...)` para o `style` do `.theme-mini` e trocar seu `background` por `var(--app-backdrop)`.

CSS (só tokens):

```css
.bg-row { display: flex; flex-wrap: wrap; gap: 10px; }
.bg-opt { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--fg-dim); }
.bg-thumb { width: 64px; height: 40px; padding: 0; border-radius: var(--radius-md); border: 1px solid var(--border-strong); background-size: cover; }
.bg-opt.selected .bg-thumb { outline: 2px solid var(--accent); outline-offset: 2px; }
.bg-add, .bg-desktop { display: grid; place-items: center; background: var(--bg-sunken); color: var(--fg-dim); font-size: var(--text-lg); }
.bg-x { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; padding: 0; border-radius: 50%; font-size: var(--text-xs); }
```

- [ ] **Step 4: Tipos e testes**

Run: `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot && npx electron-vite build`
Expected: PASS.

- [ ] **Step 5: Verificação real** (`temas-capturas.cjs` com `HOLD`, `GT_HOME=/tmp/gtt/<nome>`; capturas no scratchpad):
  1. Cada premium com fundo "Tema": espaço + Preferências; barra lateral e abas com vidro sobre o gradiente; painéis com respiro e cantos; terminal sólido.
  2. Aurora com "Imagem 1": imagem atrás; `getComputedStyle(document.querySelector('.sidebar')).backgroundColor` com alfa 0.82.
  3. Imagem do usuário: copiar uma imagem grande (ex. 4000×3000 gerada com `ffmpeg -f lavfi -i testsrc2=size=4000x3000 -frames:v 1`) chamando o IPC de importação com o diálogo substituído no teste (`app.evaluate` trocando `dialog.showOpenDialog` por um stub que devolve o caminho); conferir arquivo em `/tmp/gtt/<nome>/fundos/*.jpg` com largura 2560 e o fundo aplicado; apagar o arquivo por fora e reaplicar → cai no gradiente.
  4. "Nenhum": `--app-backdrop` = `bg`.
  5. Mesa do macOS: escolher → confirmação → janelas reabertas com `?desktop=1`; `BrowserWindow` transparente; layout e sessões iguais; flutuante continua. Voltar para "Tema" → reabre opaca.
  6. Automático (light=vidro com mesa, dark=noite com tema): `emulateMedia` claro/escuro → nada fecha; aparece "O fundo mudou · Reabrir janelas".
  7. Padrão e Claro iguais às capturas da parte 1.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/BackgroundRow.tsx src/renderer/src/components/AppearancePanel.tsx src/renderer/src/components/StatusBar.tsx src/renderer/src/store.ts src/renderer/src/appearance.ts src/renderer/src/styles.css
git commit -m "feat(temas): fileira 'Fundo' na aba Aparência (tema, nenhum, imagens, sua imagem, mesa do macOS) com confirmação e aviso de reabrir janelas"
```
