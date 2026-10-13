# Notas · F · "4 tarefas do mesmo projeto. Ao mesmo tempo."

## Material
Gravação `recF4` (2×, `gravacao/recF4.mjs`): loja-online em 2×2 com as worktrees cupom, frete, parcelas e testes. Todas 🟢 de 11,35 s; parcelas pergunta (🟡) em 13,94 ("Em quantas parcelas sem juros a loja deve permitir?"); cupom 🔵 em 22,91; frete 🔵 em 23,93; testes segue 🟢. ⇄ clicado em 29,07: o modal real mostra "⚠ cupom ↔ frete · src/carrinho.js · Se mergear cupom primeiro, frete vai conflitar (e vice-versa)" e a lateral ganha ⚠ nas duas worktrees.

## Conferência de verdade
- Gancho: o roteiro aprovado dizia "4 features"; virou "4 tarefas", porque uma das quatro é uma suíte de testes, não uma feature. O fim também: "4 tarefas. 1 projeto. 1 tela."
- "um te perguntou / um terminou / outro terminou": ordem real (13,94 / 22,91 / 23,93 s).
- "e ele avisa quem vai conflitar antes do merge": o modal real; o app avisa, não impede (nada de "zero conflito").
- Chips cupom/frete/parcelas/testes no quadro 0: as worktrees reais de cada quadrante.

## Rodadas
1. check: "Ao mesmo tempo." fora da zona segura; gancho 4,8. Gancho para 96 px + inversão de fundo na batida 0,5 (gancho 151). No 4:5, legenda dos estados encostando no topo.
2. Visual: o zoom no cupom mostrava uma faixa vazia acima da janela; o modal entrava pequeno; o rabisco riscava a linha de baixo. Caixa do tamanho de um painel, zoom no par em conflito aos 9,75 s, elipse em volta de `src/carrinho.js`.
3. Quadro 0: o centro do recorte estava errado (entrava uma fatia da lateral cortada na borda esquerda). Corrigido. Miniatura fraca → chips lima com o nome de cada worktree sobre os quadrantes (sem o "⎇", para não passar de 14 palavras na tela).

check final: 9:16 e 4:5 com 0 erro, 0 aviso. Gancho 152 (9:16) / 118 (4:5) · parado máx. 0,8 s · mesma cena 13% / 8%. Sem tetos.

## Notas
| Critério | Nota | Evidência | Pior momento |
|---|---|---|---|
| Gancho | 8 | t=0 frase em 96 px + 2×2 real com 4 chips lima; 0,5 s inversão de fundo; socos 0,5/1,0 | o 2×2 é pequeno (0,33×) |
| Clareza | 8 | 1,5–3,5 s os 4 cabeçalhos reais ⎇ com a branch; 9,75 s o par em conflito em close | "worktree" pode não dizer nada para quem não usa |
| Marca | 8 | UI real; o lima do chip de worktree vira o fundo da cena 2 | ícone pendente |
| Composição | 8 | zona segura ok nos dois formatos | 3,5–6 s espaço vazio abaixo do painel ampliado |
| Movimento | 8 | cabeçalhos entram girando, um por batida; câmera vai em quem mudou; elipse desenhada (10,1 s) | 11,75–13,3 s o 2×2 final é estático com push leve |
| Anti-genérico | 8 | nada redesenhado; pergunta e modal reais | CTA simétrico |
| CTA | 8 | 13,25–15 s | repo privado |
| Polegar | 8 | miniatura: frase grande + 4 chips lima legíveis sobre o 2×2 | o terminal some na miniatura |
| Retenção | 8 | algo novo a cada 0,5–1 s; clímax do conflito em 9,75–11,75 s | o fim é menos forte que o conflito |
| Loop | 8 | 14,6–15 s o CTA sobe e o quadro 0 entra por baixo | — |
| Compartilhamento | 8 | "olha isso antes do teu próximo merge" | nicho de quem usa worktree |
| Nativo | 8 | texto estilo feed, frase curta | CTA com cara de anúncio |
| Verdade | 9 | estados, par e arquivo do modal conferidos; "tarefas" no lugar de "features" | — |
