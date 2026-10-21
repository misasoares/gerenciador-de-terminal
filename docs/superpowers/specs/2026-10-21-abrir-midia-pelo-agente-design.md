# Agente abre mídia no painel (abrir_midia) — desenho

Data: 2026-10-21. Continua a "Parte B" de mídia no painel (a Parte A, visualizador no painel de arquivo, está na main desde 05/10).

## Por quê

Hoje, quando o usuário pede para ver prints, o agente devolve uma lista de caminhos longos e o usuário dá ⌘+clique em cada um. Às vezes o agente erra o formato e o clique não funciona. Para comparar telas (ex.: iOS × Android do StageLab, 6 telas), o agente gasta tempo montando PNGs lado a lado com ImageMagick/Python. O resultado perde resolução e não escala para 3 ou mais imagens.

Uso real: o usuário abre, bate o olho e fecha. Ele não edita, não dá zoom fino e não guarda nada.

## Objetivos

- O usuário pede "abre", "mostra" ou "compara" e o agente abre o painel sozinho, na aba da própria sessão, ao lado do terminal dela.
- Uma única chamada abre uma mídia avulsa **ou** várias comparações (grupos de imagens lado a lado), navegáveis uma por vez.
- O agente para de montar imagens compostas só para comparar.

## Não-objetivos

- Edição de imagem no app: recorte, anotação e zoom sincronizado entre imagens.
- Reprodução sincronizada de vídeos dentro de um grupo.
- Mudanças no ⌘+clique ou no painel de arquivo normal.

## Anti-objetivos

- O agente abrir painéis sem o usuário pedir, ou empilhar um painel novo a cada chamada até a aba virar uma tira de painéis.
- O painel roubar a aba ativa quando o usuário estiver olhando outra.

## Como funciona

### Ferramenta MCP `abrir_midia`

Fica no MCP `gerenciador-terminal` (`src/mcp/protocol.ts`), ao lado das outras. **Qualquer sessão pode chamar**, como em `uso_da_maquina`: não precisa ser líder nem estar em equipe, e vale para qualquer CLI que recebe o MCP.

Entrada:

- `caminhos: string[]`: mídia avulsa. Com um caminho, abre como hoje (igual ao ⌘+clique). Com vários, cada um vira um grupo de uma imagem só, navegável.
- `grupos: string[][]`: comparação. Cada grupo é uma lista de caminhos mostrados lado a lado.
- `rotulos?: string[]`: nomes das colunas, ex.: `["iOS", "Android"]`. Valem para todos os grupos.
- `titulos?: string[]`: título de cada grupo. Sem ele, o título é o nome do primeiro arquivo do grupo sem extensão.

Use `caminhos` ou `grupos`, nunca os dois. Caminhos relativos resolvem a partir da pasta (cwd) da sessão que chamou.

Validação no daemon, antes de qualquer efeito: o arquivo existe e `mediaKind()` reconhece a extensão. Se algo falhar, a chamada é recusada com a lista dos caminhos ruins. Ela nunca abre só uma parte.

Retorno: `{ aberto: <id do painel>, grupos: N }`.

### Onde abre

- No daemon (`mcpCall`), sem passar pelo renderer: grava em `persisted.filePanes` e põe a folha no layout com `insertBeside(layout, caller.id, id)`. É o mesmo caminho do `contratar_dev`.
- **Reaproveita:** se a mesma sessão já tem um painel de mídia aberto por `abrir_midia` que ainda está no layout, a chamada nova troca o conteúdo dele em vez de criar outro. (Decisão minha. Evita empilhar painéis.)
- **Não muda a aba ativa** (`insertBeside` já não muda). O painel aparece na aba da sessão.
- Se a sessão estiver flutuante, ela não está no layout. O `insertBeside` então cai na aba ativa, que é o comportamento atual dele. Aceitável.

### Modelo

`FilePaneMeta` ganha um campo opcional:

```ts
gallery?: { groups: string[][]; labels: string[] | null; titles: string[] | null; createdBy: string }
```

`path` continua apontando para a primeira imagem do primeiro grupo, para não quebrar quem lê `path`: título do painel, `findFilePane`, seletor de arquivo. Mídia avulsa com um caminho só não usa `gallery`: é um painel de arquivo comum.

O `filepane.set` do renderer (troca de modo ver/editar, `FilePane.tsx:184`) hoje substitui o registro inteiro. Ele precisa preservar `gallery` quando o id já tem uma galeria, senão a galeria vira painel comum. Todas as sessões já recebem o MCP (`panes.ts`), então a ferramenta chega a Claude e Codex sem mudança no comando.

### Painel em modo galeria (renderer)

Quando `FilePaneMeta.gallery` existe, o `FilePane` mostra a galeria em vez do visualizador de um arquivo:

- **Cabeçalho:** `‹ 2 / 6 · equalizer ›` (setas clicáveis) e o fechar de sempre.
- **Corpo:** as mídias do grupo atual numa linha, cada uma com o rótulo em cima ("iOS" | "Android") e ajustada para caber (`object-fit: contain`). Até 4 mídias ficam numa linha. Acima de 4 vira grade (colunas = ⌈√n⌉). Quantas cabem de fato depende da largura do painel: vale o ajuste para caber, sem rolagem horizontal.
- **Teclado** (com o painel focado): ← → trocam de grupo, Esc fecha o painel.
- **Clique numa mídia:** abre em tamanho real, como o painel de arquivo já faz hoje.
- **Arquivo mudou no disco:** recarrega, como hoje (`file.changed` + versão no `mediaUrl`).
- O grupo atual é estado local do painel. Ao trocar o conteúdo (nova chamada), volta para o grupo 1.
- Vídeo/áudio/PDF dentro de um grupo usam o mesmo elemento do visualizador atual, sem sincronização.

### Instruções do MCP

Linha nova em `INSTRUCTIONS`, sempre visível para o agente:

> Quando o usuário pedir para ver, abrir, mostrar ou comparar imagens, vídeos, áudios ou PDFs, use abrir_midia em vez de mandar caminhos no texto. Para comparar, passe grupos (um por tela) e rótulos (ex.: iOS, Android). Não monte imagens lado a lado: o painel já compara. Só edite uma imagem (recortar, marcar) quando precisar apontar um detalhe, e abra o resultado com abrir_midia.

Descrição da ferramenta no mesmo espírito, com um exemplo de `grupos` + `rotulos`.

## Restrições

- Comparação pelo daemon e pelo protocolo `gt-file://` que já existem. Nenhuma dependência nova.
- Testes no padrão do repo: daemon (`tests/daemon`) para a validação, o `insertBeside`, o reaproveitamento e a recusa com caminho inválido. Protocolo MCP para `tools/list` e as instruções. Renderer para a navegação, se houver teste de componente equivalente.

## Decisões minhas (para conferir)

1. Qualquer sessão pode chamar (não só o líder).
2. A chamada nova reaproveita o painel de galeria da mesma sessão.
3. Não muda a aba ativa. Sessão flutuante cai na aba ativa.
4. Mais de 4 mídias por grupo vira grade ⌈√n⌉.
5. Esc fecha o painel de galeria.
6. Título padrão do grupo = nome do primeiro arquivo sem extensão.
7. Caminho inválido recusa a chamada inteira.

## Para quem implementar decidir

- Visual exato do cabeçalho e dos rótulos, seguindo os temas atuais.
- Se o reaproveitamento guarda `createdBy` no `gallery` ou num mapa à parte.
- Se o Esc conflita com algo no foco do painel. Se conflitar, prefira não fechar.
