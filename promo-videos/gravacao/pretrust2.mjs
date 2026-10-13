// aceita a confiança de pasta do Claude nas worktrees novas da rodada 2 (abre o Claude em cada uma e sai)
import { seed, launch, sleep, wt } from './gt.mjs'
import { CMD, helpers, row, col } from './r2.mjs'
const dirs = [wt('loja-online'), wt('loja-online', 'cupom'), wt('loja-online', 'frete'), wt('loja-online', 'testes'), wt('loja-online', 'parcelas'), wt('app-financas'), wt('app-financas', 'grafico'), wt('app-financas', 'metas'), wt('api-pagamentos'), wt('api-pagamentos', 'reembolso'), wt('api-pagamentos', 'webhooks')]
seed({ projects: [['loja-online', '#e5484d']], command: CMD })
const g = await launch({ width: 1600, height: 1000 })
const h = helpers(g)
const ids = dirs.map((_, i) => 'x' + i)
await g.setup([{ id: 't1', name: 'x', root: col(row(...ids.slice(0, 4)), row(...ids.slice(4, 8)), row(...ids.slice(8))) }], 't1', ids.map((id, i) => [id, dirs[i]]))
const ok = await Promise.all(ids.map((id) => h.ready(id, 45000)))
console.log(JSON.stringify(ok)); for (const id of ids) console.log(id, JSON.stringify((await g.text(id)).slice(-300)))
for (const id of ids) { await g.input(id, '/exit'); await sleep(150); await g.input(id, '\r') }
await sleep(2500); await g.close()
