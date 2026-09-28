# Gerenciador de Terminal — Fase 2 — Design

Data: 2026-09-28
Status: aprovado em conversa (3 seções), aguardando revisão da spec escrita
Base: fase 1 em `main` (spec `2026-09-25-gerenciador-de-terminal-design.md`)

## 1. Objetivo

A fase 2 torna o app melhor para o uso diário com muitas sessões em paralelo:

1. Saber **quem precisa de mim**, incluindo o Claude que terminou o turno esperando resposta.
2. Ser avisado quando isso acontece **fora da tela**: em outra aba, com o app em segundo plano ou com o painel oculto.
3. **Antecipar conflitos entre worktrees**, tanto contra a main quanto entre elas.
4. **Personalizar** sessões e terminais.
5. Corrigir os ajustes adiados da revisão da fase 1.

### Critérios de sucesso

1. Quando o Claude termina um turno com uma pergunta em texto, o painel mostra 🔵. Quando o usuário foca o painel, vira ⚪.
2. Uma aba não ativa com um painel 🟡 ou 🔵 mostra uma bolinha. O Dock mostra quantas sessões esperam o usuário.
3. Com o app em segundo plano, uma sessão que entra em 🟡 ou 🔵 gera notificação do macOS. Clicar na notificação leva ao painel.
4. ⌘J visita as sessões que esperam o usuário: primeiro as 🟡, depois as 🔵, da mais antiga para a mais nova.
5. Com duas worktrees que conflitam entre si e não conflitam com a main, a análise aponta o par e os arquivos, **considerando também o que ainda não foi commitado**.
6. É possível renomear e colorir sessões, e escolher tema, fonte e tamanho, com efeito imediato.
7. Os 8 ajustes da seção 6 têm teste e estão corrigidos.

### Fora do escopo

Windows/Linux (fase 3), ver arquivos ou diff no app, commit/push pela interface, resolver conflitos pelo app. Este último fica fora porque o app só aponta os conflitos.

## 2. Atenção: estados, abas, Dock, notificações e ⌘J

### 2.1 Estados da sessão

`SessionStatus` passa a ser `working | needs-you | your-turn | idle`.

| Evento | Novo estado |
|---|---|
| `UserPromptSubmit`, `PreToolUse` (exceto `AskUserQuestion`), `PostToolUse*` | `working` |
| `PermissionRequest`, `PreToolUse` de `AskUserQuestion`, `Notification` com tipo que pede ação | `needs-you` |
| `Stop`, `StopFailure` | `your-turn` |
| `Notification` `idle_prompt` | `your-turn`, exceto quando já está em `idle` (visto), que se mantém |
| `SessionStart` (`startup`, `resume`, `clear`) | `idle` |
| `SessionStart` (`compact`) | mantém |
| nova mensagem `pane.seen` do app (o painel foi focado) | `your-turn` → `idle`; os outros estados não mudam |

`ClaudeSession` ganha `statusSince: number` (epoch ms), atualizado a cada mudança de estado. O ⌘J usa esse campo para ordenar.

A marcação de "visto" é guardada no daemon, então vale para qualquer cliente e sobrevive a reabrir o app.

**Quando o app manda `pane.seen`:** quando o painel recebe foco e a janela está focada, e também quando a janela volta ao foco com aquele painel ativo.

### 2.2 Onde aparece

- **Cabeçalho e sidebar:** ponto 🟢 🟡 🔵 ⚪. Painel `needs-you` com contorno âmbar (já existe). Painel `your-turn` com contorno azul discreto.
- **Aba:** se a aba não está ativa e algum painel dela está `needs-you` ou `your-turn`, a aba mostra uma bolinha com a cor do mais urgente (🟡 > 🔵).
- **Dock:** `app.dock.setBadge` com o total de sessões vivas em `needs-you` ou `your-turn`. Vazio quando for zero.
- **Notificação do macOS:** disparada na **transição** para `needs-you` ou `your-turn`, e só se `!janelaFocada || !painelVisívelNaAbaAtiva`.
  - Título: `PROJETO · ⎇ worktree`.
  - Corpo: `<nome/título da sessão> — pedindo permissão` (ou `— terminou, sua vez`).
  - Clicar foca a janela e revela o painel (mesma ação do ⌘J).
  - A regra de quando notificar é uma função pura no renderer; a notificação em si é criada pelo processo principal (`Notification` do Electron).
- **⌘J:** revela a próxima sessão, ordenando por `needs-you` antes de `your-turn` e, dentro de cada grupo, `statusSince` crescente. Troca de aba ou abre o painel num split se estiver oculto, e pisca o contorno. A partir da sessão em foco, vai para a próxima da lista, com volta ao início.

### 2.3 Aviso de hooks

- Enquanto houver `hookWarnings`, o topo da área de terminais mostra uma **faixa amarela que não pode ser fechada**, com o botão "Instalar hooks".
- Depois de instalar, a faixa mostra por alguns segundos: "Hooks instalados ✓, reinicie as sessões do Claude abertas (/exit e `claude-… --continue`)".
- Se der erro, ele aparece dentro da própria faixa.
- O link na barra de status sai.

## 3. Análise de conflitos entre worktrees

### 3.1 Algoritmo (só git, não altera nada)

Para um projeto:

1. **Retrato (tip) de cada worktree que não seja prunable:**
   - se `git status --porcelain` está vazio, o tip é `HEAD`;
   - se há alterações, o tip é um commit de trabalho em andamento criado sem tocar no índice real:
     `GIT_INDEX_FILE=<tmp> git read-tree HEAD` → `git add -A` (respeita o `.gitignore`) → `git write-tree` → `git commit-tree <tree> -p HEAD -m wip`.
     O commit fica solto e o `gc` do git o remove. O índice temporário é apagado ao final.
   - A worktree fica marcada com `dirty: true`.
2. **Base:** o tip da worktree principal, calculado da mesma forma, porque a main também pode ter alterações locais.
3. **Contra a main:** para cada worktree não principal cujo tip difere da base, `git merge-tree --write-tree --name-only --no-messages <base> <tip>`.
   - Código de saída 1 significa conflito: da segunda linha em diante, a saída traz os arquivos.
   - Código 0 significa limpo.
   - Outro código significa erro.
4. **Par a par:** a mesma comparação entre os tips de cada par (i < j) de worktrees não principais.
5. **Atalho:** worktrees com tip igual à base, ou pares com tips iguais, não são comparados e entram como "sem conflito".
6. Tudo roda no daemon, com no máximo 4 comandos git ao mesmo tempo e timeout de 30 s por comando.

### 3.2 Estado e disparo

- `ProjectView.conflicts: ConflictReport | null`, onde `ConflictReport = { analyzedAt, running, vsMain: {worktreePath, files[], dirty}[], pairs: {a, b, files[], dirty}[], cleanPairs: number, errors: {worktreePath, message}[] }`.
- Nova requisição `conflicts.analyze { projectPath }`.
- Depois da primeira análise de um projeto, o daemon refaz a análise **5 s** depois da última mudança de status git em qualquer worktree dele. Chamadas repetidas nesse intervalo se juntam numa só.
- Não há análise automática em projetos que nunca foram analisados.

### 3.3 UI

- Ícone "Analisar conflitos" na linha do projeto na sidebar, e o mesmo item no menu do botão direito do projeto.
- ⚠ laranja na linha da worktree que tem conflito, com tooltip "conflita com: main, auth-refactor".
- Modal de resultado, aberto pelo botão ou pelo ⚠, com três seções:
  - "Contra a main": ✓ ou ⚠ por worktree, com os arquivos em conflito;
  - "Entre worktrees": só os pares com conflito, cada um com seus arquivos e a frase "Se mergear A primeiro, B vai conflitar (e vice-versa).";
  - resumo "Sem conflito: N pares".
- Itens com `dirty` recebem o selo "inclui alterações não commitadas".
- Erros aparecem como "não analisada: motivo".
- O modal tem um botão ↻ e mostra "analisado há X".

## 4. Personalização

- **Por sessão:** `PaneMeta = { name: string | null, color: string | null }`, persistido no daemon pelo `paneId`, também para painéis retomáveis. Nova requisição `pane.meta { paneId, name?, color? }`.
  - **Renomear:** duplo clique no nome do cabeçalho, ou botão direito → "Renomear…". O nome vence o título automático em todos os lugares. Nome vazio volta ao título automático.
  - **Cor:** botão direito → "Cor" → uma de 8 cores, ou nenhuma. Aparece como faixa de 3 px no topo do cabeçalho e marcador na linha da sidebar.
- **Preferências (⌘,):** modal com tema do terminal (VS Code Dark, One Dark, Dracula, Solarized Dark, GitHub Dark, Nord), fonte, tamanho (10–24) e altura de linha (1.0–1.6).
  - Persistido em `state.json` como `settings` e publicado no `AppState`.
  - Aplica na hora em todos os terminais (`term.options.*` + `fit`).
- **⌘K:** paleta de busca que filtra sessões (nome, título, conta), projetos e worktrees, com correspondência por subsequência e sem diferenciar acentos nem maiúsculas.
  - Enter numa sessão a revela.
  - Enter numa worktree abre "Nova sessão" já preenchida.
  - Enter num projeto revela a primeira sessão dele ou abre "Nova sessão".

## 5. Mudanças de protocolo

Novas requisições: `pane.seen`, `pane.meta`, `pane.detach`, `conflicts.analyze`, `settings.save`. O `pane.attach` passa a levar `seq`, e as mensagens `pane.data` passam a trazer `seq`.

O `hello` passa a comparar `buildId`, gerado no build (hash do commit ou timestamp), além de `PROTOCOL_VERSION`. Qualquer diferença mostra o aviso "Reiniciar daemon quando eu quiser". `PROTOCOL_VERSION` sobe para 2.

## 6. Ajustes adiados da fase 1

1. **⌘R/reload duplicando saída:** cada `pane.attach` leva um número de sequência e o daemon marca cada `pane.data` com ele. O renderer descarta dados com sequência antiga. Ao descartar um painel, o renderer envia `pane.detach`.
2. **Memória:** a instância do xterm recebe `dispose()` quando o painel é esquecido ou descartado.
3. **Título:** o transcript é lido de forma incremental, a partir do último offset por arquivo, guardando o último título encontrado.
4. **Remover worktree:**
   - a checagem lista os arquivos ignorados que seriam apagados (`git status --ignored --porcelain`), sem `node_modules`, `dist`, `.next`, `build`, `vendor` e caches;
   - a remoção de uma worktree prunable apaga só o diretório administrativo dela, em vez de rodar `git worktree prune` para todas;
   - o `git log` ganha `--` para não confundir nomes de branch com arquivos.
5. **Comando antes do prompt:** o comando da conta só é digitado depois da primeira saída do shell seguida de 300 ms sem saída, ou depois de 5 s no máximo.
6. **Dois daemons:** trava exclusiva em `daemon.lock` (pid; trava velha de processo morto é recuperada). Sem a trava, o daemon sai sem apagar o socket.
7. **Versão:** usa o `buildId` da seção 5.
8. **Hook:** `nc -w 1`.

## 7. Testes

- **Unitários:**
  - transições de estado, incluindo `pane.seen`;
  - ordem do ⌘J;
  - bolinha da aba;
  - regra de notificar;
  - contagem do Dock;
  - parser do `merge-tree`;
  - filtro de ignorados;
  - busca do ⌘K (acentos, subsequência);
  - `PaneMeta` e settings persistidos;
  - trava do daemon;
  - espera pelo prompt.
- **Integração:** análise de conflitos com repositório real contendo 3 worktrees, com pares em conflito só por commit e só por alterações não commitadas (arquivo novo), e worktree idêntica à main; também o descarte de dados com sequência antiga, com daemon real.
- **Visual:** screenshots via CDP de aba com bolinha, faixa de hooks, modal de conflitos, ⌘K e Preferências.
- **Manual:** notificação real do macOS e clique nela, ⌘J/⌘K/⌘, pelo teclado, e o badge do Dock.
