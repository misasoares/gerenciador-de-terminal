import { RpcClient } from '../../src/shared/rpc-client'
import { PROTOCOL_VERSION } from '../../src/shared/protocol'
import type { AppState } from '../../src/shared/types'
import { waitFor } from './wait'

export async function connectApp(socketPath: string) {
  const client = await RpcClient.connect(socketPath)
  let last: AppState | null = null
  const data = new Map<string, string>()
  const alerts: string[] = []
  client.onMessage((m) => {
    if (m.t === 'state') last = m.state
    if (m.t === 'pane.data') data.set(m.paneId, (data.get(m.paneId) ?? '') + m.data)
    if (m.t === 'usage.alert') alerts.push(m.text)
  })
  await client.request({ t: 'hello', role: 'app', version: PROTOCOL_VERSION })
  return {
    client,
    state: () => last,
    output: (paneId: string) => data.get(paneId) ?? '',
    alerts: () => alerts,
    waitState: (pred: (s: AppState) => boolean, ms = 8000) => waitFor(() => (last && pred(last) ? last : null), ms),
  }
}
