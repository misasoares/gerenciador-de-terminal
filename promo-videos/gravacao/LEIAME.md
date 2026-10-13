# Gravação do material (Claude real numa cópia isolada do app)

1. `npm run build` na raiz (a cópia de teste roda `out/`).
2. `bash demo-repos.sh` (projetos fictícios) e `node pretrust.mjs` (aceita a confiança das pastas no Claude).
3. `ZOOM=2 node recB.mjs` (abas + ⌘J + equipe + conflitos), `ZOOM=2 node recD.mjs` (contratação visível), `ZOOM=2 node recDC2.mjs` (fecha com ≥3 🟢, reabre quando ≥3 🔵). `regrava.sh` roda B, D e C em sequência.
4. `python3 -W ignore glitch.py ../assets/clips/<rec>/frames` marca quadros ruins; `python3 timeline.py ../assets/clips/<rec>` mostra os estados ao longo do tempo; `node clipseq.mjs <rec>/frames ../assets/seq/<conceito>/<cena> --from a --to b [--speed s]` gera a sequência de quadros.
5. Depois de gravar: `pkill -9 -f node_modules/electron/dist` (fecha app e daemon de teste).

Cuidados (ver aprendizados.md): GT_HOME curto (socket ≤ 104 caracteres); nada de `page.screenshot` durante o screencast (os stills automáticos de recB/recD causaram quadros quebrados: tirar na próxima rodada); a cópia de teste manda notificações do macOS.
