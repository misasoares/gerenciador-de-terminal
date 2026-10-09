import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const HELPER = path.resolve(__dirname, '../../resources/update-helper.sh')
// abrir de mentira: anota a versão aberta e, se for a "boa", confirma como o app novo faria
const LAUNCH =
  'v=$(cat "$1/Contents/version" 2>/dev/null || cat "$1"); echo "$v" >> "$GT_TEST_UPD/launched"; [ "$v" = "$GT_TEST_GOOD" ] && touch "$GT_TEST_UPD/ok-$v"; true'

function run(args: string[], env: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn('sh', [HELPER, ...args], { env: { ...process.env, GT_HELPER_LAUNCH: LAUNCH, GT_HELPER_WAIT_OK: '2', ...env }, stdio: 'ignore' })
    p.on('exit', (code) => resolve(code ?? -1))
  })
}
const deadPid = () => {
  const p = spawn('sleep', ['0.2'])
  return String(p.pid)
}
const launched = (upd: string) => (fs.existsSync(path.join(upd, 'launched')) ? fs.readFileSync(path.join(upd, 'launched'), 'utf8').trim().split('\n') : [])

/** pasta com espaço no nome, como /Applications/Gerenciador de Terminal.app */
function macFixture(newVersion: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt helper '))
  const apps = path.join(root, 'Aplicativos com espaço')
  const upd = path.join(root, 'updates')
  fs.mkdirSync(upd, { recursive: true })
  const app = path.join(apps, 'Gerenciador de Terminal.app')
  fs.mkdirSync(path.join(app, 'Contents'), { recursive: true })
  fs.writeFileSync(path.join(app, 'Contents', 'version'), '0.1.0')
  const src = path.join(root, 'novo', 'Gerenciador de Terminal.app')
  fs.mkdirSync(path.join(src, 'Contents'), { recursive: true })
  fs.writeFileSync(path.join(src, 'Contents', 'version'), newVersion)
  const zip = path.join(upd, 'novo.zip')
  execFileSync('ditto', ['-c', '-k', '--keepParent', src, zip])
  return { app, upd, zip }
}

function appImageFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gt helper '))
  const upd = path.join(root, 'updates')
  fs.mkdirSync(upd)
  const target = path.join(root, 'Meus Apps', 'gerenciador.AppImage')
  fs.mkdirSync(path.dirname(target))
  fs.writeFileSync(target, '0.1.0')
  const art = path.join(upd, 'novo.AppImage')
  fs.writeFileSync(art, '0.2.0')
  return { target, upd, art }
}

describe.skipIf(process.platform !== 'darwin')('script auxiliar · Mac', () => {
  it('troca, abre a nova e, confirmada, apaga a anterior', async () => {
    const f = macFixture('0.2.0')
    const code = await run(['mac-zip', deadPid(), f.app, f.zip, f.upd, '0.2.0', '0.1.0'], { GT_TEST_UPD: f.upd, GT_TEST_GOOD: '0.2.0' })
    expect(code).toBe(0)
    expect(fs.readFileSync(path.join(f.app, 'Contents', 'version'), 'utf8')).toBe('0.2.0')
    expect(fs.existsSync(f.app.replace(/\.app$/, '.anterior.app'))).toBe(false)
    expect(fs.existsSync(path.join(f.upd, 'ok-0.2.0'))).toBe(false)
    expect(fs.existsSync(path.join(f.upd, 'failed.json'))).toBe(false)
    expect(launched(f.upd)).toEqual(['0.2.0'])
  })
  it('a nova não confirma: volta para a anterior, abre e registra a falha', async () => {
    const f = macFixture('0.2.0')
    const code = await run(['mac-zip', deadPid(), f.app, f.zip, f.upd, '0.2.0', '0.1.0'], { GT_TEST_UPD: f.upd, GT_TEST_GOOD: 'nenhuma' })
    expect(code).toBe(1)
    expect(fs.readFileSync(path.join(f.app, 'Contents', 'version'), 'utf8')).toBe('0.1.0')
    expect(launched(f.upd)).toEqual(['0.2.0', '0.1.0'])
    expect(JSON.parse(fs.readFileSync(path.join(f.upd, 'failed.json'), 'utf8'))).toMatchObject({ from: '0.1.0', to: '0.2.0' })
  })
  it('zip corrompido: não troca nada e reabre a atual', async () => {
    const f = macFixture('0.2.0')
    fs.writeFileSync(f.zip, 'não é zip')
    const code = await run(['mac-zip', deadPid(), f.app, f.zip, f.upd, '0.2.0', '0.1.0'], { GT_TEST_UPD: f.upd, GT_TEST_GOOD: '0.2.0' })
    expect(code).toBe(1)
    expect(fs.readFileSync(path.join(f.app, 'Contents', 'version'), 'utf8')).toBe('0.1.0')
    expect(launched(f.upd)).toEqual(['0.1.0'])
    expect(fs.existsSync(path.join(f.upd, 'failed.json'))).toBe(true)
  })
})

describe('script auxiliar · AppImage e espera', () => {
  it('AppImage: troca o arquivo, deixa executável e confirma', async () => {
    const f = appImageFixture()
    const code = await run(['appimage', deadPid(), f.target, f.art, f.upd, '0.2.0', '0.1.0'], { GT_TEST_UPD: f.upd, GT_TEST_GOOD: '0.2.0' })
    expect(code).toBe(0)
    expect(fs.readFileSync(f.target, 'utf8')).toBe('0.2.0')
    expect(fs.statSync(f.target).mode & 0o111).not.toBe(0)
    expect(fs.existsSync(f.target + '.anterior')).toBe(false)
  })
  it('AppImage que não confirma: volta para a anterior', async () => {
    const f = appImageFixture()
    const code = await run(['appimage', deadPid(), f.target, f.art, f.upd, '0.2.0', '0.1.0'], { GT_TEST_UPD: f.upd, GT_TEST_GOOD: 'nenhuma' })
    expect(code).toBe(1)
    expect(fs.readFileSync(f.target, 'utf8')).toBe('0.1.0')
    expect(launched(f.upd)).toEqual(['0.2.0', '0.1.0'])
  })
  it('o app não fecha a tempo: desiste sem trocar', async () => {
    const f = appImageFixture()
    const alive = spawn('sleep', ['30'])
    const code = await run(['appimage', String(alive.pid), f.target, f.art, f.upd, '0.2.0', '0.1.0'], { GT_TEST_UPD: f.upd, GT_TEST_GOOD: '0.2.0', GT_HELPER_WAIT_EXIT: '1' })
    alive.kill()
    expect(code).toBe(1)
    expect(fs.readFileSync(f.target, 'utf8')).toBe('0.1.0')
    expect(launched(f.upd)).toEqual([])
    expect(fs.readFileSync(path.join(f.upd, 'helper.log'), 'utf8')).toMatch(/não fechou/)
  })
})
