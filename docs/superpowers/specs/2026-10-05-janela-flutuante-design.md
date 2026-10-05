# Gerenciador de Terminal — Janela flutuante — Design

Data: 2026-10-05
Status: aprovado em conversa (4 partes), aguardando revisão da spec escrita
Base: `main` (ba72be5), branch `feat/flutuante`. Projeto 2 dos espaços: usa a base de várias janelas.

## 1. Objetivo

Tirar um painel da grade para uma **janela própria do sistema**, que fica por cima de tudo (inclusive do Chrome e de outros apps) e, se o usuário quiser, acompanha em todas as mesas do macOS. Caso principal: deixar o techlead sempre visível enquanto se usa outro app. Caso secundário: ganhar espaço tirando um terminal da grade apertada.

Decisões do usuário:
- vale para **sessões do Claude, terminais e painéis de arquivo**; continua sendo o **mesmo** terminal (nada reinicia);
- cria-se por **menu e atalho** ("Flutuar" no menu da sessão, botão ⧉ no cabeçalho, ⇧⌘F); arrastar para fora fica para depois;
- nasce **por cima de tudo**; 📌 desliga; 🌐 "fixar em todas as mesas" é opção por janela (desligada por padrão);
- **fechar** a flutuante (✕/⌘W) **esconde** o painel (sessão viva, "oculta" na sidebar);
- flutuantes são **independentes** da janela do espaço e **lembradas**: ao reabrir o app, voltam com o espaço, na posição de antes.

Fora do escopo: arrastar o painel para fora da janela; transparência; flutuante com vários painéis dentro.

### Critérios de sucesso

1. O techlead flutua por cima do Chrome; com 🌐, aparece em todas as mesas.
2. ⇧⌘F devolve à grade, na aba ativa, sem reiniciar a sessão.
3. Fechar a janela do espaço mantém as flutuantes; ⌘Q e reabrir as traz de volta na mesma posição, com 📌/🌐.
4. `contratar_dev` com `onde: "flutuante"` abre o dev numa flutuante.
5. Um arquivo aberto no leitor/editor flutua e volta.

## 2. A janela e o cabeçalho

- `BrowserWindow` sem moldura (`frame: false`); o cabeçalho do painel é a barra de arraste (`-webkit-app-region: drag`, botões `no-drag`); redimensiona pelas bordas. Tamanho inicial 640×400 perto do canto superior direito da janela do espaço (ou da tela principal); mínimo 320×180.
- Conteúdo: o painel inteiro (`TerminalView`, sessão do Claude ou `FilePane`), igual à grade (tema, fonte, atalhos, copiar/colar, links).
- 📌 → `setAlwaysOnTop(true, 'floating')`; com 🌐, `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` e nível `'screen-saver'` para ficar sobre apps em tela cheia. Linux: as mesmas chamadas; o efeito depende do gerenciador de janelas.
- Cabeçalho: projeto · ⎇ worktree · nome (👑) · bolinha de status; à direita 📌 (aceso), 🌐 (apagado), ⤓ Encaixar, ✕.
- Teclado: ⇧⌘F encaixa (Linux Ctrl+Shift+F; editável em Atalhos, ação `toggle-float`); ⌘W esconde.
- Atenção: borda pisca com 🟡/🔵; notificação suprimida se a flutuante está em foco (mesma regra da grade).

## 3. Dados e persistência

- `Workspace.floating: string[]` — painéis flutuando agora (ordem = ordem de criação).
- `PaneMetaEntry.float?: { bounds: { x: number; y: number; width: number; height: number } | null; onTop: boolean; allDesks: boolean }` — preferências lembradas por painel (também depois de encaixar/esconder e de reiniciar). Padrão `{ bounds: null, onTop: true, allDesks: false }`.
- A poda de `filePanes` passa a manter também os ids em `floating` de todos os espaços.
- `WorkspaceSummary.floating: { paneId: string; bounds; onTop; allDesks }[]` — o processo principal sincroniza as janelas por ele.
- Requisições:
  - `float.set { paneId, mode: 'float' | 'dock' | 'hide' }`:
    - `float`: entra em `floating` do espaço do painel (se já estiver, nada muda; o main traz a janela para a frente); o renderer de origem tira a folha antes (como no "Mover para espaço");
    - `dock`: sai de `floating` e a folha entra na aba ativa do espaço (`insertBeside` com âncora na última folha da aba ativa);
    - `hide`: sai de `floating` sem entrar na grade.
  - `float.prefs { paneId, bounds?, onTop?, allDesks? }`.
- Espaço de um painel: o `workspaceId` do `PaneRecord`; painel de arquivo (sem registro) usa o espaço da conexão que pediu.
- Daemon reiniciado: `floating` persiste; a flutuante reaparece mostrando "terminal encerrado"/retomar, como a grade.

## 4. Processo principal

- `WindowManager` ganha um mapa `floats: Map<paneId, { win, link, wsId }>`. Cada flutuante tem a sua `DaemonLink` (hello com o `workspaceId`) e carrega a rota `?view=float&ws=<id>&pane=<id>`.
- Sincronização (função pura `syncFloats(summary, activeWs, openNow) → { open: FloatSpec[]; close: string[]; update: FloatSpec[] }`): mostra as flutuantes dos espaços **ativados nesta execução** (abertos ao menos uma vez desde que o app iniciou); fechar a janela do espaço não desativa o espaço.
- Posição: move/resize → `float.prefs` com atraso de 400 ms. Posição fora de qualquer monitor → centraliza na tela principal (`fitBounds(bounds, displays)` pura).
- Cascata: sem `bounds` salvo, a n-ésima flutuante nova do espaço nasce deslocada 30 px × n (`cascade(base, n)` pura).
- Fechar a janela flutuante pelo sistema (botão vermelho do Linux/atalho) = `float.set hide`. ⌘Q / encerrar: fecham sem gravar nada.
- `gt:focusFloat(paneId)`: traz a janela da flutuante para a frente (troca de mesa).

## 5. Interface (renderer)

- Rota `view=float`: monta só o painel (`FloatPane`) com o cabeçalho próprio; reaproveita `TerminalView`/`FilePane` e o store (a janela recebe o `AppState` do espaço).
- Grade: botão ⧉ no cabeçalho do painel (também no de arquivo); menu da sessão "Flutuar"/"Encaixar"; ação `toggle-float` (⇧⌘F).
- `mergeIncomingLayout` ganha mais uma "chegada": folha que o daemon pôs no layout para um painel que **saiu de `floating`** neste estado (encaixe).
- Sidebar: ⧉ nas sessões flutuantes; clique → `gt:focusFloat`. ⌘J e "Outros espaços": se o alvo flutua, foca a flutuante.
- Painel de arquivo com alteração não salva: ✕ na flutuante pergunta antes (como na grade).

## 6. Contratar

- `contratar_dev` aceita `onde: "flutuante"`: o dev entra em `floating` do espaço do líder em vez do layout.

## 7. Falhas

| Situação | Comportamento |
|---|---|
| Flutuar painel que já flutua | traz a janela para a frente |
| Processo da sessão sai | flutuante mostra "terminal encerrado · Fechar" |
| Daemon cai | "desconectado" e religa sozinha |
| Posição fora dos monitores | centraliza na tela principal |
| Arquivo com alteração não salva e ✕ | pergunta antes |
| Duas janelas pedem flutuar o mesmo painel | daemon aceita a primeira; a segunda só foca |
| ⌘Q com flutuantes | fecham sem perguntar; voltam com o espaço |
| Linux sem "todas as mesas" | 🌐 fica marcado, sem efeito |

## 8. Testes

- Daemon: `float.set` float/dock/hide (lista, folha na aba ativa ao encaixar); prefs lembradas após encaixar e após reiniciar; painel de arquivo flutuando não é podado; resumo traz as flutuantes; `contratar_dev` com `onde: "flutuante"`.
- Main (puro): `syncFloats`, `fitBounds`, `cascade`.
- Renderer (puro): `mergeIncomingLayout` com encaixe; marca ⧉ no modelo da sidebar; alvo do ⌘J.
- Teste real: techlead por cima do Chrome; 🌐 e trocar de mesa; ⇧⌘F; ⌘Q e reabrir; dev contratado flutuante; arquivo flutuante.
