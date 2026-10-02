# Gerenciador de Terminal — Worktree real do agente — Design

Data: 2026-10-01
Status: aprovado em conversa (2 seções), aguardando revisão da spec escrita
Base: `main` (092518e)

## 1. Objetivo

Hoje o painel pertence à worktree da **pasta do shell**. Agentes que trabalham em outra worktree por caminho absoluto (`W=/…/.worktrees/tcheerp/dev2; git -C $W …`) aparecem em "⎇ principal". Por isso:
- o cabeçalho e a sidebar mostram a worktree errada;
- a worktree real aparece como "(sem sessão)";
- o ⌘P e os links de arquivo procuram na pasta errada.

O app passa a **deduzir a worktree em que o agente escreve**, a partir dos hooks `PreToolUse` que já recebe, e a tratar essa como a worktree efetiva da sessão.

Fora do escopo:
- leituras como sinal (Read/Grep/Glob não contam);
- worktrees fora dos projetos cadastrados;
- mudar a pasta do shell (o app nunca digita `cd`).

### Critérios de sucesso

1. dev-1 e dev-2 (shell na principal, escrevendo em `.worktrees/tcheerp/dev1` e `dev2`):
   - o cabeçalho mostra "⎇ dev1 ·" e "⎇ dev2 ·", com a marca de deduzido;
   - na sidebar, cada sessão aparece dentro da sua worktree;
   - essas worktrees deixam de estar "(sem sessão)".
2. O Techlead, que lê as worktrees dos outros e faz no máximo uma escrita solta numa delas, continua em "principal".
3. `/clear`, sessão nova ou `cd` no shell voltam para a worktree da pasta do shell.
4. ⌘P e os links de arquivo do terminal passam a usar a worktree efetiva.

## 2. Regras

### Caminhos escritos — função pura `writtenPaths(payload, cwd, home): string[]`

Só para `hook_event_name === 'PreToolUse'`.

**Edit, Write, MultiEdit:** `tool_input.file_path`. **NotebookEdit:** `tool_input.notebook_path`.

**Bash** (`tool_input.command`):
- **Variáveis:** antes, resolve as atribuições do próprio comando (`NOME=valor`, com ou sem aspas, separadas por `;`, `&&` ou nova linha) e substitui `$NOME` e `${NOME}`.
- **Caminhos colhidos:**
  - o argumento de `git -C <p>`;
  - o de `cd <p>`;
  - o destino de `>` e `>>`.
- Variável que não foi definida no comando faz o caminho ser ignorado.

**Codex e outras ferramentas:** quando `tool_name` não é nenhum dos anteriores mas `tool_input` traz `file_path` ou `path` e a ferramenta não é de leitura (`Read`, `Grep`, `Glob`, `LS`, `WebFetch`, `WebSearch`), o caminho conta.

**Normalização:**
- `~` vira `home`;
- relativo é resolvido por `cwd`;
- `.` e `..` são resolvidos.

### Worktree de um caminho — `worktreeOf(path, worktrees): string | null`

É a worktree cadastrada (de qualquer projeto) cujo caminho é o maior prefixo do caminho, com `/` como fronteira. Se nenhuma servir, devolve `null`.

### Troca — função pura `nextInference(state, hit, shellWorktree)`

**Estado por painel:**
- `inferred: string | null`, a worktree deduzida;
- `candidate: { path: string; count: number } | null`.

**A cada escrita com worktree `w`:**
- `w` é igual à efetiva atual (`inferred ?? shellWorktree`) → zera o candidato;
- `w` é diferente e igual ao candidato → `count + 1`; chegando a **2**, `inferred = w` (ou `null`, se `w` for a do shell) e o candidato zera;
- `w` é diferente e diferente do candidato → candidato `{ w, 1 }`.

**Reset** (`inferred = null`, `candidate = null`):
- `SessionStart`;
- `SessionEnd`;
- mudança de `cwd` do painel, seja pelo hook ou pelo poller;
- worktree deduzida que sumiu do cadastro.

Hooks de subagente (`agent_id`) **contam**: o subagente trabalha para a mesma sessão.

## 3. Efeito no app

**`PaneView`:**
- `worktreePath` passa a ser a **efetiva** (deduzida, ou senão a do shell);
- `projectPath`, quando há dedução, é o projeto da worktree deduzida;
- campos novos:
  - `shellWorktreePath: string | null`, a worktree da pasta do shell;
  - `worktreeInferred: boolean`.

**Quem passa a usar a worktree efetiva, sem mudança de código:**
- sidebar, contagem de sessões por worktree, cabeçalho;
- `sharesContext`;
- status do git do cabeçalho;
- `pickerRoot` (⌘P);
- bases dos links de arquivo;
- `GIT_HINT_EVENTS` (refresh do git na worktree certa).

**Cabeçalho:** com `worktreeInferred`, o bloco da worktree mostra "⎇ dev2 ·" (um "·" depois do nome) e o tooltip diz:

> o agente está editando em dev2; o shell está em principal

## 4. Falhas

| Situação | Comportamento |
|---|---|
| Worktree deduzida removida | Reset para a do shell |
| `$VAR` não definida no comando | Caminho ignorado |
| Escrita fora de projeto cadastrado | Ignorada |
| Escritas intercaladas em worktrees diferentes | Candidato reinicia; não troca |
| Duas sessões na mesma worktree | Independentes |

## 5. Testes

- **`writtenPaths`:**
  - Edit e Write;
  - NotebookEdit;
  - Bash com `git -C`, `cd … &&` e `>`/`>>`;
  - o comando real `W=/Users/u/Documents/weboption/.worktrees/tcheerp/dev2; git -C $W status --short | head -3; git -C $W fetch …`;
  - `${VAR}` e aspas;
  - variável indefinida;
  - Read, Grep e `cat x` não contam;
  - `~`, `..` e relativo.
- **`worktreeOf`:** maior prefixo, com a fronteira `/` (`/r/api2` não é de `/r/api`), e `null` fora.
- **`nextInference`:**
  - 1 escrita não troca;
  - 2 seguidas trocam;
  - uma intercalada zera;
  - voltar a escrever na do shell desfaz;
  - o reset.
- **Daemon (`daemon.test.ts`):** projeto com worktree `wt`; painel com shell na principal; dois hooks `PreToolUse` Write em `wt`. A partir daí, `panes[0]` vem com:
  - `worktreePath = wt`;
  - `shellWorktreePath = principal`;
  - `worktreeInferred = true`.

  Um hook `SessionStart` volta para a principal.
- **Cabeçalho:** `headerView` expõe `worktreeInferred` e `shellWorktree`, com o rótulo para o tooltip.
