# Notas · B · "Pedi pro Claude contratar 3 devs."

## Material
Gravação D (2×): prompt digitado 1,2–10,0 s (clipe a 6×), enter 10,02 s, terminais abrindo em 17,19 / 19,26 / 21,43 s, resposta do líder em 26,4 s ("Os 3 devs foram contratados. Cada um tem um terminal próprio, ao lado desta sessão…"), os três 🟡 de 27,73 a 28,9 s, ⌘J + aprovação: dev-1 (aprovado 28,95, 🟢 30,04), dev-2 (34,20 / 35,29), dev-3 (39,32 / 40,41). Gravação B: análise de conflitos real em 133,5 s ("⚠ dev-1 ↔ dev-2 · src/carrinho.js, test/carrinho.test.js · Se mergear dev-1 primeiro, dev-2 vai conflitar"), equipe no fim 128,6–130,2 s.

Achado: o screencast não mandou quadros de 26,43 a 27,73 s (captura parada travou o fluxo). O dev-3 virou 🟡 em 26,52 s, mas isso só aparece a partir de 27,73 s. A cena dos três 🟡 usa 27,73–28,9 s.

## Ajuste de texto contra os dados
- Roteiro dizia "os 3 pediram permissão juntos". Os pedidos foram em 22,3 / 23,9 / 26,5 s; o que é verdade é que de 27,7 a 28,9 s os três estão esperando ao mesmo tempo. Texto final: "os 3 esperando você. ao mesmo tempo."
- Roteiro dizia "confere conflito antes do merge"; a análise real encontrou um par em conflito. Texto final: "e avisa quem vai conflitar no merge".

## Rodadas
1. check: rótulos ⎇ fora da zona segura, gancho 7,1, 2,3 s parado (8,0–10,3 s). Visual: texto digitado pequeno, close do líder começando depois da frase, dev-3 aparecendo 🟢 na cena dos 🟡 (buraco do screencast).
2. Rótulos numa linha; app recortado só na área dos painéis; texto digitado a 1,6× (42 px); aprovação com destaque índigo + ✓ verde; cena dos 🟡 em 27,73–28,9 s; zoom no par em conflito. Gancho subiu com a inversão de fundo de meio tempo na batida 0,5 s (recurso que funcionou no Closer360).
3. ✓ soltos no canto (faltava escondê-los fora da cena), quadro 0 cortando "contrata", cabeçalho destacado saindo pela direita, zoom cortando "(e vice-versa)". Corrigidos.

check final: 9:16 e 4:5 com 0 erro, 0 aviso. 9:16: gancho 181 · parado máx. 1,0 s · 20 viradas · mesma cena 36%. Sem tetos.

## Notas
| Critério | Nota | Evidência | Pior momento |
|---|---|---|---|
| Gancho | 8 | t=0 "Pedi pro Claude contratar 3 devs." + "❯ contrata 3 devs agora," sendo digitado; 0,5 s inversão de fundo; 1,0 s enter | frase do gancho é a mesma do prompt, pode soar repetida |
| Clareza | 8 | 2,0–3,0 s os 3 terminais abrem com os rótulos ⎇ dev-1/2/3; 4,0 s o líder explica | o app inteiro em 2–3 s é pequeno (painéis a 0,33×) |
| Marca | 8 | UI real, chips e cores do app, tema Noite | ícone pendente |
| Composição | 8 | zona segura ok nos dois formatos | 2,1 s faixa vazia entre "Ele contratou." e o app |
| Movimento | 8 | terminais abrindo exatamente nas batidas 2,0/2,5/3,0; aprovações em 8/9/10 s com ✓ | entrada do modal de conflito é um slide simples |
| Anti-genérico | 8 | nada inventado; fundos escuro → claro → escuro → amarelo | CTA simétrico (igual ao A) |
| CTA | 8 | "grátis no GitHub" + URL, 1,7 s | repo ainda privado |
| Polegar | 8 | miniatura: frase grande + prompt real legível | metade de baixo do quadro 0 vazia |
| Retenção | 8 | escalada: contrata → abrem → explicam → todos te esperam → 3 teclas → conflito → tech lead | — |
| Loop | 8 | 15,4–16 s o CTA sobe e sai, a pergunta e o prompt sobem de baixo até a posição do quadro 0 | 15,64 s a pergunta passa por cima do amarelo (2 quadros) |
| Compartilhamento | 9 | "o Claude contrata devs" é novidade para quem usa Claude Code; dá vontade de mandar no grupo | — |
| Nativo | 8 | história em 1ª pessoa, legenda em caixa | CTA com cara de anúncio |
| Verdade | 9 | frases ajustadas aos dados (ver acima); o líder 👑 foi marcado no app como pode contratar | "grátis" depende do repo abrir |

Rodada 4: loop com movimento contínuo (CTA sai por cima, quadro 0 entra por baixo).

## Pendente antes do render final
- Ícone em `assets/icone.png`; faixa de música real.
