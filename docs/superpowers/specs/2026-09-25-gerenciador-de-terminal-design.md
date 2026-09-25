# Gerenciador de Terminal — Design

Data: 2026-09-25
Status: aprovado em conversa, aguardando revisão da spec escrita

## 1. Objetivo

App desktop para rodar várias sessões do Claude Code ao mesmo tempo, no mesmo
projeto e em projetos diferentes, substituindo o VS Code como "hospedeiro de
terminais". O usuário não lê código no editor; ele precisa ver, por terminal:

- projeto e **worktree** (principal requisito de visibilidade);
- branch;
- alterações não commitadas;
- commits para push (↑) e para pull (↓);
- estado da sessão do Claude (trabalhando / precisa de você / terminou);
- conta do Claude usada naquela sessão.

98% do uso é Claude Code; comandos avulsos no shell também precisam funcionar.

### Critérios de sucesso

1. Abrir N sessões do Claude em N projetos/worktrees, lado a lado, sem VS Code.
2. Quando o Claude entra numa worktree no meio da sessão, o cabeçalho do painel
   reflete a nova worktree em até ~2s, sem ação do usuário.
3. Fechar, travar ou recompilar o app não interrompe nenhuma sessão; ao reabrir,
   a tela e o scrollback de cada terminal voltam intactos, com scroll nativo.
4. Teclas mortas do layout Brasileiro - Pro funcionam (`ã õ ê é à ü`, `~`).
5. Worktrees órfãs podem ser vistas, reabertas ou removidas com segurança.

### Contexto do usuário (fatos verificados)

- macOS 26.5, layout de teclado "Brazilian - Pro", zsh.
- `claude` é uma **função do zsh**, não um binário: aplica `_claude_sem_gateway`
  e `--add-dir` para `~/Documents/weboption`. Funções `claude-misa`,
  `claude-mslabs`, `claude-weboption`, `claude-weboption-max` usam `cswap run`
  (session mode), cada conta com seu `CLAUDE_CONFIG_DIR` em
  `~/.claude-swap-backup/sessions/<N>-<conta>/`.
- Os três `settings.json` dos perfis são symlinks para `~/.claude/settings.json`.
- `~/.claude/settings.json` já tem hook `PreToolUse` (RTK) que deve ser preservado.
- As contas weboption recebem `--settings <arquivo>` (gateway ou max), sem hooks.
- O usuário **nunca** usa `cswap switch`/`auto` no dia a dia; o app também não.
- 99,9% das worktrees são criadas pelo próprio Claude durante a sessão.

## 2. Plataforma

Electron + xterm.js + node-pty, TypeScript. Código organizado para rodar em
macOS, Windows e Linux; **a fase 1 entrega e testa só macOS**. Tudo que depende
de SO fica isolado num módulo `platform/` (PTY/shell padrão, leitura de cwd de
processo, transporte do socket, notificações).

Alternativas descartadas: Swift nativo (só Mac, SwiftTerm menos maduro),
tmux + TUI (quebra o scroll nativo do Claude Code, UX inferior, sem Windows).

## 3. Arquitetura

Três peças:

```
App (Electron)  ── socket local ──  Daemon (Node)  ── socket local ──  gt-hook
 interface                            dono dos PTYs                      chamado pelos
 xterm.js                             estado git/worktree/sessão         hooks do Claude
```

### 3.1 Daemon

- Processo Node separado, desacoplado do app (detached). Sobrevive ao app.
- Dono de todos os PTYs (`node-pty`). Para cada terminal mantém um espelho
  headless (`@xterm/headless` + addon de serialização) para restaurar tela e
  scrollback quando um cliente reconecta.
- Mantém o estado: projetos, worktrees, sessões, git, estado do Claude.
- Escuta num socket local (`~/.gerenciador-terminal/daemon.sock`; named pipe no
  Windows no futuro). Protocolo: mensagens JSON delimitadas por linha para
  controle/estado; dados de terminal no mesmo canal, identificados por `paneId`.
- Encerra só por comando explícito ("Encerrar tudo") ou desligamento da máquina.
- Expõe sua versão; o app avisa em caso de versão divergente e **não** reinicia
  o daemon sem o usuário pedir.

### 3.2 App

- Ao abrir: conecta ao daemon; se não existir, inicia um e conecta.
- Recebe snapshot de estado + tela serializada de cada terminal; segue ao vivo.
- Não guarda estado de terminal. Persiste em disco apenas o que é de interface
  (abas, splits) através do daemon.

### 3.3 gt-hook

- Script Node pequeno, chamado pelos hooks do Claude Code.
- Lê o JSON do hook no stdin, anexa `GT_PANE_ID`, `CLAUDE_CONFIG_DIR` e a
  linha de comando do processo pai, e envia ao daemon. Timeout curto; nunca
  bloqueia nem falha o Claude.
- Se `GT_PANE_ID` não existir no ambiente (Claude rodando fora do app), sai
  imediatamente com código 0.

### 3.4 Criação de terminal

- O daemon abre o shell do usuário como **shell de login interativo** (`zsh -il`)
  para carregar as funções do `.zshrc`.
- Injeta no ambiente: `GT_PANE_ID`, `GT_SOCKET`.
- Para uma sessão Claude, o daemon escreve o comando da conta no shell
  (ex.: `claude-mslabs\n`) — nunca executa o binário diretamente, para passar
  pelas funções do usuário (gateway, `--add-dir`, chaves por projeto).

### 3.5 Estado em disco

`~/.gerenciador-terminal/`:
- `state.json`: projetos (caminho, nome, conta padrão), abas e árvore de splits,
  e para cada painel o último `session_id` do Claude, conta e cwd (para retomada).
- `daemon.sock`, `daemon.log`.

## 4. Contas do Claude

- Contas conhecidas (configuráveis): `misa` → `claude`, `mslabs` →
  `claude-mslabs`, `weboption` → `claude-weboption`, `weboption-max` →
  `claude-weboption-max`. Cada conta tem nome, comando e cor.
- Identificação da conta de uma sessão: pelo `CLAUDE_CONFIG_DIR` recebido do
  gt-hook (ausente → `misa`; `…/3-misael_mslabs-dev.com` → `mslabs`; etc.).
  `weboption` vs `weboption-max`: pelo arquivo passado em `--settings` na linha
  de comando do processo `claude`.
- Instalação dos hooks: o app acrescenta suas entradas em
  `~/.claude/settings.json`, com backup prévio, sem alterar hooks existentes.
  Idempotente (identifica as próprias entradas por marcador no comando).
- Na inicialização, o daemon verifica cada perfil em
  `~/.claude-swap-backup/sessions/*/settings.json`: se não for mais symlink e
  não contiver os hooks, o app oferece instalar ali.
- Cada projeto pode ter conta padrão (ex.: tudo em `~/Documents/weboption`
  sugere `weboption`).

## 5. Detecção

### 5.1 Worktree / cwd da sessão

1. **Hooks (fonte principal):** todo evento traz `cwd`. O daemon atualiza o cwd
   do painel a cada evento. Se a versão instalada do Claude Code tiver um evento
   dedicado de mudança de diretório, ele também é registrado (verificar na
   implementação).
2. **Leitura de processo (reforço):** a cada ~2s, cwd do processo em primeiro
   plano do PTY (`lsof -a -p <pid> -d cwd -Fn` no macOS; `/proc/<pid>/cwd` no
   Linux). Cobre `cd` manual e terminais sem Claude.
3. **cwd → projeto/worktree:** `git rev-parse --show-toplevel --git-common-dir`.
   O common dir identifica o projeto; o toplevel identifica a worktree.
   Pasta fora de projeto cadastrado → painel "fora de projeto" com ação
   "adicionar projeto".

O app **não** registra os hooks `WorktreeCreate`/`WorktreeRemove` (eles
substituem o comportamento de criação do Claude; o app só observa).

### 5.2 Git (por worktree, compartilhado entre painéis)

- Fonte: `git status --porcelain=v2 --branch` → branch, upstream, ahead/behind,
  contagem de arquivos alterados/não rastreados.
- Gatilhos: watcher nos arquivos do gitdir da worktree (`HEAD`, `index`, refs),
  evento `PostToolUse` de sessão naquela worktree, e intervalo de 10s. Debounce.
- `git fetch` em segundo plano por projeto a cada 5 min (configurável), com
  `GIT_TERMINAL_PROMPT=0`. Falha → ⚠ discreto no cabeçalho.
- Todo comando git com timeout; falha não derruba nada.

### 5.3 Worktrees do projeto

- `git worktree list --porcelain` por projeto, atualizado junto com o git.
- Marca: principal, travada, prunable, com/sem sessão.
- **Remoção segura:**
  - bloqueada se houver sessão aberta na worktree;
  - checa alterações não commitadas e commits não alcançáveis por nenhum remoto
    nem pela branch principal; se houver, mostra o que seria perdido e pede
    confirmação explícita;
  - executa `git worktree remove` (com `--force` só após essa confirmação);
  - opção de apagar a branch junto (`git branch -d`; `-D` só com confirmação).

### 5.4 Estado da sessão Claude

| Evento | Efeito |
|---|---|
| `SessionStart` | registra sessão no painel: `session_id`, conta, cwd |
| `UserPromptSubmit`, `PreToolUse` | 🟢 trabalhando |
| `Notification` (pedido de permissão), `PreToolUse` de `AskUserQuestion` | 🟡 precisa de você |
| `PostToolUse` | 🟢 + atualiza cwd e dispara git |
| `Stop` | ⚪ terminou o turno |
| `SessionEnd` | painel volta a ser shell comum |

Sem distinção entre "terminou e visto" / "não visto".

## 6. Interface

### 6.1 Sidebar

- Árvore Projeto → Worktree → Sessões. Worktrees sem sessão aparecem como
  "(sem sessão)".
- Sessão: ponto de estado + nome (título da conversa quando disponível, senão
  "sessão N").
- Projeto recolhido mostra resumo de estados (ex.: `🟡1 🟢2`).
- Menu de contexto da worktree: Nova sessão, Terminal comum, Remover worktree,
  Abrir no Finder.
- ＋ adiciona projeto (seletor de pasta; aceita qualquer worktree e resolve o
  repositório principal).

### 6.2 Área principal

- Abas no topo; cada aba tem uma árvore de splits livres (dividir, arrastar
  borda para redimensionar, arrastar sessão da sidebar para um split). Uma aba
  pode misturar projetos.
- Clicar numa sessão na sidebar foca o painel, trocando de aba se preciso.
- Abas e splits são persistidos e restaurados.

### 6.3 Cabeçalho do painel

`projeto · ⎇ worktree · branch · ●N alterados · ↑N ↓N · estado · conta`

- Worktree não principal ganha cor própria; ao mudar de worktree o cabeçalho
  pisca brevemente.
- Conta exibida com a cor da conta.

### 6.4 Painéis e sessões

- ✕ / ⌘W **esconde** o painel; a sessão segue viva e acessível pela sidebar.
- "Encerrar sessão" é ação separada; pede confirmação se estiver 🟢.
- Nova sessão (⌘T): projeto/worktree pré-preenchidos com o painel em foco,
  conta pré-preenchida com a padrão do projeto; abre em split ao lado.

### 6.5 Atalhos (fase 1)

| Atalho | Ação |
|---|---|
| ⌘T | nova sessão |
| ⌘D / ⇧⌘D | dividir vertical / horizontal |
| ⌘W | esconder painel |
| ⌘1…9 | ir para aba |
| ⌥⌘ + setas | mover foco entre painéis |

### 6.6 Terminal

- Fonte, tamanho e tema configuráveis; padrão semelhante ao terminal do VS Code.
- Links clicáveis; Shift+Enter envia quebra de linha para o Claude Code.
- **Teclas mortas / composição:** entrada via eventos de composição do sistema;
  `macOptionIsMeta = false` por padrão (configurável). `~` + espaço produz `~`.

## 7. Erros

- **Daemon morreu:** app mostra "reconectando…" e inicia outro. Os PTYs antigos
  se perderam; com base em `state.json`, o app oferece retomar cada painel com
  `claude --resume <session_id>` usando o comando da conta registrada, no cwd
  registrado.
- **Versão do daemon divergente:** aviso; reinício só quando o usuário pedir.
- **Git lento/quebrado:** timeout, ⚠ no cabeçalho, resto segue.
- **Hooks ausentes numa conta:** aviso com ação "instalar".
- **gt-hook sem daemon:** sai com 0 em silêncio.

## 8. Testes

- **Unitários:** mapeamento evento de hook → estado; parser de
  `git status --porcelain=v2` e `git worktree list --porcelain`; cwd → projeto;
  `CLAUDE_CONFIG_DIR`/argv → conta; regras de remoção segura; merge idempotente
  dos hooks no `settings.json`.
- **Integração:** daemon real em repositório temporário — criar worktrees,
  alterar arquivos, simular eventos do gt-hook e verificar estado; derrubar o
  cliente e reconectar verificando a tela serializada.
- **Checklist manual:** digitar `não, ação, você, à, pôr, ~/pasta` com o Claude
  rodando; Shift+Enter; redimensionar com Claude ativo; Claude criando worktree
  real e o cabeçalho acompanhando; fechar/reabrir o app com Claude 🟢.

## 9. Escopo

**Fase 1 (MVP, macOS):** daemon com persistência; sidebar Projeto → Worktree →
Sessão; abas + splits livres; cabeçalho git/worktree; estados 🟢🟡⚪; contas;
instalação dos hooks; remoção segura de worktree; teclas mortas.

**Fase 2:** notificação do macOS e badge no Dock quando uma sessão precisa de
você; atalho "próxima sessão que precisa de mim"; ⌘K busca rápida.

**Fase 3:** Windows e Linux; empacotamento e publicação no GitHub.

**Fora de escopo:** visualizar/editar arquivos, diff, git GUI (commit/push pelo
app), sincronização entre máquinas.
