import { useEffect, useState } from 'react'
import type React from 'react'
import { BUNDLED_BACKGROUNDS, type AppThemeId, type Background } from '../../../shared/settings'
import { mediaUrl } from '../../../shared/media'
import { APP_THEMES } from '../app-themes'
import { refreshBackgrounds } from '../appearance'
import { showError } from '../store'

const same = (a: Background, b: Background) => JSON.stringify(a) === JSON.stringify(b)

/** fundos do tema premium: tema, nenhum, as 2 incluídas, as do usuário, escolher imagem, mesa do macOS */
export function BackgroundRow({ theme, value, onChange }: { theme: AppThemeId; value: Background; onChange(b: Background): void }) {
  const t = APP_THEMES[theme]
  const [user, setUser] = useState<{ dir: string; list: string[] }>({ dir: '', list: [] })
  const load = () => window.gt.backgrounds().then(setUser).catch(showError)
  useEffect(() => {
    void load()
  }, [])
  const opts: { b: Background; label: string; style: React.CSSProperties; user?: string }[] = [
    { b: { kind: 'theme' }, label: 'Tema', style: { background: t.tokens['app-backdrop'] } },
    { b: { kind: 'none' }, label: 'Nenhum', style: { background: t.tokens.bg } },
    ...BUNDLED_BACKGROUNDS.filter((id) => id.startsWith(`${theme}-`)).map((id) => ({
      b: { kind: 'image', image: `bundled:${id}` } as Background,
      label: id.endsWith('1') ? 'Imagem 1' : 'Imagem 2',
      style: { background: `url("./fundos/${id}.jpg") center / cover` },
    })),
    ...user.list.map((n) => ({
      b: { kind: 'image', image: `user:${n}` } as Background,
      label: 'Sua imagem',
      user: n,
      style: { background: `url("${mediaUrl(`${user.dir}/${n}`, 0)}") center / cover` },
    })),
  ]
  const remove = async (name: string, b: Background) => {
    await window.gt.removeBackground(name).catch(showError)
    if (same(b, value)) onChange({ kind: 'theme' })
    await load()
    await refreshBackgrounds()
  }
  const pickImage = async () => {
    const name = await window.gt.importBackground().catch((e) => (showError(e), null))
    if (!name) return
    await load()
    await refreshBackgrounds()
    onChange({ kind: 'image', image: `user:${name}` })
  }
  return (
    <div className="bg-row">
      {opts.map((o) => (
        <div key={JSON.stringify(o.b)} className={`bg-opt${same(o.b, value) ? ' selected' : ''}`}>
          <button className="bg-thumb" style={o.style} title={o.label} onClick={() => onChange(o.b)} />
          {o.user && (
            <button className="bg-x" title="Remover imagem" onClick={() => void remove(o.user!, o.b)}>
              ✕
            </button>
          )}
          <span>{o.label}</span>
        </div>
      ))}
      <div className="bg-opt">
        <button className="bg-thumb bg-add" title="Escolher imagem…" onClick={() => void pickImage()}>
          ＋
        </button>
        <span>Escolher imagem…</span>
      </div>
      {window.gt.platform === 'darwin' && (
        <div className={`bg-opt${value.kind === 'desktop' ? ' selected' : ''}`}>
          <button className="bg-thumb bg-desktop" title="Mesa do macOS (vidro sobre a sua área de trabalho)" onClick={() => onChange({ kind: 'desktop' })}>
            ◎
          </button>
          <span>Mesa do macOS</span>
        </div>
      )}
    </div>
  )
}
