import type { Account, AgentKind, PaneView } from '../../shared/types'

export const AGENT_LABEL: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' }
const YOLO: Record<AgentKind, string> = { claude: 'claude --dangerously-skip-permissions', codex: 'codex --yolo' }
const COLOR: Record<AgentKind, string> = { claude: '#d97757', codex: '#10a37f' }

export function newAgentDraft(existing: Account[], agent: AgentKind): Account {
  const ids = new Set(existing.map((a) => a.id))
  let id: string = agent
  for (let n = 2; ids.has(id); n++) id = `${agent}-${n}`
  const first = !existing.some((a) => a.agent === agent)
  return { id, label: id === agent ? AGENT_LABEL[agent] : `${AGENT_LABEL[agent]} ${id.split('-').pop()}`, command: YOLO[agent], color: COLOR[agent], agent, configDirMatch: [], isDefault: first, settingsMatch: null, pathPrefix: null }
}

export function hooksMissingPanes(panes: PaneView[]): PaneView[] {
  return panes.filter((p) => p.alive && p.agentHooksMissing)
}
