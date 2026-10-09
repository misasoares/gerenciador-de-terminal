import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { ReadyArtifact } from './updater'

export interface InstallDeps {
  updatesDir: string
  stateFile: string
  /** update-helper.sh dentro do bundle (resources) */
  helperSource: string
  from: string
  ready: ReadyArtifact
  /** .app (Mac) ou AppImage a trocar */
  target: string
  appPid: number
  env: NodeJS.ProcessEnv
  stopDaemon(): Promise<void>
  spawnDetached(cmd: string, args: string[], env: NodeJS.ProcessEnv): void
  quit(): void
  now?: () => Date
}

export const stamp = (d: Date): string => d.toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-')

/** variáveis do AppImage e do modo Node não vão para o script nem para o app reaberto */
export function helperEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { APPDIR: _a, APPIMAGE: _b, ARGV0: _c, OWD: _d, ELECTRON_RUN_AS_NODE: _e, ...rest } = env
  return rest
}

/** prepara a troca e sai; quem troca é o script, depois que este processo terminar */
export async function runInstall(d: InstallDeps): Promise<void> {
  const now = (d.now ?? (() => new Date()))()
  fs.mkdirSync(d.updatesDir, { recursive: true })
  if (fs.existsSync(d.stateFile)) fs.copyFileSync(d.stateFile, path.join(d.updatesDir, `state-${stamp(now)}.json`))
  fs.writeFileSync(path.join(d.updatesDir, 'pending.json'), JSON.stringify({ from: d.from, to: d.ready.version, at: now.toISOString() }))
  fs.rmSync(path.join(d.updatesDir, 'failed.json'), { force: true })
  // cópia fora do bundle: no AppImage a montagem some quando o app sai
  const helper = path.join(d.updatesDir, 'update-helper.sh')
  fs.copyFileSync(d.helperSource, helper)
  await d.stopDaemon()
  d.spawnDetached('/bin/sh', [helper, d.ready.kind, String(d.appPid), d.target, d.ready.file, d.updatesDir, d.ready.version, d.from], helperEnv(d.env))
  d.quit()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const accepts = (socketPath: string) =>
  new Promise<boolean>((resolve) => {
    const s = net.createConnection(socketPath)
    s.once('connect', () => {
      s.destroy()
      resolve(true)
    })
    s.once('error', () => resolve(false))
  })

/** true quando o daemon parou de aceitar conexões dentro do limite */
export async function waitSocketGone(socketPath: string, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!(await accepts(socketPath))) return true
    await sleep(100)
  }
  return !(await accepts(socketPath))
}

/** o que o script troca: o .app no Mac, o AppImage no Linux; null = este tipo de instalação não se atualiza */
export function installTarget(platform: string, execPath: string, appImage: string | undefined): string | null {
  if (platform === 'linux') return appImage || null
  if (platform !== 'darwin') return null
  const app = path.resolve(execPath, '..', '..', '..')
  return app.endsWith('.app') ? app : null
}

/** a troca precisa escrever na pasta do bundle; translocado (aberto de Downloads/.dmg) nunca é a pasta real */
export function canWriteTarget(target: string): boolean {
  if (target.includes('/AppTranslocation/')) return false
  try {
    fs.accessSync(path.dirname(target), fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}
