import { describe, expect, it } from 'vitest'
import { DEFAULT_ACCOUNTS } from '../../src/daemon/accounts'
import { checkName, insertBeside, pickAccount, statusName, uniqueDash } from '../../src/daemon/hire'

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
