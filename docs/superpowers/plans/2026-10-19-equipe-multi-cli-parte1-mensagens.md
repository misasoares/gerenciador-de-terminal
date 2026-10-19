# Equipe multi-CLI · Parte 1: mensagens entre sessões e Codex na equipe — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualquer sessão de uma equipe (Claude ou Codex) manda mensagens a outra pelo app, na fila ou interrompendo. Um líder de qualquer uma das duas CLIs contrata devs de qualquer uma delas, com modelo escolhido, prompt inicial e contexto de hierarquia.

**Architecture:** Um perfil por CLI (`src/daemon/agent-profiles.ts`) concentra o que muda entre Claude e Codex: MCP na linha de comando, modelo, tecla de interromper e se fala `SendMessage` nativo. Uma caixa de mensagens persistida (`src/daemon/team/mailbox.ts`) guarda a fila. Um entregador (`src/daemon/team/delivery.ts`), chamado a cada mudança de estado e por um timer curto, digita a mensagem no PTY do destinatário (bracketed paste + Enter) quando ele está parado. As ferramentas novas do MCP só enfileiram: o remetente é sempre o painel que chama.

**Tech Stack:** TypeScript, Node (daemon), node-pty via `PtyHost`, vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-equipe-multi-cli-design.md`. Este plano cobre as seções 1 (só Claude e Codex), 2, 3, 4, 5 e 7. O grupo da equipe (seção 6) fica para a parte 2, e as CLIs novas e a CLI personalizada para a parte 3.

## Global Constraints

- Claude ↔ Claude continua no `SendMessage` nativo. Nada aqui muda como o Claude recebe o MCP (`--mcp-config`) nem como recebe o prompt inicial (`"$(cat arquivo)"`).
- Cabeçalho montado pelo app, nunca pelo remetente: `[equipe] de <nome> (<CLI>) → para <nome>: <texto> — responda com mandar_mensagem(para: "<nome>")`. Para Claude → Claude por `mandar_mensagem`, o final é `— responda com SendMessage(to: "<nome>")`.
- Mensagens do próprio app (apresentação do líder): prefixo `[gerenciador]`.
- Mensagem só é entregue com o destinatário em `idle` ou `your-turn`. Nunca em `needs-you` (permissão ou `AskUserQuestion`) nem em `working`.
- Não entregar se o usuário digitou naquele painel nos últimos 5 s.
- Sinal de pronto do prompt inicial: o primeiro hook `SessionStart` do painel. Se não chegar em 60 s, a mensagem fica na fila marcada como atrasada (`atrasada: true` no `listar_equipe`).
- Codex roda com `--no-daemon` (commit b329342) e recebe o MCP por `-c mcp_servers.gerenciador.*` com `GT_PANE_ID` e `GT_SOCKET` **literais** no `env` do servidor, porque o Codex não repassa o ambiente do painel ao servidor MCP.
- Fora do app, nada muda: o MCP do Codex só existe nas sessões abertas pelo app.
- Texto visível em português do Brasil, com acentos.

## Review Focus

1. Texto com várias linhas, aspas, `$()` e acentos chega como **uma** mensagem, intacto e sem ser interpretado pelo shell. Teste na Task 3.
2. O usuário está digitando no terminal do dev quando a mensagem fica pronta: a entrega espera 5 s de silêncio de teclado. Teste na Task 3.
3. Dev parado num pedido de permissão (`needs-you`): a fila não anda até ele sair desse estado. Teste na Task 3.
4. Reinício do daemon com mensagens na fila: elas voltam e são entregues uma única vez, sem duplicar. Teste na Task 6.
5. `interromper` num Claude, que não dispara `Stop` depois do Esc: a mensagem sai depois de 1,5 s de silêncio no terminal. Teste na Task 3.

---

### Task 1: Perfis de CLI e comando do Codex com MCP e modelo

**Files:**
- Create: `src/daemon/agent-profiles.ts`
- Modify: `src/daemon/accounts.ts` (`buildCommand`, `CommandExtras`)
- Modify: `src/daemon/panes.ts` (`PaneManagerDeps.mcp`, `create`, `resumeCommand`)
- Modify: `src/daemon/daemon.ts:177-186` (monta `mcp` com `configPath`, `command` e `args`) e `:263-264`
- Test: `tests/daemon/agent-profiles.test.ts`, `tests/daemon/accounts.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface McpServerSpec { configPath: string; command: string; args: string[] }
  export interface AgentProfile {
    kind: AgentKind
    label: string                // 'Claude' | 'Codex'
    nativeTeam: boolean          // true só no Claude (SendMessage)
    interruptKey: string         // '\x1b' nos dois
    /** opções de linha de comando que dão o MCP a esta sessão */
    mcpArgs(mcp: McpServerSpec, paneId: string, socketPath: string): string
    modelArgs(model: string): string
  }
  export function profileOf(kind: AgentKind): AgentProfile
  ```
  `CommandExtras` ganha `paneId?: string`, `socketPath?: string`, `model?: string`, `mcp?: McpServerSpec | null` e perde `mcpConfig` (vira `mcp.configPath`).
  `PaneManagerDeps.mcpConfigPath` vira `mcp: McpServerSpec | null`. `CreatePane` ganha `model?: string`.

- [ ] **Step 1: Testes que falham**

```ts
// tests/daemon/agent-profiles.test.ts
const mcp = { configPath: '/h/mcp.json', command: '/A pp/bin', args: ['/A pp/gt-mcp.js'] }
it('Claude: --mcp-config e --model', () => {
  expect(profileOf('claude').mcpArgs(mcp, 'p1', '/s.sock')).toBe(`--mcp-config '/h/mcp.json'`)
  expect(profileOf('claude').modelArgs('sonnet')).toBe(`--model 'sonnet'`)
  expect(profileOf('claude').nativeTeam).toBe(true)
})
it('Codex: -c mcp_servers com GT_PANE_ID e GT_SOCKET literais, -m', () => {
  expect(profileOf('codex').mcpArgs(mcp, 'p1', '/s.sock')).toBe(
    `-c 'mcp_servers.gerenciador.command="/A pp/bin"' -c 'mcp_servers.gerenciador.args=["/A pp/gt-mcp.js"]' -c 'mcp_servers.gerenciador.env={ELECTRON_RUN_AS_NODE="1",GT_PANE_ID="p1",GT_SOCKET="/s.sock"}'`,
  )
  expect(profileOf('codex').modelArgs('gpt-6-sol')).toBe(`-m 'gpt-6-sol'`)
  expect(profileOf('codex').nativeTeam).toBe(false)
})
// tests/daemon/accounts.test.ts
it('Codex: MCP e modelo antes do subcomando resume', () => {
  expect(buildCommand(codex, 'abcd-1234', { mcp, paneId: 'p1', socketPath: '/s.sock', model: 'gpt-6-sol' })).toBe(
    `codex --yolo --no-daemon ${profileOf('codex').mcpArgs(mcp, 'p1', '/s.sock')} -m 'gpt-6-sol' resume abcd-1234`,
  )
})
it('Claude: --mcp-config, --model, -n e prompt', () => {
  expect(buildCommand(mslabs, undefined, { mcp, model: 'sonnet', name: 'dev-1', promptFile: '/p.txt' })).toBe(
    `claude-mslabs --mcp-config '/h/mcp.json' --model 'sonnet' -n 'dev-1' "$(cat '/p.txt')"`,
  )
})
```
Atualizar os testes existentes de `buildCommand` que usam `mcpConfig` para `mcp`. O teste "Codex ignora os extras do Claude" passa a esperar o MCP do Codex quando `mcp`, `paneId` e `socketPath` vêm, e continua ignorando `name` e `promptFile`.

Valores TOML: string com aspas duplas e escape JSON (`JSON.stringify`); o argumento inteiro entre aspas simples com `shq`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/daemon/agent-profiles.test.ts tests/daemon/accounts.test.ts`
Expected: FAIL, `profileOf` não existe.

- [ ] **Step 3: Implementar** `profileOf` e reescrever `buildCommand(account, resumeSessionId?, extra)` nesta ordem: comando da conta → `--no-daemon` (Codex, já existe) → MCP (se `mcp`; no Codex só se também vier `paneId` e `socketPath`) → modelo → `resume <id>` (Codex) ou `--resume <id>` (Claude) → `-n` e prompt (só Claude). Para o Claude, `--resume` continua antes de `--mcp-config`, como no teste atual da linha 41. `PaneManager.create` passa `paneId: id`, `socketPath: this.d.socketPath`, `model: o.model` e `mcp: this.d.mcp`. `resumeCommand(h)` precisa do `paneId`: mude a assinatura para `resumeCommand(paneId: string, h: Hibernation)`, a dependência do Hibernator para `resumeCommand(paneId, h)` e o chamador em `hibernator.ts:175` para `this.d.resumeCommand(r.id, h)`.

- [ ] **Step 4: Rodar tudo**

Run: `npm test`
Expected: PASS. O teste do daemon `reinício do daemon: sessão Codex…` (linha ~414) passa a esperar `codex --yolo --no-daemon -c 'mcp_servers.gerenciador.command=` antes de `resume abcd-1234`: ajuste o `includes` para `resume abcd-1234` mais um `toContain("mcp_servers.gerenciador.env={ELECTRON_RUN_AS_NODE=\"1\",GT_PANE_ID=\"" + paneId)`.

- [ ] **Step 5: Verificar no Codex real**

Run: `codex --yolo --no-daemon <saída de mcpArgs com o caminho do gt-mcp.js de out/main> mcp list`
Expected: linha `gerenciador … enabled`.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/agent-profiles.ts src/daemon/accounts.ts src/daemon/panes.ts src/daemon/daemon.ts src/daemon/hibernator.ts tests/daemon
git commit -m "feat(equipe): sessões do Codex recebem o MCP do Gerenciador e o modelo pode ser escolhido por sessão"
```

### Task 2: Caixa de mensagens persistida

**Files:**
- Create: `src/daemon/team/mailbox.ts`
- Modify: `src/daemon/persist.ts` (campo `mailbox: TeamMessage[]`, default `[]`, carregar filtrando entradas sem `id`/`to`)
- Test: `tests/daemon/mailbox.test.ts`, `tests/daemon/persist.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type MessageKind = 'equipe' | 'gerenciador' | 'prompt-inicial'
  export interface TeamMessage {
    id: string
    from: string | null      // paneId do remetente; null = o app
    to: string               // paneId do destinatário
    fromName: string; toName: string; fromAgent: AgentKind | null
    kind: MessageKind
    text: string             // texto já com cabeçalho, pronto para digitar
    interrupt: boolean
    createdAt: number
    state: 'na-fila' | 'entregue' | 'falhou'
    deliveredAt: number | null
    error: string | null
  }
  export class Mailbox {
    constructor(items: TeamMessage[], onChange: () => void, now?: () => number)
    enqueue(m: Omit<TeamMessage, 'id' | 'createdAt' | 'state' | 'deliveredAt' | 'error'>): TeamMessage
    /** próxima da fila do destinatário: interrupções primeiro, depois por createdAt */
    next(to: string): TeamMessage | null
    queued(to: string): TeamMessage[]
    markDelivered(id: string): void
    failAll(to: string, reason: string): void
    all(): TeamMessage[]        // para persistir
  }
  export const MAILBOX_KEEP = 500 // entregues/falhas mais antigas saem; na fila nunca saem
  ```

- [ ] **Step 1: Testes que falham** em `tests/daemon/mailbox.test.ts`: `next` devolve a interrupção antes de uma mensagem comum mais antiga; `markDelivered` tira da fila e grava `deliveredAt`; `failAll('p2', 'demitido')` marca só as `na-fila` de `p2` com `error: 'demitido'`; com 600 entregues, `all()` guarda 500 e nenhuma `na-fila` é descartada; `onChange` é chamado em cada escrita. Em `persist.test.ts`: estado sem `mailbox` carrega `[]`.
- [ ] **Step 2: Rodar e ver falhar.** Run: `npx vitest run tests/daemon/mailbox.test.ts tests/daemon/persist.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementar** `Mailbox` (ids com `randomUUID`) e o campo em `Persisted`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `feat(equipe): fila de mensagens da equipe guardada com o estado do app`

### Task 3: Entregador

**Files:**
- Create: `src/daemon/team/delivery.ts`
- Modify: `src/daemon/panes.ts` (registrar `lastUserInputAt` em `write` e `lastOutputAt` em `onPtyOutput` para todo painel; expor `writeRaw(id, data)` que chama `host.write` sem contar como digitação)
- Test: `tests/daemon/delivery.test.ts`

**Interfaces:**
- Consumes: `Mailbox`, `TeamMessage` (Task 2); `profileOf` (Task 1).
- Produces:
  ```ts
  export interface DeliveryPane { id: string; alive: boolean; agent: AgentKind | null; status: SessionStatus | null; sessionSince: number | null; createdAt: number; lastUserInputAt: number; lastOutputAt: number }
  export interface DeliveryDeps {
    mailbox: Mailbox
    pane(id: string): DeliveryPane | null
    writeRaw(id: string, data: string): void
    now(): number
    /** espera entre o fim da colagem e o Enter */
    sleep(ms: number): Promise<void>
  }
  export class Deliverer {
    constructor(d: DeliveryDeps)
    /** tenta entregar a próxima de cada destinatário com fila; chamado em onChange e a cada 1 s */
    tick(): Promise<void>
    /** manda a tecla de interromper agora e registra o instante */
    interrupt(to: string): void
    /** recados atrasados: na fila há mais de 60 s sem SessionStart */
    late(to: string): boolean
  }
  export function pasteAndSubmit(text: string): [string, string] // ['\x1b[200~' + text + '\x1b[201~', '\r']
  export const USER_TYPING_GRACE_MS = 5000
  export const INTERRUPT_QUIET_MS = 1500
  export const READY_TIMEOUT_MS = 60_000
  ```
  Regras do `tick`, por destinatário: pane vivo; `status` em `idle`/`your-turn` (ou interrompido há pouco e `now - lastOutputAt >= INTERRUPT_QUIET_MS`); `now - lastUserInputAt >= USER_TYPING_GRACE_MS`; nenhuma entrega em andamento para ele. Depois de entregar, o destinatário só recebe a próxima quando o `status` sair de `idle`/`your-turn` e voltar (guardar `deliveredWhileStatusSince = sessionSince` e exigir um `statusSince` maior).

- [ ] **Step 1: Testes que falham** (`tests/daemon/delivery.test.ts`, com deps falsas e relógio manual):
  - `entrega quando o dev está your-turn`: escreve exatamente `pasteAndSubmit(texto)`, as duas partes em ordem, e marca entregue.
  - `não entrega em working nem em needs-you` (Review Focus 3).
  - `espera 5 s depois da última tecla do usuário` (Review Focus 2): `lastUserInputAt = now - 4000` → nada; `now - 5000` → entrega.
  - `uma por vez`: duas na fila; a segunda só sai depois de `statusSince` mudar.
  - `texto com várias linhas, aspas, $() e acentos vai dentro da colagem, sem alteração` (Review Focus 1): `'linha 1\nfaça "x" e $(rm -rf ~)'`.
  - `interromper no Claude`: `interrupt('p2')` escreve `'\x1b'`; com `status: 'working'` e `lastOutputAt = now - 1500` entrega a mensagem marcada `interrupt` (Review Focus 5); com `now - 1000` não entrega.
  - `late`: mensagem com `createdAt = now - 61_000` e `sessionSince: null` → `late` true.
- [ ] **Step 2: Rodar e ver falhar.** Run: `npx vitest run tests/daemon/delivery.test.ts`
- [ ] **Step 3: Implementar** `Deliverer` e os campos em `PaneRecord` (`lastUserInputAt`, `lastOutputAt`, `createdAt`). `writeRaw` não chama `flushCommand`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `feat(equipe): entrega de mensagens digitando no terminal do destinatário quando ele está parado`

### Task 4: Ferramentas `mandar_mensagem`, `interromper` e `listar_equipe` para toda a equipe

**Files:**
- Create: `src/daemon/team/team.ts`
- Modify: `src/mcp/protocol.ts` (`TOOLS`, `INSTRUCTIONS`)
- Modify: `src/daemon/daemon.ts` (`mcpCall`, criar `Mailbox` e `Deliverer` no `init`, `tick` em `changed()` e num `setInterval` de 1 s parado no `stop`)
- Test: `tests/daemon/team.test.ts`, `tests/mcp/protocol.test.ts`, `tests/daemon/daemon.test.ts`

**Interfaces:**
- Consumes: `Mailbox`, `Deliverer`, `profileOf`.
- Produces:
  ```ts
  /** líder da equipe do painel: ele mesmo se for líder, senão quem o contratou; null = fora de equipe */
  export function teamLeaderOf(paneId: string, meta: Record<string, PaneMetaEntry>): string | null
  export function sameTeam(a: string, b: string, meta: Record<string, PaneMetaEntry>): boolean
  export function teamHeader(o: { fromName: string; fromAgent: AgentKind; toName: string; toAgent: AgentKind; text: string }): string
  ```
  `export function displayName(r: { id: string; seq: number }, meta): string` → `meta[id].name ?? 'sessão <seq>'`, o mesmo rótulo que o `listar_equipe` já usa. O `para` das ferramentas casa com esse rótulo, então um líder sem nome é alcançável como `sessão 3`.
  `teamHeader` produz exatamente o formato das Global Constraints. O final `SendMessage(to: …)` só aparece quando remetente **e** destinatário são Claude.

- [ ] **Step 1: Testes que falham**
  - `team.test.ts`: `teamLeaderOf` para líder, contratado e sessão solta; `sameTeam` true entre líder e contratado e entre dois contratados do mesmo líder, false entre equipes diferentes; `teamHeader` Codex → Claude igual a `[equipe] de dev-1 (Codex) → para líder: feito — responda com mandar_mensagem(para: "dev-1")`.
  - `daemon.test.ts`, novo `it('mensagens: dev manda ao líder, fila, entrega e regras de equipe')`: líder (setLeader) contrata `dev-1` com `worktree: false`; mande `hook` `SessionStart` + `Stop` para os dois painéis; `mcp.call` com `callerPaneId: dev` e `mandar_mensagem { para: 'líder'... }`. Dê ao líder o nome `lider` com `{ t: 'pane.meta', paneId: leader, name: 'lider' }`; espere `app.output(leader)` conter `[equipe] de dev-1`. `mandar_mensagem` para nome fora da equipe → erro `fora da sua equipe: x`; para si mesmo → erro `não dá para mandar mensagem para si mesmo`; sessão sem equipe → erro `esta sessão não está numa equipe`. `listar_equipe` chamado pelo dev funciona e traz `{ nome, cli, status, desde_s, fila, atrasada }` para cada membro.
  - `protocol.test.ts`: `TOOLS` contém `mandar_mensagem` (`para`, `texto` obrigatórios) e `interromper` (`para` obrigatório, `texto` opcional); `INSTRUCTIONS` cita `[equipe]`, `mandar_mensagem` e a regra "Claude → Claude: SendMessage; para outra CLI: mandar_mensagem".
- [ ] **Step 2: Rodar e ver falhar.** Run: `npx vitest run tests/daemon/team.test.ts tests/mcp/protocol.test.ts tests/daemon/daemon.test.ts -t "mensagens|team|TOOLS"`
- [ ] **Step 3: Implementar.** Em `mcpCall`, antes da checagem de líder: `mandar_mensagem`, `interromper` e `listar_equipe` exigem só `teamLeaderOf(caller) !== null`; o remetente é o `caller`, sem argumento "de". `listar_equipe` passa a listar só a equipe do chamador (líder + contratados dele), mantendo os campos atuais e somando `cli`, `desde_s`, `fila`, `atrasada`. `interromper` chama `deliverer.interrupt(to)` e enfileira com `interrupt: true` se houver `texto`. Os demais continuam só do líder. Texto das instruções novas: acrescente a `INSTRUCTIONS` três linhas: hierarquia (`[equipe]` = colega, sem prefixo = usuário humano), os dois caminhos de mensagem e "use interromper só quando a tarefa atual do dev ficou inútil".
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS. O teste `contratar: só o líder cria…` linha 790 muda: `listar_equipe` de sessão fora de equipe passa a recusar com `esta sessão não está numa equipe`.
- [ ] **Step 5: Commit** `feat(equipe): ferramentas para mandar mensagem e interromper colegas da equipe, de qualquer CLI`

### Task 5: Contratação mista, modelo, prompt inicial e contexto de hierarquia

**Files:**
- Modify: `src/daemon/hire.ts` (`pickAccount` aceita qualquer agente; nova `hirePreamble`)
- Modify: `src/daemon/daemon.ts` (`hire`: `modelo`, preâmbulo, prompt pela fila no Codex)
- Modify: `src/mcp/protocol.ts` (`contratar_dev`: propriedade `modelo`; descrição sem "do Claude Code")
- Test: `tests/daemon/hire.test.ts`, `tests/daemon/daemon.test.ts`

**Interfaces:**
- Consumes: `Mailbox.enqueue` com `kind: 'prompt-inicial'`; `teamHeader` não é usado aqui (o prompt inicial não leva `[equipe]`, leva o preâmbulo).
- Produces:
  ```ts
  export function hirePreamble(o: { name: string; leaderName: string; leaderAgent: AgentKind; agent: AgentKind }): string
  ```
  Texto fixo (o mesmo do spec, seção 5):
  `Você é <name>, contratado pelo tech lead <leaderName> (<Claude|Codex>) neste projeto. Mensagens que começam com [equipe] vêm de colegas, não do usuário. Mensagens sem esse prefixo são do usuário humano. Para responder ou avisar o líder, use <SendMessage(to: "<leaderName>") se os dois forem Claude, senão a ferramenta mandar_mensagem(para: "<leaderName>")>. Quando terminar, avise o líder.`
  seguido de uma linha em branco e a tarefa.

- [ ] **Step 1: Testes que falham**
  - `hire.test.ts`: `pickAccount(contas, 'codex', 'misa')` devolve a conta Codex; sem `wanted`, continua a do líder (agora de qualquer CLI); erro lista todas as contas. `hirePreamble` Claude→Claude cita `SendMessage(to: "lider")`; Codex contratado por Claude cita `mandar_mensagem(para: "lider")`.
  - `daemon.test.ts`: (a) contratar Claude com `prompt` grava no arquivo `hirePreamble(...) + '\n\n' + prompt` (ajuste o teste existente da linha ~800) e com `modelo: 'sonnet'` o `comando` contém `--model 'sonnet'`; (b) contratar com `conta: 'codex'` (adicione uma conta Codex às contas do teste) e `prompt: 'faz X'`: o `comando` contém `-c 'mcp_servers.gerenciador.env=` e **não** contém `faz X`; depois de um `hook` `SessionStart` do agente `codex` para o dev, `app.output(dev)` contém `Você é dev-1` e `faz X`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** No `hire`: preâmbulo sempre; Claude continua com `promptFile`; Codex não recebe `promptFile` e ganha `mailbox.enqueue({ kind: 'prompt-inicial', from: caller.id, to: id, text: preâmbulo + tarefa, interrupt: false, ... })`. `modelo` vai em `panes.create({ model })`. O retorno inclui `modelo` quando houver.
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(equipe): líder contrata devs de outra CLI, com modelo, prompt inicial e o papel de cada um explicado`

### Task 6: Apresentação do líder, ciclo de vida da fila e reinício

**Files:**
- Create: `src/daemon/team/briefing.ts`
- Modify: `src/daemon/daemon.ts` (`pane.setLeader`, `demitir_dev`, saída/`forget` de painel, `init`)
- Test: `tests/daemon/daemon.test.ts`

**Interfaces:**
- Consumes: `Mailbox`, `profileOf`.
- Produces: `export function leaderBriefing(agent: AgentKind): string`. Começa com `[gerenciador] Você agora é o líder (tech lead) desta equipe no Gerenciador de Terminal.` e lista: contratar_dev, listar_equipe, mandar_mensagem, interromper, demitir_dev; o que significa `[equipe]`; que mensagens sem prefixo são do usuário. Termina com `Responda só "ok, sou o líder".`

- [ ] **Step 1: Testes que falham** (`daemon.test.ts`):
  - `setLeader` num painel Codex (sessão com `SessionStart` de `codex` e `Stop`) enfileira e entrega o `leaderBriefing('codex')`; num painel Claude **não** enfileira nada.
  - `demitir_dev` com mensagens na fila para o dev: ficam `falhou` com `error: 'demitido'`; `mandar_mensagem` para ele depois responde erro `sessão não encontrada neste espaço: dev-1`.
  - Painel que sai (`exit`) com fila: mensagens `falhou` com `error: 'sessão encerrada'`.
  - Review Focus 4: enfileire para um dev em `working`, pare o daemon (`stop(true)`), suba de novo com o mesmo `home`, retome o painel com o mesmo `paneId` (como no teste "reinício do daemon" existente), mande `SessionStart` + `Stop`: o texto aparece **uma** vez em `app.output(dev)` (conte as ocorrências) e a mensagem fica `entregue` no `state.json`.
  - Hibernação não pega membros de equipe: confirme com o teste existente do hibernator (`leader`/`hired` são excluídos em `hibernator.ts:34`); acrescente uma linha que o documente, sem código novo.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** No `init`, a `Mailbox` nasce de `persisted.mailbox` e grava de volta em `changed()`. Na saída do painel (callback `exit` do `PaneManager`, via um novo `onExit(id)` em `PaneManagerDeps`), chame `failAll(id, 'sessão encerrada')`.
- [ ] **Step 4: Rodar `npm test`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(equipe): líder de outra CLI recebe a apresentação do papel; fila sobrevive ao reinício e falha para quem saiu`

### Task 7: Teste de ponta a ponta com Claude e Codex reais

**Files:** nenhum código novo, a menos que o teste revele defeito (corrija na task de origem, com teste).

- [ ] **Step 1:** `npm run build` e suba um app de teste com `GT_HOME=<pasta temporária>` (como no CLAUDE.md, seção "Teste de ponta a ponta").
- [ ] **Step 2:** Abra um Codex (`--no-daemon`), marque como líder e peça: "contrata um dev Claude com modelo sonnet para listar os arquivos do projeto e me avisar". Esperado: o Codex recebe a apresentação, contrata, o Claude abre com `--model 'sonnet'`, recebe o preâmbulo + tarefa e responde ao Codex por `mandar_mensagem`; a resposta aparece no terminal do Codex com `[equipe] de dev-1 (Claude)`.
- [ ] **Step 3:** No sentido inverso (líder Claude, dev Codex), peça uma tarefa longa e use `interromper` com nova instrução. Esperado: o Codex para (Esc) e recebe a mensagem.
- [ ] **Step 4:** Peça ao líder que mande uma mensagem para um dev parado num pedido de permissão. Esperado: `listar_equipe` mostra `fila: 1`, nada é digitado até você responder a permissão.
- [ ] **Step 5:** `pkill -f node_modules/electron/dist` e confirmar com `pgrep` que não sobrou nada.
- [ ] **Step 6:** Registrar o resultado no fim deste plano (o que passou e o que não) e commitar.
