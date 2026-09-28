# Gerenciador de Terminal

App para macOS que hospeda várias sessões do Claude Code em splits livres e mostra, por painel,
projeto, worktree, branch, alterações, commits para push/pull, estado da sessão e conta.

## Como funciona
- Um daemon (`~/.gerenciador-terminal/daemon.sock`) é dono dos terminais: fechar ou atualizar o app não mata sessões.
- Hooks do Claude Code (instalados em `~/.claude/settings.json`, com backup) avisam o app de mudança de pasta/worktree e do estado da sessão.
- As contas são os comandos do seu `.zshrc` (`claude`, `claude-mslabs`, `claude-weboption`, `claude-weboption-max`); o app só digita o comando.

## Desenvolvimento
    npm install
    npm test
    npm run dev            # usa ~/.gerenciador-terminal (GT_HOME=/tmp/x npm run dev para isolar)
    npm run pack           # gera dist/mac-arm64/Gerenciador de Terminal.app

## Atalhos
⌘T nova sessão · ⌘D / ⇧⌘D dividir · ⌘W esconder · ⌘J próxima que precisa de mim · ⌘K buscar · ⌘, preferências · ⇧⌘T nova aba · ⌘1…9 abas · ⌥⌘+setas foco · ⌘B sidebar

## Estados e avisos
🟢 trabalhando · 🟡 precisa de você (permissão/opções) · 🔵 sua vez (terminou e espera resposta) · ⚪ ocioso.
Abas não ativas ganham uma bolinha quando algo nelas espera você; o Dock mostra o total; o macOS notifica quando você não está vendo.

## Conflitos entre worktrees
Botão ⇄ no projeto: compara cada worktree com a main e com cada outra (inclui alterações não commitadas), sem mexer em nada.

## Encerrar de verdade
Menu do app → "Encerrar tudo" (as sessões ficam disponíveis para retomar na próxima abertura).
Logs: `~/.gerenciador-terminal/daemon.log`.
