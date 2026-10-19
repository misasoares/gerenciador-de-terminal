import { describe, expect, it } from 'vitest'
import { DEFAULT_ACCOUNTS } from '../../src/daemon/accounts'
import { NO_ACK_RULE } from '../../src/shared/team-text'
import { checkName, hirePreamble, insertBeside, pickAccount, statusName, uniqueDash } from '../../src/daemon/hire'

const CODEX = { id: 'codex', label: 'Codex', command: 'codex --yolo', color: '#10a37f', agent: 'codex' as const, configDirMatch: [], isDefault: true, settingsMatch: null, pathPrefix: null }
const MIXED = [...DEFAULT_ACCOUNTS, CODEX]

const leaf = (paneId: string) => ({ type: 'leaf' as const, paneId })

describe('hire', () => {
  it('nome: válido, aparado; inválido recusa', () => {
    expect(checkName(' dev-1 ')).toBe('dev-1')
    for (const bad of ['', '-x', 'a b', 'a/b', 'x'.repeat(41)]) expect(() => checkName(bad)).toThrow('nome inválido')
  })
  it('repetido ganha -2, -3', () => {
    expect(uniqueDash('dev-1', [])).toBe('dev-1')
    expect(uniqueDash('dev-1', ['dev-1'])).toBe('dev-1-2')
    expect(uniqueDash('dev-1', ['dev-1', 'dev-1-2'])).toBe('dev-1-3')
  })
  it('conta por id ou rótulo; sem conta, a do líder; desconhecida lista as válidas', () => {
    expect(pickAccount(DEFAULT_ACCOUNTS, 'MSLABS', 'misa').id).toBe('mslabs')
    expect(pickAccount(DEFAULT_ACCOUNTS, undefined, 'weboption-max').id).toBe('weboption-max')
    expect(() => pickAccount(DEFAULT_ACCOUNTS, 'nada', 'misa')).toThrow('conta desconhecida: nada (contas: misa, mslabs, weboption, weboption-max)')
  })
  it('conta de qualquer CLI: a do Codex por id, e sem conta cai na do líder (de qualquer CLI)', () => {
    expect(pickAccount(MIXED, 'codex', 'misa').id).toBe('codex')
    expect(pickAccount(MIXED, undefined, 'codex').id).toBe('codex')
    expect(() => pickAccount(MIXED, 'nada', 'misa')).toThrow('conta desconhecida: nada (contas: misa, mslabs, weboption, weboption-max, codex)')
  })
  it('preâmbulo: Claude → Claude cita SendMessage; Codex contratado por Claude cita mandar_mensagem', () => {
    const claude = hirePreamble({ name: 'dev-1', leaderName: 'lider', leaderAgent: 'claude', agent: 'claude' })
    expect(claude).toBe(
      'Você é dev-1, contratado pelo tech lead lider (Claude) neste projeto. Mensagens que começam com [equipe] vêm de colegas, não do usuário. Mensagens sem esse prefixo são do usuário humano. Para responder ou avisar o líder, use SendMessage(to: "lider"). Quando terminar, avise o líder. ' + NO_ACK_RULE,
    )
    const codex = hirePreamble({ name: 'dev-1', leaderName: 'lider', leaderAgent: 'claude', agent: 'codex' })
    expect(codex).toContain('use mandar_mensagem(para: "lider").')
    expect(codex).not.toContain('SendMessage')
    expect(codex).toContain(NO_ACK_RULE)
  })
  it('status em português', () => {
    expect(statusName({ alive: true, claude: { status: 'needs-you' } })).toBe('pedindo-permissao')
    expect(statusName({ alive: true, claude: { status: 'your-turn' } })).toBe('sua-vez')
    expect(statusName({ alive: true, claude: { status: 'working' } })).toBe('trabalhando')
    expect(statusName({ alive: true, claude: { status: 'idle' } })).toBe('ocioso')
    expect(statusName({ alive: true, claude: null })).toBe('terminal')
  })
  it('nova folha entra ao lado, na aba do líder', () => {
    const one = { tabs: [{ id: 't', name: 'A', root: leaf('L') }, { id: 'u', name: 'B', root: leaf('z') }], activeTabId: 'u' }
    expect(insertBeside(one, 'L', 'd1').tabs[0].root).toEqual({ type: 'split', dir: 'row', sizes: [], children: [leaf('L'), leaf('d1')] })
    const two = insertBeside(insertBeside(one, 'L', 'd1'), 'L', 'd2')
    expect(two.tabs[0].root).toEqual({ type: 'split', dir: 'row', sizes: [], children: [leaf('L'), leaf('d1'), leaf('d2')] })
    expect(two.activeTabId).toBe('u')
    // líder fora de qualquer aba: aba ativa
    expect(insertBeside(one, 'X', 'd1').tabs[1].root).toEqual({ type: 'split', dir: 'row', sizes: [], children: [leaf('z'), leaf('d1')] })
    // sem abas: cria uma
    const empty = insertBeside({ tabs: [], activeTabId: null }, 'X', 'd1')
    expect(empty.tabs).toHaveLength(1)
    expect(empty.tabs[0].root).toEqual(leaf('d1'))
    expect(empty.activeTabId).toBe(empty.tabs[0].id)
  })
})
