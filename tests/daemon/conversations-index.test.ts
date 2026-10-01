import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConversationIndex, candidateAccounts } from '../../src/daemon/conversations/index'
import { projectDirName } from '../../src/daemon/conversations/files'
import type { Account } from '../../src/shared/types'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gt-ix-')))
const acc = (id: string, over: Partial<Account> = {}): Account => ({ id, label: id, command: id, color: '#111111', agent: 'claude', configDirMatch: [], isDefault: false, settingsMatch: null, pathPrefix: null, ...over })
const user = (text: string, cwd = '/r/api') => JSON.stringify({ type: 'user', message: { role: 'user', content: text }, cwd, timestamp: 't' })

function conv(profile: string, cwd: string, id: string, text = 'oi', fileCwd = cwd): string {
  const f = path.join(profile, 'projects', projectDirName(cwd), `${id}.jsonl`)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, user(text, fileCwd) + '\n')
  return f
}

describe('candidateAccounts', () => {
  const accounts = [
    acc('misa', { isDefault: true, configDirMatch: ['1-misa'] }),
    acc('mslabs', { configDirMatch: ['3-mslabs'] }),
    acc('weboption', { configDirMatch: ['2-web'] }),
    acc('weboption-max', { configDirMatch: ['2-web'] }),
    acc('codex', { agent: 'codex', isDefault: true }),
  ]
  it('perfil compartilhado devolve as duas contas, na ordem da lista', () => {
    expect(candidateAccounts(accounts, 'claude', '/s/2-web', '/h/.claude', {})).toEqual(['weboption', 'weboption-max'])
  })
  it('diretório aprendido (loginDirs) vale mais que configDirMatch; "" é o padrão', () => {
    expect(candidateAccounts(accounts, 'claude', '/h/.claude', '/h/.claude', { mslabs: '' })).toEqual(['misa', 'mslabs'])
    expect(candidateAccounts(accounts, 'claude', '/s/1-misa', '/h/.claude', { misa: '/s/1-misa' })).toEqual(['misa'])
    expect(candidateAccounts(accounts, 'claude', '/h/.claude', '/h/.claude', { misa: '/s/1-misa' })).toEqual([])
  })
  it('Codex padrão e perfil sem conta', () => {
    expect(candidateAccounts(accounts, 'codex', '/h/.codex', '/h/.codex', {})).toEqual(['codex'])
    expect(candidateAccounts(accounts, 'claude', '/s/9-nada', '/h/.claude', {})).toEqual([])
  })
})

describe('ConversationIndex', () => {
  function setup() {
    const home = tmp()
    const p2 = tmp()
    const accounts = [acc('misa', { isDefault: true }), acc('wo', { configDirMatch: [path.basename(p2)] })]
    const open = new Map<string, string>()
    const known: string[] = []
    const ix = new ConversationIndex({
      userHome: home,
      claudeProfiles: () => [p2, '/nao/existe'],
      codexHomes: () => [],
      accounts: () => accounts,
      loginDirs: () => ({}),
      openSessions: () => open,
      knownPaths: () => known,
    })
    return { home, p2, ix, open, known, def: path.join(home, '.claude') }
  }

  it('lista de várias pastas e perfis, mais recente primeiro, com contas e painel aberto', async () => {
    const { p2, ix, open, def } = setup()
    const a = conv(def, '/r/api', 'a', 'primeira')
    conv(p2, '/r/api/wt', 'b', 'na worktree')
    fs.utimesSync(a, 1000, 1000)
    open.set('b', 'pane-b')
    const list = await ix.list(['/r/api', '/r/api/wt'])
    expect(list.map((c) => [c.sessionId, c.title, c.accountIds, c.openPaneId, c.cwd])).toEqual([
      ['b', 'na worktree', ['wo'], 'pane-b', '/r/api/wt'],
      ['a', 'primeira', ['misa'], null, '/r/api'],
    ])
  })

  it('mesma conversa em dois perfis aparece uma vez, com as contas somadas', async () => {
    const { p2, ix, def } = setup()
    conv(def, '/r/api', 'dup')
    conv(p2, '/r/api', 'dup')
    const list = await ix.list(['/r/api'])
    expect(list).toHaveLength(1)
    expect(list[0].accountIds).toEqual(['misa', 'wo'])
  })

  it('título longo da 1ª mensagem é cortado em 80; cache não relê arquivo igual', async () => {
    const { ix, def } = setup()
    conv(def, '/r/api', 'x', 'a'.repeat(200))
    expect((await ix.list(['/r/api']))[0].title).toHaveLength(80)
    const before = ix.reads
    await ix.list(['/r/api'])
    expect(ix.reads).toBe(before)
  })

  it('locate: pelo transcriptPath, pelo id nos perfis, ou null; devolve o cwd de início', async () => {
    const { p2, ix, def } = setup()
    const f = conv(p2, '/r/api', 'mudou', 'oi', '/r/api') // começou em /r/api
    expect(await ix.locate('claude', 'mudou', f)).toEqual({ file: f, startCwd: '/r/api' })
    expect(await ix.locate('claude', 'mudou', '/caminho/velho.jsonl')).toEqual({ file: f, startCwd: '/r/api' })
    expect(await ix.locate('claude', 'nao-existe', null)).toBeNull()
    expect(ix.profiles('claude')).toEqual([def, p2, '/nao/existe'])
  })

  it('arquivo na pasta da worktree com cwd da principal: lista e localizar usam a worktree', async () => {
    const { p2, ix, known } = setup()
    const wt = '/r/api/.claude/worktrees/craft'
    known.push('/r/api', wt)
    const f = conv(p2, wt, 'w', 'oi', '/r/api')
    expect((await ix.list([wt]))[0].cwd).toBe(wt)
    expect(await ix.locate('claude', 'w', null)).toEqual({ file: f, startCwd: wt })
  })
})
