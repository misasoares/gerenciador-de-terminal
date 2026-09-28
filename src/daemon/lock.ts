import fs from 'node:fs'

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
  const owner = Number(fs.readFileSync(lockPath, 'utf8').trim())
  if (owner && owner !== process.pid && isAlive(owner)) return false
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
