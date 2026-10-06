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
