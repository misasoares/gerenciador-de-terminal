# Gerenciador de Terminal — Espaços de trabalho (várias janelas) — Design

Data: 2026-10-02
Status: aprovado em conversa (2 seções), aguardando revisão da spec escrita
Base: `main` (092518e). Projeto 1 de 2: o projeto 2 (terminal flutuante em janela separada do macOS) usa a base de várias janelas criada aqui.

## 1. Objetivo

Hoje o app tem uma janela só, e abrir "outra instância" repete tudo. Quem separa projetos por mesa do macOS (navegador + terminais de um projeto numa mesa, de outro projeto noutra) não consegue.

**Espaço de trabalho** = uma janela com seus próprios projetos, abas e layout. Por baixo é o mesmo daemon, com contas, preferências, hooks e uso do plano em comum.

Decisões do usuário:
- isolamento na tela, mesmo motor por baixo;
- fechar a janela mantém as sessões rodando em segundo plano, e isso fica sempre claro;
- o mesmo projeto pode estar em mais de um espaço;
- ao abrir o app, uma lista com checkbox para reabrir alguns ou todos os espaços.

Fora do escopo:
- terminal flutuante (projeto 2);
- espaços com contas, preferências ou hooks diferentes;
- sincronizar espaços entre máquinas.

### Critérios de sucesso

1. Dois espaços ("TCHEERP" e "Pessoal") em mesas diferentes do macOS, cada um com seus projetos, abas e sessões; nada de um aparece no outro.
2. Fechar a janela de "TCHEERP" com 6 sessões avisa que elas continuam rodando. Ao reabrir, as 6 estão lá, vivas.
3. Fechar o app com 3 espaços abertos e abrir de novo mostra a lista com os 3 marcados; dá para abrir só 2.
4. O estado atual vira o espaço "Principal" sem perder abas, sessões, cores nem painéis de arquivo.
5. "Mover para espaço…" leva uma sessão viva para outro espaço sem reiniciá-la.

## 2. O que o usuário vê

### Criar, trocar, renomear, encerrar

**Menu Janela:**
- **Novo espaço de trabalho…** (⇧⌘N no mac, Ctrl+Alt+N no Linux; editável na aba Atalhos) pede um nome e abre uma janela vazia;
- **Renomear espaço…**;
- **Encerrar espaço de trabalho…**: fecha a janela **e** encerra as sessões do espaço, que viram "para retomar" naquele espaço;
- a lista de todos os espaços (✓ nos abertos; clicar num fechado reabre).

**Menu do Dock:** a mesma lista de espaços e "Novo espaço de trabalho…".

**Título da janela:** "Gerenciador de Terminal — <nome>".

**Nome:** obrigatório; um nome repetido ganha " 2", " 3"…

### Fechar a janela

Vale para ⌘W sem painel em foco, para o botão vermelho e para ⇧⌘W.

**Na primeira vez** (até marcar "não perguntar de novo"), aparece o diálogo:
- texto: "Fechar a janela "<nome>"? As N sessões continuam rodando em segundo plano. Você reabre pelo menu Janela ou pelo Dock.";
- botões: **Fechar janela** · **Encerrar o espaço também** · **Cancelar**;
- caixa: "não perguntar de novo".

**Sempre que fechar** com sessões vivas, aparece a notificação do sistema: "<nome> fechado · N sessões continuam em segundo plano".

**Sem sessões vivas,** fecha sem diálogo nem notificação.

**Última janela fechada:** o app continua no Dock (padrão do macOS). Clicar no ícone abre a tela de reabrir. **No Linux,** fechar a última janela continua encerrando a interface, como hoje; o daemon segue vivo.

### Abrir o app

- **1 espaço:** abre direto.
- **2 ou mais:** abre a tela **"Reabrir espaços de trabalho"**:
  - checkbox, nome e "N sessões rodando" (ou "sem sessões") para cada espaço;
  - vêm marcados os que estavam abertos quando o app fechou;
  - botões **Abrir selecionados** e **Abrir todos**, e o link **Novo espaço de trabalho…**.

### Sessões e projetos

- **Projetos:** cada espaço tem a sua lista; o mesmo projeto pode estar em vários. Remover um projeto de um espaço só o tira dali.
- **"Mover para espaço ▸ <nome>"** (menu da sessão na sidebar): a sessão sai do layout deste espaço e entra no outro, na aba ativa de lá, sem reiniciar. Se o projeto dela não estiver no destino, ele é adicionado lá.
- **Badge do Dock:** soma o que espera você em todos os espaços.
- **Notificação de estado** (🟡/🔵): ao clicar, abre o painel na janela do espaço dele, reabrindo a janela se ela estiver fechada.

## 3. Como funciona

### Estado (`state.json`)

```ts
interface Workspace {
  id: string            // uuid; "principal" na migração
  name: string
  open: boolean         // estava aberto quando o app fechou
  projectPaths: string[] // ordem da sidebar
  layout: Layout
  resumable: ResumeEntry[]
}
```

- **`Persisted` ganha** `workspaces: Workspace[]` e `askOnCloseWindow: boolean` (padrão `true`).
- **Viram por espaço:** `layout` e `resumable`, que saem da raiz e vão para `workspaces[i]`.
- **Continua global:** a lista de projetos da raiz (`projects`: cor e conta padrão), que é o cadastro único; os espaços só referenciam os caminhos.
- **Migração:** sem `workspaces`, cria `{ id: 'principal', name: 'Principal', open: true, projectPaths: <todos>, layout, resumable }`.
- **Sessões:** `PersistedPane` e `PaneRecord` ganham `workspaceId`. Painel sem espaço (estado antigo) vai para "principal".
- **Continuam globais:** `paneMeta`, `filePanes` (a poda olha os layouts de todos os espaços), contas, preferências, `loginDirs`, `claudeProfiles` e `codexHomes`.

### Conexões e protocolo

- **`hello`:** `{ t: 'hello'; role: 'app'; version; workspaceId?: string }`. A conexão guarda `conn.workspaceId`. Sem id, vale `principal`, o que mantém o comportamento atual para clientes antigos e testes.
- **`buildState(workspaceId)`** devolve o `AppState` daquele espaço:
  - `projects`: só os de `projectPaths`, na ordem dele;
  - `panes`: só os desse espaço;
  - `layout` e `resumable`: os desse espaço;
  - o resto, como hoje;
  - mais `workspaces: { id, name, open, sessions }[]` (resumo de todos).
- **Broadcast:** cada conexão `app` recebe o estado do seu espaço.
- **Requisições existentes** (`project.add`/`remove`, `layout.save`, `pane.create`, `resume.dismiss` etc.) agem no espaço da conexão; o formato não muda.
- **Requisições novas:**
  - `workspace.create { name }` → `{ id }`;
  - `workspace.rename { id, name }`;
  - `workspace.setOpen { id, open }`;
  - `workspace.end { id }`: mata as sessões do espaço, que viram `resumable` dele;
  - `workspace.list` → o resumo;
  - `pane.moveWorkspace { paneId, to }`.
- **Hooks:** não mudam. O espaço da sessão vem do `PaneRecord`.

### Processo principal (Electron)

- **Janelas:** `Map<workspaceId, { win: BrowserWindow; link: DaemonLink }>`. Cada janela tem a **sua** `DaemonLink`, que faz o `hello` com o `workspaceId` dela.
- **IPC:** os handlers (`gt:request`, `gt:send`, `gt:notify`, `gt:setBadge`, `gt:confirm`…) resolvem a janela e a conexão por `event.sender`.
- **Início:**
  1. uma conexão de serviço pede `workspace.list`;
  2. com 1 espaço, abre direto; com mais, abre a janela pequena **"Reabrir espaços de trabalho"** (rota `?view=reopen` do renderer).
- **Fechar a janela:**
  1. intercepta `close`;
  2. com sessões vivas e `askOnCloseWindow`, mostra o diálogo;
  3. depois do diálogo, `workspace.setOpen { open: false }` e a notificação.
- **Badge:** soma o que cada janela informa.
- **Menu Janela e menu do Dock:** remontados quando o resumo de espaços muda.

### Interface (renderer)

- Lê `workspaceId` da URL (`?ws=<id>`) e o passa no `hello` via preload.
- **Telas novas:** `ReopenWorkspaces.tsx` (lista com checkbox) e o diálogo de nome (criar e renomear).
- **Sidebar:** "Mover para espaço ▸" no menu da sessão.
- O restante da interface não muda: cada janela vê um `AppState` "único", já filtrado.

## 4. Falhas

| Situação | Comportamento |
|---|---|
| Nome vazio / repetido | Recusa vazio; repetido ganha " 2" |
| Encerrar o último espaço aberto | App fica no Dock; tela de reabrir ao clicar no ícone |
| Hook de sessão | Espaço vem do `PaneRecord` |
| Projeto removido de um espaço | Sai só dali; cadastro fica |
| `pane.moveWorkspace` para espaço fechado | Move; a sessão aparece quando o espaço reabrir |
| Estado antigo sem `workspaces` | Migra para "Principal" |
| Janela de espaço já aberto | Focar a existente, nunca duas janelas do mesmo espaço |

## 5. Testes

- **Persistência:** migração para "Principal" (layout, resumable, projetos e painéis); ida e volta de `workspaces`.
- **Daemon:**
  - duas conexões com espaços diferentes recebem projetos, sessões e layout separados;
  - `project.add` num espaço não aparece no outro;
  - o mesmo projeto nos dois;
  - `workspace.create`/`rename` (nome repetido vira " 2");
  - `workspace.end` mata as sessões do espaço e as deixa em `resumable`;
  - `pane.moveWorkspace` muda o espaço sem reiniciar o PTY;
  - poda de `filePanes` olha todos os layouts;
  - `hello` sem `workspaceId` vai para "principal".
- **Renderer (puro):** modelo da tela de reabrir (marcados = os que estavam abertos; contagem de sessões).
- **Teste real com o usuário:**
  - dois espaços em mesas diferentes;
  - fechar uma janela (diálogo e notificação), reabrir pelo Dock;
  - fechar o app com 3 abertos e reabrir 2 pela lista;
  - "Mover para espaço".
