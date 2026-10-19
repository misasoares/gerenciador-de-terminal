# Equipe multi-CLI: mensagens entre sessões e grupo da equipe

Data: 2026-10-19 · Status: rascunho para aprovação

## Intenção

Hoje só o Claude Code consegue montar e coordenar uma equipe no Gerenciador: o líder 👑 usa o MCP do app (`contratar_dev` e afins) e conversa com os devs pelo `SendMessage` nativo do Claude. O Codex e as outras CLIs de terminal ficam de fora: não recebem o MCP, não recebem o prompt inicial e não têm `SendMessage`.

O objetivo é que **qualquer CLI suportada participe de uma equipe**, como líder ou como dev, e que equipes mistas funcionem (líder Claude com devs Codex, líder Kimi com devs Claude…). O app distribuído para outros usuários precisa funcionar de fábrica com as CLIs principais.

Também entra um **grupo da equipe**, estilo grupo de WhatsApp, onde você vê toda a conversa entre líder e devs e pode escrever para eles.

## Decisões do usuário

1. **Claude continua nativo.** Entre Claudes, a coordenação segue pelo `SendMessage`. Nada do novo mecanismo substitui isso.
2. **As outras CLIs conversam pelo app.** O Gerenciador entrega a mensagem digitando o texto no terminal do destinatário e apertando Enter.
3. **Equipes mistas entram agora.** Uma IA pode contratar outra de tipo diferente.
4. **Contexto de hierarquia explícito.** Todo agente precisa saber que está numa equipe (tech lead × devs contratados) e distinguir mensagem da equipe de mensagem do usuário humano.
5. **Duas formas de enviar:** só mandar (vai para a fila e é entregue quando o destinatário fica parado) e interromper (para o destinatário na hora e entrega em seguida).
6. **O líder vê o estado de cada dev.**
7. **Vem pronto e funcionando**, inclusive instalando o MCP direto na configuração de cada CLI.
8. **Lista oficial só com CLIs testadas.** O que não tem certeza fica de fora, mas o usuário pode configurar manualmente. OpenClaude fica fora da lista (é derivado do código vazado do Claude Code) e entra só pelo modo manual.
9. **Grupo da equipe é um painel do layout** (opção B): arrasta, redimensiona, solta da grade e pode ficar flutuante, como um terminal.
10. **Conteúdo do grupo aprovado como no modelo:** eventos da equipe, mensagens com destino (`→ dev-1`), estado de entrega (🕓 na fila, ✓✓ entregue), alertas de permissão parada, interrupção marcada com ⚡, você escreve com `@nome` (e ⚡ para interromper), e só as mudanças de estado que importam (terminou, esperando você).

## Metas

- Líder de qualquer CLI suportada contrata devs de qualquer CLI suportada.
- Qualquer membro manda mensagem a qualquer outro da mesma equipe, na fila ou interrompendo.
- O estado de cada sessão (trabalhando, pedindo permissão, esperando) chega ao app para todas as CLIs da lista oficial.
- O grupo mostra toda a troca, inclusive o `SendMessage` nativo entre Claudes.
- Instalação automática do MCP e dos hooks nas CLIs oficiais, do mesmo jeito que hoje os hooks vão para `~/.claude/settings.json` e `~/.codex/hooks.json`.

## Fora do escopo

- Substituir o `SendMessage` entre Claudes.
- Mensagem para todos de uma vez (broadcast). Já foi recusado na fase 3.
- Suporte oficial a CLIs não testadas.
- Coordenação entre equipes de líderes diferentes.

## Anti-metas (falha mesmo funcionando)

- Um agente confundir mensagem da equipe com pedido do usuário, ou um dev conseguir se passar pelo líder ou pelo usuário.
- Mensagem digitada por cima de um pedido de permissão, aprovando ou recusando sem querer.
- Mensagem misturada com um rascunho que o usuário está digitando no terminal.
- Mexer nas configurações das CLIs de um jeito que quebre o uso delas fora do app. Fora do app, as ferramentas precisam responder "fora do Gerenciador" e não fazer nada.

## Como funciona

### 1. Perfis de CLI

Hoje `AgentKind = 'claude' | 'codex'`. Isso passa a ser um perfil por CLI, com:

- comando padrão e opção de liberar tudo sem pedir permissão (`--yolo`, `-y`…);
- como retomar uma conversa;
- tecla de interromper;
- onde e como instalar o MCP do Gerenciador;
- onde e como instalar os hooks (ou o plugin, no OpenCode) e o mapa dos eventos da CLI para os estados do app;
- se fala `SendMessage` nativo (só o Claude).

Levantamento inicial (precisa ser confirmado instalando e testando cada uma; a que falhar sai da lista oficial):

| CLI | MCP | Estado |
|---|---|---|
| Claude | `--mcp-config` (como hoje) | hooks em `settings.json` (como hoje) |
| Codex | `~/.codex/config.toml` → `[mcp_servers.gerenciador-terminal]`, ou `-c mcp_servers...` no comando | `~/.codex/hooks.json` (como hoje); roda com `--no-daemon` (commit b329342) |
| Kimi | `~/.kimi/mcp.json` | `[[hooks]]` em `~/.kimi/config.toml` (beta): `UserPromptSubmit`, `Stop`, `Notification` (`permission_prompt`), `SessionStart` |
| Qwen Code | `~/.qwen/settings.json` → `mcpServers` | hooks no mesmo arquivo, no formato do Claude: `UserPromptSubmit`, `Stop`, `PermissionRequest`, `SessionStart` |
| Gemini CLI | `~/.gemini/settings.json` → `mcpServers` | hooks no mesmo arquivo: `BeforeAgent`, `AfterAgent`, `Notification` |
| OpenCode | `~/.config/opencode/opencode.json` → `mcp` (`type: local`, `command` como array) | não tem hooks: plugin JS em `~/.config/opencode/plugins/` ouvindo `session.status`, `session.idle` e `permission.asked`, que chama o `gt-hook` |

Respeitar as variáveis de diretório de cada CLI quando existirem (`CODEX_HOME`, `KIMI_SHARE_DIR`…), como hoje se faz com `CODEX_HOME`.

**CLI personalizada (manual):** tipo "Outra CLI" nas Preferências, com comando e tecla de interromper. O app **não** escreve na configuração dela: mostra, prontos para copiar, o bloco do MCP e o comando do `gt-hook`, com instruções de onde colar. Sem hooks, o estado é estimado pela atividade do terminal (saída recente = trabalhando; alguns segundos de silêncio = parado) e a bolinha indica que é estimado.

### 2. MCP para todos os membros

- O MCP do Gerenciador é oferecido a todas as sessões, não só ao líder. As ferramentas de contratar, demitir e renomear continuam só para o líder; mandar mensagem e ver a equipe valem para todos da equipe.
- O servidor MCP identifica quem chama pelo `GT_PANE_ID`, que já é herdado do painel (`src/mcp/daemon-call.ts`). Instalado na configuração global da CLI, ele também sobe fora do app: aí responde "fora do Gerenciador" e não faz nada.
- As instruções do MCP explicam a hierarquia, o prefixo `[equipe]` e quando usar cada caminho (abaixo).

### 3. Ferramentas novas e alteradas

- `contratar_dev`: a `conta` passa a aceitar qualquer agente configurado (inclusive de outra CLI). O prompt inicial é entregue pelo mesmo mecanismo das mensagens (o app espera a sessão ficar pronta, digita e aperta Enter), em vez de opção de linha de comando. O Claude pode continuar recebendo o prompt pela linha de comando, como hoje.
- `contratar_dev` ganha `modelo` (opcional), repassado na opção de modelo de cada CLI. Surgiu ao contratar o revisor deste documento, quando não deu para pedir Sonnet 5.5.
- `mandar_mensagem(para, texto)`: põe na fila do destinatário.
- `interromper(para, texto?)`: manda a tecla de interromper da CLI do destinatário e, se houver texto, entrega em seguida.
- `listar_equipe`: passa a incluir, por membro, a CLI, o estado, há quanto tempo está nele e quantas mensagens esperam na fila.

**Qual caminho usar:**
- Claude → Claude: `SendMessage` nativo.
- Claude → outra CLI: `mandar_mensagem` / `interromper`.
- Outra CLI → qualquer um (inclusive Claude): `mandar_mensagem` / `interromper`. Para o Claude, chega digitado no terminal dele com o cabeçalho `[equipe]`.

### 4. Entrega

- Fila por destinatário. Entrega quando o estado é "parado/esperando" (Stop / sua vez / ocioso). Uma mensagem por vez, em ordem.
- Não entrega enquanto houver pedido de permissão aberto. O grupo e o `listar_equipe` mostram isso.
- Não entrega por cima de um rascunho do usuário no terminal. A forma de detectar o rascunho fica com quem construir; o mínimo é não entregar se o usuário digitou naquele painel nos últimos segundos.
- Texto entregue sempre com cabeçalho montado pelo app, nunca pelo remetente:
  `[equipe] de dev-2 (Codex) → para líder: <texto> — responda com mandar_mensagem(para: "dev-2")`.
- Texto com várias linhas: entregar de modo que a CLI receba como uma única mensagem (bracketed paste ou o equivalente de cada CLI). Confirmar por CLI nos testes.
- Interromper: tecla da CLI (Esc no Claude e no Codex; confirmar nas outras), esperar o estado virar parado e então entregar.

### 5. Contexto de hierarquia

- **Prompt de contratação:** o app põe antes da tarefa um texto dizendo o nome do dev, quem o contratou, que mensagens com `[equipe]` vêm de colegas, que mensagens sem prefixo vêm do usuário humano e como responder.
- **Cabeçalho `[equipe]`** em toda mensagem entregue (acima).
- **Instruções do MCP** repetem as regras para o líder.
- Mensagem escrita por você no grupo chega **sem** o prefixo `[equipe]`: é o usuário humano falando, com a mesma autoridade de quando você digita direto no terminal. Escolha minha: mostrar no terminal que veio pelo grupo, para você se localizar depois, sem mudar a autoridade.

### 6. Grupo da equipe

- Um grupo por líder (equipe = líder + quem ele contratou + você).
- É um tipo novo de painel no layout: arrasta, redimensiona, solta da grade e fica flutuante, como os terminais.
- Itens: eventos (contratou, demitiu, terminou, travou), mensagens com destino e estado de entrega (🕓/✓✓), alertas de permissão parada (clicar leva ao terminal), interrupções com ⚡, e as suas mensagens.
- Você escreve com `@nome`. Escolha minha: sem `@`, vai para o líder.
- Mensagens `SendMessage` entre Claudes aparecem capturadas pelo hook `PreToolUse` do Claude (matcher `SendMessage`, lendo destino e texto do `tool_input`). O app só registra: não entrega nada nesse caso.
- Histórico persistido junto do estado do espaço de trabalho e mantido depois do reinício do app. Escolha minha.

### 7. Identidade, prontidão e instalação (respostas da revisão)

Escolhas minhas, tomadas depois da revisão do desenho:

- **Identidade:** o remetente é sempre o painel que chama, resolvido pelo daemon a partir do `GT_PANE_ID` (como já faz `src/mcp/daemon-call.ts`). Nenhuma ferramenta aceita um argumento "de". A equipe sai do que o daemon já guarda: `paneMeta[id].leader` e `paneMeta[id].createdBy`. Só se manda mensagem dentro da própria equipe (líder ↔ contratados dele, e entre contratados do mesmo líder).
- **Líder de outra CLI:** quando o usuário marca uma sessão não-Claude como líder (👑), o app entrega na fila dela um texto de apresentação: que ela é líder, que ferramentas tem, o que significa `[equipe]` e como coordenar. Isso não depende de a CLI mostrar as instruções do MCP ao modelo. Para o Claude, nada muda.
- **Sinal de pronto para o prompt inicial:** primeiro `SessionStart`, ou o primeiro evento equivalente da CLI. Na falta dele, o app espera a saída do terminal parar por cerca de 2 s depois que a CLI abriu. Se não ficar pronto em 60 s, o prompt continua na fila, o grupo mostra um alerta e o líder recebe falha no `listar_equipe`.
- **O que conta como "parado" para entregar:** só fim de turno (`Stop` ou equivalente) e ocioso. Pedido de permissão e pergunta aberta ao usuário (`AskUserQuestion` no Claude, que vira "precisa de você") **não** recebem entrega: a mensagem espera.
- **Fila:** persistida com o estado do app e mantida depois do reinício. Mensagem para sessão hibernada acorda a sessão (retomar) e é entregue quando ela fica pronta. Mensagem para sessão demitida ou encerrada falha na hora: o remetente recebe erro e o grupo mostra "não entregue".
- **Onde instalar o MCP:** por sessão, na linha de comando, sempre que a CLI permitir (Claude `--mcp-config`, Codex `-c mcp_servers...`, Kimi `--mcp-config-file`; confirmar Qwen, Gemini e OpenCode). Assim o MCP só sobe dentro do app e não custa nada fora dele. Arquivo global só para a CLI que não tiver esse jeito. Nesse caso: bloco próprio e identificado (como os hooks hoje, marcados com `gt-hook`), backup antes de gravar, edição que preserve o resto do arquivo (comentários do TOML inclusive), remoção pelo botão de hooks nas Preferências e o mesmo aviso/consentimento que os hooks já têm hoje (`HooksBanner`).
- **Hooks:** continuam no arquivo global, como hoje, porque são a única forma de a maioria das CLIs informar o estado. Fora do app, o `gt-hook` já não faz nada (sem `GT_PANE_ID`).
- **Ferramentas de líder em não-líderes:** continuam visíveis e respondem erro explicando como marcar o líder, como hoje.

## Deixado para quem construir

- O formato do perfil de CLI no código e a migração de `AgentKind`.
- A detecção de rascunho no terminal e o tempo de silêncio da estimativa de estado.
- O visual exato do painel do grupo, seguindo os temas atuais do app.
- A ordem das entregas em partes (sugestão: perfis + MCP/hooks do Codex primeiro, porque o Codex já está em uso; depois as demais CLIs; o grupo pode vir em paralelo).

## Testes de aceitação

Para cada CLI oficial, no Mac e no Linux, com a CLI instalada de verdade:
1. O MCP e os hooks são instalados pelo app e a CLI os carrega.
2. A bolinha passa por trabalhando, permissão e esperando.
3. Ela contrata um dev de outra CLI, e o dev recebe o prompt inicial com o contexto de hierarquia.
4. Mensagem na fila é entregue só quando o destinatário para, nunca durante um pedido de permissão.
5. `interromper` para o destinatário e entrega a mensagem.
6. Tudo aparece no grupo, inclusive o `SendMessage` entre dois Claudes.
7. Fora do app, a CLI abre normalmente e as ferramentas respondem "fora do Gerenciador".
