import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { USER_BG_RE } from '../shared/settings'

/** imagens do usuário já importadas (nomes válidos, mais novas primeiro) */
export function listBackgrounds(dir: string): { dir: string; list: string[] } {
  try {
    const list = fs.readdirSync(dir).filter((n) => USER_BG_RE.test(n))
    list.sort((a, b) => fs.statSync(`${dir}/${b}`).mtimeMs - fs.statSync(`${dir}/${a}`).mtimeMs)
    return { dir, list }
  } catch {
    return { dir, list: [] }
  }
}

const MAX_WIDTH = 2560

/** largura máxima das imagens copiadas (memória com várias janelas abertas) */
export function fitWidth(w: number, h: number, max = MAX_WIDTH): { width: number; height: number } {
  return w <= max ? { width: w, height: h } : { width: max, height: Math.round((h * max) / w) }
}

/** nome pelo conteúdo: a mesma imagem importada duas vezes não duplica */
export function userBgName(jpeg: Buffer): string {
  return createHash('sha256').update(jpeg).digest('hex').slice(0, 16) + '.jpg'
}

export function removeBackground(dir: string, name: string): boolean {
  if (!USER_BG_RE.test(name)) return false
  try {
    fs.unlinkSync(`${dir}/${name}`)
    return true
  } catch {
    return false
  }
}
