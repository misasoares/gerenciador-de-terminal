import { useMemo, useState } from 'react'
import { chooseConversationFor, openReleaseNotes, resumeAll, restartDaemonFlow, runUpdateAction } from '../flows'
import { updateItem } from '../update-model'
import { hidePane } from '../actions'
import { setUi, showError, useUi } from '../store'
import { usageChips } from '../usage-model'
import { liveMissing } from '../conversations-model'
import { MachineChip } from './MachineChip'

/** 2l: avisos não intrusivos na barra de status inferior */
export function StatusBar() {
  const app = useUi((s) => s.app)
  const connected = useUi((s) => s.connected)
  const vm = useUi((s) => s.versionMismatch)
  const error = useUi((s) => s.error)
  const missingAll = useUi((s) => s.missingResume)
  const desktopMismatch = useUi((s) => s.desktopMismatch)
  const update = useUi((s) => s.update)
  const updateNotice = useUi((s) => s.updateNotice)
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({})
  if (!app) return null
  // calculado no render (não no seletor): o seletor precisa devolver sempre a mesma referência
  const missing = liveMissing(missingAll, app.resumable)
  const alive = app.panes.filter((p) => p.alive).length
  const dismiss = (k: string) => setDismissed((d) => ({ ...d, [k]: true }))
  const upd = updateItem(update, window.gt.platform)

  return (
    <div className="statusbar">
      <span>{alive === 1 ? '1 sessão' : `${alive} sessões`}</span>
      {upd && !dismissed['upd:' + upd.text] && (
        <span className={`st-item${upd.tone === 'warn' ? ' warn' : ''}`}>
          {upd.text}{' '}
          {upd.action && (
            <button className="st-btn" onClick={() => runUpdateAction(update)}>
              {upd.action.label}
            </button>
          )}
          {upd.notes && (
            <button className="st-btn" onClick={() => openReleaseNotes(update)}>
              Ver novidades
            </button>
          )}
          {!upd.action && (
            <button className="st-x" onClick={() => dismiss('upd:' + upd.text)}>
              ✕
            </button>
          )}
        </span>
      )}
      {updateNotice && (
        <span className="st-item">
          {updateNotice}{' '}
          <button className="st-x" onClick={() => setUi({ updateNotice: null })}>
            ✕
          </button>
        </span>
      )}
        {!connected && <span className="st-item warn">↻ reconectando…</span>}
      {desktopMismatch && (
        <span className="st-item warn">
          O fundo mudou ·{' '}
          <button className="st-btn" onClick={() => void window.gt.reopenWindows().catch(showError)}>
            Reabrir janelas
          </button>
        </span>
      )}
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
      {missing.length > 0 && (
        <span className="st-item warn">
          {missing.length === 1 ? '1 conversa não encontrada' : `${missing.length} conversas não encontradas`}{' '}
          <button className="st-btn" onClick={() => chooseConversationFor(missing[0])}>
            Escolher
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
      <MachineChip />
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
