# Notas · A · Quiz "Qual desses Claudes tá esperando você?"

## Material
Gravação B regravada em 2× (zoom 2 no conteúdo, viewport 3840×2160): `clips/recB`, 107–114 s (quiz contínuo: só o dev-3 🟡 de 107,8 a 110,7 s, ⌘J real em 110,72 s, aprovação em 112,13 s, 🟢 em 112,95 s), saltos ⌘J na lateral (35,2 / 40,3 / 50,4 s), estado final 126,5–130,5 s. Quadros com zoom errado (efeito das capturas paradas) marcados por `glitch.py` e pulados no recorte.

## Rodadas
1. check: 3 erros de zona segura, gancho 5,2, mesma cena 46%, cartão final 2,8 s. Correções: números e tecla para dentro da zona; células "encaixando"; CTA amarelo e mais curto.
2. Visual: números atrás das células (z-index), barra riscando a pergunta, zoom pegando código cortado, legenda escura sumindo no terminal, cena final minúscula, bolinha amarela sumindo no CTA amarelo. Corrigidos.
3. check: determinismo em 2,55 s. Causa: o círculo do número 1 rasterizado em escala pequena era reaproveitado ao voltar no tempo. Escala por tamanho (largura/fonte), não por transform. `P.seq` passou a esperar `img.decode()`.
4. Visual: quadro 0 bagunçado pelo "encaixe" (células giradas por cima da pergunta). Quadro 0 assentado; o movimento do 1º segundo vem do soco de câmera na batida + número acendendo. Varredura das células em branco (amarelo significa "precisa de você" no app e confundiria o quiz). Corte seco na batida 5,5 s em vez de transição com recorte sem sentido. Faixa do cabeçalho em largura total + anel na bolinha.
5. 4:5: pergunta e "É o 4." acima da zona segura; legenda cobrindo o pedido. Corrigidos.

check final: 9:16 e 4:5 com 0 erro, 0 aviso. 9:16: gancho 11,7 · parado máx. 0,8 s · 22 viradas · mesma cena 29%. 4:5: gancho 12,6 · 31%. Sem tetos.

## Notas (rodada 5)
| Critério | Nota | Evidência | Pior momento |
|---|---|---|---|
| Gancho | 8 | t=0: pergunta em 96 px + 4 terminais numerados; 0,5–2,0 s cada célula leva um soco branco com tick; métrica 11,7 | 0–3 s é uma cena só (a barra enchendo segura) |
| Clareza | 8 | 3,3 s "É o 4." com contorno amarelo real; 4,8 s "Do you want to proceed?"; 6,05 s bolinha 🟢 | o nome do produto só aparece em 12,8 s |
| Marca | 8 | UI real no tema Noite, cores de estado do app, chips reais | sem ícone ainda (bolinhas no lugar, 13,6 s) |
| Composição | 8 | zona segura ok nos dois formatos; 6,05 s faixa centrada | 6,05 s metade de baixo vazia |
| Movimento | 8 | revelação em 3,0 s, corte seco em 5,5 s, saltos em 7/8/9 s na batida | entrada do cartão da lateral (6,6 s) é um slide comum |
| Anti-genérico | 8 | nada inventado; fundo escuro → claro → escuro → amarelo | CTA centralizado e simétrico |
| CTA | 8 | "grátis no GitHub" + URL legível em 2 linhas, 2,2 s | depende do repo estar público ao postar |
| Polegar (360 px) | 8 | pergunta legível na miniatura, 4 números formam o enigma | terminais viram textura na miniatura |
| Retenção | 8 | ciclo aberto (barra) respondido em 3,0 s; algo novo a cada ≤1,5 s | 10–12,8 s pilha de cabeçalhos é o trecho mais calmo |
| Loop | 8 | 14,75–15 s a grade e a pergunta voltam idênticas ao quadro 0 | — |
| Compartilhamento | 8 | pergunta direta ao espectador, dá para chutar nos comentários e marcar quem vive com 6 abas | sem humor explícito |
| Nativo | 8 | formato de quiz, legenda em caixa branca estilo TikTok | CTA amarelo tem cara de anúncio |
| Verdade | 9 | toda frase conferida com a gravação: "É o 4." (só o dev-3 🟡 em 110,0 s); "aprovou, ele segue sozinho" (🟢 em 112,95 s); "qualquer projeto, qualquer aba" (salto para a aba API, outro projeto, em 50,7 s) | "grátis" vale se o repo abrir antes de postar |

Erros já vistos: nenhum presente (payoff aos 3–6 s, cartão final 2,2 s, quadro 0 sem UI cortada na lateral, cenas alternando fundo).

## Pendente antes do render final
- Ícone do usuário em `assets/icone.png` (o CTA troca as bolinhas pelo ícone sozinho).
- Faixa de música real (a trilha atual é o groove sintetizado de rascunho).
