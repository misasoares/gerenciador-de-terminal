#!/usr/bin/env node
// Notas da release a partir dos assuntos dos commits (stdin, um por linha): feat → Novo, fix → Corrigido.
import { readFileSync } from 'node:fs'

const novo = []
const corrigido = []
for (const s of readFileSync(0, 'utf8').split('\n')) {
  const m = /^(feat|fix)(\([^)]*\))?!?:\s*(.+)$/.exec(s.trim())
  if (!m) continue
  const text = m[3].charAt(0).toUpperCase() + m[3].slice(1)
  ;(m[1] === 'feat' ? novo : corrigido).push(`- ${m[1] === 'feat' ? 'Novo' : 'Corrigido'}: ${text}`)
}
const lines = [...novo, ...corrigido]
process.stdout.write((lines.length ? lines : ['- Melhorias internas']).join('\n') + '\n')
