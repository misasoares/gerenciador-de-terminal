import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultPersisted, loadPersisted, savePersisted } from '../../src/daemon/persist'

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
})
