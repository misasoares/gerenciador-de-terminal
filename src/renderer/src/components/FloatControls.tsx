import { dockFloat, hideFloat } from '../actions'
import { showError, useUi } from '../store'

/** 📌 por cima de tudo · 🌐 em todas as mesas · ⤓ encaixar · ✕ esconder */
export function FloatControls({ paneId }: { paneId: string }) {
  const spec = useUi((s) => s.app?.workspaces.find((w) => w.id === s.app?.workspaceId)?.floating.find((f) => f.paneId === paneId))
  const onTop = spec?.onTop ?? true
  const allDesks = spec?.allDesks ?? false
  const prefs = (p: { onTop?: boolean; allDesks?: boolean }) => window.gt.request({ t: 'float.prefs', paneId, ...p }).catch(showError)
  return (
    <span className="float-controls">
      <button className={onTop ? 'on' : ''} title="Por cima de tudo" onClick={() => prefs({ onTop: !onTop })}>
        📌
      </button>
      <button className={allDesks ? 'on' : ''} title="Em todas as mesas" onClick={() => prefs({ allDesks: !allDesks })}>
        🌐
      </button>
      <button title="Encaixar na grade · ⇧⌘F" onClick={() => dockFloat(paneId)}>
        ⤓
      </button>
      <button title="Esconder (a sessão continua rodando)" onClick={() => void hideFloat(paneId)}>
        ✕
      </button>
    </span>
  )
}
