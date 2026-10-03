import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { shq } from '../../src/daemon/shell-quote'

const sh = (script: string) => execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8' })

describe('shq', () => {
  it('cita para o shell sem perder nada', () => {
    expect(shq("it's")).toBe(`'it'"'"'s'`)
    for (const s of ['/Volumes/SSD MISA/a b', `aspas "duplas" e 'simples'`, 'cifrão $HOME e crase `id`', 'ação ñ 🚀', '']) {
      expect(sh(`printf %s ${shq(s)}`)).toBe(s)
    }
  })
  it('prompt por arquivo chega intacto pelo "$(cat …)"', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt q '))
    const f = path.join(dir, 'p.txt')
    const prompt = `linha 1 "aspas" 'simples'\nlinha 2 $HOME \`id\` ação`
    fs.writeFileSync(f, prompt)
    expect(sh(`printf %s "$(cat ${shq(f)})"`)).toBe(prompt)
  })
})
