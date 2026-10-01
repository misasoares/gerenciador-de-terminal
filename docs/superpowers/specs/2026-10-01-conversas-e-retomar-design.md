# Gerenciador de Terminal — Navegador de conversas e retomar à prova de falha — Design

Data: 2026-10-01
Status: aprovado em conversa (3 seções), aguardando revisão da spec escrita
Base: `main` (c2c2ad0). Parte "a" da fase de confiabilidade (ver memória `fase-atual-ordem`).

## 1. Objetivo

1. **Retomar nunca falha às cegas:** antes de rodar `--resume`, o app confere se a conversa existe. Se não existir, oferece escolher outra da mesma pasta, e não abre um terminal com "No conversation found".
2. **Navegador de conversas:** um recurso próprio, que você abre quando quiser, para listar e retomar qualquer conversa do Claude ou do Codex de uma worktree ou de um projeto, inclusive conversas que nunca passaram pelo app.

Caso real que motivou: o painel `weboption` em `~/Documents/weboption/tcheerp` guardou o id `0c218190…`, mas o Claude nunca gravou esse arquivo.
- **Causas conhecidas:**
  - sessão aberta sem nenhuma mensagem: o Claude só cria o `.jsonl` depois da primeira;
  - `/clear`: gera um id novo.
- **O que falta no app hoje:**
  - não guarda o `transcript_path`;
  - não confere se o arquivo existe antes de retomar.

Fora do escopo:
- busca em todas as pastas ao mesmo tempo;
- apagar ou renomear conversas;
- prévia do conteúdo além da primeira mensagem;
- projetos sem git, que têm design próprio.

### Critérios de sucesso

1. No TCHEERP, "Conversas desta worktree…" lista as conversas do Claude e do Codex da pasta, da mais recente para a mais antiga, com a conta certa em cada uma.
2. **Retomar** abre um painel com o comando certo e a conversa continua. Nunca aparece "No conversation found".
3. Uma conversa salva cujo arquivo sumiu abre o painel de sessão perdida com **"Escolher conversa…"**. O "Retomar todas" avisa quantas não foram encontradas.
4. Reabrir a janela de uma pasta já lida é instantâneo: o cache não relê arquivo que não mudou.

## 2. O que o usuário vê

### Por onde abrir

- Clique direito numa worktree (sidebar) → **"Conversas desta worktree…"**.
- Clique direito num projeto → **"Conversas do projeto…"**, que lista todas as worktrees do projeto.
- Painel de sessão perdida → **"Escolher conversa…"**. A janela abre filtrada na pasta e na conta daquele painel, com a conversa mais recente selecionada.
- A paleta de comandos ganha essa entrada quando for feita.

### Janela "Conversas · <PROJETO> ⎇ <worktree>"

- **Campo de filtro** no topo, que busca no título e na primeira mensagem, sem diferenciar maiúsculas de acentos.
- **Lista** da mais recente para a mais antiga. Cada linha mostra:
  - tipo (`Claude` ou `Codex`);
  - **título**: o nome dado à conversa (`custom-title`) ou, sem nome, os primeiros 80 caracteres da primeira mensagem;
  - branch, horário relativo ("há 2 h", "ontem 14:10") e número de mensagens;
  - **conta**: deduzida do perfil onde o arquivo está, com um seletor quando mais de uma conta usa o mesmo perfil. O padrão é a primeira da lista de agentes;
  - na janela de projeto, a worktree de cada conversa.
- **Conversa aberta agora** (algum painel vivo com aquele id): o botão vira **Focar**, que traz o painel em vez de abrir outro.
- **Retomar** (Enter ou clique): abre um painel novo ao lado do que está em foco, com a conta escolhida.
  - Claude: `<comando> --resume <id>`.
  - Codex: `<comando> resume <id>`.
- **Navegação:** ↑↓ percorre a lista e Esc fecha.

### Estados

- **Lendo pela primeira vez:** "lendo conversas…". A lista aparece quando a leitura termina.
- **Vazia:** "Nenhuma conversa nesta pasta". Na janela de worktree, um link **"ver o projeto inteiro"**.
- **Conta não configurada:** a linha aparece com "conta não configurada" e o Retomar desabilitado, com a dica "cadastre o agente na aba Agentes".

### Retomar à prova de falha

- O `transcript_path` dos hooks passa a ser guardado com o id: em `ResumeEntry` e nos painéis persistidos, como `transcriptPath`.
- No `pane.create` com `resumeSessionId`, o daemon confere se a conversa existe:
  - pelo `transcriptPath` guardado;
  - sem ele, procurando o arquivo do id nos perfis conhecidos (Claude) ou nos rollouts (Codex).
- **Não existe:** responde o erro `conversation-missing` e não digita nada. O painel mostra "A conversa salva não foi encontrada" + **"Escolher conversa…"** + **Descartar**.
- **"Retomar todas":** retoma as que existem e mostra na barra de status "N conversas não encontradas", com o link **Escolher**. O link abre a janela da primeira delas; as demais ficam como painéis de sessão perdida.

## 3. Como funciona

### Daemon: `src/daemon/conversations/`

- **`paths.ts`**
  - `projectDirName(cwd)`: troca cada caractere fora de `[A-Za-z0-9-]` por `-` (por exemplo, `/Volumes/SSD MISA/x` vira `-Volumes-SSD-MISA-x`). A regra é conferida em teste contra pastas reais de `~/.claude/projects` antes de ser assumida; se divergir, a função segue o que o Claude faz de verdade.
  - `claudeProfiles(userHome, seen)`: `~/.claude` mais os `CLAUDE_CONFIG_DIR` já vistos em hooks.
- **`claude.ts`** — `listClaude(cwds, profiles, cache)`:
  - para cada perfil e cada `cwd`, lê `projects/<projectDirName>/*.jsonl`;
  - do **começo** (64 KB), tira a primeira mensagem do usuário (ignorando mensagens de sistema que começam com `<`), a `gitBranch` e o `cwd`;
  - do **fim** (64 KB), tira o `custom-title` mais recente (reusando a lógica do `title.ts`), o último `timestamp` e uma contagem aproximada de mensagens;
  - linhas que não são JSON válido (por exemplo, a última, cortada) são ignoradas;
  - arquivo sem nenhuma mensagem do usuário e sem título não é listado.
- **`codex.ts`** — `listCodex(cwds, codexHomes, cache)`:
  - percorre `sessions/AAAA/MM/DD/rollout-*.jsonl`;
  - lê a primeira linha (`session_meta`: `id`, `cwd`, `timestamp`) e filtra pela pasta;
  - lê o começo do arquivo para tirar a primeira mensagem do usuário.
- **`accounts.ts`**: a conta é deduzida pelo perfil com a regra de hoje (`configDirMatch` / `isDefault` por tipo). Devolve todas as contas candidatas, na ordem da lista de agentes; sem nenhuma candidata, a lista fica vazia.
- **Cache:** `Map<arquivo, { size, mtimeMs, info }>` em memória. A leitura roda com no máximo 8 arquivos em paralelo.
- **`exists(agent, sessionId, transcriptPath, profiles)`:** é a checagem usada pelo `pane.create`.

### Estado e protocolo

- **`Persisted`:**
  - `claudeProfiles: string[]`, os `CLAUDE_CONFIG_DIR` vistos;
  - `codexHomes: string[]`, os `CODEX_HOME` vistos;
  - os dois são atualizados no `case 'hook'`.
- **`ResumeEntry` e `PersistedPane`:** ganham `transcriptPath?: string | null`.
- **`conversations.list { paths: string[] }`:** devolve `ConversationInfo[]`, assim:

```ts
interface ConversationInfo {
  agent: AgentKind
  sessionId: string
  cwd: string
  title: string
  branch: string | null
  lastActivity: number       // epoch ms
  messages: number
  accountIds: string[]       // candidatas; [] = conta não configurada
  openPaneId: string | null  // painel vivo com esta sessão
}
```

- **`pane.create`:** com `resumeSessionId` de conversa inexistente, falha com `Error('conversation-missing')`.

### Renderer

- **`ConversationsModal.tsx`**, com um modelo puro em `conversations-model.ts` para filtro, título exibido e horário relativo.
- **`flows.ts`**: entradas nos menus de projeto e worktree, e "Escolher conversa…".
- **`PaneFrame.tsx`**: no estado de sessão perdida, trata `conversation-missing`.
- **`resumeAll`**: conta as conversas não encontradas e mostra o aviso na status bar.

## 4. Falhas

| Situação | Comportamento |
|---|---|
| Pasta sem conversas | Janela vazia + "ver o projeto inteiro" |
| Última linha cortada / arquivo em escrita | Linha ignorada; mostra o que deu para ler |
| Conversa só aberta e fechada | Não aparece |
| Perfil sem conta configurada | "conta não configurada", Retomar desabilitado |
| Conversa salva sumiu | `conversation-missing` → "Escolher conversa…" |
| Centenas de arquivos | 8 em paralelo + cache; "lendo conversas…" |
| Perfil que nunca mandou hook | Não é listado até a primeira sessão daquela conta rodar no app (limitação conhecida; a parte "c" investiga o aprendizado de logins) |

## 5. Testes

- **`projectDirName`:**
  - casos com espaço, ponto e barra;
  - conferência contra pastas reais de `~/.claude/projects`, num teste que só roda localmente (`it.skipIf` sem a pasta).
- **Leitura do Claude**, com `.jsonl` falsos:
  - primeira mensagem, ignorando as de sistema;
  - branch e `custom-title` mais recente;
  - última linha cortada;
  - arquivo vazio, que não é listado.
- **Leitura do Codex**, com rollouts falsos:
  - filtro pelo `cwd` do `session_meta`;
  - primeira mensagem.
- **Contas:**
  - perfil compartilhado (weboption e weboption-max): duas candidatas, na ordem da lista;
  - perfil sem conta: lista vazia.
- **Cache:** arquivo inalterado não é relido (leitor contado).
- **Daemon (`daemon.test.ts`):**
  - `conversations.list` devolve as conversas, com `openPaneId` preenchido para um painel vivo;
  - `pane.create` com conversa ausente falha com `conversation-missing`; com conversa existente, digita o comando.
- **Modelo do renderer:** filtro sem acento e sem diferenciar maiúsculas, título exibido e horário relativo.
- **Teste real com o usuário:**
  - abrir as conversas do TCHEERP e retomar uma conversa antiga;
  - abrir a conversa daquele painel weboption pelo "Escolher conversa…".
