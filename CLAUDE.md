# gerenciador-de-terminal

<!-- video-promo:start -->
## Vídeos publicitários (skill video-promo)

Tudo de anúncio em vídeo mora em `promo-videos/`. Para criar ou mexer em vídeo, use a skill `video-promo`.

- Composição = um `index.html` puro por conceito, renderizado por `~/.claude/skills/video-promo/scripts/render.mjs`. **Não use HyperFrames, Remotion nem as skills hyperframes/general-video/motion-graphics/media-use.**
- Leia `promo-videos/brand.md` antes de qualquer vídeo: cores, fontes, telas, tom e restrições de copy deste produto.
- Nenhum render completo antes de `check.mjs` passar sem erros e de todas as notas do loop de qualidade ficarem ≥ 8.
- Nunca redesenhe a UI de imaginação: use screenshots/gravações reais de `promo-videos/assets/`.
- Clipes para composição: WebM VP9 ou sequência de JPG (o Chromium do Playwright não decodifica H.264).
- Ao final de cada rodada, registre em `promo-videos/aprendizados.md` o que funcionou e o que não funcionou.
<!-- video-promo:end -->

## Lançar uma atualização (release)

Quando o usuário pedir para "lançar/publicar uma atualização" ou "soltar a versão X", o comando é `npm run release -- <versão>` (`scripts/release.sh`). Os apps instalados (Mac e AppImage) descobrem a release no GitHub ao abrir e a cada 6 h, baixam sozinhos, conferem o SHA-256 e mostram "Versão X pronta · Atualizar". `.deb`/`.rpm` só avisam e abrem a página da release.

Antes de rodar, confira (o script também barra os 4 primeiros):
1. Branch `main`, árvore limpa — arquivos não rastreados também contam (`promo-videos/`, `CLAUDE.md`): commit ou `.gitignore` antes.
2. `gh auth status` ok e Docker rodando (o build Linux usa Docker).
3. Versão `maior.menor.correção` maior que a do `package.json`. Pergunte qual se o usuário não disser: correção para só correções, menor para funcionalidade nova.
4. Certificado "Gerenciador de Terminal Local" no Keychain (`security find-identity -p codesigning`). Sem ele, `sh scripts/mac-cert.sh` (o usuário roda). Nunca assine ad hoc: muda a identidade e o macOS volta a pedir as permissões de pastas.
5. O repositório precisa ser público, senão os apps não enxergam a release (falham em silêncio). Tornar público é irreversível: só com confirmação explícita, depois de varrer o histórico por segredos.
6. Apague `dist/mac*` velhos de outra arquitetura (o script pega o primeiro `dist/mac*`).

O que o script faz: `npm test` → muda a versão no `package.json` → `npm run pack` (Mac, assinado) → zip `gerenciador-de-terminal-<v>-mac-<arch>.zip` → `scripts/build-linux.sh` (AppImage/.deb/.rpm, testa instalação em Debian e Fedora) → `SHA256SUMS` → commit `chore(release): <v>` → tag `v<v>` → push de main e da tag → `gh release create` com as notas.
- Demora: ~10–15 min. Rode em segundo plano e leia o fim do log.
- É publicação externa (push + release pública): confirme com o usuário antes de rodar.
- Notas: geradas dos assuntos dos commits desde a última tag (`feat:` → "Novo", `fix:` → "Corrigido"; o resto é ignorado). Commits semânticos em português viram o texto que o usuário final lê em "Ver novidades".
- Falha antes do commit: `package.json` volta sozinho. Falha depois do commit (push ou `gh release`): não há retomada automática; termine à mão (`git push origin main v<v>` e `gh release create v<v> dist/release-<v>/* --title <v> --notes ...`).

Depois de publicar:
- Confira `gh release view v<v>`: os 4 arquivos + `SHA256SUMS`, nomes exatamente como acima (o app procura por esses nomes).
- Release com defeito: não apague a release (quem já atualizou fica sem caminho); publique uma correção com versão maior. Rascunhos e pre-releases são ignorados pelo app.
- O app do próprio usuário se atualiza pelo botão. Não troque o bundle em `/Applications` à mão com o app aberto.

Teste de ponta a ponta sem publicar: copie o app para uma pasta temporária e rode com `GT_HOME=<pasta>` e `GT_UPDATE_URL=<servidor local que imita releases/latest>`. No fim, `pkill` nos Electrons de teste e confirme com `pgrep`.
Detalhes: `docs/superpowers/specs/2026-10-08-atualizacao-pelo-app-design.md`.
