// E: 3 abas (uma por projeto), 3 sessões em cada; o foco fica na Loja enquanto Finanças e API chamam; 3 ⌘J reais
import fs from 'node:fs'; import path from 'node:path'
import { seed, launch, sleep, wt, REPO } from './gt.mjs'
import { CMD, helpers, row, col, pergunta } from './r2.mjs'
const OUT = path.join(REPO, 'promo-videos/assets/clips/recE3')
seed({ projects: [['loja-online', '#e5484d'], ['app-financas', '#30a46c'], ['api-pagamentos', '#8e4ec6']], command: CMD })
const g = await launch({ width: 1920, height: 1080 })
const h = helpers(g)
const P = {
  frete: wt('loja-online', 'frete'), loja: wt('loja-online'), cupom: wt('loja-online', 'cupom'),
  metas: wt('app-financas', 'metas'), financas: wt('app-financas'), grafico: wt('app-financas', 'grafico'),
  reembolso: wt('api-pagamentos', 'reembolso'), api: wt('api-pagamentos'), webhooks: wt('api-pagamentos', 'webhooks'),
}
const tabs = [
  { id: 't1', name: 'Loja', root: row('frete', col('loja', 'cupom')) },
  { id: 't2', name: 'Finanças', root: row('metas', col('financas', 'grafico')) },
  { id: 't3', name: 'API', root: row('reembolso', col('api', 'webhooks')) },
]
await g.setup(tabs, 't1', Object.entries(P))
for (const id of Object.keys(P)) await g.meta(id, { name: id })
const NC = 'Não faça commit.'
const TASK = {
  metas: pergunta('Qual o limite de alerta das metas de gasto?', '70%, 80% e 90%', `crie src/metas.js com metas por categoria e o alerta, com testes, e rode npm test. ${NC}`),
  financas: `Crie src/relatorio.js com o resumo mensal (total, média por dia, maior gasto) a partir de src/gastos.js, com testes em test/relatorio.test.js; rode npm test até passar. ${NC}`,
  grafico: `Crie src/grafico.js que imprime um gráfico de barras em texto com o total por categoria, com testes; rode npm test até passar. ${NC}`,
  reembolso: 'Explique em 3 linhas o que src/pagamentos.js faz hoje e o que falta para ter reembolso. Não mude nenhum arquivo.',
  api: `Valide o método de pagamento em src/pagamentos.js (só pix, cartao e boleto), com testes em test/pagamentos.test.js; rode npm test até passar. ${NC}`,
  webhooks: `Crie src/webhooks.js que confirma pagamentos com assinatura HMAC-SHA256, com testes; rode npm test até passar. ${NC}`,
  frete: pergunta('O frete grátis vale acima de qual valor?', 'R$ 150, R$ 200 e R$ 300', `implemente o frete em total() de src/carrinho.js, com teste, e rode npm test. ${NC}`),
  loja: `Documente cada função de src/carrinho.js com JSDoc detalhado e crie docs/arquitetura.md explicando o fluxo do carrinho, com exemplos de uso; rode npm test no fim. ${NC}`,
  cupom: `Em src/carrinho.js, crie aplicarCupom(carrinho, percentual) e faça total() aplicar o desconto; acrescente um teste e rode npm test até passar. ${NC}`,
}
await g.startRec(path.join(OUT, 'frames'))
// ordem pensada para a fila do ⌘J (🟡 antes de 🔵, o mais antigo primeiro): o reembolso (API) termina primeiro e vira o
// 🔵 mais antigo; depois metas (Finanças) e frete (Loja) perguntam, nessa ordem. A Loja fica na frente no fim.
const timer = setInterval(() => h.poll().catch(() => {}), 700)
for (const [tab, ids] of [['tab-3', ['reembolso', 'api', 'webhooks']], ['tab-2', ['metas', 'financas', 'grafico']], ['tab-1', ['frete', 'loja', 'cupom']]]) {
  g.mark(tab); await g.menu(tab); await sleep(800)
  await Promise.all(ids.map((id) => h.ready(id)))
  await h.task(ids[0], TASK[ids[0]], 120)
  await Promise.all(ids.slice(1).map((id) => h.task(id, TASK[id], 120)))
}
clearInterval(timer)
g.mark('loja na frente')
const t0 = Date.now(); let allAt = 0
while (Date.now() - t0 < 4 * 60_000) {
  await sleep(500); await h.poll()
  const all = h.st('metas') === 'needs-you' && h.st('frete') === 'needs-you' && h.st('reembolso') === 'your-turn'
  if (all && !allAt) { allAt = Date.now(); g.mark('os 3 chamando') }
  if (allAt && Date.now() - allAt > 5000) break
}
// três ⌘J: a fila real decide para onde vai (🟡 antes de 🔵, o mais antigo primeiro)
for (let i = 0; i < 3; i++) {
  const panes = await h.poll()
  const q = panes.filter((p) => ['needs-you', 'your-turn'].includes(p.claude?.status)).sort((a, b) => (a.claude.status === 'needs-you' ? 0 : 1) - (b.claude.status === 'needs-you' ? 0 : 1) || a.claude.statusSince - b.claude.statusSince)
  const alvo = q[0]; if (!alvo) break
  g.mark(`cmdJ -> ${alvo.name ?? alvo.id} ${alvo.claude.status}`); await g.menu('next-attention'); await sleep(1800)
  if (alvo.claude.status === 'needs-you') { g.mark(`responde ${alvo.name}`); await g.input(alvo.id, '\r') }
  for (let k = 0; k < 5; k++) { await sleep(500); await h.poll() }
}
for (let k = 0; k < 10; k++) { await sleep(500); await h.poll() }
console.log('frames', await g.stopRec())
fs.writeFileSync(path.join(OUT, 'state-final.json'), JSON.stringify(await g.state(), null, 1))
await g.close()
