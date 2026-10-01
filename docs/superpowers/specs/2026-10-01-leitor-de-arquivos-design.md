# Gerenciador de Terminal — Leitor e editor de arquivos — Design

Data: 2026-10-01
Status: aprovado em conversa (3 seções), aguardando revisão da spec escrita
Base: `main` (f114175)

## 1. Objetivo

Abrir um arquivo de vez em quando, sem sair do app, para **ler um `.md`** (relatórios e planos que os agentes escrevem) ou **mexer num `.env`** ou numa configuração. O app é uma IDE de desenvolvimento guiado por IA, não um editor de código: o leitor é uma ferramenta pontual, não o centro.

Fora do escopo:
- árvore de pastas;
- abas de arquivo dentro do painel;
- autocompletar, ir para definição, LSP;
- diff;
- edição de binários;
- arquivos com mais de 2 MB.

### Critérios de sucesso

1. ⌘+clique em `.private/revisao-interna/frente-a-projetos.md` citado por um agente abre o arquivo renderizado à direita do terminal.
2. ⌘P na worktree em foco acha e abre o `.env`, mesmo com o `.env` no `.gitignore`. Editar e salvar com ⌘S grava no disco preservando as permissões.
3. Se um agente altera o arquivo aberto:
   - sem edição local, o painel recarrega sozinho;
   - com edição local, aparece **Recarregar / Manter o meu**, e nenhum dos dois lados é perdido sem você escolher.
4. Fechar e reabrir o app traz o painel de arquivo de volta, no mesmo lugar.

## 2. O que o usuário vê

### Painel de arquivo

É um painel como os outros: divide, arrasta, troca de aba e encosta nas bordas.

**Cabeçalho:**
- 📄 nome do arquivo + caminho relativo à worktree, em cinza (absoluto quando o arquivo está fora de projeto);
- **● não salvo** quando há alterações;
- **Visualizar / Editar** nos `.md`;
- ✕.

**Corpo:** CodeMirror 6.
- cores pelo tipo do arquivo: markdown, json, yaml, js/ts e um modo simples para `.env` (chave, `=`, valor e comentário com `#`);
- números de linha, ⌘F para buscar, ⌘Z / ⇧⌘Z;
- **⌘S salva**.

**`.md`:** abre **renderizado** (títulos, listas, tabelas, código); **Editar** troca para texto. A escolha fica salva no painel.

**Fechar com alterações:** "Descartar as alterações em `<arquivo>`?".

**Mudou no disco:**
- **sem edição local:** recarrega e mostra "atualizado do disco" por 2 s;
- **com edição local:** faixa "O arquivo mudou no disco" com:
  - **Recarregar**: descarta a sua edição;
  - **Manter o meu**: o próximo ⌘S sobrescreve o disco.

**Grande (mais de 2 MB) ou binário:** "Não dá para abrir este arquivo aqui", com os botões **Abrir no app padrão** e **Mostrar no Finder**.

**Sumiu:** "Arquivo não encontrado", com:
- **Salvar mesmo assim**, que recria o arquivo, quando há conteúdo;
- **Fechar**.

### Como abrir

1. **⌘+clique num caminho dentro do terminal.**
   - **Quais caminhos viram link:** os relativos à pasta do painel (`a/b.md`, `./x`, `.env`, `src/app.ts:42`) e os absolutos, desde que o arquivo exista.
   - **Onde abre:** à direita do terminal, já na linha quando vem `:N`.
2. **⌘P "Abrir arquivo…"**: busca aproximada nos arquivos da worktree do painel em foco; Enter abre à direita do painel em foco. O atalho pode ser trocado na aba Atalhos.
3. **Clique direito numa worktree → "Abrir arquivo…"**: a mesma busca, naquela worktree.

Os painéis de arquivo **não** aparecem na lista de sessões da sidebar nem na contagem de sessões.

## 3. Como funciona

### Layout

- O painel de arquivo é uma folha comum `{ type: 'leaf', paneId: 'file:<uuid>' }`.
- `Layout` ganha `files?: Record<string, { path: string; mode: 'view' | 'edit' }>`, indexado pelo `paneId`.
- Dividir, mover, encostar nas bordas e trocar de aba funcionam sem mudança, porque essas funções só olham o id.
- Remover a folha de um arquivo apaga a entrada em `files`.
- **Onde todo painel é tratado como terminal,** os ids `file:` são ignorados: sidebar, contagem de sessões, aviso de atenção da aba, `sharesContext` e `placePane`.
- `isFilePane(id)` é a função única que decide isso.

### Daemon: `src/daemon/files.ts`

**`readFile(path)`** devolve `{ content, mtimeMs, size }` ou os erros:
- `file-missing`;
- `file-too-large` (mais de 2 MB);
- `file-binary` (byte nulo nos primeiros 8 KB);
- a mensagem do sistema para os demais (sem permissão etc.).

**`writeFile(path, content, expectedMtimeMs | null)`:**
- se `expectedMtimeMs` não for `null` e a data de modificação atual for diferente, devolve `file-changed`;
- grava no próprio arquivo, preservando modo e dono;
- se o arquivo não existe, cria, e cria as pastas que faltam;
- devolve a nova data de modificação.

**`FileWatcher`:**
- vigia com `fs.watch` por caminho, com contador de assinantes;
- agrupa eventos em 150 ms;
- avisa `{ path, mtimeMs | null }`, com `null` quando o arquivo foi apagado.

**`listFiles(root)`:**
- **com git:** `git ls-files -co --exclude-standard` mais os `.env*` ignorados (`git ls-files -oi --exclude-standard -- '.env*' '**/.env*'`);
- **sem git:** varre as pastas, pulando `node_modules`, `.git`, `dist`, `out` e `build`;
- **limite:** 20 mil, com `truncated: true` quando passa.

**`existing(cwd, paths)`:** resolve relativos por `cwd` e devolve só os que existem e são arquivos.

### Protocolo

- **Requisições:**
  - `file.read`, `file.write`;
  - `file.watch { path }`, `file.unwatch { path }`, uma assinatura por conexão, liberada ao desconectar;
  - `file.list { root }`;
  - `file.exists { cwd, paths }`.
- **Evento do daemon para a interface:** `{ t: 'file.changed'; path: string; mtimeMs: number | null }`.

### Interface

- **`file-links.ts` (puro):** `findPathCandidates(line)` devolve `{ text, path, line?, start, end }[]`.
  - **Reconhece:** caminhos com `/` ou extensão conhecida, nomes `.env*`, `:N` e `:N:M` no fim, e caminhos com espaço entre aspas.
  - **Ignora:** URLs (`http://`, `https://`), pontuação final (`.`, `,`, `)`, `:`) e textos sem cara de caminho, como `e.g.` e versões tipo `1.2.3`.
- **Links no xterm:** `registerLinkProvider` → candidatos da linha → `file.exists` (cache de 30 s por cwd) → links sublinhados; a ativação exige ⌘ (Ctrl no Linux). Convive com o `WebLinksAddon` das URLs.
- **`FilePane.tsx`:** CodeMirror 6 + `marked` + `DOMPurify`. Assina `file.watch` enquanto está montado.
- **`FilePicker.tsx`:** usa a busca aproximada (`fuzzyScore`) que o ⌘K já usa.
- **`actions.ts`:** `openFile(path, opts: { line?, besidePaneId? })` cria a folha `file:` à direita do painel indicado (ou do painel em foco) e registra em `layout.files`.
- **Atalho:** ação nova `openFile` ("Abrir arquivo…", padrão ⌘P / Ctrl+P no Linux) no registro de atalhos.

### Dependências novas

`codemirror`, `@codemirror/lang-markdown`, `@codemirror/lang-json`, `@codemirror/lang-yaml`, `@codemirror/lang-javascript`, `@codemirror/legacy-modes` (properties/shell para `.env`), `marked`, `dompurify`.

## 4. Falhas

| Situação | Comportamento |
|---|---|
| Arquivo apagado com o painel aberto | "Arquivo não encontrado" + **Salvar mesmo assim** / Fechar |
| App reaberto com arquivo apagado | O mesmo, sem conteúdo (só Fechar) |
| Sem permissão | Mensagem do erro no painel; edição mantida |
| Salvar com mudança no disco | `file-changed` → faixa **Recarregar / Manter o meu** |
| Caminho do terminal inexistente | Não vira link |
| `.md` com HTML/script | `DOMPurify` limpa; script não roda; links abrem no navegador |
| Mais de 20 mil arquivos no ⌘P | Lista parcial com o aviso "lista parcial" |
| Grande/binário | Tela "Não dá para abrir este arquivo aqui" |

## 5. Testes

- **Daemon (`tests/daemon/files.test.ts`):**
  - ler, criar e salvar; os erros `file-missing`, `file-too-large` e `file-binary`;
  - `file-changed` com mtime antigo e sucesso com `null`;
  - permissão preservada (`chmod 600` mantido);
  - watcher avisa quando o arquivo muda e quando é apagado, e para de avisar no unwatch;
  - `listFiles` com git: versionado, não adicionado, `.env` ignorado incluído, `node_modules` fora;
  - `listFiles` sem git: varredura e limite;
  - `existing` com relativos e absolutos.
- **Daemon (`daemon.test.ts`):**
  - `file.read` / `file.write` / `file.list` pelo protocolo;
  - `file.changed` chega para quem assinou.
- **Detector (`tests/renderer/file-links.test.ts`):**
  - relativo, absoluto, `:N`, `:N:M`;
  - pontuação final;
  - URL ignorada;
  - `.env` sozinho;
  - caminho entre aspas com espaço;
  - `1.2.3` e `e.g.` ignorados.
- **Layout (`tests/renderer/layout.test.ts`, `sidebar-model.test.ts`, `header.test.ts`):**
  - painel de arquivo entra e sai e limpa `layout.files`;
  - a sidebar e o `sharesContext` ignoram `file:`.
- **Teste real com o usuário:**
  - ⌘+clique num `.md` citado por um agente;
  - editar e salvar um `.env`;
  - um agente altera o arquivo aberto e aparece a faixa de conflito.
