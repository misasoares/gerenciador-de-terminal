# F · "4 features do mesmo projeto. Ao mesmo tempo."

- **Fórmula:** ação no meio (o quadro 0 já tem os quatro trabalhando).
- **Público:** várias frentes no mesmo projeto (feature, bug e teste em worktrees paralelas).
- **Quadro 0:** fundo Noite; "4 features do mesmo projeto." / "Ao mesmo tempo." enorme; embaixo, o app em 2×2 com quatro painéis da loja-online, cada um com o chip ⎇ (cupom, frete, parcelas, testes) e o Claude trabalhando 🟢.
- **Por que compartilhar:** "olha isso antes do teu próximo merge"; quem usa worktree reconhece o problema de não saber qual branch é de quem.
- **Duração:** 15 s · 120 BPM · faixa "leve" com o drop aos 1,5 s, no primeiro close de cabeçalho.

| tempo | batida | visual | texto na tela | movimento | som |
|---|---|---|---|---|---|
| 0–1,5 | 1–3 | 2×2 com os 4 painéis 🟢 | "4 features do mesmo projeto." / "Ao mesmo tempo." | socos de câmera nas batidas | batida |
| 1,5–3,5 | 4–7 | closes nos cabeçalhos, um por batida: ⎇ cupom · feat/cupom; ⎇ frete · feat/frete; ⎇ parcelas; ⎇ testes | "cada Claude na sua worktree." → "cada um na sua branch." | carrossel com corte na batida | drop + tique por close |
| 3,5–6,0 | 8–12 | volta ao 2×2: os estados mudam de verdade (dois 🔵, um 🟡, um 🟢) | "um terminou." / "outro terminou." / "um pediu permissão." (uma por batida, na hora da troca) | zoom em cada contorno que muda | ding |
| 6,0–8,5 | 13–17 | fundo claro: os 4 cabeçalhos empilhados, com as alterações (+N −N) e a branch de cada um | "e você vê o que cada branch mudou." | as faixas entram em cascata | |
| 8,5–12,0 | 18–24 | botão ⇄ do projeto → modal real de conflitos: "cupom ↔ frete · src/carrinho.js" e "Se mergear cupom primeiro, frete vai conflitar" | "e ele avisa quem vai conflitar" / "antes do merge." | close no par e no arquivo; rabisco sob o nome do arquivo | alerta curto |
| 12,0–13,0 | 25–26 | os 4 painéis de novo | "4 frentes. 1 projeto. 1 tela." | recuo | |
| 13,0–15,0 | 27–30 | CTA amarelo; nos últimos 0,5 s ele sobe e o 2×2 do quadro 0 entra | "grátis no GitHub" + URL + "macOS e Linux" | | impacto |

- **Loop:** o CTA sobe e o 2×2 com a frase volta.
- **Assets reais:** gravação nova `recF4` (loja-online em 2×2, quatro worktrees; as tarefas do cupom e do frete mexem na mesma função `total()` de `src/carrinho.js`, para a análise de conflitos ter o que mostrar; testes e parcelas em arquivos próprios).
- **Conferência de verdade:** o texto dos estados acompanha a ordem real das trocas; o par e o arquivo do modal são os que a análise real encontrar. Nada de "zero conflito": o app avisa, não impede.
- **4:5:** o 2×2 ocupa a largura; os closes de cabeçalho ficam iguais.
