import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')

describe('notas da release', () => {
  it('feat vira Novo, fix vira Corrigido (Novo primeiro); o resto some', () => {
    const r = spawnSync('node', ['scripts/release-notes.mjs'], {
      cwd: ROOT,
      input: 'fix(abas): contorno da aba ativa\nfeat(atualizacao): atualização pelo app\ndocs: spec\nchore(release): 0.1.0\nfeat: tela nova\n',
      encoding: 'utf8',
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toBe('- Novo: Atualização pelo app\n- Novo: Tela nova\n- Corrigido: Contorno da aba ativa\n')
  })
  it('sem feat/fix → Melhorias internas', () => {
    const r = spawnSync('node', ['scripts/release-notes.mjs'], { cwd: ROOT, input: 'docs: x\n', encoding: 'utf8' })
    expect(r.stdout).toBe('- Melhorias internas\n')
  })
})

describe('release.sh: guardas antes de mexer em qualquer coisa', () => {
  const pkg = () => fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
  it('versão inválida ou não maior que a atual → erro, package.json intacto', () => {
    const before = pkg()
    for (const v of ['abc', '0.0.1', JSON.parse(before).version]) {
      const r = spawnSync('sh', ['scripts/release.sh', v], { cwd: ROOT, encoding: 'utf8' })
      expect(r.status).not.toBe(0)
      expect(r.stderr).toMatch(/versão/)
    }
    expect(pkg()).toBe(before)
  })
})
