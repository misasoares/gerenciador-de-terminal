# Gerenciador de Terminal — Uso do plano (Claude + Codex) — Design

Data: 2026-09-28
Status: aprovado em conversa (3 seções), aguardando revisão da spec escrita
Base: `main` **depois do merge de `feat/agentes-codex-linux`** (spec `2026-09-28-agentes-codex-linux-design.md`). Esta spec usa o modelo de agente de lá: `Account.agent: 'claude' | 'codex'`, a aba **Agentes** nas Preferências e o build Linux.
Origem da ideia: 49 Agents IDE (github.com/alpbahadur/49-ide, BSL 1.1). Só a ideia foi aproveitada, nenhum código.

## 1. Objetivo

Mostrar quanto de cada plano já foi usado, para:

1. **escolher o agente com folga** na hora de abrir uma sessão;
2. **não ser pego de surpresa** pelo limite, com aviso ao cruzar 80% e 95%.

Vale para agentes **Claude** (plano Pro/Max via login OAuth) e **Codex** (plano ChatGPT). Agentes que passam por gateway ou por chave de API, como o `weboption` via 9router, não têm plano e não aparecem.

Fora do escopo: gasto em dinheiro de agentes via API ou gateway, histórico ou gráfico de uso, e outras CLIs.

### Critérios de sucesso

1. Na máquina do usuário, a barra mostra `misa`, `mslabs`, `weboption-max` e `codex` com números iguais aos do `/usage` do Claude e do `/status` do Codex, com margem de 1 ponto e diferença de no máximo 5 min.
2. O `weboption` não aparece na barra, e o `weboption-max` aparece uma vez só, mesmo tendo o mesmo login do `weboption`.
3. O app **nunca** renova, grava ou transmite o token. O token só é usado na chamada para `api.anthropic.com`.
4. Com o endpoint fora do ar, token vencido ou acesso ao Keychain negado, o resto do app funciona normalmente e o item mostra o estado correspondente (seção 6).
5. Ao cruzar 80% ou 95% numa janela, sai uma notificação, uma vez só por janela e limiar, mesmo que o app reinicie.

## 2. O que o usuário vê

### Status bar

No lado direito, um item por **login**:

```
misa 5h 42% · sem 18%   mslabs 5h 7% · sem 61%   weboption-max 5h — · sem 12%   codex sem 31%
```

- O rótulo usa a cor do agente. No grupo de um login com vários agentes, vale o primeiro agente do grupo que tem `planUsage: true`, na ordem da lista de agentes.
- Cada janela mostra seu percentual, arredondado para inteiro. `—` indica uma janela que o plano não informa.
- A cor do percentual segue o uso: normal abaixo de 80%, amarelo de 80% a 94% e vermelho a partir de 95%.
- **Tooltip:** plano (quando vier), horário de reset de cada janela ("renova às 17:40" no mesmo dia, "renova seg 09:00" em outro dia) e "lido às HH:MM".
- Estados `stale` e `expired` mostram `~` antes do número, com o texto apagado. `unavailable` mostra `indisponível`. A seção 6 explica cada um.

### Modal de nova sessão (⌘T)

Cada agente com uso conhecido mostra o mesmo resumo ao lado do nome, por exemplo `5h 42% · sem 18%`. O agente sugerido continua sendo escolhido pelas regras atuais; o resumo é só informação.

### Aba Agentes (Preferências)

Cada agente ganha a opção **"Usa o plano (mostrar uso)"**, que corresponde ao campo `planUsage`.

### Notificação

Formato: `mslabs: 80% da janela semanal · renova seg 09:00`. O clique só traz o app para a frente.

## 3. Modelo

### `Account`

Novo campo `planUsage: boolean`.
- **Padrão:** `true`.
- **Migração:** contas persistidas sem o campo ganham `planUsage = !(settingsMatch ?? '').includes('gateway')`. Na máquina do usuário, só o `weboption` fica com `false`.
- As sugestões do assistente (`suggestAgents`) criam os agentes com `true`.

### Login

O login é a chave de agrupamento: `loginKey = agent + ':' + configDir`.
- `configDir` é o valor de `CLAUDE_CONFIG_DIR` (Claude) ou `CODEX_HOME` (Codex) visto no hook daquele agente. Quando a variável não existe, vale `~/.claude` ou `~/.codex`, com o caminho já expandido.
- O daemon guarda em `state.json` um mapa `loginDirs: Record<accountId, string>`. Ele é atualizado quando um hook é atribuído ao agente (`applyHook`, depois do `detectAccount`).
- Agente sem `loginDirs`, ou seja, que ainda não mandou nenhum hook:
  - se for o `isDefault` do seu tipo, usa o diretório padrão;
  - senão, fica sem uso até mandar o primeiro hook.

  O tooltip do ⌘T mostra: "abra uma sessão deste agente uma vez para o app descobrir o login".

### `UsageView` (no `AppState.usage: UsageView[]`)

```ts
interface UsageWindow { kind: '5h' | 'week'; percent: number; resetsAt: number | null } // resetsAt em ms epoch
interface UsageView {
  loginKey: string
  agent: 'claude' | 'codex'
  accountIds: string[]          // agentes com planUsage do login, na ordem da lista
  windows: UsageWindow[]        // só as janelas que a fonte informa
  plan: string | null
  readAt: number | null         // última leitura bem-sucedida
  status: 'ok' | 'stale' | 'expired' | 'unavailable'
}
```

O `AppState` nunca contém o token.

## 4. Fontes

### Claude (`src/daemon/usage/claude.ts`)

**Token (só leitura):**
- **macOS:** `security find-generic-password -s <serviço> -w`, via `execFile` sem shell e com timeout de 5 s.
  - `<serviço>` é o nome que o Claude Code usa para aquele `configDir`: `Claude Code-credentials` no diretório padrão e `Claude Code-credentials-<sufixo derivado do configDir>` nos outros.
  - **A regra do sufixo é verificada na implementação** contra as contas reais, só com `security find-generic-password -s <serviço>` sem `-w`, que confirma se a entrada existe sem expor o segredo. A regra fica numa função pura com teste.
- **Linux, ou quando o Keychain não tem a entrada:** `<configDir>/.credentials.json`.
- **Formato esperado:** `{ claudeAiOauth: { accessToken, expiresAt, subscriptionType? } }`.
- Com `expiresAt` no passado, o status fica `expired` e a consulta não é feita.
- **Nunca** usa o `refreshToken`, nunca grava nada e nunca loga o token.

**Consulta:**
- `GET https://api.anthropic.com/api/oauth/usage` com `Authorization: Bearer <token>` e `anthropic-beta: oauth-2025-04-20`, timeout de 10 s.
- **Parser puro:** `five_hour` vira a janela `5h` e `seven_day` vira `week`. `utilization` é o `percent` e `resets_at` é o `resetsAt`. Campos ausentes ou nulos não geram janela.
- O plano vem de `subscriptionType`, quando existir.

### Codex (`src/daemon/usage/codex.ts`)

- Procura o rollout mais recente em `<configDir>/sessions/AAAA/MM/DD/rollout-*.jsonl`, descendo pelas pastas de data em ordem decrescente e comparando o mtime dentro do dia mais recente.
- Lê só os últimos 256 KB e pega o **último** objeto `rate_limits`.
- **Parser puro:**
  - `primary` e `secondary` viram janelas conforme `window_minutes`: 300 é `5h`, 10080 é `week`, e outros valores são ignorados;
  - `used_percent` é o `percent`, e `resets_at` (em segundos) é multiplicado por 1000;
  - `plan_type` é o plano.
- Uma janela com `resetsAt` já passado vale 0%, e o `resetsAt` passa a ser desconhecido (`null`).
- Sem rollout ou sem `rate_limits`, o login não gera `UsageView`.

## 5. Monitor (`src/daemon/usage/monitor.ts`)

- **Agrupamento:** a função pura `groupLogins(accounts, loginDirs, home)` devolve os logins de agentes com `planUsage`.
- **Frequência:** cada login é lido ao abrir e depois a cada 5 min.
- **`Stop` de um agente:** agenda a leitura daquele login, respeitando um mínimo de 60 s desde a última.
- **Backoff:** depois de um 429 ou erro de rede, o intervalo dobra a cada falha, até no máximo 30 min, e volta a 5 min no primeiro sucesso.
- **Leituras:** uma por vez por login, sem sobreposição.
- **Mudanças:** quando a lista de agentes ou `loginDirs` muda, o monitor refaz os logins e descarta os que sumiram.
- Toda mudança num `UsageView` publica o estado, como hoje.
- **Testes:** relógio e `fetch` injetáveis.

## 6. Falhas

| Situação | Status | Barra |
|---|---|---|
| Leitura ok | `ok` | valores normais |
| 429 ou erro de rede, com leitura anterior | `stale` | `~` + último valor |
| Token vencido, com leitura anterior | `expired` | `~` + último valor; tooltip: "abra uma sessão desta conta para atualizar" |
| Token vencido, sem leitura anterior | — | fora da barra; tooltip no ⌘T |
| Sem token (sem login, Keychain negou, arquivo ausente) | — | fora da barra; tooltip no ⌘T |
| Resposta com formato desconhecido | `unavailable` | `indisponível` |

Erros vão para o `daemon.log` no máximo uma vez por hora por login e por tipo de erro, sem o token nem o corpo da resposta.

## 7. Avisos

- A função pura `crossings(prev, next, notified)` devolve os cruzamentos de 80 e 95 por login e janela.
- **Chave do aviso:** `loginKey|kind|resetsAt|limiar`.
- `notified` fica no `state.json`. Chaves de janelas que já reiniciaram são descartadas.
- Só avisa em leitura com status `ok`. Na primeira leitura depois de abrir o app, avisa só os limiares que ainda não estão em `notified`.
- O daemon emite o evento `usage.alert { text }`. O processo principal mostra a notificação com o `NotifyKeeper`.

## 8. Testes

- **Vitest:**
  - parser do Claude e parser do Codex, incluindo o caso da janela que já reiniciou;
  - nome do serviço do Keychain;
  - `groupLogins`, com dedupe por login e filtro `planUsage`;
  - migração de `planUsage`;
  - `crossings`: aviso único, persistência e rearme quando a janela reinicia;
  - monitor com relógio e `fetch` falsos: intervalo, `Stop`, backoff, `stale` e `expired`;
  - formatação da barra: cores e tooltip.
- **Teste real com o usuário:** barra com as 4 contas e o Codex, comparada com `/usage` e `/status`. Também forçar um aviso, baixando o limiar temporariamente no teste.
