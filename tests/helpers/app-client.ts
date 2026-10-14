import { RpcClient } from '../../src/shared/rpc-client'
import { PROTOCOL_VERSION } from '../../src/shared/protocol'
import type { AppState, MachineDetail, MachineView } from '../../src/shared/types'
import { waitFor } from './wait'

export async function connectApp(socketPath: string, workspaceId?: string) {
  const client = await RpcClient.connect(socketPath)
  let last: AppState | null = null
  const data = new Map<string, string>()
  const alerts: string[] = []
  const fileEvents: { path: string; mtimeMs: number | null }[] = []
  const machine: { machine: MachineView; detail?: MachineDetail }[] = []
  client.onMessage((m) => {
    if (m.t === 'state') last = m.state
    if (m.t === 'pane.data') data.set(m.paneId, (data.get(m.paneId) ?? '') + m.data)
    if (m.t === 'usage.alert') alerts.push(m.text)
    if (m.t === 'file.changed') fileEvents.push({ path: m.path, mtimeMs: m.mtimeMs })
    if (m.t === 'machine') machine.push({ machine: m.machine, detail: m.detail })
  })
  await client.request({ t: 'hello', role: 'app', version: PROTOCOL_VERSION, ...(workspaceId ? { workspaceId } : {}) })
  return {
    client,
    state: () => last,
    output: (paneId: string) => data.get(paneId) ?? '',
    alerts: () => alerts,
    fileEvents: () => fileEvents,
    machine: () => machine,
    waitState: (pred: (s: AppState) => boolean, ms = 8000) => waitFor(() => (last && pred(last) ? last : null), ms),
  }
}
