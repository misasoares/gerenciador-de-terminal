import { useMemo, useState } from 'react'
import { resumeAll, restartDaemonFlow } from '../flows'
import { hidePane } from '../actions'
import { setUi, showError, useUi } from '../store'
import { usageChips } from '../usage-model'

/** 2l: avisos não intrusivos na barra de status inferior */
export function StatusBar() {
  const app = useUi((s) => s.app)
  const connected = useUi((s) => s.connected)
  const vm = useUi((s) => s.versionMismatch)
  const error = useUi((s) => s.error)
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({})
  if (!app) return null
  const alive = app.panes.filter((p) => p.alive).length
  const dismiss = (k: string) => setDismissed((d) => ({ ...d, [k]: true }))

  return (
    <div className="statusbar">
      <span>{alive === 1 ? '1 sessão' : `${alive} sessões`}</span>
      {!connected && <span className="st-item warn">↻ reconectando…</span>}
      {app.resumable.length > 0 && (
        <span className="st-item">
          {app.resumable.length === 1 ? '1 sessão para retomar' : `${app.resumable.length} sessões para retomar`}{' '}
          <button className="st-btn" onClick={() => void resumeAll()}>
            Retomar todas
          </button>
          <button
            className="st-btn"
            onClick={() =>
              app.resumable.forEach((r) => {
                hidePane(r.paneId)
                window.gt.send({ t: 'resume.dismiss', paneId: r.paneId })
              })
            }
          >
            Descartar
          </button>
        </span>
      )}
      {vm && !dismissed.vm && (
        <span className="st-item">
          ⓘ daemon {vm.daemon} · app {vm.app}{' '}
          <button className="st-btn" onClick={() => void restartDaemonFlow()}>
            Reiniciar daemon quando eu quiser
          </button>
          <button className="st-x" onClick={() => dismiss('vm')}>
            ✕
          </button>
        </span>
      )}
      {error && (
        <span className="st-item error">
          {error}{' '}
          <button className="st-x" onClick={() => setUi({ error: null })}>
            ✕
          </button>
        </span>
      )}
      <span className="st-spacer" />
      {usageChips(app, Date.now()).map((c) => (
        <span key={c.key} className={`st-usage${c.dim ? ' u-dim' : ''}`} title={c.tooltip}>
          <span style={{ color: c.color }}>{c.label}</span>
          {c.unavailable ? (
            <span className="u-dim">indisponível</span>
          ) : (
            c.parts.map((p, i) => (
              <span key={i} className={p.level === 'bad' ? 'u-bad' : p.level === 'warn' ? 'u-warn' : undefined}>
                {i > 0 ? '· ' : ''}
                {p.text}
              </span>
            ))
          )}
        </span>
      ))}
    </div>
  )
}
