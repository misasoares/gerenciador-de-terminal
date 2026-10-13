// D: a parede cresce 1 → 2 → 4 → 8 → 12 enquanto grava; metas e reembolso perguntam (🟡); dois ⌘J e um ⌘K "fre"
import fs from 'node:fs'; import path from 'node:path'
import { seed, launch, sleep, wt, REPO } from './gt.mjs'
import { CMD, helpers, row, col, leaf, pergunta } from './r2.mjs'
const OUT = path.join(REPO, 'promo-videos/assets/clips/recD12')
seed({ projects: [['loja-online', '#e5484d'], ['app-financas', '#30a46c'], ['api-pagamentos', '#8e4ec6']], command: CMD })
const g = await launch({ width: 1920, height: 1080 })
const h = helpers(g)
const P = {
  loja: wt('loja-online'), cupom: wt('loja-online', 'cupom'), frete: wt('loja-online', 'frete'), testes: wt('loja-online', 'testes'),
  financas: wt('app-financas'), grafico: wt('app-financas', 'grafico'), metas: wt('app-financas', 'metas'), revisao: wt('app-financas'),
  api: wt('api-pagamentos'), reembolso: wt('api-pagamentos', 'reembolso'), webhooks: wt('api-pagamentos', 'webhooks'), docs: wt('api-pagamentos'),
}
const NC = 'Não faça commit.'
const LONGA = (o) => `${o} Escreva testes com node:test, rode npm test até passar e depois explique as decisões num arquivo em docs/. ${NC}`
const TASK = {
  loja: LONGA('Documente cada função de src/carrinho.js com JSDoc detalhado e crie docs/arquitetura.md com o fluxo do carrinho.'),
  cupom: LONGA('Em src/carrinho.js, crie aplicarCupom(carrinho, percentual) e faça total() aplicar o desconto.'),
  frete: LONGA('Em src/carrinho.js, faça total() somar frete de R$ 19,90 e zerar acima de R$ 200.'),
  testes: LONGA('Escreva pelo menos 15 testes de casos de borda para src/carrinho.js em test/borda.test.js.'),
  financas: LONGA('Crie src/relatorio.js com o resumo mensal (total, média por dia, maior gasto) a partir de src/gastos.js.'),
  grafico: LONGA('Crie src/grafico.js que imprime um gráfico de barras em texto com o total por categoria.'),
  metas: pergunta('Qual o limite de alerta das metas de gasto?', '70%, 80% e 90%', `crie src/metas.js com metas por categoria e o alerta, com testes, e rode npm test. ${NC}`),
  revisao: LONGA('Revise src/gastos.js procurando bugs e casos não tratados; corrija o que achar.'),
  api: LONGA('Valide o método de pagamento em src/pagamentos.js (só pix, cartao e boleto).'),
  reembolso: pergunta('O reembolso pode ser parcial?', 'só total, parcial e total, parcial até 30 dias', `implemente o reembolso em src/pagamentos.js, com testes, e rode npm test. ${NC}`),
  webhooks: LONGA('Crie src/webhooks.js que confirma pagamentos com assinatura HMAC-SHA256.'),
  docs: LONGA('Documente a API de src/pagamentos.js em docs/api.md com exemplos de uso.'),
}
const ROWS = [['loja', 'cupom', 'frete', 'testes'], ['financas', 'grafico', 'metas', 'revisao'], ['api', 'reembolso', 'webhooks', 'docs']]
const tab = (root) => [{ id: 't1', name: 'Tudo', root }]
const STEPS = [
  [leaf('loja'), ['loja']],
  [row('loja', 'cupom'), ['cupom']],
  [col(row('loja', 'cupom'), row('financas', 'grafico')), ['financas', 'grafico']],
  [col(row(...ROWS[0]), row(...ROWS[1])), ['frete', 'testes', 'metas', 'revisao']],
  [col(row(...ROWS[0]), row(...ROWS[1]), row(...ROWS[2])), ['api', 'reembolso', 'webhooks', 'docs']],
]
await g.setup(tab(STEPS[0][0]), 't1', [['loja', P.loja]]); await g.meta('loja', { name: 'loja' })
await h.ready('loja'); await h.task('loja', TASK.loja, 45)
for (let i = 0; i < 40 && h.st('loja') !== 'working'; i++) { await sleep(500); await h.poll() }
await sleep(2500)
await g.startRec(path.join(OUT, 'frames'))
await sleep(3000)
const pend = []
for (const [root, novos] of STEPS.slice(1)) {
  g.mark('cresce ' + novos.join(','))
  await g.win.evaluate((l) => window.gt.send({ t: 'layout.save', layout: l }), { tabs: tab(root), activeTabId: 't1' })
  await sleep(300)
  for (const id of novos) { await g.create(id, P[id]); await g.meta(id, { name: id }) }
  // cada sessão nova recebe a tarefa assim que o Claude abre (enquanto a parede continua crescendo)
  for (const id of novos) pend.push(h.ready(id).then(() => h.task(id, TASK[id], 60)))
  for (let k = 0; k < 6; k++) { await sleep(500); await h.poll() }
}
await Promise.all(pend); g.mark('12 com tarefa')
const t0 = Date.now(); let twoAt = 0
while (Date.now() - t0 < 4 * 60_000) {
  await sleep(500); await h.poll()
  if (!twoAt && h.st('metas') === 'needs-you' && h.st('reembolso') === 'needs-you') { twoAt = Date.now(); g.mark('dois 🟡') }
  if (twoAt && Date.now() - twoAt > 4000) break
}
for (let i = 0; i < 2; i++) {
  const panes = await h.poll()
  const q = panes.filter((p) => p.claude?.status === 'needs-you').sort((a, b) => a.claude.statusSince - b.claude.statusSince)
  const alvo = q[0]; if (!alvo) break
  g.mark(`cmdJ -> ${alvo.name}`); await g.menu('next-attention'); await sleep(1800)
  g.mark(`responde ${alvo.name}`); await g.input(alvo.id, '\r')
  for (let k = 0; k < 5; k++) { await sleep(500); await h.poll() }
}
g.mark('cmdK'); await g.menu('palette'); await sleep(1000)
for (const ch of 'fre') { await g.win.keyboard.type(ch); g.mark('tecla ' + ch); await sleep(500) }
await sleep(1000); g.mark('enter paleta'); await g.win.keyboard.press('Enter')
for (let k = 0; k < 8; k++) { await sleep(500); await h.poll() }
console.log('frames', await g.stopRec())
fs.writeFileSync(path.join(OUT, 'state-final.json'), JSON.stringify(await g.state(), null, 1))
await g.close()
