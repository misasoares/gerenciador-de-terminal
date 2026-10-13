# Aprendizados dos vídeos

Uma entrada por rodada: o que foi testado, o que funcionou, o que não funcionou, o que mudar.

## 2026-10-11 · Gerenciador de Terminal · rodada 1 (A quiz, B contratei 3 devs, C fechei o app)

**Brief:** alcance orgânico para devs; públicos: dev das 8 abas, quem vigia o terminal, tech lead de agentes, multiprojeto/multitarefa. Material gravado com Claude Code real numa cópia isolada do app. CTA "grátis no GitHub" (repo ainda privado, abre antes de postar). Ícone pendente (CTA usa as 3 bolinhas até `assets/icone.png` existir).

**Aprovado pelo usuário:** os 3 conceitos; CTA GitHub; gerar 2 faixas no Artlist (600 créditos); render final já, trocando o ícone depois.

**Notas finais (self, com evidência em cada notas.md):** A, B e C com todos os critérios ≥ 8 (verdade 9; compartilhamento do B 9). check sem erro e sem aviso nos 6 arquivos; verify-output ✓ (−14 LUFS).

**Gravar app desktop (Electron) para anúncio: o que funcionou**
- Cópia isolada com `GT_HOME` próprio e projetos fictícios. O caminho do socket Unix precisa ter ≤ 104 caracteres: o scratchpad é longo demais (o daemon não sobe e o app abre um alerta modal que trava tudo).
- `_electron.launch` do Playwright não pegou a janela; funcionou abrir o Electron com `--remote-debugging-port` e conectar por `connectOverCDP`. Ações de menu nativo (⌘J, abas) por `--inspect` no processo principal + `webContents.send('gt:menu', …)`.
- O renderer só adota o layout do daemon quando chegam painéis novos: mandar `layout.save` antes de `pane.create`.
- O Claude pede confiança por pasta (worktree nova pede de novo): roteiro aceita sozinho lendo o texto do terminal. O texto do TUI vem com `ESC[nG` (coluna absoluta) entre as palavras: normalizar antes de procurar frases.
- `Page.startScreencast` ignora o DPR (sai em 1×). Para closes nítidos: viewport em 3840×2160 + `setZoomFactor(2)` (mesmo layout, dobro de pixels).
- **Nunca** tirar `page.screenshot` durante o screencast: ele troca a emulação, gera quadros com zoom errado e trava o fluxo por até 1,3 s (o momento em que o dev-3 virou 🟡 se perdeu assim). Os stills devem sair dos próprios quadros do screencast.
- Detector de quadro ruim pela faixa do topo do quadro (abas/cabeçalhos) + recorte de clipe por instante exato com hardlink. O `concat` do ffmpeg com imagens esticou clipes (2 s viraram 3,17 s).
- Para a cena "fechei o app": consultar o daemon direto com o app fechado até a condição (3 sessões 🔵) e só então reabrir. Rodar a equipe em modo automático para ninguém travar pedindo permissão sem ninguém olhando.
- O ⌘J real nem sempre vai para quem o log espera (a fila mistura 🟡 e 🔵): rotular cada salto pelo que o quadro mostra.

**Composição**
- Imagem de 3840 px: o `__seek` precisa esperar `img.decode()` (já no kit: `P.seq` + `P.settle`).
- Elemento pequeno escalado por `transform` foi rasterizado pequeno e reaproveitado ao voltar no tempo (falha de determinismo): escalar por largura/fonte.
- Gancho: socos de câmera na batida, inversão de fundo de meio tempo (B) e flash curto (C) passaram de 9 com folga. Recuo de câmera no quadro 0 cortava a UI nas bordas (erro já visto): descartado.
- Amarelo é "precisa de você" no app: não usar amarelo como cor de destaque genérica (no quiz, a varredura amarela entregava a resposta errada). Branco para varrer, amarelo só para o 🟡 real.
- Conferência de verdade mudou 2 frases: "os 3 pediram permissão juntos" → "os 3 esperando você. ao mesmo tempo." (pedidos em 22,3/23,9/26,5 s; os três esperando juntos de 27,7 a 28,9 s); "confere conflito" → "avisa quem vai conflitar no merge" (a análise real achou dev-1 ↔ dev-2). Legenda "tech lead em 16 segundos" cortada (vídeo acelerado).

**Música:** Lyria 3 Pro instrumental, 300 créditos por faixa. A "leve" veio a 123,5 BPM: `atempo` para 120 sem mudar o tom, depois medir de novo. Drop de cada faixa encaixado no impacto do vídeo (A 7,0 s, B 2,0 s, C 3,5 s). Comparação: `contratei-3-devs` com a faixa padrão (leve) e `alt-musica-escura-9x16.mp4`.

**Pendências:** ícone do usuário (re-renderizar só muda o CTA); repo público antes de postar; métricas (views, retenção) quando postar: registrar aqui.

## 2026-10-12 · Gerenciador de Terminal · rodada 2 (D eu às 15h, E 3 projetos, F 4 tarefas)

**Brief:** "novas versões focando em quem trabalha multitarefa e gerencia vários terminais". Públicos marcados: 3 projetos ao mesmo tempo, várias frentes no mesmo projeto, terminal demais (10+). Não marcado: "faz outra coisa enquanto roda" (janela flutuante). Gravação nova; músicas da rodada 1 reaproveitadas (0 crédito).

**Aprovado:** os 3 conceitos como propostos. Mudança minha na conferência de verdade: F "4 features" → "4 tarefas" (uma das quatro é suíte de testes).

**Notas finais (self, com evidência em cada notas.md):** todos os critérios ≥ 8; D com gancho, retenção, compartilhamento e nativo 9. check sem erro e sem aviso nos 6 arquivos.

**Gravação: o que mudou e funcionou**
- Para controlar quem fica 🟡: todas as sessões em `--dangerously-skip-permissions` e as que "chamam você" recebem no prompt "antes de mexer em qualquer arquivo, use AskUserQuestion para me perguntar X". Fica 🟡 em 3–5 s e o close mostra uma pergunta real e legível. Esconder o prompt no enquadramento (ele denuncia a encenação).
- Sonnet 5.5 resolve tarefa pequena em 5–15 s: sessão de "enchimento" vira 🔵 logo. A fila do ⌘J (🟡 antes de 🔵, o mais antigo primeiro) passa a depender da ordem em que as tarefas terminam. Para o ⌘J cair onde o roteiro quer, a sessão alvo precisa ser o 🔵 mais antigo (digitar a tarefa dela primeiro). A 1ª versão do E foi descartada por isso.
- Digitar o prompt em 12 painéis ao mesmo tempo (um evaluate por caractere) leva ~50 s; a parede só trabalha depois disso. Digitar mais rápido (120 cps) ou começar a gravar só depois.
- Painel focado que termina vira ⚪ na hora (se a janela de teste estiver com foco do macOS): focar uma sessão longa antes de gravar.
- Nos painéis estreitos o rodapé do Claude some: "pronto" = indicador "◐ medium" do cabeçalho do Claude.
- Worktrees dentro de um repositório já confiado herdam a confiança da pasta: não precisa de pretrust.
- Conta de teste com `planUsage: false` (a barra de status mostrava o uso real do plano do usuário) e `Notification.prototype.show` anulado no processo principal (a cópia de teste mandava notificações para a tela).
- Estados simulados por hook somem: o daemon confere se há processo do Claude no painel. Sonda visual só com Claude real.

**Composição**
- Medir posições nos quadros reduzidos (1920) e usar no quadro 2× sem dobrar deu dois erros (zoom no prompt em vez da pergunta; recorte do app com a lateral cortada na borda). Medir sempre no quadro em 3840 ou dobrar na hora.
- Gancho sem movimento (texto + tela parada) mede 5–7 no check. Resolveram: inversão de fundo na batida 0,5 (F), flash na cor de cada projeto nas batidas (E), fundo virando a cada passo da escalada (D).
- Parede de 12 terminais é ilegível em 360 px: a miniatura precisa de um elemento grande além do texto. Funcionaram: fileira de 12 bolinhas com o estado real de cada sessão (D) e chips lima com o nome de cada worktree sobre o 2×2 (F).
- Chips sobre a tela contam como palavras no check (>14 vira aviso): nome curto, sem símbolo.
- Fundo por cena: lima (cor do chip de worktree) e índigo (acento Noite) entraram bem como variação de cenário; as cores dos projetos (vermelho/verde/roxo) como fundo de cada ⌘J deixaram os saltos legíveis.

**Música:** D e F com a "leve" (drop aos 2,0 s e 1,5 s), E com a "escura" (drop no 1º ⌘J, 3,0 s). Nenhum buraco abaixo de −30 dB.

**Pendências:** ícone do usuário; repo público; métricas quando postar.
