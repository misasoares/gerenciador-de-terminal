import { describe, expect, it } from 'vitest'
import { assetName, compareVersions, isNewer, parseRelease, parseSums, pickAsset } from '../../src/main/updater/release-check'

const gh = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v0.2.0',
  body: '- Novo: atualização pelo app',
  html_url: 'https://github.com/misasoares/gerenciador-de-terminal/releases/tag/v0.2.0',
  draft: false,
  prerelease: false,
  assets: [
    { name: 'gerenciador-de-terminal-0.2.0-mac-arm64.zip', browser_download_url: 'https://x/mac-arm64.zip', size: 10 },
    { name: 'gerenciador-de-terminal-0.2.0-mac-x64.zip', browser_download_url: 'https://x/mac-x64.zip', size: 10 },
    { name: 'gerenciador-de-terminal-0.2.0-x86_64.AppImage', browser_download_url: 'https://x/app.AppImage', size: 10 },
    { name: 'SHA256SUMS', browser_download_url: 'https://x/SHA256SUMS', size: 1 },
  ],
  ...over,
})

describe('versões', () => {
  it('compara numericamente (0.10.0 > 0.9.0) e aceita prefixo v', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('0.1.9', '0.2.0')).toBe(-1)
  })
  it('versão inválida: compareVersions lança, isNewer diz não', () => {
    expect(() => compareVersions('abc', '0.1.0')).toThrow()
    expect(isNewer('abc', '0.1.0')).toBe(false)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.0.9', '0.1.0')).toBe(false)
    expect(isNewer('0.1.1', '0.1.0')).toBe(true)
  })
})

describe('release do GitHub', () => {
  it('lê versão, notas, página e arquivos', () => {
    const r = parseRelease(gh())!
    expect(r.version).toBe('0.2.0')
    expect(r.notes).toBe('- Novo: atualização pelo app')
    expect(r.htmlUrl).toContain('/releases/tag/v0.2.0')
    expect(r.assets[0]).toEqual({ name: 'gerenciador-de-terminal-0.2.0-mac-arm64.zip', url: 'https://x/mac-arm64.zip', size: 10 })
  })
  it('rascunho, pré-release, tag inválida ou lixo → null', () => {
    expect(parseRelease(gh({ draft: true }))).toBeNull()
    expect(parseRelease(gh({ prerelease: true }))).toBeNull()
    expect(parseRelease(gh({ tag_name: 'nightly' }))).toBeNull()
    expect(parseRelease(null)).toBeNull()
    expect(parseRelease('x')).toBeNull()
  })
  it('asset malformado é ignorado', () => {
    const r = parseRelease(gh({ assets: [{ name: 1 }, { name: 'SHA256SUMS', browser_download_url: 'https://x/s', size: 1 }] }))!
    expect(r.assets.map((a) => a.name)).toEqual(['SHA256SUMS'])
  })
})

describe('escolha do arquivo', () => {
  const r = parseRelease(gh())!
  it('nomes por plataforma', () => {
    expect(assetName('mac-zip', '0.2.0', 'arm64')).toBe('gerenciador-de-terminal-0.2.0-mac-arm64.zip')
    expect(assetName('appimage', '0.2.0', 'x64')).toBe('gerenciador-de-terminal-0.2.0-x86_64.AppImage')
  })
  it('Mac pela arquitetura', () => {
    expect(pickAsset(r, { platform: 'darwin', arch: 'arm64', appImage: false })).toEqual({ kind: 'mac-zip', asset: r.assets[0] })
    expect(pickAsset(r, { platform: 'darwin', arch: 'x64', appImage: false })).toEqual({ kind: 'mac-zip', asset: r.assets[1] })
  })
  it('Linux: AppImage se atualiza; deb/rpm só avisam', () => {
    expect(pickAsset(r, { platform: 'linux', arch: 'x64', appImage: true })).toEqual({ kind: 'appimage', asset: r.assets[2] })
    expect(pickAsset(r, { platform: 'linux', arch: 'x64', appImage: false })).toEqual({ kind: 'notify-only' })
  })
  it('sem o arquivo da máquina ou plataforma desconhecida → null', () => {
    expect(pickAsset(r, { platform: 'linux', arch: 'arm64', appImage: true })).toBeNull()
    expect(pickAsset(r, { platform: 'win32', arch: 'x64', appImage: false })).toBeNull()
  })
})

describe('SHA256SUMS', () => {
  it('lê "hash  arquivo" (e o formato binário com *), ignora lixo', () => {
    const h = 'a'.repeat(64)
    const m = parseSums(`${h}  gerenciador-de-terminal-0.2.0-mac-arm64.zip\n${'B'.repeat(64)} *outro.AppImage\nlixo\n`)
    expect(m.get('gerenciador-de-terminal-0.2.0-mac-arm64.zip')).toBe(h)
    expect(m.get('outro.AppImage')).toBe('b'.repeat(64))
    expect(m.size).toBe(2)
  })
})
