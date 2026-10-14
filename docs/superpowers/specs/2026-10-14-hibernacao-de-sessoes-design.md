# Gerenciador de Terminal — Hibernação de sessões ociosas — Design

Data: 2026-10-14
Status: aprovado em conversa (3 seções), aguardando revisão da spec escrita

## 1. Objetivo

Com muitas sessões abertas, as paradas seguram RAM à toa: cada uma custa ~250–400 MB (processo `claude`/`codex` + os servidores MCP que ele sobe). A hibernação encerra o agente de uma sessão esquecida e o traz de volta, com a mesma conversa, quando o usuário volta a ela — sem tirar o painel do lugar.

### Contexto medido em 2026-10-14 (24 GB, 20–21 sessões)

- árvore do app ≈ 11,8 GB antes da limpeza de MCPs; ≈ 9,4 GB depois; o `claude` sozinho ≈ 4,6 GB (~200–260 MB por sessão);
- poucas sessões estão ativas ao mesmo tempo; o resto fica em ⚪/🔵 por horas;
- a RAM liberada por processos mortos é o que realmente esvazia compressor/swap (congelar com SIGSTOP só empurra para o swap).

### Critérios de sucesso

- Sessão ociosa há mais de N minutos (padrão 30), fora de foco, hiberna sozinha; a memória do agente e dos MCPs dela é liberada.
- Focar a sessão hibernada acorda-a em 2–4 s no mesmo terminal, com a mesma conversa (`--resume`), mesma conta e mesmo `--mcp-config`.
- Nunca hiberna sessão trabalhando, pedindo permissão, em foco, líder, dev contratado ou com comando rodando (inclusive em background).
- Reiniciar o daemon com sessões hibernadas não perde a conversa (viram retomáveis como as outras).

Fora do escopo: hibernação manual (menu/botão), descartar o histórico do terminal no daemon (fica para o item de scrollback), detectar `/loop`/`ScheduleWakeup` pendentes.

## 2. Abordagem

Encerrar **só o agente** e manter o shell do painel. O painel continua `alive` para o resto do app (abas, flutuante, worktree, layout não mudam); o terminal segue mostrando o histórico. Acordar = o daemon digita no mesmo shell o comando da conta com `--resume <id>`.

Descartadas: encerrar o painel inteiro e reaproveitar o cartão "Retomar sessão" (perde o histórico visível, mais estados no layout); SIGSTOP (não libera memória, só vai para o swap).

## 3. Estado e regra (daemon)

### Estado

`PaneRecord` ganha:

```ts
hibernated: { sessionId: string; agent: AgentKind; accountId: string | null; since: number } | null
waking: { since: number } | null
/** não tenta hibernar antes disso (falha anterior) */
hibernateCooldownUntil: number
```

O painel continua `alive: true` enquanto hibernado (o shell está vivo).

### Foco

Mensagem nova `pane.focus { paneId: string | null }`, enviada por cada janela (principal e flutuantes) quando o painel focado muda (inclusive para `null` ao perder o foco da janela). O daemon guarda o foco por conexão; um painel está "em foco" se estiver focado em alguma conexão `app`. Conexão que cai some do conjunto.

### Regra

Função pura `shouldHibernate(rec, now, ctx)` em `src/daemon/hibernate.ts`. Hiberna quando **todas** valem:

1. `settings.hibernate.enabled` (padrão `true`);
2. `rec.claude?.status` é `idle` ou `your-turn` e `now - statusSince ≥ minutes × 60 000` (qualquer hook, inclusive de subagente, já reinicia o `statusSince`);
3. painel não está em foco em nenhuma conexão;
4. `paneMeta[id].leader !== true` e `paneMeta[id].createdBy == null` (líder e devs contratados nunca hibernam — o `SendMessage` nativo só alcança sessões vivas);
5. nenhum descendente do processo do agente é um shell (`sh`, `bash`, `zsh`, `fish`) — a ferramenta Bash/Monitor do Claude sempre roda via shell, então cobre comandos em foreground e em background;
6. não está hibernado nem acordando, e `now ≥ hibernateCooldownUntil`.

A checagem roda dentro do `poll()` existente (que já tem o `ps`), no máximo a cada 30 s.

### Hibernar

1. Reconfere a regra (status pode ter mudado) e envia SIGTERM ao processo do agente (`findAgent`). Os MCPs morrem com ele.
2. Aguarda a saída até 10 s (o `poll` confirma que o processo sumiu). Sem saída → SIGKILL; ainda vivo → desiste e marca `hibernateCooldownUntil = now + 30 min`.
3. Se chegar hook de atividade (`working`/`needs-you`) durante a espera, cancela: não manda SIGKILL e não grava `hibernated`.
4. Saiu: grava `hibernated` com `sessionId`, `agent` e `accountId` (o da sessão, ou `launchedAccountId`). O `SessionEnd` que chega zera `rec.claude` como hoje; o 💤 vem de `hibernated`.

O transcript já está em disco; a conversa não se perde. Rascunho não enviado no prompt do agente se perde (aceitável após 30 min parado).

### Persistência

`save()` grava, para painéis hibernados, `sessionId`/`agent`/`accountId` de `hibernated` (em vez do `rec.claude` nulo). No próximo início do daemon eles viram retomáveis pelo caminho existente.

### Índice de conversas

`openSessions` passa a incluir as sessões hibernadas (→ `paneId`). O ⌘K mostra "Focar" e leva ao painel, que acorda — sem abrir duplicata.

## 4. Acordar e interface

### Acordar (daemon)

Ao receber `pane.focus` para um painel com `hibernated`:

1. confere no `ps` que o shell do painel não tem filho em foreground (`foregroundOf` = o próprio shell);
2. escreve no PTY `buildCommand(conta, sessionId, { mcpConfig })` + `\r` (ex.: `claude-weboption --resume …`, `codex --yolo resume …`); conta inexistente → `resumeAccount` como no retomar atual;
3. zera `hibernated`, grava `waking = { since: now }`; o primeiro `SessionStart` (ou 60 s) zera `waking`.

Shell ocupado (o usuário digitou algo nele) → não digita nada, só zera `hibernated`; o painel vira terminal comum e o usuário retoma pela paleta/⌘K.

### Interface

- **Cabeçalho do painel**: selo discreto "💤 hibernada há 42 min"; acordando → "acordando…". Sem cartão nem overlay; o texto "Resume this session with…" que o Claude imprime ao sair fica visível.
- **Sidebar/abas**: estado 💤 cinza, abaixo de ⚪ na escala de atenção; não gera notificação nem bolinha na aba.
- **Painel da máquina** (chip CPU/RAM): linha "N sessões hibernadas".
- **Preferências → Máquina**: "Hibernar sessões ociosas" — interruptor + minutos (padrão 30, mínimo 5). `settings.hibernate = { enabled: true, minutes: 30 }`, normalizado como `machine`.

`AppState.panes[]` ganha `hibernated: { since } | null` e `waking: boolean`.

## 5. Erros e bordas

- Agente ignora SIGTERM → SIGKILL após 10 s; persistiu → resfriamento de 30 min.
- Hook de atividade durante a espera → cancela a hibernação.
- `--resume` falha (conversa apagada, conta removida) → o erro aparece no terminal como se o comando tivesse sido digitado; `waking` expira em 60 s.
- Usuário sai do agente (`/exit`) acordando → `waking` zera no `SessionEnd`/expiração, como terminal comum.
- `pane.forget`/fechar painel hibernado → o estado vai junto com o registro.
- Codex: mesmo fluxo (`codex resume <id>`), mesma regra do shell descendente.
- Limitação conhecida: `/loop` ou `ScheduleWakeup` pendente não deixa processo; se a sessão passar 30 min ociosa esperando, hiberna e o despertar agendado se perde.

## 6. Testes

- **`tests/daemon/hibernate.test.ts`** — `shouldHibernate`: cada condição isolada (status, tempo, foco, líder, contratado, shell descendente, desligado, resfriamento).
- **`PaneManager` com PTY real** (padrão de `pty-host.test.ts`): script fake de agente que respeita SIGTERM; hibernar; acordar (comando digitado no shell); cancelamento por hook na espera; SIGKILL quando ignora SIGTERM; shell ocupado não recebe comando.
- **Persistência**: hibernado reaparece como retomável com `sessionId` após reiniciar o daemon.
- **Settings**: normalização de `hibernate` (valores inválidos, mínimo 5).
- **Renderer**: modelo do selo/estado 💤 (sidebar, atenção).
- **Manual (app instalado)**: com 5 min, ver a RAM cair (`top`) e acordar com o contexto.
