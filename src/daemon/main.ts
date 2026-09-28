import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { Daemon, defaultShell } from './daemon'
import { acquireLock, releaseLock } from './lock'

function alreadyRunning(sock: string): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection(sock)
    s.once('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.once('error', () => resolve(false))
  })
}

async function main(): Promise<void> {
  const home = process.env.GT_HOME ?? path.join(os.homedir(), '.gerenciador-terminal')
  fs.mkdirSync(home, { recursive: true, mode: 0o700 })
  const log = fs.createWriteStream(path.join(home, 'daemon.log'), { flags: 'a' })
  const write =
    (level: string) =>
    (...args: unknown[]) =>
      log.write(`${new Date().toISOString()} ${level} ${args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')}\n`)
  console.log = write('INFO')
  console.error = write('ERROR')
  // um daemon que cai leva todas as sessões junto: registra e segue
  process.on('uncaughtException', (e) => console.error('uncaughtException', e))
  process.on('unhandledRejection', (e) => console.error('unhandledRejection', e))
  process.on('SIGHUP', () => {})

  const socketPath = path.join(home, 'daemon.sock')
  if (await alreadyRunning(socketPath)) {
    console.log('já existe um daemon rodando; saindo')
    process.exit(0)
  }
  const lockPath = path.join(home, 'daemon.lock')
  if (!acquireLock(lockPath)) {
    console.log('outro daemon está iniciando; saindo')
    process.exit(0)
  }
  process.on('exit', () => releaseLock(lockPath))
  const daemon = await Daemon.start({
    home,
    socketPath,
    stateFile: path.join(home, 'state.json'),
    hookScriptPath: path.join(home, 'bin', 'gt-hook'),
    userHome: os.homedir(),
    shell: defaultShell(),
    shellArgs: ['-il'],
    onShutdown: () => process.exit(0),
  })
  const bye = () => {
    void daemon.stop(true).then(() => process.exit(0))
  }
  process.on('SIGTERM', bye)
  process.on('SIGINT', bye)
  console.log(`daemon iniciado pid=${process.pid}`)
}

main().catch((e) => {
  console.error('falha ao iniciar o daemon', e)
  process.exit(1)
})
