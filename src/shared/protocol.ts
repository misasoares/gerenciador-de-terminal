import type { Account, AppState, HookPayload, Layout } from './types'
import type { TerminalSettings } from './settings'

export const PROTOCOL_VERSION = 2

export type ClientRequest =
  | { t: 'hello'; role: 'app' | 'hook'; version: number }
  | { t: 'state.get' }
  | { t: 'hook'; paneId: string; configDir: string; payload: HookPayload }
  | { t: 'pane.create'; paneId?: string; cwd: string; accountId: string | null; resumeSessionId?: string; cols: number; rows: number }
  | { t: 'pane.attach'; paneId: string; cols?: number; rows?: number; seq?: number }
  | { t: 'pane.detach'; paneId: string }
  | { t: 'pane.input'; paneId: string; data: string }
  | { t: 'pane.resize'; paneId: string; cols: number; rows: number }
  | { t: 'pane.kill'; paneId: string }
  | { t: 'pane.forget'; paneId: string }
  | { t: 'pane.seen'; paneId: string }
  | { t: 'conflicts.analyze'; projectPath: string }
  | { t: 'pane.meta'; paneId: string; name?: string | null; color?: string | null }
  | { t: 'settings.save'; settings: TerminalSettings }
  | { t: 'accounts.save'; accounts: Account[] }
  | { t: 'agents.detect' }
  | { t: 'project.add'; path: string }
  | { t: 'project.remove'; path: string }
  | { t: 'project.setAccount'; path: string; accountId: string | null }
  | { t: 'layout.save'; layout: Layout }
  | { t: 'worktree.checkRemove'; path: string }
  | { t: 'worktree.remove'; path: string; force: boolean; deleteBranch: boolean }
  | { t: 'hooks.install' }
  | { t: 'resume.dismiss'; paneId: string }
  | { t: 'daemon.shutdown' }

/** id 0 = sem resposta (fire-and-forget) */
export interface RequestEnvelope {
  id: number
  req: ClientRequest
}

export type ServerMessage =
  | { t: 'reply'; id: number; ok: true; result: unknown }
  | { t: 'reply'; id: number; ok: false; error: string }
  | { t: 'state'; state: AppState }
  | { t: 'pane.data'; paneId: string; data: string; seq: number }

/** eventos que o processo principal do Electron entrega ao renderer */
export type BridgeEvent =
  | ServerMessage
  | { t: 'disconnected' }
  | { t: 'reconnected' }
  | { t: 'version-mismatch'; daemon: string; app: string }
