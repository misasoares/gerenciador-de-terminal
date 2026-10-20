# Equipe multi-CLI · Parte 2: grupo da equipe (estilo WhatsApp) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um painel novo, o grupo da equipe, mostra tudo o que acontece numa equipe (mensagens com destino e estado de entrega, `SendMessage` entre Claudes, contratações, quem terminou, quem está parado pedindo permissão) e deixa o usuário escrever para qualquer membro com `@nome`, com ou sem ⚡ para interromper.

**Architecture:** O daemon guarda o histórico em duas fontes já persistidas: a `Mailbox` da parte 1 (que ganha `team` e `body`) e um `TeamLog` novo (eventos e `SendMessage` nativo capturado pelo hook `PreToolUse`). Uma função pura monta o `TeamFeedView` de um líder juntando as duas. O renderer pede o feed (`team.feed`) e recarrega quando o daemon avisa (`team.changed`); o usuário escreve com `team.say`, que entra na mesma fila e no mesmo entregador da parte 1. O painel do grupo é uma folha do layout com id `team:<paneId do líder>`, tratada como o painel de arquivo (`file:`): grade, arrastar, flutuar.

**Tech Stack:** TypeScript, Node (daemon), React + zustand (renderer), Electron, vitest.

**Também entra (Task 0):** a correção do "sessão de origem não encontrada" de 20/10, e a release com as duas coisas (Task 7).

**Spec:** `docs/superpowers/specs/2026-10-19-equipe-multi-cli-design.md`, seção 6 e decisões 9 e 10. A parte 1 (seções 1 a 5 e 7) já está na main (`docs/superpowers/plans/2026-10-19-equipe-multi-cli-parte1-mensagens.md`). As CLIs novas e a CLI personalizada ficam para a parte 3.

## Global Constraints

- Um grupo por líder: equipe = líder + quem ele contratou (`teamLeaderOf`) + você. O id do painel é `team:<leaderPaneId>`; não existe outro registro do painel além da folha no layout ou da entrada em `floating`.
- Mensagem escrita por você no grupo chega **sem** `[equipe]`, com o texto `(pelo grupo) <corpo>`. Ela tem a autoridade do usuário. Sem `@`, vai para o líder.
- `SendMessage` entre Claudes só é registrado: o app não entrega nada nesse caso.
- Estado de entrega: `🕓` na fila, `✓✓` entregue, `✕ não entregue: <motivo>` quando falhou. Interrupção marcada com `⚡`.
- Eventos que entram no grupo, e só eles: contratou, demitiu, terminou (de `working` para `your-turn`), pedindo permissão, esperando você (pergunta aberta), travou (`StopFailure`), saiu, interrompeu (Esc sem texto). Nenhum outro evento de estado.
- Alerta de permissão aberto enquanto o membro continua no mesmo `needs-you`; clicar leva ao terminal dele.
- Histórico persistido no `state.json` e mantido depois do reinício. `TEAM_LOG_KEEP = 300` entradas por equipe; a `Mailbox` continua com `MAILBOX_KEEP = 500`.
- Mensagens do app (`kind: 'gerenciador'`, a apresentação do líder) não aparecem no grupo.
- Visual segue os temas atuais (tokens `--bg`, `--fg`, `--fg-dim`, `--bg-hover`, classes `pane-header`, `st-btn`, `ph-close`). Texto visível em português do Brasil, com acentos.
- Commits semânticos em português: os `feat:` viram as notas da release.

## Review Focus

1. Membro sem nome dado (`sessão 3`, com espaço): `@sessão 3 faz X` vai para ele, e `@sessão 31` não casa com `sessão 3`. Teste na Task 4.
2. Você escreve no grupo para um dev parado num pedido de permissão: a mensagem fica `🕓` e só é digitada quando ele sai do `needs-you`. Teste na Task 3.
3. Líder desmarcado (👑 tirado) ou encerrado com o grupo aberto: o painel continua de pé, mostra que a equipe não está ativa e não deixa escrever; `team.say` recusa. Teste na Task 3.
4. Reinício do daemon com histórico: o feed volta igual, e a mensagem que estava `🕓` aparece `✓✓` depois de entregue uma vez só. Teste na Task 2.
5. Corpo escrito no grupo com ESC, caracteres de controle ou `[equipe]` no meio chega como uma mensagem, sem forjar cabeçalho. Teste na Task 3.

---

### Task 0: Quem chama é decidido pela árvore de processos, não só pelo `GT_PANE_ID`

**O defeito (visto em 20/10, conversa `d560aa88`, líder `02f0f9e9`):** às 12:34Z a conversa do líder foi mandada para segundo plano por um comando de barra (`claude daemon` registrou `bg claimed-spare d560aa88 (slash)`; o processo do painel ficou com `parkedJobId`). A conversa passou a rodar num processo de reserva do **daemon do Claude Code** (`claude daemon run`, um por login), que tinha nascido no dia anterior a partir do painel `7034696a` e herdou o ambiente dele. O MCP dessa reserva manda `GT_PANE_ID=7034696a`: painel que não existe mais → `sessão de origem não encontrada` em `listar_equipe` e `demitir_dev`. Se aquele painel ainda existisse, a conversa agiria **como ele** (e os hooks dela mudariam o estado dele): é o "dev se passar por outro" das anti-metas do spec. O Codex tinha o mesmo problema com o daemon dele (resolvido com `--no-daemon`); o Claude Code não tem opção equivalente.

**Files:**
- Modify: `src/daemon/platform/procs.ts` (função nova `paneOfPid`)
- Modify: `src/mcp/daemon-call.ts` (manda `callerPid: process.ppid`, o processo da CLI que abriu o MCP)
- Modify: `src/shared/protocol.ts` (`mcp.call` ganha `callerPid?: number`; `hook` ganha `pid?: number`)
- Modify: `src/daemon/hooks.ts` (`GT_HOOK_SCRIPT` põe `"pid":$PPID` no pedido; com o `exec` do `hookCommand`, `$PPID` é o processo da CLI)
- Modify: `src/daemon/daemon.ts` (`mcpCall` e `case 'hook'`; `DaemonOptions.snapshotProcs?: () => Promise<Proc[]>`, padrão `snapshotProcs`, para os testes)
- Test: `tests/daemon/procs.test.ts`, `tests/mcp/daemon-call.test.ts`, `tests/daemon/hooks.test.ts`, `tests/daemon/daemon.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** painel cujo shell é ancestral do pid; null = o processo não está em nenhum terminal do app */
  export function paneOfPid(procs: Proc[], pid: number, shells: { id: string; pid: number }[]): string | null
  export const BACKGROUND_ERROR = 'esta conversa está rodando em segundo plano do Claude Code, fora dos terminais do app, e o Gerenciador não sabe de qual sessão ela é. Peça ao usuário para continuar a conversa num terminal do app (claude --resume no painel) para usar a equipe.'
  ```
  Regras no daemon:
  - `mcp.call` com `callerPid`: o chamador é `paneOfPid(...)` sobre os painéis vivos (`this.panePids()`), não o `callerPaneId`. `null` → erro `BACKGROUND_ERROR`. Diferente do `callerPaneId` → vale o da árvore. Sem `callerPid` (MCP antigo, aberto antes da atualização) → comportamento de hoje.
  - `hook` com `pid`: se `paneOfPid` não der `req.paneId`, o hook é ignorado (não muda estado, não conta para uso). Sem `pid` → como hoje.
  - Cache `Map<pid, paneId | null>` com validade de 10 s, para não rodar `ps` a cada hook (`PreToolUse`/`PostToolUse` chegam a cada ferramenta).

- [ ] **Step 1: Testes que falham**
  - `procs.test.ts`: árvore `launchd(1) → shell(100) → claude(200) → mcp(300)` e `1 → ccdaemon(500) → worker(600)`; `paneOfPid(procs, 200, [{ id: 'p1', pid: 100 }])` → `'p1'`; `paneOfPid(procs, 600, ...)` → `null`; pid que não existe → `null`; ciclo de ppid não trava (pare ao repetir pid).
  - `daemon-call.test.ts`: o pedido mandado tem `callerPid` igual a `process.ppid`.
  - `hooks.test.ts`: `GT_HOOK_SCRIPT` contém `"pid":` seguido de `$PPID`.
  - `daemon.test.ts`, `it('identidade pela árvore de processos')`, com `snapshotProcs` injetado: (a) `mcp.call` de `listar_equipe` com `callerPaneId` do líder e `callerPid` fora de qualquer painel → erro `BACKGROUND_ERROR`; (b) `callerPaneId` de um painel A e `callerPid` debaixo do shell do painel B (líder) → responde como B (`eu: true` no B); (c) sem `callerPid` → funciona como hoje; (d) `hook` `PermissionRequest` com `paneId` de A e `pid` fora → o status de A não muda.
- [ ] **Step 2: Rodar e ver falhar.** Run: `npx vitest run tests/daemon/procs.test.ts tests/mcp/daemon-call.test.ts tests/daemon/hooks.test.ts tests/daemon/daemon.test.ts -t "paneOfPid|callerPid|pid|identidade"`.
- [ ] **Step 3: Implementar.** O script do hook muda: os hooks já instalados apontam para o mesmo `gt-hook`, que o daemon regrava a cada início; nada a reinstalar.
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS.
- [ ] **Step 5: Conferir no app real** (app de teste com `GT_HOME`): numa sessão Claude, mandar a conversa para segundo plano com o mesmo comando de barra e chamar `listar_equipe`: a resposta é o `BACKGROUND_ERROR`, não `sessão de origem não encontrada`. Encerrar depois os processos de segundo plano criados no teste (`claude agents` / `claude rm <id>`).
- [ ] **Step 6: Commit** `fix(equipe): sessão mandada para segundo plano no Claude Code não se passa mais por outro terminal e recebe um aviso claro`

### Task 1: Histórico da equipe no daemon (Mailbox com equipe, TeamLog e montagem do feed)

**Files:**
- Create: `src/daemon/team/log.ts`, `src/daemon/team/feed.ts`
- Modify: `src/daemon/team/mailbox.ts` (campos `team`, `body`; `kind` ganha `'usuario'`)
- Modify: `src/daemon/persist.ts` (campo `teamLog: TeamLogEntry[]`, default `[]`; ao carregar, descarta entradas sem `id` ou `team`; mensagens antigas da `mailbox` sem `team` carregam com `team: null` e `body: text`)
- Modify: `src/shared/types.ts` (tipos do feed, abaixo)
- Modify: `src/daemon/daemon.ts` (todo `mailbox.enqueue` passa `team` e `body`: em `teamMessage`, `team = teamLeaderOf(caller.id)` e `body = sanitizeBody(texto)`; em `briefLeader`, `team: paneId`, `body: ''`; caso `team.feed` no `handle`)
- Modify: `src/shared/protocol.ts` (`ClientRequest` ganha `{ t: 'team.feed'; leaderId: string }`, resposta `TeamFeedView`)
- Test: `tests/daemon/team-log.test.ts`, `tests/daemon/team-feed.test.ts`, `tests/daemon/mailbox.test.ts`, `tests/daemon/persist.test.ts`, `tests/daemon/daemon.test.ts`

**Interfaces:**
- Produces (em `src/shared/types.ts`):
  ```ts
  export type TeamEventKind = 'contratou' | 'demitiu' | 'terminou' | 'permissao' | 'pergunta' | 'travou' | 'saiu' | 'interrompeu'
  export type TeamFeedItem =
    | { kind: 'msg'; id: string; at: number; fromName: string; toId: string; toName: string; body: string
        interrupt: boolean; byUser: boolean; via: 'app' | 'nativo'
        /** null em via 'nativo' (o Claude entrega sozinho) */
        state: 'na-fila' | 'entregue' | 'falhou' | null; error: string | null }
    | { kind: 'event'; id: string; at: number; paneId: string | null; name: string; event: TeamEventKind
        /** contratou: CLI do contratado; interrompeu: quem interrompeu; travou: motivo, se houver */
        detail: string | null
        /** permissao/pergunta: o membro ainda está nesse mesmo needs-you */
        open: boolean }
  export interface TeamMember { id: string; name: string; cli: string; status: SessionStatus | null; leader: boolean }
  export interface TeamFeedView {
    leaderId: string
    leaderName: string
    /** líder vivo e ainda marcado como líder: dá para escrever */
    active: boolean
    members: TeamMember[]
    items: TeamFeedItem[]
  }
  ```
- Produces (em `src/daemon/team/log.ts`):
  ```ts
  export type TeamLogEntry =
    | { type: 'event'; id: string; team: string; at: number; paneId: string | null; name: string; event: TeamEventKind; detail: string | null
        /** statusSince do needs-you que gerou o alerta */
        since: number | null }
    | { type: 'nativo'; id: string; team: string; at: number; fromName: string; toId: string | null; toName: string; body: string }
  export const TEAM_LOG_KEEP = 300
  export class TeamLog {
    constructor(items: TeamLogEntry[], onChange: () => void, now?: () => number)
    event(e: { team: string; paneId: string | null; name: string; event: TeamEventKind; detail?: string | null; since?: number | null }): void
    native(m: { team: string; fromName: string; toId: string | null; toName: string; body: string }): void
    of(team: string): TeamLogEntry[]
    all(): TeamLogEntry[]
  }
  ```
- Produces (em `src/daemon/team/feed.ts`):
  ```ts
  export function buildFeed(o: {
    leaderId: string; leaderName: string; active: boolean; members: TeamMember[]
    messages: TeamMessage[]   // mailbox.all()
    log: TeamLogEntry[]       // teamLog.of(leaderId)
    statusOf(paneId: string): { status: SessionStatus | null; since: number } | null
  }): TeamFeedView
  ```
  `TeamMessage` ganha `team: string | null` (paneId do líder) e `body: string` (texto do remetente, sem cabeçalho). `MessageKind` vira `'equipe' | 'gerenciador' | 'usuario'`; em `'usuario'`, `from` é `null` e `fromName` é `'você'`.
  `team.feed` no daemon: líder desconhecido (sem `meta` e sem histórico) → `active: false`, `members: []`, `items: []` e `leaderName: 'equipe encerrada'`. `active` = painel do líder vivo **e** `meta.leader === true`. `members`: líder primeiro, depois os contratados vivos na ordem do `seq`; `cli` de `profileOf(agentOf(r)).label`; `status` de `r.claude?.status ?? null`.

- [ ] **Step 1: Testes que falham**
  - `team-log.test.ts`: `event` e `native` gravam `id` (uuid), `team` e `at` do relógio injetado e chamam `onChange`; com 310 entradas da equipe `L1` e 5 da `L2`, `of('L1')` tem 300 (as mais novas) e `of('L2')` continua com 5.
  - `team-feed.test.ts`:
    - só entram mensagens com `team === leaderId` e `kind` `'equipe'` ou `'usuario'`; a `'gerenciador'` fica de fora;
    - itens em ordem de `at` (mensagem usa `createdAt`), misturando mailbox e log;
    - mensagem da mailbox vira `{ kind: 'msg', via: 'app', body, state, error, interrupt, byUser: kind === 'usuario', toId: to }`; entrada `nativo` vira `via: 'nativo'`, `state: null`, `toId: toId ?? ''`;
    - evento `permissao` com `since: 100` fica `open: true` quando `statusOf` devolve `{ status: 'needs-you', since: 100 }` e `open: false` com `since: 200` ou com `status: 'working'`; `terminou` é sempre `open: false`.
  - `mailbox.test.ts`: `enqueue` guarda `team` e `body` como vieram.
  - `persist.test.ts`: estado sem `teamLog` carrega `[]`; entrada sem `team` é descartada; mensagem antiga sem `team` carrega com `team: null` e `body` igual ao `text`.
  - `daemon.test.ts`, `it('grupo: feed da equipe')`: líder (`setLeader`) contrata `dev-1` com `worktree: false`; `team.feed` traz `active: true` e `members` `[líder, dev-1]` com `leader` true só no primeiro; o `mandar_mensagem` do dev ao líder aparece como item `msg` com `body` sem cabeçalho; `team.feed` de um id qualquer → `active: false`, `leaderName: 'equipe encerrada'`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `npx vitest run tests/daemon/team-log.test.ts tests/daemon/team-feed.test.ts tests/daemon/mailbox.test.ts tests/daemon/persist.test.ts`. Expected: FAIL, `TeamLog` e `buildFeed` não existem.
- [ ] **Step 3: Implementar** `TeamLog`, `buildFeed`, os campos novos e o `teamLog` no `Persisted`. No `Daemon.init`, `this.teamLog = new TeamLog(p.teamLog, () => this.changed())`; no `save`, `teamLog: this.teamLog.all()`. Atualizar os `enqueue` existentes e os testes da parte 1 que montam `TeamMessage` à mão.
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit**
  ```bash
  git add src/daemon/team src/daemon/persist.ts src/daemon/daemon.ts src/shared/types.ts tests/daemon
  git commit -m "chore(equipe): histórico da equipe guardado com o estado do app"
  ```

### Task 2: Eventos e SendMessage nativo entram no histórico

**Files:**
- Create: `src/daemon/team/events.ts`
- Modify: `src/daemon/daemon.ts` (`case 'hook'`, `hire`, `demitir_dev`, `teamMessage`, `onExit` do `PaneManager`)
- Test: `tests/daemon/team-events.test.ts`, `tests/daemon/daemon.test.ts`

**Interfaces:**
- Consumes: `TeamLog.event`, `TeamLog.native` (Task 1); `teamLeaderOf`, `displayName` (`src/daemon/team/team.ts`).
- Produces:
  ```ts
  /** mudança de estado que vale um evento no grupo; null = nenhuma */
  export function statusEvent(prev: SessionStatus | null, next: ClaudeSession | null, p: HookPayload): 'terminou' | 'permissao' | 'pergunta' | 'travou' | null
  /** SendMessage capturado no PreToolUse do Claude; null = não é SendMessage ou sem destino */
  export function nativeMessage(p: HookPayload): { to: string; body: string } | null
  ```
  Regras de `statusEvent`, nesta ordem: `StopFailure` → `'travou'`; `next.status === 'needs-you'` e `prev !== 'needs-you'` → `'permissao'` se o evento for `PermissionRequest` ou `Notification` com `notification_type === 'permission_prompt'`, senão `'pergunta'`; `prev === 'working'` e `next.status === 'your-turn'` → `'terminou'`.
  `nativeMessage`: só com `hook_event_name === 'PreToolUse'` e `tool_name === 'SendMessage'`; lê `tool_input.to` (string não vazia) e `tool_input.message`. `message` string vai como está; qualquer outro valor vai como `JSON.stringify`, cortado em 2000 caracteres.

- [ ] **Step 1: Testes que falham**
  - `team-events.test.ts`: `working` + `Stop` → `'terminou'`; `idle` + `Stop` → `null`; `working` + `PermissionRequest` → `'permissao'`; `working` + `PreToolUse` de `AskUserQuestion` → `'pergunta'`; `needs-you` + outro `PermissionRequest` → `null`; `StopFailure` → `'travou'`. `nativeMessage` de `{ tool_name: 'SendMessage', tool_input: { to: 'dev-1', message: 'oi' } }` → `{ to: 'dev-1', body: 'oi' }`; com `message: { type: 'shutdown_request' }` → body `'{"type":"shutdown_request"}'`; sem `to` → `null`; `tool_name: 'Bash'` → `null`.
  - `daemon.test.ts`, novo `it('grupo: eventos da equipe e SendMessage nativo')`, montado como o teste `grupo: feed da equipe` da Task 1 (com hooks `SessionStart` + `Stop` nos dois painéis), lendo o histórico por `team.feed`:
    - depois do `contratar_dev`: evento `contratou` com `name: 'dev-1'` e `detail: 'Claude'`;
    - hook `UserPromptSubmit` + `Stop` no dev: evento `terminou` do `dev-1`;
    - hook `PermissionRequest` no dev: evento `permissao` com `open: true`; depois `PostToolUse`: o mesmo evento com `open: false`;
    - hook `PreToolUse` do líder com `tool_name: 'SendMessage'`, `tool_input: { to: 'dev-1', message: 'faz X' }`: item `msg` com `via: 'nativo'`, `fromName` do líder, `toName: 'dev-1'`, `toId` do dev; nada é digitado no terminal do dev (`app.output(dev)` não contém `faz X`);
    - `interromper` sem texto num dev `working`: evento `interrompeu` com `detail` igual ao nome do líder;
    - `demitir_dev`: evento `demitiu`; painel do dev que sai (`exit`): evento `saiu`;
    - Review Focus 4: mensagem enfileirada para um dev `working`, daemon parado (`stop(true)`) e subido de novo com o mesmo `home`, painel retomado com o mesmo id, `SessionStart` + `Stop`: o feed tem os mesmos eventos de antes e a mensagem aparece uma vez, `state: 'entregue'`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `npx vitest run tests/daemon/team-events.test.ts tests/daemon/daemon.test.ts -t "grupo|statusEvent|nativeMessage"`.
- [ ] **Step 3: Implementar.** No `case 'hook'`: guardar `prev = this.panes.get(req.paneId)?.claude?.status ?? null` antes do `applyHook`; depois, com `team = teamLeaderOf(paneId, meta)` não nulo, registrar `statusEvent(...)` (com `since: rec.claude.statusSince` em `permissao`/`pergunta`) e `nativeMessage(...)` (destino resolvido por `displayName` entre os membros vivos da equipe; não achou → `toId: null`, `toName` como veio). Sessão fora de equipe não registra nada. `hire` registra `contratou` com `detail: profileOf(account.agent).label`; `demitir_dev` registra `demitiu` antes de apagar o `meta`; o `onExit` registra `saiu` se o painel estava numa equipe (ler o `meta` antes de qualquer limpeza). Em `teamMessage`, `interromper` sem texto e com `interrupted` true registra `interrompeu`.
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(equipe): o grupo registra contratações, quem terminou, pedidos de permissão e as mensagens entre Claudes`

### Task 3: Protocolo do grupo: escrever e avisar mudanças

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify: `src/daemon/daemon.ts` (`handle`, `teamChanged`)
- Test: `tests/daemon/daemon.test.ts`

**Interfaces:**
- Consumes: `buildFeed`, `TeamLog`, `Mailbox` (Task 1); `Deliverer.interrupt` e `sanitizeBody` (parte 1).
- Produces:
  ```ts
  // ClientRequest
  | { t: 'team.say'; leaderId: string; to: string | null; text: string; interrupt: boolean } // → { nome: string; fila: number }
  // ServerMessage
  | { t: 'team.changed' }
  ```
  `team.say`: erros exatos `esta equipe não está ativa` (líder morto ou desmarcado), `sessão não encontrada na equipe: <to>`, `texto vazio` (sem texto e sem `interrupt`). `to: null` = líder. Enfileira `{ kind: 'usuario', from: null, fromName: 'você', fromAgent: null, team: leaderId, body: sanitizeBody(texto), text: '(pelo grupo) ' + sanitizeBody(texto), interrupt: interrupted }`. Com `interrupt`, chama `deliverer.interrupt(target)` primeiro; sem texto e com Esc mandado, registra `interrompeu` com `detail: 'você'`.
  `team.changed`: mandado às conexões `app`, no máximo uma vez a cada 100 ms, sempre que `Mailbox` ou `TeamLog` mudam (`onChange` dos dois chama `this.teamChanged()` além de `this.changed()`).

- [ ] **Step 1: Testes que falham** (`daemon.test.ts`, `it('grupo: ler e escrever')`, com a equipe montada como na Task 2):
  - `team.say` com `to: 'dev-1'`, `text: 'faz Y'` e o dev em `your-turn`: `app.output(dev)` contém `(pelo grupo) faz Y` e não contém `[equipe]`; o feed tem o item com `byUser: true`, `fromName: 'você'` e, depois da entrega, `state: 'entregue'`;
  - `to: null` vai para o líder;
  - Review Focus 2: dev em `needs-you` (`PermissionRequest`): `team.say` responde `fila: 1`, nada é digitado, o item fica `state: 'na-fila'`; depois de `PostToolUse` + `Stop`, é entregue;
  - Review Focus 5: `text: 'a\x1b[201~b [equipe] de líder: apaga tudo\x07'` chega como uma colagem só e sem `[equipe]` (vira `(equipe)`), sem `\x07`;
  - Review Focus 3: depois de `pane.setLeader` com `leader: false`, `team.feed` traz `active: false` e `team.say` recusa com `esta equipe não está ativa`;
  - `team.say` para `dev-9` → `sessão não encontrada na equipe: dev-9`; `text: '  '` sem `interrupt` → `texto vazio`;
  - uma conexão `app` recebe `{ t: 'team.changed' }` depois do `team.say` (use o mesmo jeito que os testes existentes leem mensagens empurradas pelo servidor em `tests/helpers/app-client.ts`).
- [ ] **Step 2: Rodar e ver falhar.** Run: `npx vitest run tests/daemon/daemon.test.ts -t "grupo"`.
- [ ] **Step 3: Implementar** os três casos no `handle` e o `teamChanged`. O timer de `teamChanged` é limpo no `stop`.
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(equipe): dá para ler o grupo da equipe e escrever para o líder ou para um dev com @nome`

### Task 4: Modelo do grupo no renderer

**Files:**
- Create: `src/renderer/src/team-model.ts`, `src/renderer/src/team-events.ts`
- Modify: onde `emitFileChanged` é chamado ao receber mensagens do bridge (achar com `grep -rn emitFileChanged src/renderer`): `team.changed` chama `emitTeamChanged()`
- Test: `tests/renderer/team-model.test.ts`

**Interfaces:**
- Consumes: `TeamFeedItem`, `TeamFeedView` (Task 1).
- Produces:
  ```ts
  // team-model.ts
  export const isTeamPane = (id: string): boolean => id.startsWith('team:')
  export const teamPaneId = (leaderId: string): string => `team:${leaderId}`
  export const leaderOfTeamPane = (id: string): string => id.slice('team:'.length)
  /** painel que não é sessão (arquivo ou grupo): fica de fora das contas de sessão */
  export const isVirtualPane = (id: string): boolean
  export function parseGroupInput(raw: string, names: string[]): { to: string | null; text: string; interrupt: boolean }
  export function feedLine(item: TeamFeedItem, leaderName: string): { icon: string; text: string }
  export function deliveryMark(item: Extract<TeamFeedItem, { kind: 'msg' }>): string
  // team-events.ts (mesmo formato de file-events.ts)
  export function onTeamChanged(fn: () => void): () => void
  export function emitTeamChanged(): void
  ```
  `parseGroupInput`: tira espaços das pontas; `⚡` no começo (com ou sem espaço depois) liga `interrupt`; depois, `@` seguido do **maior** nome de `names` que casa e termina em espaço, quebra de linha ou fim do texto vira `to`; `@` que não casa com nenhum nome usa a palavra até o primeiro espaço como `to` (o daemon responde o erro); sem `@`, `to: null`. `text` é o resto, sem espaços nas pontas.
  `feedLine` para eventos (o `icon` vem antes do texto):
  `contratou` → `🤝`, `<líder> contratou <name> (<detail>)`; `demitiu` → `👋`, `<líder> demitiu <name>`; `terminou` → `✅`, `<name> terminou`; `permissao` → `✋`, `<name> está pedindo permissão`; `pergunta` → `🔵`, `<name> está esperando você`; `travou` → `⚠️`, `<name> travou` + `: <detail>` se houver; `saiu` → `⏹`, `<name> saiu`; `interrompeu` → `⚡`, `<detail> interrompeu <name>`. Para `msg`: `icon` `⚡` se `interrupt`, senão `''`; `text` = `<fromName> → <toName>`.
  `deliveryMark`: `via: 'nativo'` → `'SendMessage'`; `na-fila` → `'🕓'`; `entregue` → `'✓✓'`; `falhou` → `'✕ não entregue: ' + error`.

- [ ] **Step 1: Testes que falham** (`team-model.test.ts`):
  - `parseGroupInput('@dev-1 faz X', ['lider', 'dev-1'])` → `{ to: 'dev-1', text: 'faz X', interrupt: false }`;
  - `'⚡ @dev-1 para'` e `'⚡@dev-1 para'` → `interrupt: true`, `to: 'dev-1'`, `text: 'para'`;
  - `'faz Y'` → `to: null`;
  - Review Focus 1: com `['sessão 3', 'sessão 31']`, `'@sessão 3 faz'` → `to: 'sessão 3'`, `text: 'faz'`; `'@sessão 31 faz'` → `to: 'sessão 31'`;
  - `'@dev-1-novo oi'` com `['dev-1']` → `to: 'dev-1-novo'` (não casa pela metade);
  - `'@dev-1'` → `to: 'dev-1'`, `text: ''`;
  - `feedLine` de `contratou` e `interrompeu` iguais aos textos acima; `deliveryMark` dos quatro casos;
  - `isVirtualPane('file:x')`, `isVirtualPane('team:x')` true; `isVirtualPane('abc')` false.
- [ ] **Step 2: Rodar e ver falhar.** Run: `npx vitest run tests/renderer/team-model.test.ts`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `chore(equipe): regras do grupo no renderer (@nome, ⚡, textos dos eventos)`

### Task 5: Painel do grupo, abrir pela sidebar e pela paleta

**Files:**
- Create: `src/renderer/src/components/TeamPane.tsx`
- Modify: `src/renderer/src/components/Workspace.tsx:48-53` (folha `team:` → `<TeamPane paneId>`)
- Modify: `src/renderer/src/components/FloatView.tsx` (`isTeamPane` → `<TeamPane paneId floating />`, como o `FilePane`)
- Modify: `src/renderer/src/header.ts:110` (filtro troca `!id.startsWith('file:')` por `!isVirtualPane(id)`)
- Modify: `src/renderer/src/flows.ts` (`sessionMenu`: item `Abrir grupo da equipe` logo abaixo de `Pode contratar sessões`, só quando `pane.leader`; chama `revealPane(teamPaneId(s.paneId))`)
- Modify: `src/renderer/src/search.ts` e `src/renderer/src/components/Palette.tsx` (tipo de item `'team'`, rótulo `KIND.team = 'grupo'`, um item por líder vivo do espaço: `label: 'Equipe de <nome>'`, `id: teamPaneId(leaderId)`; `run` chama `revealPane(item.id)`)
- Modify: `src/renderer/src/styles.css` (classes `team-*`)
- Test: `tests/renderer/header.test.ts`, teste de `buildPaletteItems` existente (achar com `grep -rln buildPaletteItems tests`)

**Interfaces:**
- Consumes: `team.feed`, `team.say`, `team.changed` (Task 3); `parseGroupInput`, `feedLine`, `deliveryMark`, `isTeamPane`, `teamPaneId`, `leaderOfTeamPane`, `isVirtualPane`, `onTeamChanged` (Task 4); `revealPane`, `floatPane`, `hidePaneAnimated`, `dropOnPane`, `PANE_MIME`, `FloatControls` e `STATUS_DOT` (existentes).
- Produces: `export function TeamPane({ paneId, floating }: { paneId: string; floating?: boolean })`.

Comportamento do `TeamPane`, que copia a estrutura do `FilePane` (zona de soltar, cabeçalho arrastável com `PANE_MIME`, ⧉ flutuar, ✕ fechar com `hidePaneAnimated`, `FloatControls` quando flutuante):
- Carrega `team.feed` ao montar e de novo a cada `onTeamChanged`.
- Cabeçalho: `👥 Equipe de <leaderName>` e um chip por membro com `STATUS_DOT[status]` e o nome; clicar no chip chama `revealPane(member.id)`.
- Lista: mensagem com `feedLine` em cima (`fromName → toName`, ⚡), corpo com `white-space: pre-wrap`, `deliveryMark` e hora (`HH:mm`) embaixo, alinhada à direita quando `byUser`; evento numa linha centralizada e apagada; evento com `open: true` destacado e com o botão `Ir para o terminal` (`revealPane(paneId)`). Rola sozinha para o fim quando chega item novo e a lista já estava no fim.
- Caixa de escrever: `textarea`; Enter manda, Shift+Enter quebra linha; botão ⚡ alterna interromper; digitar `@` mostra os membros para escolher (clique insere `@nome `). Mandar = `parseGroupInput(texto, members.map(m => m.name))`, `interrupt` = ⚡ do texto **ou** o botão; `team.say`; erro aparece numa linha vermelha acima da caixa e o texto não é apagado.
- `active: false`: faixa `Esta equipe não está mais ativa.` e caixa desabilitada; o histórico continua visível.

- [ ] **Step 1: Testes que falham**
  - `header.test.ts`: `sharesContext` ignora uma folha `team:L1` na aba, do mesmo jeito que ignora `file:`.
  - Teste da paleta: com um painel vivo `leader: true` chamado `lider`, `buildPaletteItems` inclui `{ kind: 'team', id: 'team:<id>', label: 'Equipe de lider' }`; sem líder, nenhum item `team`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `npx vitest run tests/renderer`.
- [ ] **Step 3: Implementar** o componente e as ligações acima.
- [ ] **Step 4: Rodar `npm test` e `npx tsc --noEmit -p .`** (ou o `typecheck` do `package.json`, se houver). Expected: PASS e sem erros de tipo.
- [ ] **Step 5: Ver funcionando** com a skill `run` (ou `npm run dev` com `GT_HOME` temporário): marcar uma sessão como líder, abrir o grupo pelo menu da sessão e pela paleta, arrastar para outra posição, flutuar (⧉) e encaixar de volta, fechar com ✕ e reabrir. Conferir nos temas Padrão e Claro. No fim, `pkill -f node_modules/electron/dist` e `pgrep` vazio.
- [ ] **Step 6: Commit** `feat(equipe): grupo da equipe estilo WhatsApp, um painel que mostra toda a conversa e deixa você escrever com @nome`

### Task 6: Teste de ponta a ponta com Claude e Codex reais

**Files:** nenhum código novo, a menos que o teste revele defeito (corrija na task de origem, com teste).

- [ ] **Step 1:** `npm run build` e subir um app de teste com `GT_HOME=<pasta temporária>` (CLAUDE.md, "Teste de ponta a ponta").
- [ ] **Step 2:** Líder Claude contrata `dev-1` Claude e `dev-2` Codex. Abrir o grupo. Esperado: dois eventos `🤝`; a conversa do líder com o `dev-1` por `SendMessage` aparece marcada `SendMessage` (confirma o formato real do `tool_input` do `SendMessage`; se os campos forem outros, ajustar `nativeMessage` e o teste da Task 2); as do `dev-2` aparecem com `🕓` e depois `✓✓`.
- [ ] **Step 3:** Escrever `@dev-2 lista os arquivos` no grupo. Esperado: no terminal do Codex aparece `(pelo grupo) lista os arquivos`, sem `[equipe]`; depois, `✅ dev-2 terminou`.
- [ ] **Step 4:** Pedir ao `dev-1` algo que peça permissão. Esperado: `✋ dev-1 está pedindo permissão`, destacado; `Ir para o terminal` leva a ele; depois de aprovar, o destaque some.
- [ ] **Step 5:** `⚡ @dev-2 para e me diz onde está` durante uma tarefa longa. Esperado: o Codex para e recebe o texto; o item tem ⚡.
- [ ] **Step 6:** Flutuar o grupo, fechar o app e abrir de novo. Esperado: o grupo volta flutuando, com o histórico igual.
- [ ] **Step 7:** `pkill -f node_modules/electron/dist` e conferir com `pgrep` que não sobrou nada.
- [ ] **Step 8:** Registrar o resultado no fim deste plano (o que passou e o que não) e commitar com `docs: resultado do teste de ponta a ponta do grupo da equipe`.

### Task 7: Lançar a versão 0.6.0

Versão menor, porque traz funcionalidade nova (o grupo) além da correção. Segue a seção "Lançar uma atualização" do `CLAUDE.md`.

- [ ] **Step 1:** Conferir: branch `main` com a árvore limpa (o plano e os arquivos não rastreados commitados ou no `.gitignore`), `gh auth status` ok, Docker rodando, certificado em `security find-identity -p codesigning`, nenhum `dist/mac*` velho de outra arquitetura.
- [ ] **Step 2:** **Confirmar com o usuário antes de rodar**: é publicação externa (push e release pública).
- [ ] **Step 3:** `npm run release -- 0.6.0` em segundo plano; ler o fim do log (~10–15 min).
- [ ] **Step 4:** `gh release view v0.6.0`: os 4 arquivos e o `SHA256SUMS`, com os nomes exatos. Conferir nas notas a linha do `fix(equipe)` da Task 0 e a do `feat(equipe)` da Task 5.
- [ ] **Step 5:** Atualizar o app do usuário pelo botão "Atualizar" (nunca trocando o bundle à mão com o app aberto).

## Resultado do teste de ponta a ponta (20/10)

App de teste com `GT_HOME` em `/tmp` (o caminho no scratchpad passa do limite de 104 caracteres do socket), líder Claude (Opus, conta misa), `dev-1` Claude e `dev-2` Codex (v0.163), sem worktree.

Passou:
- Mensagem escrita no grupo para o líder: entregue no Claude real, ✓✓.
- O líder contratou os dois: `🤝 lider contratou dev-1 (Claude)` e `(Codex)`.
- `SendMessage` do líder para o `dev-1` aparece marcado `SendMessage`. O formato real do `tool_input` é `{ to, message, summary?, notify_when_idle? }`, conferido no esquema da ferramenta.
- `@dev-2 …` com o Codex ocupado: ficou 🕓 e só foi digitado depois, como `(pelo grupo) …` e sem `[equipe]`.
- `⚡ @dev-2 …` com o Codex preso em "Working" havia 3 min: o Codex parou, recebeu o texto e respondeu; a mensagem que estava na fila veio em seguida. As duas ficaram ✓✓, e `✅ dev-2 terminou` apareceu no grupo.
- Paleta, flutuar, encaixar, fechar, reabrir, tema Claro, faixa de equipe inativa e erro de `@dev-9` (o texto continua na caixa).

Achados e correções:
- Dois hooks que chegavam juntos trocavam o evento: aparecia "🔵 esperando você" junto do "✋". O `applyHook` passou a devolver o estado lido junto com a mudança (commit `a87dd32`).
- A resposta entre sessões do Claude vai para `uds:/tmp/cc-socks/<pid>.sock`, e o grupo mostrava esse endereço. Agora o pid é resolvido pela árvore de processos para o nome do membro.
- `SendMessage` sem `message` (só `notify_when_idle`) não entra no grupo. O sufixo ` [ref]` do destino é ignorado.
- Os chips de membros eram cortados com o painel estreito. Agora rolam na horizontal.

Não testado na tela:
- Pedido de permissão com "Ir para o terminal": o modo automático aprovou tudo. Fica coberto pelo teste do daemon (`open` liga e desliga).
- Item "Abrir grupo da equipe" do menu da sessão: o menu é nativo e o Playwright não alcança. Ele chama o mesmo `revealPane` da paleta.
- Fechar o app com o grupo flutuando e abrir de novo.
