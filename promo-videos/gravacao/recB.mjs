import fs from 'node:fs'; import path from 'node:path'
import { seed, launch, sleep, wt, REPO } from './gt.mjs'
const OUT = path.join(REPO, 'promo-videos/assets/clips/recB')
const W = Number(process.env.W ?? 1920), H = Number(process.env.H ?? 1080)
seed({ projects: [['loja-online', '#e5484d'], ['app-financas', '#30a46c'], ['api-pagamentos', '#8e4ec6']], command: 'clear; claude --permission-mode acceptEdits --model sonnet' })
const g = await launch({ width: W, height: H })
const LEAD = 'lead', FIN = 'fin', API = 'api'
const tabs = [{ id: 't1', name: 'Loja', root: { type: 'leaf', paneId: LEAD } }, { id: 't2', name: 'Finanças', root: { type: 'leaf', paneId: FIN } }, { id: 't3', name: 'API', root: { type: 'leaf', paneId: API } }]
await g.setup(tabs, 't2', [[LEAD, wt('loja-online')], [FIN, wt('app-financas', 'grafico')], [API, wt('api-pagamentos')]])
await g.meta(LEAD, { name: 'tech-lead' }); await g.leader(LEAD)
const trusted = new Set()
async function trustIfAsked(id) { if (trusted.has(id)) return false; const t = (await g.text(id)).slice(-4000); if (/trust\s+this\s+folder/i.test(t)) { trusted.add(id); await g.input(id, '\x1b[B'); await sleep(400); await g.input(id, '\r'); g.mark('trust ' + id); return true } return false }
async function ready(id) { const end = Date.now() + 60000; while (Date.now() < end) { await trustIfAsked(id); if (/accept\s+edits\s+on/i.test(await g.text(id))) return true; await sleep(500) } console.log('não ficou pronto', id); return false }
await ready(FIN); await g.type(FIN, 'gera um gráfico de barras em texto com o total por categoria', 40); await sleep(300); await g.input(FIN, '\r')
await g.menu('tab-3'); await ready(API); await g.type(API, 'adiciona reembolso de pagamento, com validação e teste', 40); await sleep(300); await g.input(API, '\r')
await g.menu('tab-1'); await ready(LEAD); await sleep(1500)
fs.mkdirSync(path.join(OUT, 'stills'), { recursive: true })
await g.startRec(path.join(OUT, 'frames'))
let stillN = 0
const still = async (label) => { const f = path.join(OUT, 'stills', `${String(stillN++).padStart(3, '0')}-${label}.png`); await g.shot(f); g.mark('still ' + path.basename(f)) }
const stillTimer = setInterval(() => { still('auto').catch(() => {}) }, 6000)
await sleep(1500)
g.mark('type-lead')
await g.type(LEAD, 'contrata 3 devs agora, cada um na sua worktree: dev-1 faz cupom de desconto percentual, dev-2 faz frete grátis acima de R$ 200 e dev-3 escreve os testes do total do carrinho', 22)
await sleep(600); await g.input(LEAD, '\r'); g.mark('enter-lead')
const t0 = Date.now(); const last = {}; const since = {}; let lastAction = 0; let tabTour = 0; let backHome = 0
while (Date.now() - t0 < 9 * 60_000) {
  await sleep(700)
  const s = await g.state()
  const panes = s.panes ?? []
  for (const p of panes) {
    const st = p.claude?.status ?? 'shell'; const nm = p.name ?? p.id
    if (last[p.id] !== st) { g.mark(`status ${nm} ${st}`); last[p.id] = st; since[p.id] = Date.now(); if (st === 'needs-you' || st === 'your-turn') still(`${nm}-${st}`).catch(() => {}) }
  }
  for (const p of panes) if (p.createdBy === LEAD && !p.claude) await trustIfAsked(p.id)
  const now = Date.now()
  const lead = panes.find((p) => p.id === LEAD)
  if (lead?.claude?.status === 'needs-you' && now - since[LEAD] > 2500 && now - lastAction > 2000) { g.mark('approve lead'); await g.input(LEAD, '2'); lastAction = Date.now(); continue }
  const hiredNow = panes.filter((p) => p.createdBy === LEAD)
  // equipe contratada: volta para a aba Loja e segura alguns segundos sem agir (🟡🟡🟡 + ilha na tela)
  if (hiredNow.length === 3 && !backHome) { backHome = Date.now(); g.mark('tab-1 (equipe)'); await g.menu('tab-1'); lastAction = Date.now() + 4000; continue }
  const waiting = panes.filter((p) => p.id !== LEAD && p.claude?.status === 'needs-you' && now - since[p.id] > 4000).sort((a, b) => a.claude.statusSince - b.claude.statusSince)
  if (waiting.length && now - lastAction > 3500) {
    const target = waiting[0]
    g.mark(`cmdJ -> ${target.name ?? target.id}`); await g.menu('next-attention'); await sleep(1400)
    g.mark(`approve ${target.name ?? target.id}`); await g.input(target.id, '\r'); lastAction = Date.now(); continue
  }
  const hired = panes.filter((p) => p.createdBy === LEAD)
  // passeio pelas abas quando o time já está trabalhando
  if (hired.length === 3 && tabTour === 0 && now - lastAction > 5000) { tabTour = 1; g.mark('tab-2'); await g.menu('tab-2'); await sleep(3500); g.mark('tab-1'); await g.menu('tab-1'); lastAction = Date.now() }
  const others = panes.filter((p) => p.id !== LEAD)
  if (hired.length === 3 && others.every((p) => ['your-turn', 'idle'].includes(p.claude?.status) && now - since[p.id] > 4000)) { g.mark('all-done'); break }
}
await sleep(3000); await still('final')
g.mark('conflicts'); await g.win.locator('.sb-conflicts').first().click(); await sleep(5000); await still('conflicts'); await sleep(2000)
await g.win.keyboard.press('Escape'); await sleep(1500)
clearInterval(stillTimer)
const n = await g.stopRec(); console.log('frames', n)
fs.writeFileSync(path.join(OUT, 'state-final.json'), JSON.stringify(await g.state(), null, 1))
console.log('fim; app segue aberto para a gravação C')
if (!process.env.KEEP_OPEN) await g.close()
