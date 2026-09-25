import { spawn } from 'node:child_process'
import { RpcClient } from '../shared/rpc-client'
import { PROTOCOL_VERSION, type BridgeEvent, type ClientRequest } from '../shared/protocol'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function ensureDaemon(socketPath: string, spawnDaemon: () => void, timeoutMs = 5000): Promise<RpcClient> {
  try {
    return await RpcClient.connect(socketPath)
  } catch {
    // não está rodando
  }
  spawnDaemon()
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown = null
  while (Date.now() < deadline) {
    await sleep(100)
    try {
      return await RpcClient.connect(socketPath)
    } catch (e) {
      lastErr = e
    }
  }
  throw new Error(`não consegui iniciar o daemon: ${String(lastErr)}`)
}

export function spawnDetached(daemonScript: string, env: NodeJS.ProcessEnv): void {
  // o próprio binário do Electron roda como Node; o daemon não depende de Node instalado
  const child = spawn(process.execPath, [daemonScript], {
    detached: true,
    stdio: 'ignore',
    env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
  })
  child.unref()
}

export class DaemonLink {
  private client: RpcClient | null = null
  private quitting = false
  private reconnecting = false

  constructor(private o: { socketPath: string; daemonScript: string; onEvent(e: BridgeEvent): void; spawnDaemon?: () => void }) {}

  async start(): Promise<void> {
    await this.connectOnce(false)
  }

  request<T = unknown>(req: ClientRequest): Promise<T> {
    if (!this.client) return Promise.reject(new Error('sem conexão com o daemon'))
    return this.client.request<T>(req)
  }

  send(req: ClientRequest): void {
    this.client?.send(req)
  }

  /** restart=false: o app vai sair e não deve reconectar */
  async shutdownDaemon(restart: boolean): Promise<void> {
    if (!restart) this.quitting = true
    await this.request({ t: 'daemon.shutdown' }).catch(() => {})
  }

  private async connectOnce(isReconnect: boolean): Promise<void> {
    const client = await ensureDaemon(this.o.socketPath, this.o.spawnDaemon ?? (() => spawnDetached(this.o.daemonScript, process.env)))
    let hello: { protocolVersion: number }
    try {
      hello = await client.request<{ protocolVersion: number }>({ t: 'hello', role: 'app', version: PROTOCOL_VERSION })
    } catch (e) {
      client.close()
      throw e
    }
    // só vira o cliente ativo depois do hello; um cliente antigo que feche não derruba o novo
    this.client = client
    client.onMessage((m) => {
      if (this.client === client) this.o.onEvent(m)
    })
    client.onClose(() => {
      if (this.client !== client) return
      this.client = null
      if (this.quitting) return
      this.o.onEvent({ t: 'disconnected' })
      void this.reconnectLoop()
    })
    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      this.o.onEvent({ t: 'version-mismatch', daemon: hello.protocolVersion, app: PROTOCOL_VERSION })
    }
    if (isReconnect) this.o.onEvent({ t: 'reconnected' })
  }

  private async reconnectLoop(): Promise<void> {
    if (this.reconnecting) return
    this.reconnecting = true
    try {
      while (!this.quitting) {
        try {
          await this.connectOnce(true)
          return
        } catch {
          await sleep(1000)
        }
      }
    } finally {
      this.reconnecting = false
    }
  }
}
