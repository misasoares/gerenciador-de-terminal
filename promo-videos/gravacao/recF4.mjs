// F: loja-online em 2×2, quatro worktrees; cupom e frete mexem em total() (conflito real); parcelas pergunta (🟡)
import fs from 'node:fs'; import path from 'node:path'
import { seed, launch, sleep, wt, REPO } from './gt.mjs'
import { CMD, helpers, row, col, pergunta } from './r2.mjs'
const OUT = path.join(REPO, 'promo-videos/assets/clips/recF4')
seed({ projects: [['loja-online', '#e5484d']], command: CMD })
const g = await launch({ width: 1920, height: 1080 })
const h = helpers(g)
const P = { cupom: wt('loja-online', 'cupom'), frete: wt('loja-online', 'frete'), parcelas: wt('loja-online', 'parcelas'), testes: wt('loja-online', 'testes') }
const ids = Object.keys(P)
await g.setup([{ id: 't1', name: 'Loja', root: col(row('cupom', 'frete'), row('parcelas', 'testes')) }], 't1', ids.map((id) => [id, P[id]]))
for (const id of ids) await g.meta(id, { name: id })
console.log('prontos', await Promise.all(ids.map((id) => h.ready(id))))
// foco no painel que demora mais: o painel focado que termina vira ⚪ na hora
await g.win.locator('.pane').nth(3).click({ position: { x: 200, y: 200 } }).catch((e) => console.log('clique', e.message))
await sleep(1500)
const TASK = {
  cupom: 'Em src/carrinho.js, crie aplicarCupom(carrinho, percentual) e faça total() aplicar o desconto do cupom quando houver. Acrescente um teste em test/carrinho.test.js e rode npm test até passar. Não faça commit.',
  frete: 'Em src/carrinho.js, faça total() somar frete de R$ 19,90 e zerar o frete quando o subtotal passar de R$ 200. Acrescente um teste em test/carrinho.test.js e rode npm test até passar. Não faça commit.',
  parcelas: pergunta('Em quantas parcelas sem juros a loja deve permitir?', '3x, 6x e 10x', 'crie src/parcelas.js com parcelar(total, vezes) e um teste em test/parcelas.test.js, e rode npm test. Não faça commit.'),
  testes: 'Escreva pelo menos 15 testes de casos de borda para src/carrinho.js num arquivo novo test/borda.test.js (quantidade zero, preço com centavos, item repetido, carrinho vazio), rode npm test e depois documente cada caso em docs/testes.md. Não faça commit.',
}
await g.startRec(path.join(OUT, 'frames'))
await sleep(1500); g.mark('type')
await Promise.all(ids.map((id) => h.task(id, TASK[id], 60)))
const t0 = Date.now(); let doneAt = 0
while (Date.now() - t0 < 5 * 60_000) {
  await sleep(500)
  await h.poll()
  const ok = h.st('cupom') === 'your-turn' && h.st('frete') === 'your-turn'
  if (ok && !doneAt) { doneAt = Date.now(); g.mark('cupom+frete prontos') }
  if (doneAt && Date.now() - doneAt > 5000) break
}
g.mark('conflicts'); await g.win.locator('.sb-conflicts').first().click().catch((e) => console.log('conflitos', e.message))
for (let i = 0; i < 16; i++) { await sleep(500); await h.poll() }
await g.win.keyboard.press('Escape'); await sleep(1500)
console.log('frames', await g.stopRec())
fs.writeFileSync(path.join(OUT, 'state-final.json'), JSON.stringify(await g.state(), null, 1))
await g.close()
