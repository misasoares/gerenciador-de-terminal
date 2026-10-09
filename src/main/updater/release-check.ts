/** sem Electron: lê a release do GitHub e decide o arquivo desta máquina */

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface Release {
  version: string
  notes: string
  htmlUrl: string
  assets: ReleaseAsset[]
}

export type ArtifactKind = 'mac-zip' | 'appimage'

const parts = (v: string): number[] | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** maior.menor.correção numérico; lança em versão inválida */
export function compareVersions(a: string, b: string): number {
  const x = parts(a)
  const y = parts(b)
  if (!x || !y) throw new Error(`versão inválida: ${x ? b : a}`)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

export function isNewer(candidate: string, current: string): boolean {
  try {
    return compareVersions(candidate, current) > 0
  } catch {
    return false
  }
}

export function parseRelease(json: unknown): Release | null {
  if (!json || typeof json !== 'object') return null
  const j = json as Record<string, unknown>
  if (j.draft || j.prerelease) return null
  const version = typeof j.tag_name === 'string' ? j.tag_name.replace(/^v/, '') : ''
  if (!parts(version)) return null
  const assets = (Array.isArray(j.assets) ? j.assets : []).flatMap((a): ReleaseAsset[] => {
    const o = a as Record<string, unknown>
    return typeof o?.name === 'string' && typeof o.browser_download_url === 'string'
      ? [{ name: o.name, url: o.browser_download_url, size: typeof o.size === 'number' ? o.size : 0 }]
      : []
  })
  return { version, notes: typeof j.body === 'string' ? j.body : '', htmlUrl: typeof j.html_url === 'string' ? j.html_url : '', assets }
}

/** nomes publicados pelo scripts/release.sh (AppImage com o nome que o electron-builder gera) */
export function assetName(kind: ArtifactKind, version: string, arch: string): string {
  return kind === 'mac-zip'
    ? `gerenciador-de-terminal-${version}-mac-${arch}.zip`
    : `gerenciador-de-terminal-${version}-${arch === 'x64' ? 'x86_64' : arch}.AppImage`
}

export function pickAsset(
  r: Release,
  o: { platform: string; arch: string; appImage: boolean },
): { kind: ArtifactKind; asset: ReleaseAsset } | { kind: 'notify-only' } | null {
  if (o.platform === 'linux' && !o.appImage) return { kind: 'notify-only' }
  const kind: ArtifactKind | null = o.platform === 'darwin' ? 'mac-zip' : o.platform === 'linux' ? 'appimage' : null
  if (!kind) return null
  const asset = r.assets.find((a) => a.name === assetName(kind, r.version, o.arch))
  return asset ? { kind, asset } : null
}

/** "<sha256>  <arquivo>" por linha (o * do modo binário do shasum é aceito) */
export function parseSums(text: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const line of text.split('\n')) {
    const r = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (r) m.set(r[2], r[1].toLowerCase())
  }
  return m
}
