import net from 'node:net'
import { encode, LineDecoder } from './framing'
import type { ClientRequest, ServerMessage } from './protocol'

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class RpcClient {
  private nextId = 1
  private pending = new Map<number, Pending>()
  private listeners = new Set<(m: ServerMessage) => void>()
  private closeListeners = new Set<() => void>()

  private constructor(private sock: net.Socket) {
    const dec = new LineDecoder()
    sock.setEncoding('utf8')
    sock.on('data', (chunk: string) => {
      for (const m of dec.push(chunk) as ServerMessage[]) this.dispatch(m)
    })
    sock.on('error', () => {})
    sock.on('close', () => {
      for (const p of this.pending.values()) p.reject(new Error('conexão com o daemon encerrada'))
      this.pending.clear()
      for (const l of this.closeListeners) l()
    })
  }

  static connect(socketPath: string, timeoutMs = 2000): Promise<RpcClient> {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(socketPath)
      const timer = setTimeout(() => {
        sock.destroy()
        reject(new Error('tempo esgotado ao conectar no daemon'))
      }, timeoutMs)
      sock.once('connect', () => {
        clearTimeout(timer)
        resolve(new RpcClient(sock))
      })
      sock.once('error', (e) => {
        clearTimeout(timer)
        reject(e)
      })
    })
  }

  request<T = unknown>(req: ClientRequest): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.sock.write(encode({ id, req }))
    })
  }

  send(req: ClientRequest): void {
    this.sock.write(encode({ id: 0, req }))
  }

  onMessage(cb: (m: ServerMessage) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onClose(cb: () => void): void {
    this.closeListeners.add(cb)
  }

  close(): void {
    this.sock.end()
  }

  private dispatch(m: ServerMessage): void {
    if (m.t === 'reply') {
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      if (m.ok) p.resolve(m.result)
      else p.reject(new Error(m.error))
      return
    }
    for (const l of this.listeners) l(m)
  }
}
