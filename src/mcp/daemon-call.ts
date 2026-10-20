import { RpcClient } from '../shared/rpc-client'
import type { CallDaemon } from './protocol'

/** cada chamada abre uma conexão curta com o daemon (o MCP fica parado a maior parte do tempo) */
export function makeDaemonCall(env: Record<string, string | undefined>): CallDaemon {
  return async (tool, args) => {
    const callerPaneId = env.GT_PANE_ID
    const socket = env.GT_SOCKET
    if (!callerPaneId || !socket) throw new Error('fora do Gerenciador de Terminal')
    let client: RpcClient
    try {
      client = await RpcClient.connect(socket)
    } catch {
      throw new Error('Gerenciador de Terminal não está rodando')
    }
    try {
      return await client.request({ t: 'mcp.call', callerPaneId, callerPid: process.ppid, tool, args })
    } finally {
      client.close()
    }
  }
}
