import { seed, launch, sleep, SP, wt } from './gt.mjs'
seed({ projects: [['loja-online', '#e5484d']], command: 'clear; claude --model sonnet' })
const g = await launch({ width: 1600, height: 1000 })
const dirs = [wt('loja-online'), wt('app-financas'), wt('app-financas', 'grafico'), wt('api-pagamentos'), wt('loja-online', 'cupom'), wt('loja-online', 'frete')]
const ids = dirs.map((_, i) => 'x' + i)
await g.setup([{ id: 't1', name: 'x', root: { type: 'split', dir: 'column', sizes: [33.3, 33.3, 33.4], children: [0, 1, 2].map((r) => ({ type: 'split', dir: 'row', sizes: [50, 50], children: ids.slice(r * 2, r * 2 + 2).map((id) => ({ type: 'leaf', paneId: id })) })) } }], 't1', ids.map((id, i) => [id, dirs[i]]))
await sleep(6000); await g.shot(`${SP}/probe/pretrust1.png`); console.log('bufs', await g.win.evaluate(() => JSON.stringify(Object.keys(window.__buf).map(k => [k, window.__buf[k].length]))))
for (const id of ids) {
  const end = Date.now() + 40000
  while (Date.now() < end) { const t = await g.text(id); if (/trust\s+this\s+folder/i.test(t)) { await g.input(id, '\x1b[B'); await sleep(400); await g.input(id, '\r'); console.log(id, 'trusted'); break } if (/(accept\s+edits|auto\s+mode|bypass)/i.test(t)) { console.log(id, 'already'); break } await sleep(500) }
}
await sleep(5000)
for (const id of ids) { await g.input(id, '/exit'); await sleep(200); await g.input(id, '\r') }
await sleep(3000); await g.shot(`${SP}/probe/pretrust2.png`); await g.close()
