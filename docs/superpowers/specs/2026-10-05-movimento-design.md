# Gerenciador de Terminal — Movimento (parte 2b) — Design

Data: 2026-10-05
Status: aprovado em conversa (3 seções + 3 telas no companheiro visual), aguardando revisão da spec escrita
Base: `main` (85c8fa3), sobre o sistema de temas (partes 1 e 2a). Sequência: 2b (esta) → 3 (Minimal e Retrô). Instalação só quando todos os temas estiverem prontos. Tem de funcionar no macOS e no Linux.

## 1. Objetivo

Dar movimento ao app, com vocabulário inspirado no iOS e personalidade por tema: discreto no Padrão e no Claro, calmo no Vidro calmo, preciso na Noite afiada, vivo na Aurora. Animações interrompíveis (clicar de novo no meio redireciona a partir do valor atual), molas sem quique por padrão, entrada e saída pelo mesmo caminho, e "reduzir movimento" respeitado.

Decisões do usuário:
- movimento em **todos** os temas, sutil nos básicos;
- abordagem com a biblioteca **Motion** (motion/react) + CSS para o toque;
- efeitos escolhidos: **zoom a partir da origem, materializar, ilha dinâmica, toque responsivo, lista em cascata** (a "folha com fundo recuando" ficou de fora);
- personalidades aprovadas na demonstração; a mola "viva" da Aurora tem só um leve excesso ao aparecer;
- a grade não anima o redimensionamento das divisões (o xterm recalcularia linhas e colunas a cada quadro).

Fora do escopo: animar divisões/tamanhos de painéis; arrastar com impulso (não há gestos de arremesso no app); sons e vibração; animação na troca de tema.

### Critérios de sucesso
- Cada momento da tabela da seção 3 anima conforme o efeito e o tema, e pode ser interrompido sem salto.
- Fechar nunca demora mais que ~160 ms; nada bloqueia clique ou teclado durante uma animação.
- Com "reduzir movimento" (macOS ou GNOME/KDE), tudo vira esmaecimento curto e nada desliza, cresce ou encolhe.
- No Linux sem composição por GPU, o "materializar" vira esmaecimento; o resto funciona igual.
- Os terminais nunca são redimensionados por causa de uma animação.

## 2. Personalidades

Campo novo em `AppTheme`: `motion: 'subtle' | 'calm' | 'crisp' | 'lively'`.

| Personalidade | Temas | Entrada | Saída |
|---|---|---|---|
| `subtle` | Padrão, Claro | 150 ms, `cubic-bezier(0.2, 0, 0, 1)`, sem mola, sem materializar | 120 ms, `cubic-bezier(0.4, 0, 1, 1)` |
| `calm` | Vidro calmo | mola, amortecimento 1,0, resposta 0,45 s | 160 ms, aceleração |
| `crisp` | Noite afiada | mola, amortecimento 1,0, resposta 0,25 s | 140 ms, aceleração |
| `lively` | Aurora | mola, amortecimento 0,85, resposta 0,4 s (leve excesso só ao aparecer) | 160 ms, aceleração |

Um único módulo (`motion-presets.ts`) traduz a personalidade em parâmetros da Motion (`type: 'spring'`, `bounce` ≈ 1 − amortecimento, `visualDuration` = resposta) e oferece variantes de entrada/saída por efeito. Componentes não têm números de animação soltos.

## 3. Onde anima

| Momento | Efeito |
|---|---|
| Modais (Preferências, ⌘K, ⌘P, Nova sessão, Conflitos, Conversas, nome do espaço) | **Zoom a partir da origem**: escala de ~0,9 (premium) ou 0,96 (sutil) a 1 a partir do ponto do último clique, se o modal abriu até 400 ms depois dele; senão do topo-centro. Premium: **materializar** (desfoque 12 px → 0 junto com a escala). Saída: volta para a origem, rápida. |
| Menus do app (popovers renderizados pelo app; menus nativos do sistema não) | Zoom a partir do item clicado, curto. |
| Listas da paleta ⌘K, seletor ⌘P e conversas | **Cascata**: até 8 itens, 35 ms entre eles; o resto aparece de uma vez. Ao filtrar, sem cascata. |
| Trocar de aba | Pílula da aba ativa desliza até a nova (elemento compartilhado); conteúdo troca com esmaecimento curto. |
| Painel entra / sai (abrir/fechar terminal, abrir arquivo, encaixar flutuante) | Entra de 96% com esmaecimento; sai encolhendo a 98% e esmaecendo, **antes** de sair da grade (a ação espera a saída). Divisões se ajustam na hora. |
| Barra lateral | Seleção desliza até a sessão clicada (elemento compartilhado); seções abrem/fecham com altura animada. |
| Estado das sessões | Bolinha muda de cor com transição. "Precisa de você": **ilha dinâmica** no topo-centro da janela ("dev-1 precisa de você"), cresce da bolinha, fica ~2,5 s e recolhe; clicar leva à sessão; várias em fila, sem empilhar, sem repetir a mesma sessão já na fila. |
| Toque (botões, abas, linhas da lateral, cartões) | **Toque responsivo** em CSS: `:active` encolhe para 97% em `dur-fast`; ao soltar volta com `ease-spring` do tema. |

Padrão e Claro: os mesmos momentos com a personalidade `subtle`.

## 4. Construção

- **Dependência nova:** `motion` (motion/react). Só `transform`, `opacity` e (no materializar) `filter: blur` são animados.
- **Contexto de movimento:** o tema efetivo vai para a store (`themeId`); um hook `useMotionPreset()` devolve as variantes do tema. `<MotionConfig reducedMotion="user">` na raiz de cada janela.
- **Modais:** componente `ModalFrame` (fundo + caixa + `AnimatePresence`) substitui o par `.modal-backdrop` / `.modal` repetido em cada modal. Origem: um ouvinte global de `pointerdown` guarda posição e horário do último clique.
- **Aba ativa e seleção da lateral:** elemento compartilhado com `layoutId` (interrompível).
- **Painéis:** entrada pela Motion no `.pane-slot`; saída: `hidePane`/fechar arquivo anima o slot (140 ms) e então remove a folha. O xterm mede com `offsetWidth/Height`, que ignoram a escala: o terminal não é redimensionado.
- **Toque:** CSS (`:active`) com os tokens `dur-fast` e `ease-spring`.
- **Ilha dinâmica:** componente `AttentionIsland`, alimentado pela mesma transição de estado que hoje gera as notificações do sistema (`noticesFor`), com fila pura testável.
- **Linux / GPU:** o processo principal lê `app.getGPUFeatureStatus().gpu_compositing`; sem composição por GPU, o renderer recebe `gpu=0` e o materializar vira esmaecimento.
- **Reduzir movimento:** a Motion respeita `prefers-reduced-motion`; os presets trazem variantes só de opacidade; os tokens de duração já vão a 0 para o CSS.

## 5. Testes

- Unitários: presets por personalidade (spring vs tween, valores); variantes reduzidas (só opacidade); escolha da origem (clique recente → ponto; antigo/atalho → topo-centro); fila da ilha (ordem, sem duplicar, expiração); decisão de materializar (premium + GPU + sem reduzir movimento).
- Reais (Electron isolado): para cada tema, abrir/fechar Preferências e ⌘K, trocar aba, abrir/fechar painel, clicar na lateral, disparar "precisa de você" — medindo opacidade/transformação no meio da animação e o estado final; repetir com `prefers-reduced-motion` emulado; conferir que o terminal não recebe `pane.resize` durante a entrada/saída.
- Linux: `npm run pack:linux` (build e pacote) sem erro.
