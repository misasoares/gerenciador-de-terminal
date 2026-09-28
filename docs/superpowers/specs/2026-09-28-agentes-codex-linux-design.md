# Gerenciador de Terminal — Agentes (Claude + Codex), setup e build Linux — Design

Data: 2026-09-28
Status: aprovado em conversa (2 seções), aguardando revisão da spec escrita
Base: `main` depois da fase 2 (specs `2026-09-25-…` e `2026-09-28-…-fase-2-design.md`)

## 1. Objetivo

Deixar o app pronto para outra pessoa usar (o primeiro caso é um amigo do usuário, no Linux):

1. As "contas" passam a ser **agentes** de dois tipos, **Claude** ou **Codex**, configuráveis numa tela de setup.
2. Numa instalação nova, o padrão é **Claude e Codex em modo yolo**, e não as contas pessoais do usuário.
3. Os **hooks funcionam no Codex** também: 🟢🟡🔵⚪, troca de worktree e detecção.
4. Gerar um **AppImage x64** para Linux, com a suíte de testes rodando num Linux de verdade (container).

Fora do escopo: outras CLIs (kimi, qwen, opencode…; ficam para depois, com o tipo de agente extensível), título de conversa do Codex, pacotes .deb/.rpm e ARM no Linux.

### Critérios de sucesso

1. App aberto sem agentes configurados → o assistente aparece, detecta `claude` e `codex`, cria "Claude (yolo)" e/ou "Codex (yolo)", instala os hooks e explica o `/hooks` do Codex.
2. Na máquina do usuário, as 4 contas atuais continuam iguais, agora como agentes do tipo Claude. Nenhum hook atual é reinstalado à força.
3. Numa sessão Codex com o hook aprovado, o painel passa por 🟢 → 🔵 (Stop) e 🟡 (PermissionRequest). Com o Esc (Interrupt), vira 🔵.
4. Codex rodando há mais de 20 s sem nenhum evento de hook → faixa pedindo o `/hooks`.
5. A suíte de testes passa num container Linux x64, e o AppImage é gerado.

## 2. Modelo de agente

`Account` (o nome interno fica, porque está persistido no `state.json`) ganha:
- `agent: 'claude' | 'codex'`

Os demais campos seguem: `id`, `label`, `command`, `color`, `configDirMatch`, `isDefault`, `settingsMatch`, `pathPrefix`.
- `isDefault` passa a valer **por tipo**: o agente usado quando `CLAUDE_CONFIG_DIR` (Claude) ou `CODEX_HOME` (Codex) não está definido.
- `detectAccount(accounts, agent, configDir, argv)` considera só os agentes daquele tipo.

**Migração:** contas persistidas sem `agent` ganham `agent: 'claude'`. **Instalação nova:** `accounts: []`, e o `DEFAULT_ACCOUNTS` (as contas do usuário) deixa de ser o padrão do `state.json`.

**Sugestões do assistente** (função pura `suggestAgents(detected)`):
- Claude → `{ id: 'claude', label: 'Claude', command: 'claude --dangerously-skip-permissions', agent: 'claude', color: '#d97757', isDefault: true }`
- Codex → `{ id: 'codex', label: 'Codex', command: 'codex --yolo', agent: 'codex', color: '#10a37f', isDefault: true }`

O Claude Code não documenta `--yolo`; a flag oficial equivalente é `--dangerously-skip-permissions`.

**Validação** (`validateAccounts`), aplicada pelo daemon em `accounts.save`:
- id único e não vazio (`[a-z0-9-]+`);
- label e comando não vazios;
- cor `#rrggbb`;
- agent `claude` ou `codex`.

Erros voltam como mensagem.

## 3. Hooks

- **Script `gt-hook`:** recebe o tipo como argumento (`$1`, padrão `claude`) e o manda no evento (`agent`).
  - `configDir` vem de `CLAUDE_CONFIG_DIR` (Claude) ou `CODEX_HOME` (Codex).
  - No **Codex**, o script sempre imprime `{}` no stdout, porque o `Stop` do Codex exige JSON. No Claude continua sem imprimir nada.
- **Comandos registrados:**
  - Claude: **inalterado** (`sh -c '[ -x "$0" ] && exec "$0"; cat >/dev/null' "<script>"`), para os hooks já instalados continuarem válidos.
  - Codex: `sh -c '[ -x "$0" ] && exec "$0" codex; cat >/dev/null; printf "{}"' "<script>"`. Script ausente também devolve `{}`.
- **Eventos:**
  - Claude: os mesmos de hoje.
  - Codex: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `Stop`, `Interrupt`, `SessionEnd`.
- **Arquivos:**
  - Claude: os de hoje (`~/.claude/settings.json` e os perfis do cswap).
  - Codex: `$CODEX_HOME/hooks.json`, ou `~/.codex/hooks.json` se a variável não existir.
  - O arquivo do Codex só entra na checagem se houver algum agente Codex configurado.
  - O merge, o backup e a preservação de hooks alheios são os mesmos do Claude. Se o `hooks.json` do Codex não existir, é criado com `{ "hooks": { … } }`.
- **Confiança do Codex:** o app não aprova hooks por conta própria. O assistente e a faixa orientam o `/hooks`.

## 4. Sessão e detecção

- `ClaudeSession` ganha `agent: 'claude' | 'codex'`. `reduceSession` passa a tratar `Interrupt` → `your-turn`.
- O poller troca `findClaude` por `findAgent`, que reconhece `claude` (regra atual) ou `codex`: `(^|/)codex(\s|$)` ou `@openai/codex`. O argv de `codex` segue a mesma regra de "sessão encerrada sem SessionEnd" do Claude.
- O título da conversa (`readTitle`) só roda para sessões Claude.
- **Aviso de hooks do Codex não aprovados:**
  - O `PaneRecord` guarda quando o poller viu o processo `codex` pela primeira vez e quando chegou o último hook.
  - Com Codex vivo há mais de 20 s e nenhum hook desde que o processo apareceu, `PaneView.agentHooksMissing = true`.
  - A faixa do topo mostra: "O Codex não está mandando eventos: abra o Codex, digite `/hooks` e confie no hook do Gerenciador de Terminal."

## 5. Setup e Preferências

- **Detecção de CLIs:** nova requisição `agents.detect`. O daemon roda `$SHELL -ilc 'command -v claude …; command -v codex …'` (ambiente limpo, timeout de 15 s) e responde `{ claude: boolean, codex: boolean }`.
- **Assistente** (modal `setup`):
  - abre sozinho quando `accounts.length === 0`, uma vez por carga do app, e também pelo menu "Configurar agentes…";
  - **passo 1:** lista os agentes sugeridos, cada um marcado se o CLI foi detectado, com comando editável → `accounts.save`;
  - **passo 2:** instala os hooks e mostra o resultado → `hooks.install`;
  - **passo 3, se houver Codex:** o guia do `/hooks`.
- **Preferências (⌘,)** ganha as abas **Terminal** (o conteúdo atual) e **Agentes**:
  - Agentes lista os agentes com label, tipo, comando, cor, subir/descer e remover, e um botão para adicionar;
  - uma seção "Identificação avançada" (recolhida) edita `configDirMatch` e `settingsMatch`;
  - botões "Reinstalar hooks" e "Abrir assistente";
  - salvar → `accounts.save`.
- **Nova sessão:** os cartões mostram o tipo ("Claude"/"Codex") e o botão passa a dizer "Abrir agente ⌘↵".

## 6. Linux

- `electron-builder`: alvo `AppImage` x64, com `node-pty` fora do asar (como no mac).
- `scripts/build-linux.sh` roda num container `linux/amd64`, com Node 22 e ferramentas de build:
  - `npm ci`, o que compila o `node-pty` para Linux;
  - `npx vitest run`, com git, `procps` e `netcat-openbsd` instalados no container;
  - `electron-vite build` e `electron-builder --linux AppImage`.
- O artefato vai para `dist/`.
- README: seção Linux (`chmod +x`, e `netcat-openbsd` para os hooks).

## 7. Testes

- **Unitários:**
  - `suggestAgents`, `validateAccounts` e a migração;
  - `detectAccount` por tipo;
  - `reduceSession` com `Interrupt` e o campo `agent`;
  - `findAgent` com o argv do Codex;
  - `mergeHooks`/`hasHooks` com os eventos do Codex;
  - `hookCommand` por tipo;
  - `accountsWithoutHooks` com o arquivo do Codex.
- **Integração:**
  - o script `gt-hook codex` entrega o evento ao daemon, com `agent`, e imprime `{}`;
  - `gt-hook` Codex com o script ausente imprime `{}` e sai com 0;
  - daemon com eventos simulados do Codex (Stop → 🔵, Interrupt → 🔵, PermissionRequest → 🟡);
  - `accounts.save` valida e persiste;
  - `agents.detect` com um shell falso;
  - o aviso de Codex sem hooks, com um processo `codex` falso.
- **Manual** (com o usuário): sessão Codex real, aprovar no `/hooks` e ver 🟢🟡🔵; assistente numa instância com `GT_HOME` vazio.
- **Linux:** a suíte inteira passando no container.
