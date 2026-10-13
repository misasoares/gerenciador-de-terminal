// ajudantes da rodada 2: confiança de pasta, sessão pronta, tarefas, estados ao longo da gravação
import { sleep } from './gt.mjs'

// todas em bypass: quem "chama você" faz uma pergunta real (AskUserQuestion), sem depender de pedido de permissão
export const CMD = 'clear; claude --dangerously-skip-permissions --model sonnet'
export const leaf = (id) => ({ type: 'leaf', paneId: id })
export const split = (dir, kids) => ({ type: 'split', dir, children: kids.map((k) => (typeof k === 'string' ? leaf(k) : k)), sizes: kids.map(() => 1 / kids.length) })
export const row = (...k) => split('row', k)
export const col = (...k) => split('column', k)

export function helpers(g) {
  const trusted = new Set()
  // a opção "Yes" do diálogo de confiança é escolhida pelo número dela (não pela posição do cursor)
  async function trustIfAsked(id) {
    if (trusted.has(id)) return false
    const t = (await g.text(id)).slice(-4000)
    if (!/trust\s+this\s+folder|trust\s+the\s+files/i.test(t)) return false
    const n = t.match(/(\d)\.\s*Yes/i)?.[1] ?? '1'
    trusted.add(id); await g.input(id, n); await sleep(300); await g.input(id, '\r'); g.mark('trust ' + id)
    return true
  }
  async function ready(id, ms = 60000) {
    const end = Date.now() + ms
    while (Date.now() < end) { await trustIfAsked(id); if (/◐ \w|⏵⏵|bypass\s+perm/i.test(await g.text(id))) return true; await sleep(400) }
    console.log('não ficou pronto', id); return false
  }
  async function task(id, text, cps = 45) { await g.type(id, text, cps); await sleep(400); await g.input(id, '\r'); g.mark('enter ' + id) }
  // estado por painel; marca cada troca como "status <nome> <estado>"
  const last = {}; const since = {}
  async function poll() {
    const s = await g.state(); const panes = s.panes ?? []
    for (const p of panes) {
      const st = p.claude?.status ?? 'shell'; const nm = p.name ?? p.id
      if (last[p.id] !== st) { g.mark(`status ${nm} ${st}`); last[p.id] = st; since[p.id] = Date.now() }
    }
    return panes
  }
  const st = (id) => last[id]
  const age = (id) => Date.now() - (since[id] ?? Date.now())
  return { trustIfAsked, ready, task, poll, st, age }
}

// pergunta real no começo da tarefa: a sessão fica 🟡 esperando a resposta
export const pergunta = (q, opcoes, depois) => `Antes de mexer em qualquer arquivo, use a ferramenta AskUserQuestion para me perguntar: "${q}" com as opções ${opcoes}. Depois da minha resposta, ${depois}`
