# Gerenciador de Terminal: marca para vídeo

## Produto
- **Nome:** Gerenciador de Terminal (sem logo próprio: o app ainda usa o ícone padrão do Electron).
- **Promessa em uma frase:** todas as suas sessões do Claude Code e do Codex numa tela só, e você vê na hora qual está esperando por você.
- **O que é:** app de desktop (macOS Apple Silicon e Linux .deb/.rpm) que hospeda várias sessões de agente de código em splits livres. Ele não roda o Claude: digita o comando da sua conta no shell e acompanha a sessão pelos hooks.
- **Público:** dev que roda 3, 5, 10 sessões de Claude Code/Codex ao mesmo tempo, em vários projetos e worktrees, e perde o fio de quem terminou, quem pediu permissão e em que branch cada uma está.
- **Idioma:** pt-BR (o app é todo em português).

## O que existe de verdade (pode aparecer no vídeo)
- Splits livres, abas e espaços de trabalho (janelas).
- Cabeçalho por painel: chip do PROJETO (cor do projeto), chip da worktree `⎇ carrinho` (verde-limão), nome da sessão, branch, alterações, ↑ push / ↓ pull, conta.
- Estado por sessão: 🟢 trabalhando · 🟡 precisa de você (permissão/opções) · 🔵 sua vez (terminou e espera resposta) · ⚪ ocioso. O painel 🟡 ganha contorno amarelo; o 🔵, contorno azul.
- Lateral com projetos, worktrees e contagem de estados (🟡1 🟢1).
- ⌘J: pula para a próxima sessão que precisa de você. ⌘K: busca rápida.
- Aviso: ilha no topo "dev-1 precisa de você", notificação do macOS, número no Dock, bolinha na aba.
- Daemon: fechar ou atualizar o app não mata nenhuma sessão; ao reabrir, a tela e o scrollback voltam. "Retomar todas".
- Conflitos entre worktrees (botão ⇄): compara cada worktree com a main e entre si, só com git.
- Uso do plano (janela de 5 h e semanal) na barra de status.
- Sessão líder 👑 contrata devs: você pede "contrata 3 devs" e o app abre terminais novos ao lado, cada um com worktree própria e a tarefa.
- Janela flutuante (⇧⌘F) com Liquid Glass; leitor de arquivo, imagem e vídeo no painel.
- Temas: Padrão (VS Code escuro), Claro, Vidro calmo, Noite afiada, Aurora.
- Atualização pelo próprio app.

## Momento mais satisfatório
1. **A sessão vira 🔵 e ⌘J te leva direto a ela.** Você estava em outra coisa; a bolinha muda, a ilha cresce no topo, um atalho e você está no terminal certo.
2. **"Contrata 3 devs":** três terminais se abrem sozinhos ao lado do líder, cada um na sua worktree, já trabalhando (🟢🟢🟢).

## Cores (do código: `src/renderer/src/app-themes.ts`)
| Papel | Hex | Uso no vídeo |
|---|---|---|
| Fundo escuro (Noite afiada) | `#111219` | fundo principal das cenas tipográficas |
| Fundo escuro (Padrão) | `#1e1e1e` | variação "VS Code" |
| Texto claro | `#e6e6ea` | texto sobre escuro |
| Texto apagado | `#a8aab8` | apoio |
| Acento Noite (índigo) | `#5e6ad2` / `#8b95ff` | detalhes, nunca em gradiente roxo→azul |
| 🟢 trabalhando | `#4cb782` | estado (verde do tema Noite) |
| 🟡 precisa de você | `#f2c94c` (Noite) / `#e2a500` (Padrão) | o "alarme" do vídeo |
| 🔵 sua vez | `#3b82f6` (Padrão) / `#5e6ad2` (Noite) | o "pronto, é com você" |
| Chip worktree | fundo `#d9f99d`, texto `#1a2e05` | assinatura visual do app; cor de destaque das cenas claras |
| Chip projeto | fundo `#e6e6ea`, texto `#111219` (ou a cor do projeto) | |
| Fundo claro | `#f5f5f7` / `#ffffff` | cenas claras para variar o quadro |

As bolinhas de estado (verde, amarelo, azul) são a identidade visual mais forte do produto: são elas que dizem "quem precisa de você".

## Fontes
- App: SF Pro (fonte do sistema, `-apple-system`) na interface e Menlo no terminal. Aparecem nas capturas reais; não copiar para títulos.
- Vídeo (padrão desde 2026-10-11): Geist 800–900 nos títulos e legendas, Geist Mono na URL e nos textos de terminal (`assets/fonts/`, OFL). Teclas (⌘J, enter) em caixa clara com sombra embaixo.

## Telas de destaque (capturas reais em `assets/screens/`)
- `app-noite.png`, `app-padrao.png`, `app-aurora.png`, `app-vidro.png`: 4 sessões em 3 projetos fictícios (loja-online, app-financas, api-pagamentos), com worktrees, em 🟢 🟡 🔵 🟢. Capturadas de uma instância isolada (`GT_HOME` próprio), sem dados reais.
- Falta: gravação em movimento (terminais com o Claude trabalhando, estado mudando, ilha, ⌘J, contratar).

## Tom
Dev falando com dev, direto, com humor de quem já se perdeu em 8 abas de terminal. Nada de "revolucione seu fluxo".

## CTA e links
- CTA (decidido 2026-10-11): "grátis no GitHub" + `github.com/misasoares/gerenciador-de-terminal` (2 linhas, Geist Mono) + "macOS e Linux", em fundo amarelo. O repo precisa estar público antes de postar.
- Assinatura: ícone do usuário em `assets/icone.png` (pendente); sem ele, as 3 bolinhas 🟢🟡🔵 com contorno escuro.

## Padrões que viraram regra (2026-10-11)
- Alternar fundos por cena: escuro (Noite) → claro (#f5f5f7) → escuro → amarelo no CTA.
- Amarelo só para o 🟡 real e para o CTA; nunca como destaque de varredura.
- Legenda sobre UI escura: caixa branca, texto escuro.
- Material: gravar com Claude real na cópia isolada (`promo-videos` + scripts no aprendizados), em 2× (zoom), sem screenshot durante o screencast.
- Sessão que "chama você" na gravação: prompt pede uma pergunta pelo AskUserQuestion (🟡 real e legível); o resto em bypass. Prompt fora do enquadramento.
- Fundos de cena aceitos (2026-10-12): escuro Noite, claro #f5f5f7, lima #d9f99d (cor do chip de worktree), índigo #5e6ad2, cores dos projetos fictícios (vermelho #e5484d, verde #30a46c, roxo #8e4ec6) e amarelo só no CTA.
- Miniatura: além da frase, um elemento grande e real (bolinhas de estado, chips de worktree, lateral com contagens).

## Restrições de copy
- Não sugerir vínculo oficial com Anthropic ou OpenAI: "para Claude Code e Codex", nunca "o app oficial".
- Não prometer Windows (o código prevê, mas só macOS e Linux são entregues).
- Não dizer que o app "roda" ou "acelera" o Claude: ele organiza e avisa.
- Não mostrar projetos, contas ou clientes reais do usuário (weboption, mslabs etc.): só projetos fictícios.
- Toda frase com número ("10 sessões", "nunca perde") conferida contra o que a tela mostra.

## O que evitar
- Gradiente roxo→azul de "cara de IA" (mesmo o tema Aurora tendo um parecido: usar Noite/Padrão como base).
- Emoji como ícone solto fora do contexto do app (as bolinhas são do app; tudo bem quando aparecem na UI real).
- Redesenhar a interface: só capturas reais.
