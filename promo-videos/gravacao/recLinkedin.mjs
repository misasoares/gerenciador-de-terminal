// still para o post do LinkedIn: 7 sessões reais (Sonnet), 2 flutuando, equipe trabalhando e a ilha "precisa de você"
// captura nativa (screencapture -l) de cada janela, para sair o vidro de verdade; a composição junta depois
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'
import { seed, launch, sleep, wt, REPO } from './gt.mjs'
const OUT = path.join(REPO, 'promo-videos/assets/screens/linkedin')
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true })
const W = 1600, H = 1000
const allow = ['rtk read:*', 'rtk ls:*', 'rtk test:*', 'node --test:*', 'npm test:*', 'cat:*', 'ls:*'].map((a) => `"Bash(${a})"`).join(' ')
seed({ projects: [['loja-online', '#e5484d'], ['app-financas', '#30a46c'], ['api-pagamentos', '#8e4ec6']], command: `clear; claude --permission-mode acceptEdits --model sonnet --allowedTools ${allow}` })
const g = await launch({ width: W, height: H })
const winEval = (body) => g.mainEval(`(() => { const { BrowserWindow } = require('electron'); const all = BrowserWindow.getAllWindows(); const main = all.find((w) => !w.webContents.getURL().includes('view=')); const floats = all.filter((w) => w.webContents.getURL().includes('view=float')); ${body} })()`)
await winEval(`main.setBounds({ x: 40, y: 60, width: ${W}, height: ${H} }); return true`)
const LEAD = 'lead', D1 = 'dev1', D2 = 'dev2', D3 = 'dev3', FIN = 'fin', REL = 'rel', API = 'api'
const leaf = (paneId) => ({ type: 'leaf', paneId })
const tabs = [
  { id: 't1', name: 'Loja', root: { type: 'split', dir: 'row', sizes: [50, 50], children: [leaf(LEAD), { type: 'split', dir: 'column', sizes: [34, 33, 33], children: [leaf(D1), leaf(D2), leaf(D3)] }] } },
  { id: 't2', name: 'Finanças', root: { type: 'split', dir: 'row', sizes: [50, 50], children: [leaf(FIN), leaf(REL)] } },
  { id: 't3', name: 'API', root: leaf(API) },
]
await g.setup(tabs, 't1', [[LEAD, wt('loja-online')], [D1, wt('loja-online', 'cupom')], [D2, wt('loja-online', 'frete')], [D3, wt('loja-online')], [FIN, wt('app-financas', 'grafico')], [REL, wt('app-financas')], [API, wt('api-pagamentos')]])
for (const [id, name] of [[LEAD, 'tech-lead'], [D1, 'dev-1'], [D2, 'dev-2'], [D3, 'dev-3'], [FIN, 'grafico'], [REL, 'relatorio'], [API, 'reembolso']]) await g.meta(id, { name })
await g.leader(LEAD)
async function ready(id) {
  const end = Date.now() + 60000
  while (Date.now() < end) {
    const t = (await g.text(id)).slice(-4000)
    if (/trust\s+this\s+folder/i.test(t)) { await g.input(id, '\x1b[B'); await sleep(400); await g.input(id, '\r') }
    if (/accept\s+edits\s+on/i.test(t)) return true
    await sleep(500)
  }
  console.log('não ficou pronto', id); return false
}
const longo = 'Use TDD: escreva um teste, rode, implemente, rode de novo, um caso por vez, cobrindo pelo menos 10 casos.'
const prompts = {
  [LEAD]: 'olha o código da loja e me diz em 3 linhas o que falta para o carrinho ir para produção',
  [D1]: `implementa cupom de desconto percentual e de valor fixo no carrinho. ${longo}`,
  [D2]: `implementa frete por faixa de CEP no carrinho. ${longo}`,
  [D3]: `escreve testes para o total do carrinho com vários itens, quantidades e preços quebrados. ${longo}`,
  [API]: `adiciona reembolso parcial e total de pagamento, com validação. ${longo}`,
  [REL]: `cria um relatório mensal de gastos com média, maior gasto e variação. ${longo}`,
  [FIN]: 'antes de começar o gráfico, me pergunte com a ferramenta AskUserQuestion se o gráfico deve ser de barras ou de pizza, e espere minha resposta',
}
async function send(id) { await ready(id); await g.type(id, prompts[id], 80); await sleep(300); await g.input(id, '\r') }
await g.menu('tab-3'); await sleep(800); await send(API)
await g.menu('tab-2'); await sleep(800); await send(REL); await ready(FIN)
await g.menu('tab-1'); await sleep(800); for (const id of [LEAD, D1, D2, D3]) await send(id)
// desencaixa API e relatório; Finanças fica numa aba escondida para a ilha aparecer quando o "grafico" perguntar
for (const [id, tab] of [[API, 'tab-3'], [REL, 'tab-2']]) { await g.menu(tab); await sleep(900); await g.win.evaluate((id) => window.gt.request({ t: 'float.set', paneId: id, mode: 'float' }), id); await sleep(1500) }
await g.menu('tab-1'); await sleep(1000)
await winEval(`floats.forEach((w, i) => w.setBounds({ x: 40 + ${W} - 520 + i * 40, y: 60 + 120 + i * 420, width: 680, height: 400 })); return floats.length`)
async function native(dir) {
  fs.mkdirSync(dir, { recursive: true })
  const ws = await winEval(`return all.map((w) => ({ url: w.webContents.getURL(), b: w.getBounds(), id: w.getMediaSourceId().split(':')[1] }))`)
  for (const w of ws) { const name = w.url.includes('view=float') ? 'float-' + /pane=(\w+)/.exec(w.url)[1] : 'main'; try { execFileSync('screencapture', ['-x', '-o', '-l', w.id, path.join(dir, name + '.png')]) } catch { console.log('screencapture falhou', name) } }
  const st = Object.fromEntries((await g.state()).panes.map((p) => [p.id, p.claude?.status]))
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ st, ws }, null, 1))
  console.log('shot', path.basename(dir), JSON.stringify(st))
}
// libera pedidos de permissão de todos, menos do grafico (ele fica 🟡 de propósito)
async function approve() {
  for (const p of (await g.state()).panes) if (p.id !== FIN && p.claude?.status === 'needs-you') { const t = (await g.text(p.id)).slice(-1500); if (/Do you want|proceed/i.test(t)) await g.input(p.id, '\r') }
}
// espera o tech-lead terminar (🔵) com a equipe trabalhando
for (let i = 0; i < 90; i++) { await approve(); const ps = (await g.state()).panes; const st = Object.fromEntries(ps.map((p) => [p.id, p.claude?.status])); if (st[LEAD] === 'your-turn' && ps.filter((p) => p.claude?.status === 'working').length >= 4) break; await sleep(700) }
await native(path.join(OUT, 'antes'))
await g.input(FIN, '\x1b'); await sleep(200)
await g.type(FIN, '', 1)
await g.win.evaluate(([id, text]) => window.gt.send({ t: 'pane.input', paneId: id, data: text }), [FIN, prompts[FIN]]); await sleep(300); await g.input(FIN, '\r')
let n = 0
for (let i = 0; i < 200 && n < 6; i++) {
  await sleep(150); if (i % 4 === 0) await approve()
  if (await g.win.locator('.island').count()) { await native(path.join(OUT, `ilha${n++}`)); await sleep(300) }
}
await native(path.join(OUT, 'depois'))
await g.close()
