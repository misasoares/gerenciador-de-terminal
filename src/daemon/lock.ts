import fs from 'node:fs'

const STALE_MS = 30_000

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** trava exclusiva com o pid do dono; recupera trava deixada por processo que já morreu */
export function acquireLock(lockPath: string): boolean {
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' })
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
  }
  let owner = 0
  let age = Infinity
  try {
    owner = Number(fs.readFileSync(lockPath, 'utf8').trim()) || 0
    age = Date.now() - fs.statSync(lockPath).mtimeMs
  } catch {
    // sumiu entre o wx e a leitura: tenta de novo abaixo
  }
  // a trava só protege a janela de inicialização: mais velha que isso é resto de crash/reboot (pid pode ter sido reaproveitado)
  const recent = age < STALE_MS
  if (recent && !owner) return false // outro processo acabou de criar e ainda está gravando
  if (recent && owner !== process.pid && isAlive(owner)) return false
  fs.rmSync(lockPath, { force: true })
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' })
    return true
  } catch {
    return false
  }
}

export function releaseLock(lockPath: string): void {
  try {
    if (fs.readFileSync(lockPath, 'utf8').trim() === String(process.pid)) fs.rmSync(lockPath)
  } catch {
    // já não existe
  }
}
