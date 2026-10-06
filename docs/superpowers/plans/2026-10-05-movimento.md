# Movimento (parte 2b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Movimento com personalidade por tema (sutil, calmo, preciso, vivo): modais com zoom da origem e materializar, listas em cascata, pílula da aba e seleção da lateral deslizando, painéis entrando/saindo, ilha dinâmica para "precisa de você" e toque responsivo — interrompível, com "reduzir movimento" e funcionando no Linux.

**Architecture:** Cada tema declara uma personalidade; `motion-presets.ts` a traduz em transições da biblioteca Motion (molas/tweens + variantes reduzidas). Componentes pedem o preset via `useMotionPreset()`. Modais passam por uma moldura comum (`ModalFrame`) sob um `AnimatePresence` central. Toque é CSS com os tokens de movimento. O processo principal informa se há composição por GPU; sem ela, não há desfoque animado.

**Tech Stack:** TypeScript, React 19, `motion` (motion/react), Electron 44, CSS, vitest.

**Spec:** `docs/superpowers/specs/2026-10-05-movimento-design.md`

## Global Constraints

- Personalidades: `'subtle'` (Padrão, Claro), `'calm'` (vidro), `'crisp'` (noite), `'lively'` (aurora).
- Entrada: subtle = tween 150 ms `[0.2, 0, 0, 1]`; calm = spring `bounce 0`, `visualDuration 0.45`; crisp = spring `bounce 0`, `visualDuration 0.25`; lively = spring `bounce 0.15`, `visualDuration 0.4`.
- Saída: subtle 120 ms, calm 160 ms, crisp 140 ms, lively 160 ms, todas `ease [0.4, 0, 1, 1]`.
- Reduzido (`prefers-reduced-motion`): entrada e saída = tween 120 ms só de opacidade; nada escala, desliza ou desfoca.
- Materializar (desfoque 12 px → 0): só personalidade ≠ subtle, com GPU, sem reduzir movimento.
- Origem do zoom: ponto do último `pointerdown` se até 400 ms antes de abrir; senão topo-centro (`50% 0%`).
- Cascata: até 8 itens, 35 ms entre eles, só na primeira renderização da lista (filtrar não refaz).
- Ilha: só `needs-you`; 2,5 s visível; fila sem repetir a mesma sessão já na fila.
- Toque: `:active` escala 0.97; em reduzir movimento, nenhuma escala.
- Animar só `transform`, `opacity` e (materializar) `filter`. Nunca tamanho de painel/divisão.
- Nada pode chamar `pane.resize` por causa de animação (o xterm mede `offsetWidth/Height`, que ignoram `transform`).
- `styles.css` continua só com tokens (o teste `styles-tokens` vale).
- Testes: `rtk proxy npx vitest run --reporter=dot`; `npx tsc --noEmit`; `npx electron-vite build`. Teste real só com `GT_HOME=/tmp/gtt/<nome>`; nunca no app instalado.
- Commits semânticos em português, uma linha.

## Review Focus

1. **Fechar um modal e abrir outro em seguida** (⌘, depois ⌘K rápido): a saída do primeiro não pode bloquear nem "piscar" o segundo — `AnimatePresence` com `key` por tipo; checagem real (Task 8).
2. **Fechar painel com ⌘W várias vezes rápido**: cada saída anima e remove o painel certo; nada fica órfão na grade — teste de `animateOut` sem elemento (Task 5) + checagem real (Task 8).
3. **Muitas sessões ficando 🟡 ao mesmo tempo**: a ilha mostra uma por vez, sem duplicar — teste da fila (Task 6).
4. **Linux sem GPU / reduzir movimento**: nada de desfoque animado nem escala — testes de `presetsFor` (Task 1) + checagem com mídia emulada (Task 8).
5. **Troca de aba**: painéis não "crescem" ao trocar de aba — teste de `shouldAnimateEnter` (Task 5).

---

## Estrutura de arquivos

- Create `src/renderer/src/motion-presets.ts` — personalidade → transições e variantes; decisão de materializar.
- Create `src/renderer/src/use-motion.ts` — hook `useMotionPreset()` (store + reduzir movimento + GPU).
- Create `src/renderer/src/pointer.ts` — último `pointerdown`; `originFor()`.
- Create `src/renderer/src/components/ModalFrame.tsx` — moldura animada dos modais.
- Create `src/renderer/src/pane-motion.ts` — `shouldAnimateEnter()`, `animateOut()`.
- Create `src/renderer/src/island-queue.ts` + `src/renderer/src/components/AttentionIsland.tsx`.
- Modify `app-themes.ts` (campo `motion`, `ease-spring` neutro no Padrão/Claro), `store.ts` (`motion`), `appearance.ts`, `view.ts` (`GPU_OK`), `main/windows.ts` (query `gpu`), `Modals.tsx` + 8 modais, `Palette.tsx`, `FilePicker.tsx`, `ConversationsModal.tsx`, `Workspace.tsx`, `Sidebar.tsx`, `PaneHeader.tsx`, `actions.ts`, `main.tsx`, `App.tsx`, `styles.css`, `package.json`.
- Tests: `tests/renderer/motion-presets.test.ts`, `tests/renderer/pointer.test.ts`, `tests/renderer/pane-motion.test.ts`, `tests/renderer/island-queue.test.ts`, `tests/renderer/app-themes.test.ts`.

---

### Task 1: Dependência, personalidades e presets

**Files:**
- Modify: `package.json` (dependência `motion`)
- Create: `src/renderer/src/motion-presets.ts`, `src/renderer/src/use-motion.ts`
- Modify: `src/renderer/src/app-themes.ts`, `src/renderer/src/store.ts`, `src/renderer/src/appearance.ts`, `src/renderer/src/view.ts`, `src/main/windows.ts`, `src/renderer/src/styles.css` (`:root` — `--ease-spring` do Padrão)
- Test: `tests/renderer/motion-presets.test.ts`, `tests/renderer/app-themes.test.ts`

**Interfaces:**
- Produces:
  - `type MotionPersonality = 'subtle' | 'calm' | 'crisp' | 'lively'`; `AppTheme.motion: MotionPersonality`
  - `interface MotionPreset { enter: Transition; exit: Transition; reduced: boolean; materialize: boolean; scaleFrom: number }`
  - `presetsFor(p: MotionPersonality, o: { reduced: boolean; gpu: boolean }): MotionPreset`
  - `UiState.motion: MotionPersonality` (inicial `'subtle'`)
  - `useMotionPreset(): MotionPreset`
  - `GPU_OK: boolean` (view.ts, de `?gpu=0`)

- [ ] **Step 1: Instalar** — `npm i motion@^12` (dependência normal; roda em Chromium de qualquer SO). Conferir `node -e "require('motion')"` sem erro.

- [ ] **Step 2: Testes que falham** — `tests/renderer/motion-presets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { presetsFor } from '../../src/renderer/src/motion-presets'

describe('motion-presets', () => {
  it('sutil: tween curto, sem mola nem materializar', () => {
    const p = presetsFor('subtle', { reduced: false, gpu: true })
    expect(p.enter).toEqual({ duration: 0.15, ease: [0.2, 0, 0, 1] })
    expect(p.exit).toEqual({ duration: 0.12, ease: [0.4, 0, 1, 1] })
    expect(p.materialize).toBe(false)
    expect(p.scaleFrom).toBe(0.96)
  })
  it('calmo, preciso e vivo: molas com os valores da spec', () => {
    expect(presetsFor('calm', { reduced: false, gpu: true }).enter).toEqual({ type: 'spring', bounce: 0, visualDuration: 0.45 })
    expect(presetsFor('crisp', { reduced: false, gpu: true }).enter).toEqual({ type: 'spring', bounce: 0, visualDuration: 0.25 })
    expect(presetsFor('lively', { reduced: false, gpu: true }).enter).toEqual({ type: 'spring', bounce: 0.15, visualDuration: 0.4 })
    expect(presetsFor('crisp', { reduced: false, gpu: true }).exit).toEqual({ duration: 0.14, ease: [0.4, 0, 1, 1] })
    expect(presetsFor('lively', { reduced: false, gpu: true }).scaleFrom).toBe(0.9)
  })
  it('materializar só com GPU e sem reduzir movimento', () => {
    expect(presetsFor('calm', { reduced: false, gpu: true }).materialize).toBe(true)
    expect(presetsFor('calm', { reduced: false, gpu: false }).materialize).toBe(false)
    expect(presetsFor('calm', { reduced: true, gpu: true }).materialize).toBe(false)
  })
  it('reduzir movimento: só opacidade, 120 ms, sem escala', () => {
    const p = presetsFor('lively', { reduced: true, gpu: true })
    expect(p.reduced).toBe(true)
    expect(p.enter).toEqual({ duration: 0.12, ease: 'linear' })
    expect(p.exit).toEqual({ duration: 0.12, ease: 'linear' })
    expect(p.scaleFrom).toBe(1)
  })
})
```

Em `tests/renderer/app-themes.test.ts`:

```ts
  it('personalidade de movimento por tema', () => {
    expect([APP_THEMES.padrao.motion, APP_THEMES.claro.motion, APP_THEMES.vidro.motion, APP_THEMES.noite.motion, APP_THEMES.aurora.motion]).toEqual(['subtle', 'subtle', 'calm', 'crisp', 'lively'])
  })
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `rtk proxy npx vitest run --reporter=dot tests/renderer/motion-presets.test.ts tests/renderer/app-themes.test.ts`
Expected: FAIL (módulo inexistente; `motion` indefinido).

- [ ] **Step 4: Implementar**

`src/renderer/src/motion-presets.ts`:

```ts
import type { Transition } from 'motion/react'

export type MotionPersonality = 'subtle' | 'calm' | 'crisp' | 'lively'

export interface MotionPreset {
  enter: Transition
  exit: Transition
  /** reduzir movimento: só opacidade */
  reduced: boolean
  /** desfoque → nítido junto com a escala (premium, com GPU) */
  materialize: boolean
  /** escala inicial de modais/painéis que entram */
  scaleFrom: number
}

const OUT = [0.4, 0, 1, 1] as const
const ENTER: Record<MotionPersonality, Transition> = {
  subtle: { duration: 0.15, ease: [0.2, 0, 0, 1] },
  calm: { type: 'spring', bounce: 0, visualDuration: 0.45 },
  crisp: { type: 'spring', bounce: 0, visualDuration: 0.25 },
  lively: { type: 'spring', bounce: 0.15, visualDuration: 0.4 },
}
const EXIT_S: Record<MotionPersonality, number> = { subtle: 0.12, calm: 0.16, crisp: 0.14, lively: 0.16 }

/** personalidade do tema → transições; reduzir movimento vira esmaecimento curto */
export function presetsFor(p: MotionPersonality, o: { reduced: boolean; gpu: boolean }): MotionPreset {
  if (o.reduced) {
    const fade: Transition = { duration: 0.12, ease: 'linear' }
    return { enter: fade, exit: fade, reduced: true, materialize: false, scaleFrom: 1 }
  }
  return {
    enter: ENTER[p],
    exit: { duration: EXIT_S[p], ease: [...OUT] },
    reduced: false,
    materialize: p !== 'subtle' && o.gpu,
    scaleFrom: p === 'subtle' ? 0.96 : 0.9,
  }
}
```

`src/renderer/src/use-motion.ts`:

```ts
import { useReducedMotion } from 'motion/react'
import { presetsFor, type MotionPreset } from './motion-presets'
import { useUi } from './store'
import { GPU_OK } from './view'

/** transições do tema atual (com reduzir movimento e sem desfoque animado quando não há GPU) */
export function useMotionPreset(): MotionPreset {
  const p = useUi((s) => s.motion)
  const reduced = useReducedMotion() ?? false
  return presetsFor(p, { reduced, gpu: GPU_OK })
}
```

`app-themes.ts`: `import type { MotionPersonality } from './motion-presets'`; `AppTheme` ganha `motion: MotionPersonality`; valores: padrao/claro `'subtle'`, vidro `'calm'`, noite `'crisp'`, aurora `'lively'`. No `NEUTRAL` (Padrão/Claro) acrescentar `'ease-spring': 'cubic-bezier(0.2, 0, 0, 1)'` (o toque volta sem excesso nos básicos) e trocar a linha `--ease-spring` do `:root` do `styles.css` para `cubic-bezier(0.2, 0, 0, 1)`.

`store.ts`: `UiState` ganha `motion: MotionPersonality` (inicial `'subtle'`). `appearance.ts`: em `applyAppearance`, `setUi({ motion: app.motion })` (junto do `desktopMismatch`, valendo também na flutuante: mover para fora do `if`).

`view.ts`: `export const GPU_OK = q.get('gpu') !== '0'`.

`windows.ts` (`load`): acrescentar à query `gpu: String(app.getGPUFeatureStatus().gpu_compositing).startsWith('enabled') ? '1' : '0'` (importar `app` de `electron`). Vale para espaço, flutuante e tela de reabrir.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/renderer/src/motion-presets.ts src/renderer/src/use-motion.ts src/renderer/src/app-themes.ts src/renderer/src/store.ts src/renderer/src/appearance.ts src/renderer/src/view.ts src/main/windows.ts src/renderer/src/styles.css tests/renderer/motion-presets.test.ts tests/renderer/app-themes.test.ts
git commit -m "feat(movimento): personalidade de movimento por tema e presets (Motion) com reduzir movimento e sem desfoque sem GPU"
```

---

### Task 2: Modais — zoom da origem e materializar

**Files:**
- Create: `src/renderer/src/pointer.ts`, `src/renderer/src/components/ModalFrame.tsx`
- Modify: `src/renderer/src/components/Modals.tsx`, `Preferences.tsx`, `Palette.tsx`, `SetupWizard.tsx`, `ConversationsModal.tsx`, `FilePicker.tsx`, `WorkspaceNameModal.tsx`, `ConflictsModal.tsx`, `NewSessionDialog.tsx`; `src/renderer/src/main.tsx` (instalar o rastreador), `FloatControls.tsx` (popover)
- Test: `tests/renderer/pointer.test.ts`

**Interfaces:**
- Consumes: `useMotionPreset()` (Task 1).
- Produces: `originFor(click: { x: number; y: number; t: number } | null, now: number, box: { left: number; top: number }): string`; `trackPointer(): void`; `lastPointer()`; `ModalFrame({ onClose, className, backdropClassName, children })`.

- [ ] **Step 1: Teste que falha** — `tests/renderer/pointer.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { originFor } from '../../src/renderer/src/pointer'

describe('origem do zoom', () => {
  it('clique recente (≤ 400 ms): o ponto do clique relativo à caixa', () => {
    expect(originFor({ x: 300, y: 120, t: 1000 }, 1300, { left: 200, top: 100 })).toBe('100px 20px')
  })
  it('clique antigo ou nenhum (abriu por atalho): topo-centro', () => {
    expect(originFor({ x: 300, y: 120, t: 1000 }, 1500, { left: 200, top: 100 })).toBe('50% 0%')
    expect(originFor(null, 1500, { left: 0, top: 0 })).toBe('50% 0%')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — `rtk proxy npx vitest run --reporter=dot tests/renderer/pointer.test.ts` → FAIL.

- [ ] **Step 3: Implementar**

`src/renderer/src/pointer.ts`:

```ts
type Click = { x: number; y: number; t: number }
let last: Click | null = null

/** guarda o último pointerdown (origem do zoom dos modais) */
export function trackPointer(): void {
  window.addEventListener('pointerdown', (e) => (last = { x: e.clientX, y: e.clientY, t: performance.now() }), { capture: true })
}
export const lastPointer = (): Click | null => last

/** origem do zoom: o clique, se o modal abriu logo depois dele; senão o topo-centro (abriu por atalho) */
export function originFor(click: Click | null, now: number, box: { left: number; top: number }): string {
  return click && now - click.t <= 400 ? `${click.x - box.left}px ${click.y - box.top}px` : '50% 0%'
}
```

`src/renderer/src/components/ModalFrame.tsx`:

```tsx
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { useMotionPreset } from '../use-motion'
import { lastPointer, originFor } from '../pointer'

/** fundo + caixa do modal: nasce da origem (clique) e volta para ela; premium materializa */
export function ModalFrame({ onClose, className = 'modal', backdropClassName = '', children }: { onClose(): void; className?: string; backdropClassName?: string; children: ReactNode }) {
  const pr = useMotionPreset()
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (el) el.style.transformOrigin = originFor(lastPointer(), performance.now(), el.getBoundingClientRect())
  }, [])
  const hidden = { opacity: 0, scale: pr.scaleFrom, filter: pr.materialize ? 'blur(12px)' : 'blur(0px)' }
  return (
    <motion.div
      className={`modal-backdrop ${backdropClassName}`}
      onMouseDown={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: pr.enter }}
      exit={{ opacity: 0, transition: pr.exit }}
    >
      <motion.div
        ref={box}
        className={className}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        initial={hidden}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transition: pr.enter }}
        exit={{ ...hidden, scale: pr.reduced ? 1 : 0.96, transition: pr.exit }}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}
```

`Modals.tsx`: trocar o `Backdrop` local por `ModalFrame` (`onClose={() => setUi({ modal: null })}`); mover o corpo atual de `Modals` para `function ModalSwitch({ modal, app })` e fazer:

```tsx
export function Modals() {
  const modal = useUi((s) => s.modal)
  const app = useUi((s) => s.app)
  return <AnimatePresence>{modal && app && <ModalSwitch key={modal.kind} modal={modal} app={app} />}</AnimatePresence>
}
```

(`AnimatePresence` de `motion/react`; os `exit` dos `motion.*` dentro do filho removido rodam antes de desmontar.)

Em cada um dos 8 modais, trocar o par

```tsx
<div className="modal-backdrop[ X]" onMouseDown={fechar}>
  <div className="CLASSE" onMouseDown={(e) => e.stopPropagation()} onKeyDown={...Escape...}>
    …
  </div>
</div>
```

por `<ModalFrame onClose={fechar} className="CLASSE" backdropClassName="X">…</ModalFrame>` (manter outros `onKeyDown` específicos do modal, se houver, dentro do conteúdo). A paleta usa `className="palette"` e `backdropClassName="palette-backdrop"`.

`main.tsx`: chamar `trackPointer()` logo depois de `initAppearance()`.

Menus do app (spec, seção 3): o popover de opacidade da flutuante (`FloatControls.tsx:64-65`, `div.float-opacity` no portal) vira `motion.div` com `initial={{ opacity: 0, scale: pr.reduced ? 1 : 0.92 }}`, `animate={{ opacity: 1, scale: 1 }}`, `transition={pr.enter}` e `style={{ transformOrigin: 'top right' }}` (abre a partir do botão ◐, que fica à direita do cabeçalho).

- [ ] **Step 4: Rodar e ver passar** — `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot` → PASS; `grep -rn "modal-backdrop" src/renderer/src/components` só aparece em `ModalFrame.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pointer.ts src/renderer/src/components tests/renderer/pointer.test.ts src/renderer/src/main.tsx
git commit -m "feat(movimento): modais nascem do clique que os abriu (ou do topo) e voltam para ele; premium materializa"
```

---

### Task 3: Listas em cascata

**Files:**
- Modify: `src/renderer/src/components/Palette.tsx:43-52`, `FilePicker.tsx:~62`, `ConversationsModal.tsx:~71`

**Interfaces:**
- Consumes: `useMotionPreset()`.

- [ ] **Step 1: Implementar** — em cada lista, guardar `const first = useRef(true); useEffect(() => { first.current = false }, [])` e trocar cada item `div` por `motion.div` com:

```tsx
initial={first.current && i < 8 ? { opacity: 0, y: pr.reduced ? 0 : 6 } : false}
animate={{ opacity: 1, y: 0 }}
transition={{ ...pr.enter, delay: first.current && i < 8 ? i * 0.035 : 0 }}
```

(`first.current` é lido na primeira renderização; ao digitar para filtrar, os itens novos entram sem cascata.)

- [ ] **Step 2: Tipos e testes** — `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Palette.tsx src/renderer/src/components/FilePicker.tsx src/renderer/src/components/ConversationsModal.tsx
git commit -m "feat(movimento): listas da paleta, do seletor de arquivo e de conversas entram em cascata ao abrir"
```

---

### Task 4: Pílula da aba e seleção da lateral deslizando

**Files:**
- Modify: `src/renderer/src/components/Workspace.tsx:~116`, `src/renderer/src/components/Sidebar.tsx:~22-40` (e o trecho que abre/fecha projetos/worktrees), `src/renderer/src/styles.css`

**Interfaces:**
- Consumes: `useMotionPreset()`.

- [ ] **Step 1: Aba** — dentro do botão/elemento da aba, quando ativa: `{active && <motion.span layoutId="tab-pill" className="tab-pill" transition={pr.reduced ? { duration: 0 } : pr.enter} />}` como primeiro filho; o conteúdo da aba ganha `position: relative; z-index: 1` via CSS. O conteúdo da área de abas (`tab-body`) ganha um `motion.div` com `key={tab.id}`, `initial={{ opacity: 0.6 }}`, `animate={{ opacity: 1 }}`, `transition={pr.enter}` (esmaecimento curto na troca).

CSS (só tokens): mover o fundo/realce da aba ativa para a pílula:

```css
.tab-pill { position: absolute; inset: 0; z-index: 0; background: var(--bg); box-shadow: inset 0 -2px 0 var(--accent); border-radius: inherit; }
.tab > :not(.tab-pill) { position: relative; z-index: 1; }
.tab.active { background: transparent; box-shadow: none; }
.tab.colored .tab-pill { background: transparent; box-shadow: inset 0 -3px 0 currentColor; }
:root:is([data-theme='vidro'], [data-theme='noite'], [data-theme='aurora']) .tab-pill { background: var(--bg-raised); box-shadow: 0 0 0 1px var(--border), 0 1px 2px color-mix(in srgb, var(--fg) 12%, transparent); }
```

(Remover as regras de `.tab.active` / `.tab.colored.active` de fundo e sombra que a pílula substitui, inclusive no bloco premium.)

- [ ] **Step 2: Lateral** — em `SessionRow`, quando `focused`: `<motion.span layoutId="sb-sel" className="sb-sel" transition={pr.reduced ? { duration: 0 } : pr.enter} />` como primeiro filho. CSS: `.sb-session { position: relative; } .sb-sel { position: absolute; inset: 0; z-index: 0; background: var(--bg-selected); border-radius: var(--radius-md); } .sb-session > :not(.sb-sel) { position: relative; z-index: 1; } .sb-session.focused { background: transparent; }`. A bolinha de estado (emoji): `<AnimatePresence mode="popLayout" initial={false}><motion.span key={s.status} className="dot" initial={{ opacity: 0, scale: pr.reduced ? 1 : 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={pr.enter}>…</motion.span></AnimatePresence>`.

- [ ] **Step 3: Seções** — onde projetos/worktrees abrem e fecham (o bloco de filhos condicionado ao estado aberto), envolver com `<AnimatePresence initial={false}>{aberto && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={pr.enter} style={{ overflow: 'hidden' }}>…</motion.div>}</AnimatePresence>`.

- [ ] **Step 4: Tipos, testes e build** — `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot && npx electron-vite build` → PASS (`styles-tokens` inclusive).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Workspace.tsx src/renderer/src/components/Sidebar.tsx src/renderer/src/styles.css
git commit -m "feat(movimento): pílula da aba ativa e seleção da lateral deslizam; seções da lateral abrem com altura animada"
```

---

### Task 5: Painéis entrando e saindo

**Files:**
- Create: `src/renderer/src/pane-motion.ts`
- Modify: `src/renderer/src/components/Workspace.tsx` (folha da grade), `src/renderer/src/actions.ts` (`hidePaneAnimated`, `requestCloseFile`, `runMenuAction` 'hide-pane'), `src/renderer/src/components/PaneHeader.tsx:~98`
- Test: `tests/renderer/pane-motion.test.ts`

**Interfaces:**
- Produces: `shouldAnimateEnter(tabId: string, paneId: string, seen?: Map<string, Set<string>>): boolean`; `animateOut(paneId: string, exit: { opacity: number; scale: number }, t: Transition): Promise<void>`; `hidePaneAnimated(paneId: string): Promise<void>`.

- [ ] **Step 1: Teste que falha** — `tests/renderer/pane-motion.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { animateOut, shouldAnimateEnter } from '../../src/renderer/src/pane-motion'

describe('painéis', () => {
  it('primeira visita a uma aba não anima; voltar à aba não anima; painel novo numa aba já vista anima', () => {
    const seen = new Map<string, Set<string>>()
    expect(shouldAnimateEnter('t1', 'a', seen)).toBe(false)
    expect(shouldAnimateEnter('t1', 'a', seen)).toBe(false)
    expect(shouldAnimateEnter('t1', 'b', seen)).toBe(true)
    expect(shouldAnimateEnter('t1', 'b', seen)).toBe(false)
  })
  it('aba vazia já visitada: o primeiro painel anima', () => {
    const seen = new Map<string, Set<string>>([['t2', new Set()]])
    expect(shouldAnimateEnter('t2', 'x', seen)).toBe(true)
  })
  it('animateOut sem o elemento na tela resolve na hora (não trava o fechar)', async () => {
    await expect(animateOut('nao-existe', { opacity: 0, scale: 0.98 }, { duration: 0.14 })).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — FAIL (módulo inexistente).

- [ ] **Step 3: Implementar** — `src/renderer/src/pane-motion.ts`:

```ts
import { animate, type Transition } from 'motion'

const seenByTab = new Map<string, Set<string>>()

/** painel anima a entrada só se for novo numa aba já vista (trocar de aba remonta tudo e não deve "crescer") */
export function shouldAnimateEnter(tabId: string, paneId: string, seen = seenByTab): boolean {
  const s = seen.get(tabId)
  if (!s) {
    seen.set(tabId, new Set([paneId]))
    return false
  }
  const fresh = !s.has(paneId)
  s.add(paneId)
  return fresh
}

/** anima a saída do slot do painel; sem o elemento (já saiu, outra aba), resolve na hora */
export async function animateOut(paneId: string, exit: { opacity: number; scale: number }, t: Transition): Promise<void> {
  if (typeof document === 'undefined') return
  const el = document.querySelector<HTMLElement>(`.pane-slot[data-pane-id="${CSS.escape(paneId)}"]`)
  if (!el) return
  await animate(el, exit, t).finished
}
```

`Workspace.tsx` (folha): trocar o `div.pane-slot` por

```tsx
<PaneSlot tabId={tabId} paneId={node.paneId}>{…painel…}</PaneSlot>
```

com

```tsx
function PaneSlot({ tabId, paneId, children }: { tabId: string; paneId: string; children: ReactNode }) {
  const pr = useMotionPreset()
  const [enter] = useState(() => shouldAnimateEnter(tabId, paneId))
  return (
    <motion.div className="pane-slot" data-pane-id={paneId} initial={enter ? { opacity: 0, scale: pr.scaleFrom === 1 ? 1 : 0.96 } : false} animate={{ opacity: 1, scale: 1 }} transition={pr.enter}>
      {children}
    </motion.div>
  )
}
```

(o `tabId` já chega ao `SplitNode`).

`actions.ts`:

```ts
/** fechar pelo usuário (✕, ⌘W): o painel encolhe e esmaece, e só então sai da grade */
export async function hidePaneAnimated(paneId: string): Promise<void> {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  const p = presetsFor(getUi().motion, { reduced, gpu: true })
  await animateOut(paneId, { opacity: 0, scale: p.reduced ? 1 : 0.98 }, p.exit)
  hidePane(paneId)
}
```

e usar em: `PaneHeader` ✕ (`onClick={() => void hidePaneAnimated(pane.id)}`), `runMenuAction` 'hide-pane' (ramo não-arquivo: `void hidePaneAnimated(id)`), e em `requestCloseFile` trocar `hidePane(id)` por `await hidePaneAnimated(id)`.

- [ ] **Step 4: Rodar e ver passar** — `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pane-motion.ts src/renderer/src/components/Workspace.tsx src/renderer/src/actions.ts src/renderer/src/components/PaneHeader.tsx tests/renderer/pane-motion.test.ts
git commit -m "feat(movimento): painel novo entra crescendo e o fechado encolhe antes de sair da grade (trocar de aba não anima)"
```

---

### Task 6: Ilha dinâmica e estados

**Files:**
- Create: `src/renderer/src/island-queue.ts`, `src/renderer/src/components/AttentionIsland.tsx`
- Modify: `src/renderer/src/main.tsx:~43-59`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`
- Test: `tests/renderer/island-queue.test.ts`

**Interfaces:**
- Produces: `type IslandItem = { paneId: string; label: string }`; `enqueue(q: IslandItem[], it: IslandItem): IslandItem[]`; `showIsland(it: IslandItem): void`; `onIsland(fn: (it: IslandItem) => void): () => void`; `<AttentionIsland />`.

- [ ] **Step 1: Teste que falha** — `tests/renderer/island-queue.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { enqueue } from '../../src/renderer/src/island-queue'

const a = { paneId: 'a', label: 'dev-1' }, b = { paneId: 'b', label: 'dev-2' }

describe('fila da ilha', () => {
  it('ordem de chegada; a mesma sessão não entra duas vezes', () => {
    let q = enqueue([], a)
    q = enqueue(q, b)
    q = enqueue(q, a)
    expect(q.map((x) => x.paneId)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Rodar e ver falhar** — FAIL.

- [ ] **Step 3: Implementar** — `island-queue.ts`:

```ts
export type IslandItem = { paneId: string; label: string }

export function enqueue(q: IslandItem[], it: IslandItem): IslandItem[] {
  return q.some((x) => x.paneId === it.paneId) ? q : [...q, it]
}

const subs = new Set<(it: IslandItem) => void>()
export const onIsland = (fn: (it: IslandItem) => void) => (subs.add(fn), () => void subs.delete(fn))
export const showIsland = (it: IslandItem) => subs.forEach((f) => f(it))
```

`AttentionIsland.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { revealPane } from '../actions'
import { enqueue, onIsland, type IslandItem } from '../island-queue'
import { useMotionPreset } from '../use-motion'

/** "dev-1 precisa de você": cresce no topo-centro, fica 2,5 s, recolhe; clicar leva à sessão; uma por vez */
export function AttentionIsland() {
  const pr = useMotionPreset()
  const [queue, setQueue] = useState<IslandItem[]>([])
  useEffect(() => onIsland((it) => setQueue((q) => enqueue(q, it))), [])
  const cur = queue[0]
  useEffect(() => {
    if (!cur) return
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 2500)
    return () => clearTimeout(t)
  }, [cur])
  return (
    <AnimatePresence>
      {cur && (
        <motion.button
          key={cur.paneId}
          className="island"
          onClick={() => {
            revealPane(cur.paneId)
            setQueue((q) => q.slice(1))
          }}
          initial={{ opacity: 0, scale: pr.reduced ? 1 : 0.4 }}
          animate={{ opacity: 1, scale: 1, transition: pr.enter }}
          exit={{ opacity: 0, scale: pr.reduced ? 1 : 0.6, transition: pr.exit }}
        >
          <span className="island-dot" />
          {cur.label} precisa de você
        </motion.button>
      )}
    </AnimatePresence>
  )
}
```

CSS (tokens): `.island { position: fixed; top: 6px; left: 50%; translate: -50% 0; z-index: 40; display: flex; align-items: center; gap: 8px; padding: 4px 12px; border-radius: 999px; background: var(--fg); color: var(--bg); font-size: var(--text-sm); font-weight: 600; box-shadow: var(--shadow-sm); } .island-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--state-needs-you); } .tab-dot { transition: background-color var(--dur-base) var(--ease-standard), box-shadow var(--dur-base) var(--ease-standard); }` (usar `translate`, não `transform`, para não brigar com a escala da Motion).

`App.tsx`: renderizar `<AttentionIsland />` uma vez (janela de espaço). `main.tsx`, no laço das `notices`: para `n.kind === 'needs-you'`, `showIsland({ paneId: p.id, label: who })` (além do `window.gt.notify`).

- [ ] **Step 4: Rodar e ver passar** — `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/island-queue.ts src/renderer/src/components/AttentionIsland.tsx src/renderer/src/main.tsx src/renderer/src/App.tsx src/renderer/src/styles.css tests/renderer/island-queue.test.ts
git commit -m "feat(movimento): ilha dinâmica 'precisa de você' no topo (uma por vez, leva à sessão) e transição de cor nas bolinhas das abas"
```

---

### Task 7: Toque responsivo

**Files:**
- Modify: `src/renderer/src/styles.css`

- [ ] **Step 1: Implementar** (fim do arquivo, só tokens):

```css
/* toque: encolhe no pressionar, volta com a mola do tema ao soltar */
button, .tab, .sb-session, .theme-card, .bg-thumb { transition: transform var(--dur-base) var(--ease-spring); }
button:active, .tab:active, .sb-session:active, .theme-card:active, .bg-thumb:active { transform: scale(0.97); transition-duration: var(--dur-fast); transition-timing-function: var(--ease-standard); }
@media (prefers-reduced-motion: reduce) {
  button:active, .tab:active, .sb-session:active, .theme-card:active, .bg-thumb:active { transform: none; }
}
```

Conferir que nenhum desses elementos já usa `transform` próprio (`grep -n "transform" src/renderer/src/styles.css`); a ilha usa `translate` (Task 6).

- [ ] **Step 2: Testes e build** — `rtk proxy npx vitest run --reporter=dot && npx electron-vite build` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/styles.css
git commit -m "feat(movimento): toque responsivo em botões, abas, linhas da lateral e cartões (sem escala com reduzir movimento)"
```

---

### Task 8: Verificação real e Linux

**Files:** roteiro no scratchpad (`pw/hold-movimento.cjs`), reaproveitando `temas-capturas.cjs`.

- [ ] **Step 1: Roteiro** — para cada tema (`padrao`, `claro`, `vidro`, `noite`, `aurora`): abrir Preferências (`gt:menu 'preferences'`) e medir aos 40 ms e aos 900 ms a opacidade e a escala (`getComputedStyle(.modal).transform`) e, nos premium, o `filter`; fechar e medir que a caixa sumiu em ≤ 250 ms; abrir ⌘K e conferir `getAnimations()` com atrasos crescentes nos 8 primeiros itens; trocar de aba e medir a posição da `.tab-pill` no meio; abrir um terminal novo (`pane.create` + encaixe) e medir o slot entrando; fechar com `hidePaneAnimated` e conferir que a folha só sai da grade depois da animação; disparar `needs-you` (`showIsland` via `window`) e conferir a `.island` visível e sumindo após ~2,5 s.
- [ ] **Step 2: Sem redimensionar terminal** — interceptar `window.gt.send`/`request` registrando `pane.resize` durante a entrada e a saída de um painel: nenhuma chamada fora da troca de layout.
- [ ] **Step 3: Reduzir movimento** — `page.emulateMedia({ reducedMotion: 'reduce' })` e repetir: só opacidade (transformação `none`), nenhum `blur`.
- [ ] **Step 4: Fechar e abrir rápido** — `gt:menu 'preferences'` e logo `gt:menu 'palette'`: a paleta aparece e nada fica preso.
- [ ] **Step 5: Linux** — `npm run pack:linux` (requer Docker/colima ativo); se o Docker não estiver disponível, registrar no ledger e rodar ao menos `npx electron-vite build` + `npx tsc --noEmit`.
- [ ] **Step 6: Suíte final** — `npx tsc --noEmit && rtk proxy npx vitest run --reporter=dot && npx electron-vite build` → PASS; apagar `/tmp/gtt`.
