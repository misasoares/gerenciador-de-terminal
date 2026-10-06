import fs from 'node:fs'

const DEFAULT = '#1e1e1e'
const HEX = /^#[0-9a-f]{6}$/i

/** último fundo do tema (gravado pelo processo principal): a primeira janela já nasce na cor certa */
export function readWindowBg(file: string): string {
  try {
    const v = fs.readFileSync(file, 'utf8').trim()
    return HEX.test(v) ? v : DEFAULT
  } catch {
    return DEFAULT
  }
}

export function writeWindowBg(file: string, bg: string): void {
  if (!HEX.test(bg)) return
  try {
    fs.writeFileSync(file, bg)
  } catch {
    // sem gravar: só a próxima abertura volta a nascer no fundo padrão
  }
}

/** janela de espaço transparente (fundo "mesa do macOS"): lembrado para a primeira janela da abertura */
export function readWindowDesktop(file: string): boolean {
  try {
    return fs.readFileSync(file, 'utf8').trim() === '1'
  } catch {
    return false
  }
}

export function writeWindowDesktop(file: string, v: boolean): void {
  try {
    fs.writeFileSync(file, v ? '1' : '0')
  } catch {
    // sem gravar: a próxima abertura nasce opaca
  }
}
