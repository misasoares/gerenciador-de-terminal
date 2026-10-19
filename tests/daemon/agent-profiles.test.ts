import { describe, expect, it } from 'vitest'
import { profileOf } from '../../src/daemon/agent-profiles'

const mcp = { configPath: '/h/mcp.json', command: '/A pp/bin', args: ['/A pp/gt-mcp.js'] }

describe('profileOf', () => {
  it('Claude: --mcp-config e --model', () => {
    expect(profileOf('claude').mcpArgs(mcp, 'p1', '/s.sock')).toBe(`--mcp-config '/h/mcp.json'`)
    expect(profileOf('claude').modelArgs('sonnet')).toBe(`--model 'sonnet'`)
    expect(profileOf('claude').nativeTeam).toBe(true)
  })
  it('Codex: -c mcp_servers com GT_PANE_ID e GT_SOCKET literais, -m', () => {
    expect(profileOf('codex').mcpArgs(mcp, 'p1', '/s.sock')).toBe(
      `-c 'mcp_servers.gerenciador.command="/A pp/bin"' -c 'mcp_servers.gerenciador.args=["/A pp/gt-mcp.js"]' -c 'mcp_servers.gerenciador.env={ELECTRON_RUN_AS_NODE="1",GT_PANE_ID="p1",GT_SOCKET="/s.sock"}'`,
    )
    expect(profileOf('codex').modelArgs('gpt-6-sol')).toBe(`-m 'gpt-6-sol'`)
    expect(profileOf('codex').nativeTeam).toBe(false)
  })
  it('as duas CLIs interrompem com Esc', () => {
    expect(profileOf('claude').interruptKey).toBe('\x1b')
    expect(profileOf('codex').interruptKey).toBe('\x1b')
  })
})
