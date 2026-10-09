import fs from 'node:fs'
import path from 'node:path'

export type AfterUpdate = { kind: 'none' } | { kind: 'updated'; to: string } | { kind: 'failed'; to: string; current: string }

/** o que a última atualização deixou: abriu na nova, voltou para a anterior ou nada a fazer */
export function readAfterUpdate(updatesDir: string, current: string): AfterUpdate {
  let p: { from?: unknown; to?: unknown }
  try {
    p = JSON.parse(fs.readFileSync(path.join(updatesDir, 'pending.json'), 'utf8'))
  } catch {
    return { kind: 'none' }
  }
  if (typeof p?.from !== 'string' || typeof p.to !== 'string') return { kind: 'none' }
  if (p.to === current) return { kind: 'updated', to: current }
  // sem failed.json o script ainda pode estar esperando a versão nova confirmar
  if (p.from === current && fs.existsSync(path.join(updatesDir, 'failed.json'))) return { kind: 'failed', to: p.to, current }
  return { kind: 'none' }
}

/** o script espera este arquivo para saber que a versão nova abriu */
export function markStarted(updatesDir: string, version: string): void {
  fs.mkdirSync(updatesDir, { recursive: true })
  fs.writeFileSync(path.join(updatesDir, `ok-${version}`), new Date().toISOString())
}

export function clearAfterUpdate(updatesDir: string): void {
  for (const f of ['pending.json', 'failed.json']) fs.rmSync(path.join(updatesDir, f), { force: true })
}

/** primeira abertura na versão nova: só confirma depois que os renderers das janelas abertas subiram (tela branca → sem ok → o script volta) */
export async function openThenConfirm(o: { ids: string[]; open(id: string): Promise<void>; rendered(): Promise<void>; confirm(): void }): Promise<void> {
  for (const id of o.ids) await o.open(id)
  await o.rendered()
  o.confirm()
}
