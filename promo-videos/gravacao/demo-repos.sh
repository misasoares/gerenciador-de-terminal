#!/bin/bash
# Recria os projetos fictícios usados nas gravações (loja-online, app-financas, api-pagamentos) em /private/tmp/claude-501/dev.
D=/private/tmp/claude-501/dev; rm -rf $D; mkdir -p $D
mk() { local d=$D/$1; mkdir -p $d; git -C $d init -q -b main; git -C $d config user.name "Misa"; git -C $d config user.email demo@example.com; }
mk loja-online; L=$D/loja-online; mkdir -p $L/src $L/test
echo '{ "name": "loja-online", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }' > $L/package.json
printf 'export function criarCarrinho() {\n  return { itens: [] }\n}\n\nexport function adicionar(carrinho, produto, qtd = 1) {\n  const item = carrinho.itens.find((i) => i.id === produto.id)\n  if (item) item.qtd += qtd\n  else carrinho.itens.push({ ...produto, qtd })\n  return carrinho\n}\n\nexport function total(carrinho) {\n  return carrinho.itens.reduce((soma, i) => soma + i.preco * i.qtd, 0)\n}\n' > $L/src/carrinho.js
printf "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\nimport { criarCarrinho, adicionar, total } from '../src/carrinho.js'\n\ntest('soma o total', () => {\n  const c = criarCarrinho()\n  adicionar(c, { id: 1, nome: 'Camiseta', preco: 59.9 }, 2)\n  assert.equal(total(c), 119.8)\n})\n" > $L/test/carrinho.test.js
echo "# loja-online" > $L/README.md; git -C $L add -A; git -C $L commit -qm "carrinho básico"
mk app-financas; F=$D/app-financas; mkdir -p $F/src
echo '{ "name": "app-financas", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }' > $F/package.json
printf "export const gastos = [\n  { data: '2026-10-01', categoria: 'mercado', valor: 312.4 },\n  { data: '2026-10-03', categoria: 'transporte', valor: 48 },\n  { data: '2026-10-05', categoria: 'mercado', valor: 127.9 },\n  { data: '2026-10-08', categoria: 'lazer', valor: 90 },\n]\n\nexport function totalPorCategoria(lista) {\n  const out = {}\n  for (const g of lista) out[g.categoria] = (out[g.categoria] ?? 0) + g.valor\n  return out\n}\n" > $F/src/gastos.js
echo "# app-financas" > $F/README.md; git -C $F add -A; git -C $F commit -qm "gastos por categoria"
mk api-pagamentos; A=$D/api-pagamentos; mkdir -p $A/src
echo '{ "name": "api-pagamentos", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }' > $A/package.json
printf "const pagamentos = new Map()\n\nexport function criarPagamento({ id, valor, metodo }) {\n  if (valor <= 0) throw new Error('valor inválido')\n  const p = { id, valor, metodo, status: 'aprovado' }\n  pagamentos.set(id, p)\n  return p\n}\n\nexport function buscar(id) {\n  return pagamentos.get(id) ?? null\n}\n" > $A/src/pagamentos.js
echo "# api-pagamentos" > $A/README.md; git -C $A add -A; git -C $A commit -qm "pagamentos em memória"
git -C $L worktree add -q -b feat/cupom .claude/worktrees/cupom; git -C $L worktree add -q -b feat/frete .claude/worktrees/frete
git -C $F worktree add -q -b feat/grafico .claude/worktrees/grafico
for r in loja-online app-financas api-pagamentos; do echo ".claude/" >> $D/$r/.git/info/exclude; done
echo "projetos fictícios em $D (rode pretrust.mjs depois para aceitar a confiança das pastas no Claude)"
