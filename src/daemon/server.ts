import fs from 'node:fs'
import net from 'node:net'
import { encode, LineDecoder } from '../shared/framing'
import type { ClientRequest, RequestEnvelope, ServerMessage } from '../shared/protocol'

export interface Conn {
  role: 'app' | 'hook' | null
  /** espaço de trabalho da janela (padrão 'principal') */
  workspaceId: string
  /** paneId → seq do último attach desta conexão */
  subscriptions: Map<string, number>
  send(m: ServerMessage): void
  end(): void
  onClose(fn: () => void): void
}

export type Handler = (req: ClientRequest, conn: Conn) => unknown | Promise<unknown>

export interface RpcServer {
  conns: Set<Conn>
  close(): Promise<void>
}

export async function startServer(socketPath: string, handler: Handler): Promise<RpcServer> {
  try {
    fs.unlinkSync(socketPath)
  } catch {
    // não existia
  }
  const conns = new Set<Conn>()
  const sockets = new Set<net.Socket>()

  const server = net.createServer((sock) => {
    sockets.add(sock)
    sock.setEncoding('utf8')
    const dec = new LineDecoder()
    const closers: (() => void)[] = []
    const conn: Conn = {
      role: null,
      workspaceId: 'principal',
      subscriptions: new Map(),
      send: (m) => {
        if (!sock.destroyed) sock.write(encode(m))
      },
      end: () => sock.end(),
      onClose: (fn) => {
        closers.push(fn)
      },
    }
    conns.add(conn)

    const handle = async (env: RequestEnvelope): Promise<void> => {
      try {
        const result = await handler(env.req, conn)
        if (env.id) conn.send({ t: 'reply', id: env.id, ok: true, result: result ?? null })
      } catch (e) {
        if (env.id) conn.send({ t: 'reply', id: env.id, ok: false, error: e instanceof Error ? e.message : String(e) })
      }
    }

    sock.on('data', (chunk: string) => {
      for (const env of dec.push(chunk) as RequestEnvelope[]) void handle(env)
    })
    sock.on('error', () => {})
    sock.on('close', () => {
      conns.delete(conn)
      sockets.delete(sock)
      for (const fn of closers) fn()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => resolve())
  })
  fs.chmodSync(socketPath, 0o600)

  return {
    conns,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      }),
  }
}
