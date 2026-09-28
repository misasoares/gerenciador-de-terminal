import { describe, expect, it } from 'vitest'
import { hooksBanner, hooksMissingPanes, newAgentDraft } from '../../src/renderer/src/agents-model'
import type { Account, PaneView } from '../../src/shared/types'

const acc = (id: string, agent: 'claude' | 'codex'): Account => ({ id, label: id, command: id, color: '#111111', agent, configDirMatch: [], isDefault: false, settingsMatch: null, pathPrefix: null })

describe('agents-model', () => {
  it('rascunho com id único e comando yolo do tipo', () => {
    expect(newAgentDraft([], 'codex')).toMatchObject({ id: 'codex', agent: 'codex', command: 'codex --yolo' })
    expect(newAgentDraft([acc('codex', 'codex')], 'codex').id).toBe('codex-2')
    expect(newAgentDraft([acc('claude', 'claude'), acc('claude-2', 'claude')], 'claude')).toMatchObject({ id: 'claude-3', command: 'claude --dangerously-skip-permissions' })
  })
  it('painéis com Codex sem hooks', () => {
    const p = (id: string, missing: boolean) => ({ id, agentHooksMissing: missing, alive: true }) as PaneView
    expect(hooksMissingPanes([p('a', false), p('b', true)]).map((x) => x.id)).toEqual(['b'])
  })
  it('faixa: hooks não instalados vencem o aviso do /hooks do Codex', () => {
    const p = (missing: boolean) => ({ id: 'p', agentHooksMissing: missing, alive: true }) as PaneView
    expect(hooksBanner(['~/.codex/hooks.json'], [p(true)])).toBe('install')
    expect(hooksBanner([], [p(true)])).toBe('codex-trust')
    expect(hooksBanner(undefined, [p(false)])).toBe(null)
  })
})
