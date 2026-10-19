import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultPersisted, loadPersisted, migrateWorkspaces, savePersisted } from '../../src/daemon/persist'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gt-p-'))

describe('persistência', () => {
  it('arquivo ausente → padrão com as contas conhecidas', () => {
    const p = loadPersisted(path.join(tmp(), 'state.json'))
    expect(p).toEqual(defaultPersisted())
    expect(p.accounts).toEqual([])
    expect(p.fetchIntervalMin).toBe(5)
  })

  it('ida e volta', () => {
    const f = path.join(tmp(), 'state.json')
    const data = { ...defaultPersisted(), projects: [{ path: '/a', name: 'a', defaultAccountId: null }] }
    savePersisted(f, data)
    expect(loadPersisted(f)).toEqual(data)
    expect(fs.readdirSync(path.dirname(f))).toEqual(['state.json'])
  })

  it('JSON corrompido → padrão e o arquivo ruim é guardado ao lado', () => {
    const dir = tmp()
    const f = path.join(dir, 'state.json')
    fs.writeFileSync(f, '{ quebrado')
    expect(loadPersisted(f)).toEqual(defaultPersisted())
    expect(fs.readdirSync(dir).some((n) => n.startsWith('state.json.corrupt-'))).toBe(true)
  })

  it('loginDirs e usageNotified têm padrão e fazem ida e volta', () => {
    expect(defaultPersisted()).toMatchObject({ loginDirs: {}, usageNotified: [] })
    const f = path.join(tmp(), 'state.json')
    const data = { ...defaultPersisted(), loginDirs: { mslabs: '/x/3-m' }, usageNotified: ['claude:/x|week|1|80'] }
    savePersisted(f, data)
    expect(loadPersisted(f)).toEqual(data)
  })

  it('claudeProfiles e codexHomes têm padrão vazio', () => {
    expect(defaultPersisted()).toMatchObject({ claudeProfiles: [], codexHomes: [] })
  })
  it('estado sem mailbox carrega lista vazia; entradas sem id ou destino são descartadas', () => {
    expect(defaultPersisted().mailbox).toEqual([])
    const f = path.join(tmp(), 'state.json')
    const ok = { id: 'm1', from: null, to: 'p2', fromName: 'app', toName: 'dev', fromAgent: null, kind: 'gerenciador', text: 'x', interrupt: false, createdAt: 1, state: 'na-fila', deliveredAt: null, error: null }
    fs.writeFileSync(f, JSON.stringify({ version: 1, projects: [], panes: [] }))
    expect(loadPersisted(f).mailbox).toEqual([])
    fs.writeFileSync(f, JSON.stringify({ version: 1, projects: [], panes: [], mailbox: [ok, { to: 'p2' }, { id: 'm2' }, null] }))
    expect(loadPersisted(f).mailbox).toEqual([ok])
  })
  it('filePanes tem padrão vazio', () => {
    expect(defaultPersisted()).toMatchObject({ filePanes: {} })
  })
  it('migra o estado antigo para o espaço Principal (layout, retomáveis e projetos)', () => {
    const f = path.join(tmp(), 'state.json')
    const layout = { tabs: [{ id: 't', name: 'A', root: { type: 'leaf' as const, paneId: 'p1' } }], activeTabId: 't' }
    fs.writeFileSync(f, JSON.stringify({ version: 1, projects: [{ path: '/r/a', name: 'a', defaultAccountId: null }], layout, resumable: [{ paneId: 'p1', cwd: '/r/a', accountId: null, sessionId: null }], panes: [] }))
    const p = loadPersisted(f)
    expect(p.workspaces).toEqual([{ id: 'principal', name: 'Principal', open: true, projectPaths: ['/r/a'], layout, resumable: [{ paneId: 'p1', cwd: '/r/a', accountId: null, sessionId: null }], floating: [] }])
    expect(p.askOnCloseWindow).toBe(true)
    expect(migrateWorkspaces(p)).toEqual(p)
  })

  it('estado novo começa com o espaço Principal vazio', () => {
    expect(defaultPersisted().workspaces).toEqual([{ id: 'principal', name: 'Principal', open: true, projectPaths: [], layout: { tabs: [], activeTabId: null }, resumable: [], floating: [] }])
  })
  it('flutuantes: espaço antigo sem floating carrega com lista vazia', () => {
    const f = path.join(tmp(), 'state.json')
    fs.writeFileSync(f, JSON.stringify({ version: 1, projects: [], workspaces: [{ id: 'principal', name: 'Principal', open: true, projectPaths: [], layout: { tabs: [], activeTabId: null }, resumable: [] }], panes: [] }))
    expect(loadPersisted(f).workspaces[0].floating).toEqual([])
    expect(defaultPersisted().workspaces[0].floating).toEqual([])
  })
})
