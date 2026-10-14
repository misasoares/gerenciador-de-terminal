# Gerenciador de Terminal — Monitor da máquina (CPU/RAM) + gate do contratar_dev — Design

Data: 2026-10-14
Status: aprovado em conversa (2 seções), aguardando revisão da spec escrita

## 1. Objetivo

Muitas sessões abertas, Colima e emulador juntos travam o Mac sem aviso. Esta fase entrega:

1. **ver** o uso de CPU e RAM da máquina, minimalista e sempre visível, com detalhamento de quem está consumindo;
2. **impedir** que a sessão líder contrate devs quando a máquina já está no limite (gate no `contratar_dev`).

A análise de otimização (MCPs duplicados por sessão, matar processos, Colima) fica para uma fase seguinte.

### Contexto medido em 2026-10-14 (M4 Pro, 12 núcleos, 24 GB)

- swap 8,7 GB de 10 GB; carga média de 15 min em 24,8 (2× os núcleos);
- um `esbuild` órfão de outro projeto rodando havia 5 dias a 364% de CPU — escondido sem visão por processo;
- cada sessão do Claude sobe ~5 servidores MCP em `node` (18 sessões ≈ 90 processos, quase todos na swap).

Conclusão de desenho: **swap e pressão de memória** pesam tanto quanto CPU, e o painel precisa mostrar **processos individuais**, não só categorias.

### Critérios de sucesso

- O chip na barra de status mostra CPU e RAM atualizados a cada ~3 s e muda de cor nos limites.
- Clicar no chip mostra grupos (sessões do app, Colima/Docker, emulador, navegadores) e o top 5 de processos com tempo de vida.
- Com a máquina no vermelho, `contratar_dev` recusa com motivo e números; passa só com `forcar: true`.
- O monitor não vira consumidor: sem `ps` em segundo plano quando o painel está fechado; sem broadcast do `AppState` inteiro a cada leitura.

Fora do escopo: matar processos pelo app, histórico/gráfico, otimizar MCPs por sessão, notificação do sistema ao ficar vermelho.

## 2. Coleta (daemon)

Módulo novo `src/daemon/machine/`, no padrão de `usage/`:

- `parse.ts` — parsers puros: `vm_stat`, `sysctl vm.swapusage`, `/proc/meminfo`, `/proc/stat`, `/proc/pressure/memory`.
- `read.ts` — executa os comandos (`execFile` com timeout, como `platform/procs.ts`) e devolve uma `MachineSample`.
- `level.ts` — calcula `ok | warn | bad` a partir da amostra e dos limites.
- `groups.ts` — agrupa a saída do `ps` em grupos + top 5.
- `monitor.ts` — `MachineMonitor`: timer de 3 s, média móvel de 1 min da CPU, guarda a última amostra.

### Métricas

| Métrica | macOS | Linux |
|---|---|---|
| CPU % | delta de `os.cpus()` entre leituras | idem |
| CPU 1 min | média móvel das últimas 20 leituras | idem |
| RAM usada | `vm_stat`: (active + wired + compressed occupier) × pagesize — `os.freemem()` subestima no Mac | `MemTotal − MemAvailable` |
| RAM total | `os.totalmem()` | idem |
| Swap | `sysctl vm.swapusage` (used/total) | `SwapTotal − SwapFree` |
| Pressão | `sysctl kern.memorystatus_vm_pressure_level` (1 normal, 2 alerta, 4 crítica) | `/proc/pressure/memory` `some avg10`: ≥ 10 alerta, ≥ 40 crítica; sem o arquivo, `null` |

Os três comandos do macOS foram testados nesta máquina.

### Por processo (sob demanda)

`ps -A -o pid=,ppid=,rss=,pcpu=,etime=,args=` roda **só** quando:
- algum app enviou `machine.watch` (painel aberto) — a cada 3 s, até `machine.unwatch` ou a conexão fechar;
- o gate ou `uso_da_maquina` é chamado — uma vez.

`parsePs` atual não lê rss/pcpu/etime; `groups.ts` tem parser próprio para esse formato.

Grupos (por `args`, primeiro que casar):
- **Sessões do app** — PIDs na árvore de cada pane vivo (o daemon conhece o PID raiz de cada pty; usa `descendants`); guarda também o total por pane para foco no clique;
- **Colima / Docker** — `colima`, `limactl`, `qemu-system` com `lima`, `com.docker`, `Docker Desktop`;
- **Emulador** — `qemu-system` (fora do lima), `emulator` (Android), `Simulator` (iOS);
- **Navegadores** — `Google Chrome`, `Safari`, `Arc`, `Firefox`, `Brave`;
- **Top 5** — os 5 processos individuais com mais CPU (desempate por RAM), com nome curto, RAM, CPU e tempo de vida, independentemente do grupo.

## 3. Estado e protocolo

Tipos em `src/shared/types.ts`:

```ts
type MachineLevel = 'ok' | 'warn' | 'bad'
type MemPressure = 'normal' | 'alerta' | 'critica' | null
interface MachineView {
  cpu: number          // 0–100, leitura atual
  cpu1m: number        // média de 1 min (usada no nível)
  ram: { used: number; total: number }   // bytes
  swap: { used: number; total: number }  // bytes; total 0 = sem swap
  pressure: MemPressure
  level: MachineLevel
  reasons: string[]    // ex.: ['swap 92%', 'pressão crítica']
  at: number           // ms epoch
  stale: boolean       // última leitura falhou
}
interface MachineGroup { key: string; label: string; count: number; rss: number; cpu: number; paneIds?: string[] }
interface MachineProc { pid: number; name: string; rss: number; cpu: number; etime: string }
interface MachineDetail { groups: MachineGroup[]; top: MachineProc[]; perPane: Record<string, { rss: number; cpu: number }> }
```

Protocolo (`src/shared/protocol.ts`):
- daemon → app: `{ t: 'machine'; machine: MachineView; detail?: MachineDetail }` — mensagem própria, **fora do `state`**. Enviada quando a leitura muda (CPU arredondada a inteiro, RAM/swap a 0,1 GB, nível) ou a cada 30 s no máximo. `detail` só vai para conexões em watch.
- app → daemon: `{ t: 'machine.watch' }` / `{ t: 'machine.unwatch' }`.
- Ao conectar (`hello` de app), o daemon envia o último `machine` imediatamente.

No renderer, o `store` ganha `machine: MachineView | null` e `machineDetail: MachineDetail | null`, atualizados só por essa mensagem.

## 4. Limites (Preferências)

Em `TerminalSettings` (`src/shared/settings.ts`), com sanitização no padrão existente:

```ts
machine: {
  cpuWarn: number   // padrão 70  (CPU 1 min %)
  cpuBad: number    // padrão 90
  swapWarn: number  // padrão 50  (% do total de swap)
  swapBad: number   // padrão 90
  pressureGate: boolean // padrão true: pressão crítica = bad, alerta = warn
}
```

Regra de nível (`level.ts`): `bad` se qualquer critério bad; senão `warn` se qualquer warn; senão `ok`. `reasons` lista os critérios que dispararam. Swap com total 0 é ignorada. Sanitização garante `warn < bad`, faixa 10–100.

Preferências ganham a seção **Máquina**: quatro sliders (CPU amarelo/bloqueio, swap amarelo/bloqueio), o toggle da pressão e "restaurar padrões".

## 5. Gate no MCP

### `contratar_dev`

Em `Daemon.hire`, antes de qualquer efeito (antes da worktree):

1. Lê a última `MachineView` do monitor.
2. Se `level === 'bad'` e `args.forcar !== true`: roda o `ps` uma vez e lança erro com:
   > Máquina sobrecarregada: swap 92% · pressão crítica (CPU 64%, RAM 22,1/24 GB). Maiores consumidores: Emulador 3,8 GB · java 326% CPU · Sessões do app (9) 6,1 GB. Contratar agora pode travar o computador. Pergunte ao usuário; só repita com forcar: true se ele autorizar.
3. Se não há leitura válida (monitor nunca leu ou `stale` há mais de 60 s): **deixa passar** e o resultado ganha `aviso: 'não consegui medir a máquina'`.
4. Se `level === 'warn'`: contrata e inclui `aviso` com os motivos.

Schema: `forcar: { type: 'boolean', description: 'contratar mesmo com a máquina sobrecarregada; só com autorização explícita do usuário' }`.

### `uso_da_maquina` (ferramenta nova)

Sem parâmetros. Devolve `MachineView` formatada (GB, %), os grupos, o top 5 e:
- `media_por_sessao_claude`: RAM média por sessão do app com agente Claude vivo (soma da árvore / quantidade);
- `cabem_ate_amarelo`: estimativa de quantas sessões novas cabem antes de a RAM usada passar de 85% do total (`floor((0,85·total − used) / média)`, mínimo 0); omitido sem sessões para medir.

Não exige líder (é só leitura).

### INSTRUCTIONS

Nova linha: "Antes de contratar mais de um dev, consulte uso_da_maquina e ajuste quantos contratar. Se contratar_dev recusar por máquina sobrecarregada, mostre o motivo ao usuário e só use forcar: true se ele autorizar."

## 6. UI

### Chip na barra de status

`MachineChip` em `StatusBar.tsx`, à direita, antes dos chips de uso do plano:

```
CPU ▮▮▮▯▯ 34%   RAM ▮▮▮▮▯ 81%   swap 8,7G ⚠
```

- 5 segmentos por barra; cor por nível do critério (`u-warn`, `u-bad`), herdando o tema.
- `swap …` aparece só quando a swap está em warn/bad ou a pressão não é normal.
- `stale`: chip com `u-dim` e tooltip "leitura indisponível".
- Lógica de formatação em `src/renderer/src/machine-model.ts` (puro, testável), como `usage-model.ts`.

### Painel

Popover ancorado no chip (fecha com Esc/clique fora), não modal. Ao abrir envia `machine.watch`; ao fechar, `machine.unwatch`.

```
Uso da máquina
CPU 34% · RAM 19,4/24 GB
swap 8,7 GB ⚠ alto · pressão normal

Sessões do app (9)   6,1 GB  22%
Emulador             3,8 GB  41%
Navegadores          2,9 GB   8%
Colima / Docker      —  desligado

Maiores processos
esbuild      364%   0,0 GB   5d19h
java         326%   1,0 GB   1m43s
…
```

- Grupo sem processos aparece como "— desligado" só para Colima/Docker e Emulador (os que o usuário citou); os demais somem.
- Expandir "Sessões do app" lista cada sessão (nome, RAM, CPU); clicar foca o pane.
- Sem botão de matar processo nesta fase.

## 7. Erros

- Comando falha ou estoura timeout: mantém a última amostra com `stale: true`; tenta de novo no próximo ciclo. Log no máximo 1×/hora por tipo de falha.
- `os.cpus()` na primeira leitura não tem delta: CPU começa na segunda leitura (chip mostra só RAM até lá).
- Linux sem `/proc/pressure`: `pressure: null`, critério ignorado.
- Gate sem leitura: deixa passar com aviso (falha de medição não pode travar o fluxo).
- App fechado: o monitor continua no daemon (o gate depende dele); custo: `os.cpus()` + 2 `sysctl`/`vm_stat` a cada 3 s.

## 8. Testes (vitest, TDD)

- `parse.test.ts`: `vm_stat`, `swapusage`, `/proc/meminfo`, `/proc/stat`, `/proc/pressure/memory` com saídas reais capturadas.
- `monitor.test.ts`: delta de CPU com `os.cpus()` injetado; média de 1 min; `stale` após falha; broadcast só quando muda.
- `level.test.ts`: cada critério isolado, combinação, swap total 0, pressão null, `pressureGate: false`.
- `groups.test.ts`: fixture de `ps` com claude (na árvore de um pane), qemu do lima, qemu do emulador, Chrome, esbuild órfão → grupos e top 5 corretos.
- `settings` sanitização dos limites (`warn < bad`, faixa).
- Gate (daemon): recusa em `bad`; passa com `forcar`; passa com aviso sem leitura; `warn` contrata com aviso; nada criado (sem worktree) quando recusa.
- `protocol.test.ts` do MCP: `uso_da_maquina` listado; `forcar` no schema.
- `machine-model.test.ts`: segmentos, cores, quando a swap aparece, formatação em GB.
