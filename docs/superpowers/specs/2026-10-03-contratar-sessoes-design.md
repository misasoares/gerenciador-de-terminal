# Gerenciador de Terminal — Contratar sessões (MCP do líder) — Design

Data: 2026-10-03
Status: aprovado em conversa (4 partes), aguardando revisão da spec escrita
Base: `main` (86c17e7), branch `feat/contratar`

## 1. Objetivo

Hoje o usuário cria os devs à mão: abre 5 terminais, renomeia para `dev-1`…`dev-5`, manda "oi" para cada um aparecer no `ListAgents` do techlead, e só então o techlead distribui o trabalho pelo `SendMessage` nativo do Claude Code.

Com esta feature, o usuário pede ao techlead "contrata 5 devs e organiza essas tarefas", e o próprio techlead abre os 5 terminais **como se o usuário tivesse aberto**: com nome, conta, worktree própria e o prompt inicial já enviado.

Decisões do usuário:
- ferramentas por um servidor MCP local que vem **dentro do app** (mac e pacotes Linux), sem instalação à parte;
- os devs nascem **na aba do líder**, dividindo a tela (o terminal flutuante, projeto futuro, vira outra opção de `onde`);
- o líder escolhe a **conta** em cada chamada; sem escolha, vale a dele;
- o app cria uma **worktree git nova** para cada dev; o líder escolhe a **base**, e o padrão é a branch atual dele;
- só sessões marcadas pelo usuário como **líder** podem usar as ferramentas.

Fora do escopo:
- mandar mensagem entre sessões (o `SendMessage` nativo do Claude Code já faz, pelo nome de exibição);
- remover worktree pelo MCP (continua manual, pela sidebar, que já checa alterações e commits);
- Codex (não tem nome de sessão nem `SendMessage`);
- terminal flutuante (projeto próprio).

### Critérios de sucesso

1. Com o techlead marcado como líder, "contrata 3 devs para X, Y e Z" abre 3 painéis na aba dele, chamados `dev-1`…`dev-3`, cada um na sua worktree `.claude/worktrees/dev-N`, com o prompt já enviado.
2. O `SendMessage` do techlead alcança `dev-1` pelo nome, sem o usuário mandar "oi".
3. Uma sessão que não é líder recebe recusa clara ao tentar criar sessão.
4. O `.deb`/AppImage do Victor já traz o MCP funcionando, sem passo extra.

## 2. Ferramentas (o que o líder vê)

- **`criar_sessao`**
  - `nome` (obrigatório), `prompt?`, `conta?` (padrão: a do líder), `worktree?` (padrão `true`), `base?` (padrão: branch atual do líder), `onde?` (só `"aba-do-lider"` por enquanto);
  - devolve `{ nome, pasta, branch, conta }` (nome e branch finais, já com número se repetidos).
- **`listar_sessoes`** → sessões do espaço do líder: `nome`, `status` (`trabalhando` | `pedindo-permissao` | `sua-vez` | `ocioso` | `terminal`), `conta`, `pasta`, `branch`, `criadaPorMim`.
- **`renomear_sessao { nome, novo_nome }`**.
- **`encerrar_sessao { nome }`** → só sessões que o líder criou; a worktree fica.

## 3. Como funciona

### Peças

- **`gt-mcp`** (`src/mcp/server.ts`, empacotado como `out/main/gt-mcp.js`): servidor MCP em stdio, sem dependências externas (JSON-RPC à mão: `initialize`, `tools/list`, `tools/call`). Lê `GT_SOCKET` e `GT_PANE_ID` do ambiente e repassa cada chamada ao daemon com `{ t: 'mcp.call', callerPaneId, tool, args }`.
- **Config do MCP:** no início, o daemon grava `<GT_HOME>/mcp.json` com `{ mcpServers: { "gerenciador-terminal": { command: <process.execPath>, args: [<gt-mcp.js>], env: { ELECTRON_RUN_AS_NODE: "1" } } } }`. O caminho do binário é regravado a cada início (no AppImage a montagem muda).
- **Comando do Claude:** toda sessão Claude aberta pelo app (nova ou retomada) recebe ` --mcp-config <mcp.json>`. As criadas pelo líder recebem também ` -n <nome>` e o prompt como `"$(cat <arquivo>)"`, com o prompt gravado em `<GT_HOME>/prompts/<paneId>.txt` (o arquivo é apagado quando a sessão é esquecida, e o daemon limpa no início os de sessões que não existem mais; apagar logo após iniciar dependeria de quando o shell lê o arquivo).
- **Citação no shell:** caminhos e nomes com espaço, aspas e acentos são citados com aspas simples (`'…'"'"'…'`).

### Dados

- `paneMeta[paneId]` ganha `leader?: boolean` e `createdBy?: string` (paneId do líder). Ficam no `state.json` e sobrevivem a retomar e a reiniciar.
- `PaneView` ganha `leader: boolean` e `createdBy: string | null`.
- `settings` ganha `maxHiredPerLeader: number` (padrão 10).
- Requisição nova `pane.setLeader { paneId, leader }` (menu da sessão).

### `criar_sessao` no daemon

1. confere `paneMeta[caller].leader`; senão, recusa;
2. confere o teto: sessões vivas com `createdBy === caller` < `maxHiredPerLeader`;
3. conta: pelo nome (id ou rótulo, sem diferenciar maiúsculas); sem conta, a do líder;
4. nome único no espaço do líder (`uniqueName`, com `-2`, `-3` no lugar de " 2");
5. worktree (se `true`): projeto = o do líder; base = `base` ou a branch atual do líder; `git worktree add -b <base>-<nome> <projeto>/.claude/worktrees/<nome> <base>`, com branch e pasta únicas;
6. `panes.create` no espaço do líder, com o comando montado; `paneMeta` = `{ name, createdBy: caller }`;
7. layout do espaço do líder: a folha nova entra ao lado da última folha da aba do líder (split `row`); a janela aceita pela regra de sessão recém-chegada (`mergeIncomingLayout`).

### Interface

- Menu da sessão na sidebar: **"Pode contratar sessões (líder)"** (liga e desliga).
- 👑 antes do nome do líder na sidebar e no cabeçalho do painel.
- Preferências → Sessões: "Máximo de sessões por líder".

## 4. Falhas

| Situação | Comportamento |
|---|---|
| Não é líder | "esta sessão não é líder; peça ao usuário para marcá-la no menu da sessão" |
| Teto atingido | "limite de N sessões atingido; encerre alguma ou aumente o limite nas preferências" |
| Nome repetido no espaço | `dev-1-2`; a resposta traz o nome final |
| Branch já existe | `feat-x-dev-1-2` |
| Conta desconhecida | erro com a lista de contas válidas |
| Líder fora de git ou em HEAD solto, com worktree | erro sugerindo `worktree: false` ou `base` explícita |
| `git worktree add` falha | erro com a mensagem do git; nenhuma sessão criada |
| `encerrar_sessao` de sessão não criada pelo líder | recusa |
| Janela do espaço fechada | cria normalmente; aparece ao reabrir |
| Sem `GT_PANE_ID` / sem daemon | "fora do Gerenciador de Terminal" / "Gerenciador de Terminal não está rodando" |

## 5. Testes

- **Daemon:** criar com nome, prompt, conta, worktree e base (pasta, branch, comando com `-n`/`--mcp-config`/prompt por arquivo, aba do líder); recusa sem líder; teto; nomes e branches repetidos; `encerrar_sessao` só das criadas; `listar_sessoes` só do espaço; `leader` sobrevive a reiniciar; toda sessão Claude recebe `--mcp-config`.
- **`gt-mcp`:** handshake MCP, `tools/list` com as 4 ferramentas, repasse com `GT_PANE_ID`, erros sem `GT_PANE_ID` e sem daemon.
- **Citação:** caminhos com espaço (`/Volumes/SSD MISA/…`), aspas e acentos.
- **Pacote Linux:** `build-linux.sh` instala o `.deb` num Debian limpo e confirma que o `gt-mcp` responde ao `initialize`.
- **Teste real com o usuário:** marcar o techlead como líder; "contrata 3 devs para X"; conferir worktrees, nomes, aba e o `SendMessage` chegando ao `dev-1`.
