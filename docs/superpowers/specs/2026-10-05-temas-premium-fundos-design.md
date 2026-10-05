# Gerenciador de Terminal — Temas premium e fundos (parte 2a) — Design

Data: 2026-10-05
Status: aprovado em conversa (4 seções + 2 telas no companheiro visual), aguardando revisão da spec escrita
Base: `main` (edf31df), sobre o sistema de temas da parte 1 (`docs/superpowers/specs/2026-10-05-sistema-de-temas-design.md`).
Sequência: 2a (esta: fundos, vidro, três temas premium) → 2b (movimento) → 3 (Minimal e Retrô). Instalação só quando todos os temas estiverem prontos.

## 1. Objetivo

Três temas premium, com cara de app Apple, para agradar quem não é da área: **Vidro calmo** (Tahoe + Things/Notes, claro e arejado), **Noite afiada** (Linear/Raycast + Tahoe, escuro e preciso) e **Aurora** (Arc + Tahoe, gradiente vivo e alegre). Em cada um, o usuário escolhe o **fundo**: gradiente do tema, imagem incluída, imagem própria, nenhum, ou a mesa do macOS com Liquid Glass. Barras e cabeçalhos viram vidro fosco sobre o fundo; painéis ganham respiro e cantos arredondados; terminais e editor continuam sólidos.

Decisões do usuário:
- os três temas existem (não é escolher um);
- fundo **por tema**, com as opções: tema (gradiente), imagens incluídas geradas pelo Artlist, imagem do usuário, nenhum, mesa do macOS;
- vidro sobre o fundo do tema **e** vidro sobre a mesa do macOS, à escolha do usuário, nos três temas;
- 2 imagens incluídas por tema (6), aprovadas pelo usuário antes de entrar no app;
- o tema "Vidro" da parte 3 é coberto pelo Vidro calmo (a parte 3 fica com Minimal e Retrô).

Fora do escopo: animações novas (parte 2b); Minimal e Retrô (parte 3); fundo em movimento/vídeo; ajuste manual de desfoque pelo usuário.

### Critérios de sucesso
- Os três temas aparecem na aba Aparência com miniatura real e aplicam na hora, em todas as janelas.
- Para um tema premium, a fileira "Fundo" mostra as opções; trocar entre gradiente, imagem e nenhum é instantâneo.
- "Escolher imagem…" copia e reduz a imagem para `~/.gerenciador-terminal/fundos/` e ela aparece como fundo; mover/apagar o original não afeta o app.
- "Mesa do macOS" deixa a janela principal translúcida com o Liquid Glass "clear"; ligar/desligar avisa e reabre as janelas, e as sessões e o layout voltam iguais.
- Texto de barras, abas, cabeçalhos e status passa no AA sobre o vidro, qualquer que seja a imagem atrás.
- Padrão e Claro não mudam em nada.

## 2. Tokens novos (todos os temas)

- `app-backdrop`: fundo padrão do tema (valor CSS de `background`, ex. um gradiente). Padrão/Claro: a cor `bg`.
- `surface-blur`: desfoque do vidro (ex. `24px`); Padrão/Claro: `0px`.
- `pane-gap`: respiro entre painéis e borda da grade; Padrão/Claro: `0px`.
- `pane-radius`: cantos dos painéis; Padrão/Claro: `0px`.
- `pane-shadow`: sombra dos painéis; Padrão/Claro: `none`.

Superfícies que viram vidro nos premium (cores com alfa): `bg-side`, `bg-bar`, `bg-status` e os cabeçalhos de painel. `bg` (terminal, editor, área do painel) continua **opaco** em todo tema.

**Contraste com vidro:** para todo token de superfície com alfa, `fg` e `fg-dim` passam AA (4,5:1) sobre a superfície **composta sobre preto (#000) e sobre branco (#fff)** — os extremos de qualquer imagem. Isso fixa uma opacidade mínima por superfície.

## 3. Os três temas

Valores de referência (os definitivos ficam no plano, ajustados para passar no teste de contraste):

| | Vidro calmo | Noite afiada | Aurora |
|---|---|---|---|
| esquema | claro | escuro | claro |
| fundo padrão | gradiente pastel `#dfe9f5 → #f4efe8 → #e9e4f3` | radial `#23263a → #0c0d12` | gradiente `#ff9a8b → #ff6a88 → #8e7cff → #5ac8fa` |
| `bg` (terminal) | `#ffffff` | `#111219` | `#ffffff` |
| vidro (barra lateral) | branco leitoso | grafite translúcido | branco translúcido |
| destaque | `#0a84ff` | `#5e6ad2` | `#8e3cff` |
| respiro / cantos | 10px / 14px | 8px / 12px | 12px / 16px |
| terminal pareado | GitHub Light | novo "Noite" (escuro azulado) | GitHub Light |

## 4. Fundo

### Modelo (configurações)
`appearance.backgrounds: Partial<Record<AppThemeId, Background>>`, com
`Background = { kind: 'theme' } | { kind: 'none' } | { kind: 'desktop' } | { kind: 'image'; image: string }`, onde `image` é `bundled:<id>` (ex. `bundled:aurora-1`) ou `user:<arquivo>` (nome gerado pelo app, `^[a-f0-9]{16}\.jpg$`).
Sem entrada para um tema = `{ kind: 'theme' }`. Só temas premium usam fundo; Padrão/Claro ignoram.

Normalização (daemon e renderer): `kind` desconhecido, `image` fora do formato, `bundled` inexistente → `theme`; `desktop` fora do macOS → `theme`.

### Imagens incluídas
6 JPEG (≈2560 px de largura, ≤ ~400 KB) em `src/renderer/public/fundos/`, nomes `<tema>-<n>.jpg`; geradas pelo Artlist (abstratas, sem texto), com custo consultado e aprovação do usuário antes de entrarem no repositório.

### Imagens do usuário
"Escolher imagem…" → IPC → processo principal abre o seletor (png, jpg, jpeg, webp, heic), lê com `nativeImage`, reduz para no máximo 2560 px de largura e grava JPEG em `GT_HOME/fundos/<hash16>.jpg` (hash do conteúdo: a mesma imagem não duplica). Retorna o nome. Remover (✕) apaga o arquivo e volta o tema para o gradiente se ele usava aquela imagem. A interface lê pelo protocolo `gt-file` (já existente).

### Desenho
O fundo é pintado uma vez no contêiner raiz da janela (`background` = gradiente do tema, `url(...)` da imagem com `cover`, a cor `bg`, ou transparente na mesa). As superfícies de vidro usam `backdrop-filter: blur(var(--surface-blur)) saturate(1.4)`. A grade usa `pane-gap` como espaçamento e os painéis `pane-radius` + `pane-shadow`.

### Mesa do macOS
- O renderer avisa o processo principal do modo efetivo (`desktop: boolean`) junto do esquema (IPC `gt:appearance`, campo novo).
- Janelas de espaço passam a nascer `transparent: true` + Liquid Glass "clear" (`glass.ts`) quando o modo efetivo é mesa; caso contrário, opacas como hoje.
- Ao mudar o modo efetivo (troca de tema ou de fundo), a interface pergunta ("As janelas vão ser reabertas; as sessões continuam") e, confirmando, o processo principal fecha e reabre as janelas de espaço abertas; layout e sessões vêm do daemon.
- Mudança vinda do **sistema** (modo Automático trocando claro/escuro entre um tema com mesa e outro sem): nada fecha sozinho; aparece um aviso discreto na barra de status com o botão "Reabrir janelas". Até lá, a janela mantém o modo em que foi criada (opaca: fundo do tema; transparente: vidro sobre a mesa).
- No Linux a opção não aparece.

## 5. Interface

Aba Aparência: abaixo dos cartões de tema, para o tema premium selecionado (no Automático, para cada fileira que tiver um premium), a fileira **"Fundo"** com miniaturas: Tema · Nenhum · as 2 incluídas · as do usuário (com ✕) · "Escolher imagem…" · "Mesa do macOS" (só macOS). A miniatura do cartão do tema mostra o fundo escolhido.

## 6. Testes

- Registro: os três temas com todos os tokens (inclusive os novos); Padrão/Claro com os neutros (`0px`, `none`, `app-backdrop` = `bg`).
- Contraste AA em superfícies opacas (como na parte 1) e no vidro composto sobre #000 e #fff.
- Normalização de `backgrounds`: formatos inválidos, `bundled` inexistente, `desktop` no Linux, ausência de `backgrounds`.
- Importação de imagem: nome por hash, redução para ≤ 2560 px, mesma imagem não duplica, arquivo inválido recusado.
- Modo efetivo de mesa (função pura): tema + fundo + plataforma → `desktop` sim/não; e a decisão de reabrir: mudança do usuário → perguntar; mudança do sistema → aviso com botão.
- Real (Electron isolado, `GT_HOME` próprio): os três temas com gradiente, imagem incluída, imagem própria, nenhum e mesa (com reabertura das janelas), por capturas; Padrão/Claro sem mudança.
