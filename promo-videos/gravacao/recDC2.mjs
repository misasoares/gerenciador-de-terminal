// D2 + C2: equipe em modo automático; fecha o app com ≥3 🟢; reabre quando ≥3 terminaram (🔵)
import fs from 'node:fs'; import path from 'node:path'
import { seed, launch, sleep, wt, REPO, daemonState } from './gt.mjs'
const OUT = path.join(REPO, 'promo-videos/assets/clips')
seed({ projects: [['loja-online', '#e5484d'], ['app-financas', '#30a46c'], ['api-pagamentos', '#8e4ec6']], command: 'clear; claude --model sonnet' })
let g = await launch({ width: 1920, height: 1080 })
const LEAD = 'lead'
await g.setup([{ id: 't1', name: 'Loja', root: { type: 'leaf', paneId: LEAD } }], 't1', [[LEAD, wt('loja-online')]])
await g.meta(LEAD, { name: 'tech-lead' }); await g.leader(LEAD)
for (let end = Date.now() + 60000; Date.now() < end; await sleep(500)) if (/auto\s+mode\s+on|accept\s+edits/i.test(await g.text(LEAD))) break
await sleep(1000)
await g.type(LEAD, 'contrata 3 devs agora, cada um na sua worktree: dev-1 faz cupom de desconto percentual, dev-2 faz frete grátis acima de R$ 200 e dev-3 escreve os testes do total do carrinho', 40)
await sleep(500); await g.input(LEAD, '\r')
const trusted = new Set(); const t0 = Date.now(); let readyAt = 0
while (Date.now() - t0 < 4 * 60_000) {
  await sleep(700)
  const panes = (await g.state()).panes ?? []
  for (const p of panes) if (p.createdBy === LEAD && !p.claude && !trusted.has(p.id)) { const t = (await g.text(p.id)).slice(-4000); if (/trust\s+this\s+folder/i.test(t)) { trusted.add(p.id); await g.input(p.id, '\x1b[B'); await sleep(400); await g.input(p.id, '\r') } }
  for (const p of panes) if (p.claude?.status === 'needs-you') { await g.input(p.id, '\r'); await sleep(300) } // ninguém fica travado
  const working = panes.filter((p) => p.claude?.status === 'working').length
  const hired = panes.filter((p) => p.createdBy === LEAD).length
  if (hired === 3 && working >= 3) { if (!readyAt) readyAt = Date.now(); if (Date.now() - readyAt > 6000) break } else readyAt = 0
}
// antes de fechar: 4 s gravados + still em alta
await g.startRec(path.join(OUT, 'recD2/frames')); await sleep(4000)
fs.mkdirSync(path.join(OUT, 'recD2/stills'), { recursive: true }); await g.shot(path.join(OUT, 'recD2/stills/antes.png'))
const before = (await g.state()).panes.map((p) => [p.name, p.claude?.status]); console.log('antes', JSON.stringify(before))
await g.stopRec(); await g.close(); const closedAt = Date.now(); console.log('app fechado')
// app fechado: espera até ≥3 sessões terminarem (🔵) ou 3 min
let after = null
while (Date.now() - closedAt < 3 * 60_000) { await sleep(3000); try { const s = await daemonState(); after = s.panes.map((p) => [p.name, p.claude?.status]); if (s.panes.filter((p) => p.claude?.status === 'your-turn').length >= 3) break } catch (e) { console.log('daemon?', e.message) } }
console.log('fechado por', Math.round((Date.now() - closedAt) / 1000), 's; daemon:', JSON.stringify(after))
g = await launch({ width: 1920, height: 1080 })
await g.startRec(path.join(OUT, 'recC2/frames')); fs.mkdirSync(path.join(OUT, 'recC2/stills'), { recursive: true })
for (let i = 0; i < 6; i++) { await sleep(1500); await g.shot(path.join(OUT, 'recC2/stills', `${i}.png`)) }
await g.stopRec(); console.log('depois', JSON.stringify((await g.state()).panes.map((p) => [p.name, p.claude?.status])))
await g.close()
