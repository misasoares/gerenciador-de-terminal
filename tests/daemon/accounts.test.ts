import { describe, expect, it } from 'vitest'
import { buildCommand, DEFAULT_ACCOUNTS, detectAccount, suggestAccount } from '../../src/daemon/accounts'

const S = '/Users/u/.claude-swap-backup/sessions'

describe('detectAccount', () => {
  it('sem CLAUDE_CONFIG_DIR é a conta padrão', () => {
    expect(detectAccount(DEFAULT_ACCOUNTS, 'claude', null, '/Users/u/.local/bin/claude')).toBe('misa')
  })
  it('pelo perfil do cswap', () => {
    expect(detectAccount(DEFAULT_ACCOUNTS, 'claude', `${S}/3-misael_mslabs-dev.com`, null)).toBe('mslabs')
    expect(detectAccount(DEFAULT_ACCOUNTS, 'claude', `${S}/1-misasoaresms2_gmail.com`, null)).toBe('misa')
  })
  it('weboption x weboption-max pelo --settings', () => {
    const dir = `${S}/2-weboption2011_gmail.com`
    expect(detectAccount(DEFAULT_ACCOUNTS, 'claude', dir, 'claude --settings /Users/u/.config/claude/weboption-gateway.proj.json')).toBe('weboption')
    expect(detectAccount(DEFAULT_ACCOUNTS, 'claude', dir, 'claude --settings /Users/u/.config/claude/weboption-max.json')).toBe('weboption-max')
    expect(detectAccount(DEFAULT_ACCOUNTS, 'claude', dir, null)).toBe('weboption')
  })
  it('perfil desconhecido não chuta', () => {
    expect(detectAccount(DEFAULT_ACCOUNTS, 'claude', `${S}/9-outro`, null)).toBeNull()
  })
})

describe('buildCommand', () => {
  it('monta o comando e o resume', () => {
    const mslabs = DEFAULT_ACCOUNTS.find((a) => a.id === 'mslabs')!
    expect(buildCommand(mslabs)).toBe('claude-mslabs')
    expect(buildCommand(mslabs, '6f574752-bb4d-4ff2-8ed1-bb685dce78ed')).toBe('claude-mslabs --resume 6f574752-bb4d-4ff2-8ed1-bb685dce78ed')
  })
  it('Codex retoma com o subcomando resume', () => {
    const codex = { ...DEFAULT_ACCOUNTS[0], id: 'codex', agent: 'codex' as const, command: 'codex --yolo' }
    expect(buildCommand(codex, 'abcd-1234')).toBe('codex --yolo --no-daemon resume abcd-1234')
  })
  it('Codex roda sem o daemon compartilhado (os hooks herdam o GT_PANE_ID do painel)', () => {
    const codex = { ...DEFAULT_ACCOUNTS[0], id: 'codex', agent: 'codex' as const, command: 'codex --yolo' }
    expect(buildCommand(codex)).toBe('codex --yolo --no-daemon')
    expect(buildCommand({ ...codex, command: 'codex --no-daemon --yolo' })).toBe('codex --no-daemon --yolo')
  })
  it('Claude: --mcp-config, -n e prompt por arquivo, citados', () => {
    const mslabs = DEFAULT_ACCOUNTS.find((a) => a.id === 'mslabs')!
    expect(buildCommand(mslabs, undefined, { mcpConfig: '/Volumes/SSD MISA/h/mcp.json', name: 'dev-1', promptFile: '/p/a b.txt' })).toBe(
      `claude-mslabs --mcp-config '/Volumes/SSD MISA/h/mcp.json' -n 'dev-1' "$(cat '/p/a b.txt')"`,
    )
    expect(buildCommand(mslabs, '6f574752-bb4d-4ff2-8ed1-bb685dce78ed', { mcpConfig: '/h/mcp.json' })).toBe(
      `claude-mslabs --resume 6f574752-bb4d-4ff2-8ed1-bb685dce78ed --mcp-config '/h/mcp.json'`,
    )
  })
  it('Codex ignora os extras do Claude', () => {
    const codex = { ...DEFAULT_ACCOUNTS[0], id: 'codex', agent: 'codex' as const, command: 'codex --yolo' }
    expect(buildCommand(codex, undefined, { mcpConfig: '/h/mcp.json', name: 'dev-1', promptFile: '/p.txt' })).toBe('codex --yolo --no-daemon')
  })
  it('recusa session id que não parece um id', () => {
    expect(() => buildCommand(DEFAULT_ACCOUNTS[0], 'x; rm -rf ~')).toThrow('session id inválido')
  })
})

describe('suggestAccount', () => {
  it('sugere pela pasta do projeto', () => {
    expect(suggestAccount(DEFAULT_ACCOUNTS, '/Users/u/Documents/weboption/site', '/Users/u')).toBe('weboption')
    expect(suggestAccount(DEFAULT_ACCOUNTS, '/Users/u/Documents/weboption-velho', '/Users/u')).toBeNull()
    expect(suggestAccount(DEFAULT_ACCOUNTS, '/Volumes/SSD MISA/apps', '/Users/u')).toBeNull()
  })
})
