# Gerenciador de Terminal — Sistema de temas (parte 1) — Design

Data: 2026-10-05
Status: aprovado em conversa (4 seções), aguardando revisão da spec escrita
Base: `main` (80c7c5e). Parte 1 de 3: (1) sistema de temas + tema Claro; (2) tema premium (Apple); (3) Vidro, Minimal e Retrô.

## 1. Objetivo

Permitir que o usuário escolha **temas do app**: mudam **cores e estilo visual** (cantos, sombras, tipografia, densidade, movimento) da interface inteira, **sem mudar o layout**. O visual atual vira o tema **Padrão** e continua sendo o padrão. Esta parte entrega a **fundação** (tokens, escolha, aplicação, pareamento com o terminal, modo automático) e um tema novo, o **Claro**, que prova o sistema.

Decisões do usuário:
- um tema muda **cores + estilo visual**; o layout (onde as coisas ficam) é o mesmo;
- cada tema traz um **tema de terminal pareado**; trocar o tema do app leva o terminal junto, mas dá para fixar outro terminal separadamente;
- opção **Automático**: um tema para o macOS claro e outro para o escuro, troca junto com o sistema; quem quiser fixa um só;
- temas em **objetos TypeScript tipados** (abordagem A), aplicados como variáveis CSS;
- aceita a **arrumação da escala de texto** (12 tamanhos → 4); diferença imperceptível no Padrão.

Fora do escopo desta parte: os temas Premium, Vidro, Minimal e Retrô (partes 2 e 3); transição animada entre temas (parte 2); mudar o layout; temas criados pelo usuário.

### Critérios de sucesso
- Com o tema Padrão, o app fica visualmente igual ao de hoje (salvo a arrumação de tamanhos de texto e o ajuste de `fg-dim` da seção 6), conferido por capturas antes/depois nas mesmas telas.
- Escolher Claro muda o app inteiro na hora, em todas as janelas (espaço, flutuante, tela de reabrir), incluindo terminal, editor, barras de rolagem, players e PDF.
- No Automático, mudar a aparência do macOS troca o tema sem reabrir nada.
- Abrir uma janela com o Claro não pisca escuro.
- Nenhuma configuração antiga se perde; quem não mexer não vê diferença ao atualizar.
- Todo tema passa no contraste AA (4,5:1) para texto principal e secundário sobre suas superfícies principais.

## 2. Tokens (o vocabulário de um tema)

Nomes viram variáveis CSS `--<nome>`. O `styles.css` passa a usar só variáveis (exceto `transparent`, `currentColor` e `inherit`).

**Cores (por papel):**
- superfícies: `bg`, `bg-side`, `bg-bar`, `bg-raised` (modais/menus), `bg-sunken` (blocos de código, cartões), `bg-hover`, `bg-selected`, `bg-status` (barra de status)
- controles: `bg-control`, `bg-control-hover` (botões, teclas), `bg-input`, `border-input` (campos)
- texto: `fg`, `fg-dim`, `fg-on-accent`, `link`
- linhas: `border`, `border-strong`
- destaque: `accent`, `accent-soft`, `flash` (o "piscar" ao revelar um painel)
- avisos: `warn`, `error`, `success`, `conflict` (laranja dos conflitos), `danger` (botão destrutivo)
- banners: `banner-warn-bg`, `banner-warn-fg`, `banner-warn-border`, `banner-ok-bg`, `banner-ok-fg`
- estados das sessões: `state-needs-you` (🟡), `state-your-turn` (🔵)
- etiquetas fixas: `chip-project-bg`, `chip-project-fg`, `chip-worktree-bg`, `chip-worktree-fg`, `chip-unknown-bg`, `chip-unknown-fg`
- abas coloridas (véu sobre a cor escolhida): `tab-colored-dim`, `tab-colored-dim-hover`, `tab-colored-fg`
- mídia: `checker-a`, `checker-b` (xadrez atrás de imagens transparentes)
- véu dos modais: `scrim`

**Forma:** `radius-sm` (3px), `radius-md` (4px), `radius-lg` (6px), `radius-xl` (8px); `shadow-sm`, `shadow-side` (barra lateral solta), `shadow-lg`.

**Tipografia:** `font-ui`, `font-mono`; `text-xs` (10px), `text-sm` (11,5px), `text-md` (12px), `text-base` (13px), `text-lg` (15px) — os 12 tamanhos de hoje (9 a 16px) viram 5.

**Densidade:** `tabbar-height` (32px), `header-height` (26px, linha do cabeçalho de painel).

**Movimento:** `dur-fast`, `dur-base`, `dur-slow`; `ease-standard`, `ease-spring`. Como os tokens são gravados direto no elemento raiz (e venceriam qualquer `@media`), quem grava os tokens zera as durações quando `prefers-reduced-motion: reduce` está ativo.

Notas de fidelidade do Padrão: além do `fg-dim` (seção 6), unificam-se dois amarelos quase iguais de "precisa de você" (`#eab308` da moldura da flutuante passa a `#e2a500`, o do resto do app) e raios de 2px viram 3px — diferenças imperceptíveis, declaradas.

**Fora do tema** (iguais em todos): cores escolhidas pelo usuário para sessões, projetos e contas; cores de marca dos agentes (Claude, Codex); o contraste calculado do texto sobre essas cores.

## 3. Modelo de dados e escolha

### Registro de temas (`src/renderer/src/app-themes.ts`)
```ts
type AppThemeId = 'padrao' | 'claro'            // partes 2/3 acrescentam premium, vidro, minimal, retro
interface AppTheme {
  id: AppThemeId
  label: string            // nome na tela, em português
  scheme: 'light' | 'dark' // esquema dos elementos nativos
  terminal: ThemeId        // tema de terminal pareado
  tokens: Record<TokenName, string>  // todos os tokens, obrigatório
}
```
`TokenName` é uma união fechada dos nomes da seção 2; o TypeScript exige todos em cada tema e um teste confere em tempo de execução.

### Configurações (globais, gravadas pelo daemon, como as atuais)
- `appearance.mode`: `'fixed' | 'auto'` (padrão `'fixed'`)
- `appearance.theme`: `AppThemeId` (padrão `'padrao'`)
- `appearance.light` / `appearance.dark`: `AppThemeId` (padrões `'claro'` / `'padrao'`)
- `terminalTheme`: `'match' | ThemeId` — `'match'` = acompanhar o tema do app (novo padrão)

Novo tema de terminal: `github-light` (pareado com o Claro).

### Migração (`normalizeSettings`)
- `theme` antigo `'vscode-dark'` (o padrão) → `terminalTheme: 'match'` (o Padrão pareia com VS Code Dark: mesmo visual).
- `theme` antigo diferente → `terminalTheme` = esse tema (fixado).
- sem `appearance` → modo fixo, tema Padrão.
- ids desconhecidos (tema removido/renomeado) caem no padrão; ids internos são estáveis, nomes de tela podem mudar.

### Resolução (função pura)
`resolveTheme(settings, systemDark) → { app: AppTheme, terminal: ThemeId }`: fixo usa `appearance.theme`; automático usa `light`/`dark` conforme `systemDark`; terminal = par do tema se `'match'`, senão o fixado.

## 4. Aplicação

Em toda janela do renderer (espaço, flutuante, tela de reabrir):
- ao chegar/mudar o estado (configurações) ou a aparência do sistema (`matchMedia('(prefers-color-scheme: dark)')`), resolve o tema e grava os tokens em `document.documentElement` (`style.setProperty`), mais `data-theme=<id>` e `color-scheme: light|dark`;
- terminal e editor (CodeMirror) acompanham; `--term-bg` vem do tema de terminal efetivo;
- **sem piscar:** o último tema aplicado fica em `localStorage` e é reaplicado de forma síncrona antes da primeira pintura (antes do React montar); falha de storage = segue o Padrão do CSS;
- **elementos nativos:** o renderer avisa o processo principal do esquema efetivo (IPC); o principal ajusta `nativeTheme.themeSource` (`'system'` no automático, `'light'`/`'dark'` no fixo) e guarda a cor de fundo para criar janelas novas com o `backgroundColor` do tema.

Observação: no automático o `themeSource` fica `'system'` para que `prefers-color-scheme` continue refletindo o macOS; o tema claro/escuro escolhido para cada lado já coincide com o esquema do sistema.

## 5. Interface de escolha

- **Preferências → nova primeira aba "Aparência":**
  - alternador **Fixo / Automático** no topo;
  - **cartões com miniatura** de cada tema, desenhados com os tokens reais do tema (barra lateral, abas, linhas de terminal); clicar aplica na hora (grava a configuração);
  - no Automático, duas fileiras: "Quando o macOS estiver claro" e "Quando estiver escuro".
- **Aba "Terminal":** o seletor de tema ganha "Acompanhar o tema (<nome do pareado>)" como primeira opção.
- Troca instantânea (sem animação nesta parte).

## 6. Migração do CSS

- Substituir no `styles.css` as ~30 cores literais, 6 raios, ~8 sombras e 12 tamanhos de fonte pelos tokens; idem a linha ativa do CodeMirror (`FilePane.tsx`) e o fallback de `--term-bg`.
- O tema **Padrão** recebe os valores atuais (é a fonte da verdade do visual de hoje), com uma exceção declarada: `fg-dim` passa de `#8b8b8b` para `#8c8c8c` (um nível, imperceptível) — o atual dá 4,49:1 sobre `#252526` (abas, cabeçalhos, modais) e o novo dá 4,55:1, passando no AA.
- Checagem automática (teste): o `styles.css` não pode ter cor literal (hex, `rgb()`, `rgba()`) fora das exceções documentadas, para o sistema não voltar a vazar.
- As 2 animações existentes (`wt-flash`, `outline-flash`) passam a usar os tokens de movimento.

## 7. Tema Claro

- fundo claro estilo macOS, superfícies em cinzas leves, texto escuro, destaque azul, sombras suaves; terminal **GitHub Light**;
- etiquetas de projeto/worktree e cores de estado (🟡🔵) ajustadas para legibilidade sobre fundo claro;
- `scheme: 'light'`.

## 8. Testes

- **Registro:** todo tema define exatamente o conjunto de tokens (nem falta, nem sobra).
- **Resolução:** fixo; automático claro/escuro; `'match'` e terminal fixado.
- **Migração:** configurações antigas (padrão e não padrão) e ausentes.
- **Contraste AA:** `fg` e `fg-dim` sobre as superfícies principais `bg`, `bg-side`, `bg-bar` e `bg-raised`, em todo tema (≥ 4,5:1). Estados passageiros (`bg-hover`, `bg-selected`) ficam fora da exigência.
- **Sem cor literal** no `styles.css` fora das exceções.
- **Real, no Electron isolado** (`GT_HOME` próprio, sem tocar no app instalado): capturas antes/depois do Padrão nas mesmas telas (espaço com abas e sessões, barra lateral, Preferências, painel de arquivo, flutuante); troca Padrão ↔ Claro no fixo e no automático; abertura sem piscar.
