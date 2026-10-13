// D: contratação visível (só a aba Loja) — deixa o daemon vivo no fim para a gravação C
import fs from 'node:fs'; import path from 'node:path'
import { seed, launch, sleep, wt, REPO } from './gt.mjs'
const OUT = path.join(REPO, 'promo-videos/assets/clips/recD')
seed({ projects: [['loja-online', '#e5484d'], ['app-financas', '#30a46c'], ['api-pagamentos', '#8e4ec6']], command: 'clear; claude --permission-mode acceptEdits --model sonnet' })
const g = await launch({ width: 1920, height: 1080 })
const LEAD = 'lead'
await g.setup([{ id: 't1', name: 'Loja', root: { type: 'leaf', paneId: LEAD } }], 't1', [[LEAD, wt('loja-online')]])
await g.meta(LEAD, { name: 'tech-lead' }); await g.leader(LEAD)
const trusted = new Set()
async function trustIfAsked(id) { if (trusted.has(id)) return; const t = (await g.text(id)).slice(-4000); if (/trust\s+this\s+folder/i.test(t)) { trusted.add(id); await g.input(id, '\x1b[B'); await sleep(400); await g.input(id, '\r'); g.mark('trust ' + id) } }
for (let end = Date.now() + 60000; Date.now() < end; await sleep(500)) if (/accept\s+edits\s+on/i.test(await g.text(LEAD))) break
await sleep(1500)
fs.mkdirSync(path.join(OUT, 'stills'), { recursive: true })
await g.startRec(path.join(OUT, 'frames'))
let n = 0; const still = async (l) => { const f = path.join(OUT, 'stills', `${String(n++).padStart(3, '0')}-${l}.png`); await g.shot(f); g.mark('still ' + path.basename(f)) }
const timer = setInterval(() => still('auto').catch(() => {}), 2000)
await sleep(1200); g.mark('type-lead')
await g.type(LEAD, 'contrata 3 devs agora, cada um na sua worktree: dev-1 faz cupom de desconto percentual, dev-2 faz frete grátis acima de R$ 200 e dev-3 escreve os testes do total do carrinho', 22)
await sleep(600); await g.input(LEAD, '\r'); g.mark('enter-lead')
const t0 = Date.now(); const last = {}; let hiredAt = 0; let lastAct = 0; const since = {}
while (Date.now() - t0 < 4 * 60_000) {
  await sleep(500)
  const panes = (await g.state()).panes ?? []
  for (const p of panes) { const st = p.claude?.status ?? 'shell'; if (last[p.id] !== st) { g.mark(`status ${p.name ?? p.id} ${st}`); last[p.id] = st; since[p.id] = Date.now() } }
  for (const p of panes) if (p.createdBy === LEAD && !p.claude) await trustIfAsked(p.id)
  const lead = panes.find((p) => p.id === LEAD)
  if (lead?.claude?.status === 'needs-you' && Date.now() - since[LEAD] > 2500 && Date.now() - lastAct > 2000) { g.mark('approve lead'); await g.input(LEAD, '2'); lastAct = Date.now() }
  const hired = panes.filter((p) => p.createdBy === LEAD)
  if (hired.length === 3 && !hiredAt) { hiredAt = Date.now(); g.mark('3 hired') }
  // deixa os devs trabalharem um pouco; aprova o que pedirem com ⌘J para a cena seguir viva
  const waiting = hired.filter((p) => p.claude?.status === 'needs-you' && Date.now() - since[p.id] > 5000)
  if (hiredAt && waiting.length && Date.now() - lastAct > 3500) { g.mark('cmdJ'); await g.menu('next-attention'); await sleep(1400); const w = waiting.sort((a, b) => a.claude.statusSince - b.claude.statusSince)[0]; await g.input(w.id, '\r'); g.mark('approve ' + w.name); lastAct = Date.now() }
  if (hiredAt && Date.now() - hiredAt > 45000) break
}
clearInterval(timer); await still('end')
console.log('frames', await g.stopRec())
// fecha só o app (o daemon e as sessões seguem vivos) para a gravação C
await g.close(); console.log('app fechado; daemon vivo')
