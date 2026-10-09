import path from 'node:path'
import type { UpdateStatus } from '../../shared/update'
import { downloadVerified, pruneVersions, type Fetch } from './download'
import { isNewer, parseRelease, parseSums, pickAsset, type ArtifactKind } from './release-check'

export interface ReadyArtifact {
  version: string
  kind: ArtifactKind
  file: string
}

export interface UpdaterDeps {
  current: string
  platform: string
  arch: string
  appImage: boolean
  updatesDir: string
  apiUrl: string
  fetch: Fetch
  /** a pasta do bundle (Mac) ou do AppImage aceita a troca */
  canWrite(): boolean
  onStatus(s: UpdateStatus): void
}

/** verifica a release, baixa em segundo plano e guarda o arquivo pronto; falhas de rede ficam em silêncio */
export class Updater {
  status: UpdateStatus = { kind: 'idle' }
  ready: ReadyArtifact | null = null
  private running: Promise<void> | null = null
  /** versão que acabou de falhar: não é oferecida de novo nesta execução (só uma mais nova) */
  private failed: string | null = null

  constructor(private d: UpdaterDeps) {}

  check(): Promise<void> {
    if (!this.running) {
      this.running = this.run()
        .catch((e) => console.error('atualização: verificação falhou', e))
        .finally(() => {
          this.running = null
        })
    }
    return this.running
  }

  setFailed(to: string, current: string): void {
    this.failed = to
    this.set({ kind: 'failed-last', to, current })
  }

  private async run(): Promise<void> {
    const res = await this.d.fetch(this.d.apiUrl, { headers: { accept: 'application/vnd.github+json' } })
    if (!res.ok) return
    const r = parseRelease(await res.json())
    if (!r || !isNewer(r.version, this.d.current) || this.ready?.version === r.version || r.version === this.failed) return
    const pick = pickAsset(r, this.d)
    if (!pick) return
    if (pick.kind === 'notify-only') return this.set({ kind: 'notify-only', version: r.version, notes: r.notes, url: r.htmlUrl })
    if (!this.d.canWrite()) return this.set({ kind: 'blocked', version: r.version, reason: 'not-writable' })
    const sumsAsset = r.assets.find((a) => a.name === 'SHA256SUMS')
    if (!sumsAsset) return
    const sres = await this.d.fetch(sumsAsset.url, { redirect: 'follow' })
    if (!sres.ok) return
    const sha256 = parseSums(await sres.text()).get(pick.asset.name)
    if (!sha256) return
    const file = await downloadVerified({ fetch: this.d.fetch, url: pick.asset.url, dir: path.join(this.d.updatesDir, r.version), name: pick.asset.name, sha256 })
    pruneVersions(this.d.updatesDir, r.version)
    this.ready = { version: r.version, kind: pick.kind, file }
    this.set({ kind: 'ready', version: r.version, notes: r.notes })
  }

  private set(s: UpdateStatus): void {
    this.status = s
    this.d.onStatus(s)
  }
}
