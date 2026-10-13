#!/bin/bash
# regrava B, D e C em 2× (zoom no conteúdo)
SP=/private/tmp/claude-501/-Volumes-SSD-MISA-apps-misa-gerenciador-de-terminal/1b143a69-056d-4470-9e06-c31c8433e2ad/scratchpad
REPO="/Volumes/SSD MISA/apps-misa/gerenciador-de-terminal"; D=/private/tmp/claude-501/dev; L=$D/loja-online
limpa() {
  pkill -9 -f "node_modules/electron/dist"; sleep 2
  for n in dev-1 dev-2 dev-3; do git -C $L worktree remove --force .claude/worktrees/$n >/dev/null 2>&1; git -C $L branch -D main-$n >/dev/null 2>&1; done
  for d in $D/app-financas/.claude/worktrees/grafico $D/api-pagamentos $L $L/.claude/worktrees/cupom $L/.claude/worktrees/frete $D/app-financas; do git -C $d reset -q --hard; git -C $d clean -qfd -e .claude; done
}
mkdir -p "$REPO/promo-videos/assets/clips/old1x"
for r in recB recD recC; do [ -d "$REPO/promo-videos/assets/clips/$r" ] && mv "$REPO/promo-videos/assets/clips/$r" "$REPO/promo-videos/assets/clips/old1x/$r"; done
limpa; echo "== B"; ZOOM=2 node $SP/scripts/recB.mjs > $SP/recB.log 2>&1; echo "B EXIT=$?"
limpa; echo "== D"; ZOOM=2 node $SP/scripts/recD.mjs > $SP/recD.log 2>&1; echo "D EXIT=$?"
sleep 4; echo "== C"; ZOOM=2 node $SP/scripts/recC.mjs > $SP/recC.log 2>&1; echo "C EXIT=$?"
tail -2 $SP/recC.log
limpa; echo FIM
