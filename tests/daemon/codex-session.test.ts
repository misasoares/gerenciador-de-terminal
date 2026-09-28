import { describe, expect, it } from 'vitest'
import { reduceSession } from '../../src/daemon/session'
import { findAgent, parsePs } from '../../src/daemon/platform/procs'

describe('sessão Codex', () => {
  it('guarda o tipo; Interrupt e Stop viram sua vez; PermissionRequest precisa de você', () => {
    const s = reduceSession(null, { hook_event_name: 'SessionStart', session_id: 'c1', cwd: '/w', source: 'startup' }, 1, 'codex')
    expect(s).toMatchObject({ agent: 'codex', status: 'idle' })
    const w = reduceSession(s, { hook_event_name: 'UserPromptSubmit', session_id: 'c1', cwd: '/w' }, 2, 'codex')
    expect(reduceSession(w, { hook_event_name: 'Interrupt', session_id: 'c1', cwd: '/w' }, 3, 'codex')?.status).toBe('your-turn')
    expect(reduceSession(w, { hook_event_name: 'Stop', session_id: 'c1', cwd: '/w' }, 3, 'codex')?.status).toBe('your-turn')
    expect(reduceSession(w, { hook_event_name: 'PermissionRequest', session_id: 'c1', cwd: '/w' }, 3, 'codex')?.status).toBe('needs-you')
    expect(reduceSession(null, { hook_event_name: 'Stop', session_id: 'x', cwd: '/w' }, 1)?.agent).toBe('claude')
  })
})

describe('findAgent', () => {
  const ps = [
    '  200     1 Ss   -zsh',
    '  300   200 S+   node /Users/u/.nvm/versions/node/v22/bin/codex --yolo',
    '  301   300 S+   /Users/u/.nvm/versions/node/v22/lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex/codex --yolo',
    '  400     1 Ss   -zsh',
    '  401   400 S+   /Users/u/.local/bin/claude --dangerously-skip-permissions',
    '  500     1 Ss   -zsh',
    '  501   500 S+   vim /tmp/codex/notas.md',
    '  502   500 S    grep -r codex src',
  ].join('\n')
  const procs = parsePs(ps)
  it('reconhece o codex (node e binário nativo) e o claude', () => {
    expect(findAgent(procs, 200)).toMatchObject({ agent: 'codex' })
    expect(findAgent(procs, 400)).toMatchObject({ agent: 'claude' })
  })
  it('não confunde pasta/argumento chamado codex', () => {
    expect(findAgent(procs, 500)).toBeNull()
  })
})
