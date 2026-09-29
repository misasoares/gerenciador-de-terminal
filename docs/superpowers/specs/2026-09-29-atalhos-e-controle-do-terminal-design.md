# Gerenciador de Terminal — Atalhos configuráveis e controle do terminal — Design

Data: 2026-09-29
Status: aprovado em conversa, aguardando revisão da spec escrita
Base: `main` em `ed32909` (agentes Claude + Codex, setup e build Linux)
Origem: feedback do Victor, que testou o AppImage no Linux (áudio de 2026-09-28)

## 1. Objetivo

1. **Atalhos que não brigam com o shell no Linux.** Hoje o menu usa `CmdOrCtrl`, que no Linux vira Ctrl e rouba do terminal Ctrl+D (EOF), Ctrl+W, Ctrl+K, Ctrl+B, Ctrl+T e Ctrl+J. O `editMenu` padrão ainda registra Ctrl+C/Ctrl+V. No Mac nada muda.
2. **Tela para configurar atalhos**, com padrões de fábrica por plataforma.
3. **Terminal novo já recebe o foco.**
4. **Fechar o terminal fecha o painel, e aba vazia fecha junto.**
5. **Cabeçalho do painel mais limpo:** os números de git só aparecem quando dizem algo, e uma preferência esconde tudo.

Fora do escopo: copiar/colar editáveis, um atalho para várias ações, sequências de teclas (chords), atalhos globais do sistema, mudança nos padrões do Mac.

### Critérios de sucesso

1. No Linux, com os padrões, Ctrl+C interrompe, Ctrl+D encerra o shell, e Ctrl+W/K/B/T/J/R/L/Z chegam ao programa no terminal.
2. No Linux, Ctrl+Shift+C/V copia e cola no terminal.
3. Em Preferências → Atalhos, qualquer ação do menu pode ganhar outro atalho, ficar sem atalho ou voltar ao padrão, e o menu reflete isso na hora, sem reiniciar.
4. Nova sessão, dividir à direita/abaixo, nova aba via sidebar e "retomar sessão" deixam o cursor no terminal novo, pronto para digitar.
5. `exit` (código 0) num shell fecha o painel. Se a aba ficar vazia e houver outras abas, ela fecha também.
6. Um painel sem mudanças e em dia com o upstream não mostra `● 0 alterados ↑0 ↓0`.

## 2. Atalhos

### 2.1 Registro de ações — `src/shared/keybindings.ts` (novo)

Uma lista única, usada pelo menu e pela tela de Preferências:

```ts
export interface ActionDef {
  id: string              // igual à string de ação que o menu já envia: 'new-session', 'split-right', 'tab-1'…
  label: string           // 'Nova sessão…'
  group: 'app' | 'sessao' | 'abas' | 'exibir'
  mac: string | null      // accelerator do Electron
  linux: string | null
}
export type Platform = 'mac' | 'linux'
export type KeyOverrides = Record<string, string | null>   // null = sem atalho
export function platformOf(p: NodeJS.Platform): Platform   // 'darwin' → 'mac'; o resto → 'linux'
export function resolveBindings(platform: Platform, overrides: KeyOverrides): Record<string, string | null>
export function findConflict(bindings: Record<string, string | null>, actionId: string, accel: string): string | null  // id da outra ação que usa o accel
export function isShellKey(platform: Platform, accel: string): boolean
export function formatAccel(platform: Platform, accel: string): string  // 'CmdOrCtrl+Shift+D' → '⇧⌘D' no Mac, 'Ctrl+Shift+D' no Linux
```

Os accelerators são guardados sempre por extenso (`Ctrl+Shift+D`, `Cmd+D`, `Alt+1`), nunca com `CmdOrCtrl`. Assim o valor salvo não muda de sentido entre plataformas.

Padrões:

| Ação | id | Mac (como hoje) | Linux |
|---|---|---|---|
| Preferências… | `preferences` | ⌘, | Ctrl+, |
| Nova sessão… | `new-session` | ⌘T | Ctrl+Shift+T |
| Dividir à direita | `split-right` | ⌘D | Ctrl+Shift+D |
| Dividir abaixo | `split-down` | ⇧⌘D | Ctrl+Shift+E |
| Esconder painel | `hide-pane` | ⌘W | Ctrl+Shift+W |
| Próxima que precisa de mim | `next-attention` | ⌘J | Ctrl+Shift+J |
| Buscar… | `palette` | ⌘K | Ctrl+Shift+K |
| Foco ← → ↑ ↓ | `focus-left`… | ⌥⌘setas | Alt+setas |
| Nova aba | `new-tab` | ⇧⌘T | Ctrl+Shift+N |
| Aba 1…9 | `tab-1`…`tab-9` | ⌘1…9 | Alt+1…9 |
| Mostrar/recolher sidebar | `toggle-sidebar` | ⌘B | Ctrl+Shift+B |

"Configurar agentes…" e "Encerrar tudo…" continuam sem atalho e ficam fora da tela, assim como os itens de papel do Electron (Ocultar, Sair, Zoom, DevTools…).

Teclas do shell (`isShellKey`): no Linux, Ctrl + uma letra **sem** Shift, mais Ctrl+[ , Ctrl+\ e Ctrl+Espaço. No Mac, nenhuma: o ⌘ não chega ao terminal.

### 2.2 Onde fica salvo

- `TerminalSettings` ganha `keybindings: KeyOverrides`, com o padrão `{}`. Só as alterações são guardadas; quem nunca mexeu recebe padrões novos em versões futuras.
- `normalizeSettings` descarta ids desconhecidos e valores que não sejam string nem `null`. Depois descarta duplicados: se duas alterações usam o mesmo accel, a segunda vira `null`.
- Continua salvo pelo daemon, no `settings.save` que já existe.

### 2.3 Menu — `src/main/menu.ts` e `src/main/index.ts`

- `buildMenu` recebe `bindings: Record<string, string | null>` e `platform`, e tira os accelerators dali, não mais das strings fixas.
- **Linux:** sai o `{ role: 'editMenu' }` e entra um menu "Editar" próprio. Nele, Copiar e Colar com os papéis `copy`/`paste` do Electron usam `Ctrl+Shift+C`/`Ctrl+Shift+V`, e Selecionar tudo usa `Ctrl+Shift+A`. Desfazer e refazer saem, porque não fazem sentido no terminal. **Mac:** mantém o `editMenu`.
- Preload: `window.gt.platform` (o `process.platform`) e `window.gt.setKeybindings(bindings)`, este via IPC `gt:keybindings`.
- O renderer chama `setKeybindings(resolveBindings(...))` quando o estado chega e sempre que `settings.keybindings` muda. O `index.ts` reconstrói o menu com `Menu.setApplicationMenu(buildMenu(...))`. Até a primeira mensagem, o menu usa os padrões da plataforma.

### 2.4 Teclado no terminal — `src/renderer/src/keys.ts`

`decideKey` passa a receber a plataforma:

- **Mac:** sem mudança.
- **Linux:** Ctrl+Shift+C/V devolve `'swallow'` (não vai ao xterm), e o menu faz copiar/colar. Ctrl sem Shift segue para o xterm, como hoje. O menu não intercepta mais essas teclas porque os atalhos padrão não as usam. Um atalho do app configurado pelo usuário tem prioridade: se o accel do evento está nos bindings resolvidos, `decideKey` devolve `'swallow'`, para o menu tratar e o xterm não mandar a tecla também.

### 2.5 Tela — aba "Atalhos" em `Preferences.tsx`

Nova aba ao lado de Terminal e Agentes, num componente próprio (`KeybindingsPanel.tsx`):

- Ações agrupadas (App, Sessão, Abas, Exibir). Cada linha tem o rótulo, o campo do atalho (formatado com `formatAccel`) e ↺ quando o valor difere do padrão. As linhas alteradas ficam destacadas.
- **Gravar:** clicar no campo liga a gravação ("aperte a combinação…"). A primeira combinação com pelo menos um modificador, ou uma tecla de função, vira o accel. Esc cancela e Backspace/Delete deixa a ação sem atalho.
- **Conflito com outra ação:** a linha mostra "já usado por *Buscar* — [Trocar] [Cancelar]". Trocar passa o atalho para esta ação e deixa a outra sem atalho.
- **Tecla do shell (Linux):** aviso "o terminal deixará de receber Ctrl+W — [Usar mesmo assim] [Cancelar]".
- Botão "Restaurar todos os padrões", que salva `keybindings: {}`.
- Enquanto a tela grava, os atalhos do menu ficam desligados para a combinação não disparar a ação. O renderer manda `setKeybindings` com tudo `null` e restaura ao sair da gravação.

## 3. Foco no terminal novo — `terminals.ts` e `actions.ts`

Causa: `focusPane` chama `terminals.focus` no próximo frame, mas o xterm do painel só é criado quando o `TerminalView` monta, depois que o estado volta do daemon. O `focus` não acha a entrada e não faz nada.

Correção: `terminals.focus(paneId)` guarda `pendingFocus = paneId` quando não há entrada. Quando `ensure` cria a entrada desse painel (ou quando o `attach` termina, se o `focus` do xterm antes disso não pegar), o foco é aplicado e o pendente é limpo. Outro `focus` para outro painel substitui o pendente. `shouldFocusTerminal` continua valendo: não rouba o foco do campo de renomear.

## 4. Fechar

- **Shell/agente encerrado com código 0:** quando o `pane.exitCode` passa a `0` e o painel não é retomável (`resumable` vazio), o renderer chama `closeDeadPane`. Isso esconde o painel, descarta o xterm e manda `pane.forget`. Com código ≠ 0, ou retomável, continua a tela atual ("terminal encerrado (código N)" / "sessão perdida").
- **Aba vazia fecha:** `hidePane` e `closeDeadPane` fecham a aba que fica sem painéis, desde que exista outra aba. A última aba continua aberta com o estado vazio (`EmptyState`). Vale para ⌘W/Ctrl+Shift+W, para o ✕ do cabeçalho, para "Descartar"/"Fechar" e para o fechamento automático.
- O ⌘W continua **escondendo**, com a sessão viva na sidebar. Encerrar continua sendo `requestKill`, com confirmação quando 🟢.

## 5. Cabeçalho do painel

- `headerView` passa a devolver `changed`, `ahead` e `behind` como números, e o `PaneHeader` só renderiza cada peça quando é > 0. `⚠` e "branch sem upstream" (tooltip) continuam.
- As peças que aparecem ganham tom mais discreto (cor `--muted`). `● N alterados` mantém a cor de "sujo".
- Nova preferência `showGitStatus: boolean` (padrão `true`) na aba Terminal, "Mostrar status do git no cabeçalho". Desligada, esconde `● N`, `↑`, `↓`. A branch continua.

## 6. Erros e bordas

- Accel inválido vindo do arquivo: `normalizeSettings` descarta, e a ação volta ao padrão.
- Menu reconstruído com o app em foco: nenhum estado de UI se perde, pois o menu só envia strings de ação.
- Painel fechado automaticamente enquanto estava em foco: o foco vai para outro painel da aba (`focusAfterHide`), como já acontece.
- O fechamento automático só roda uma vez por painel: o painel sai do estado depois do `pane.forget`.

## 7. Testes

Unitários (vitest):

- `keybindings`: padrões Mac/Linux sem duplicados; `resolveBindings` com alteração, com `null` e com id desconhecido; `findConflict`; `isShellKey` (Ctrl+W sim, Ctrl+Shift+W não, Mac nunca); `formatAccel`.
- `settings`: `normalizeSettings` com `keybindings` inválido e duplicado, e `showGitStatus`.
- `menu`: `buildMenu` com bindings personalizados põe o accel certo no item; no Linux não há `Ctrl+C`/`Ctrl+V`/`Ctrl+D` em nenhum item.
- `keys`: `decideKey` no Linux (Ctrl+D → xterm; Ctrl+Shift+C → swallow; atalho personalizado → swallow) e no Mac (sem mudança).
- `terminals`/`focus`: foco pendente aplicado quando a entrada nasce e substituído por outro `focus`.
- `actions`/`layout`: esconder o último painel fecha a aba quando há outras; a última aba não fecha.
- `header`: sem zeros; `showGitStatus: false`.

Manual:

- No container Linux (`scripts/linux-container.sh`): suíte inteira.
- No AppImage, no Linux: critérios 1–5. Pedir ao Victor para refazer o teste.
- No Mac: atalhos iguais aos de hoje, tela de atalhos, critérios 3–6.
