import type { Account, AgentKind, AppState, Bounds, HookPayload, Layout, FilePaneMeta } from './types'
import type { TerminalSettings } from './settings'

export const PROTOCOL_VERSION = 2

export type ClientRequest =
  | { t: 'hello'; role: 'app' | 'hook'; version: number; workspaceId?: string }
  | { t: 'state.get' }
  | { t: 'hook'; paneId: string; configDir: string; agent?: AgentKind; payload: HookPayload }
  | { t: 'pane.create'; paneId?: string; cwd: string; accountId: string | null; resumeSessionId?: string; resumeAgent?: AgentKind; transcriptPath?: string | null; cols: number; rows: number }
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
  | { t: 'conversations.list'; paths: string[] }
  | { t: 'file.read'; path: string }
  | { t: 'file.write'; path: string; content: string; expectedMtimeMs: number | null }
  | { t: 'file.list'; root: string }
  | { t: 'file.exists'; cwd: string; paths: string[]; bases?: string[] }
  | { t: 'file.watch'; path: string }
  | { t: 'file.unwatch'; path: string }
  | { t: 'filepane.set'; id: string; path: string; mode: FilePaneMeta['mode'] }
  | { t: 'project.add'; path: string }
  | { t: 'project.remove'; path: string }
  | { t: 'project.setAccount'; path: string; accountId: string | null }
  | { t: 'project.setColor'; path: string; color: string | null }
  | { t: 'layout.save'; layout: Layout }
  | { t: 'worktree.checkRemove'; path: string }
  | { t: 'worktree.remove'; path: string; force: boolean; deleteBranch: boolean }
  | { t: 'hooks.install' }
  | { t: 'resume.dismiss'; paneId: string }
  | { t: 'daemon.shutdown' }
  | { t: 'float.set'; paneId: string; mode: 'float' | 'dock' | 'hide' }
  | { t: 'float.prefs'; paneId: string; bounds?: Bounds | null; onTop?: boolean; allDesks?: boolean; opacity?: number }
  | { t: 'pane.setLeader'; paneId: string; leader: boolean }
  | { t: 'mcp.call'; callerPaneId: string; tool: string; args: Record<string, unknown> }
  | { t: 'workspace.create'; name: string }
  | { t: 'workspace.rename'; id: string; name: string }
  | { t: 'workspace.setOpen'; id: string; open: boolean }
  | { t: 'workspace.end'; id: string }
  | { t: 'workspace.list' }
  | { t: 'workspace.setAskOnClose'; ask: boolean }
  | { t: 'pane.moveWorkspace'; paneId: string; to: string }

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
  | { t: 'usage.alert'; text: string }
  | { t: 'file.changed'; path: string; mtimeMs: number | null }

/** eventos que o processo principal do Electron entrega ao renderer */
export type BridgeEvent =
  | ServerMessage
  | { t: 'disconnected' }
  | { t: 'reconnected' }
  | { t: 'version-mismatch'; daemon: string; app: string }
