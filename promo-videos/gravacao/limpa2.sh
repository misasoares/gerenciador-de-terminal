#!/bin/bash
# fecha a cópia de teste e devolve os projetos fictícios ao estado inicial (todas as worktrees)
pkill -9 -f "node_modules/electron/dist"; sleep 2
D=/private/tmp/claude-501/dev
for r in loja-online app-financas api-pagamentos; do
  git -C $D/$r worktree list --porcelain | sed -n 's/^worktree //p' | while read -r w; do git -C "$w" reset -q --hard; git -C "$w" clean -qfd -e .claude; done
done
echo limpo
