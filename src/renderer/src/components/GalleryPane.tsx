import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { dropOnPane, floatPane, focusPane, PANE_MIME, requestCloseFile } from '../actions'
import { FloatControls } from './FloatControls'
import { MediaView } from './MediaView'
import { mediaKind } from '../../../shared/media'
import { dropZone, type DropZone } from '../layout'
import { onFileChanged } from '../file-events'
import { baseName } from '../file-model'
import { gridColumns, groupTitle, stepGroup } from '../gallery-model'
import { useUi } from '../store'

/** uma mídia da comparação: rótulo em cima, ajustar ↔ zoom com arraste, recarrega quando muda no disco */
function Cell({ path, label }: { path: string; label: string | null }) {
  const kind = mediaKind(path)
  const [version, setVersion] = useState(0)
  const [fit, setFit] = useState(true)
  const [problem, setProblem] = useState<null | 'missing' | 'cannot-open'>(null)
  const player = useRef<HTMLMediaElement | null>(null)
  useEffect(() => {
    setProblem(null)
    void window.gt.request({ t: 'file.watch', path })
    const off = onFileChanged(path, (m) => {
      if (m === null) return setProblem('missing')
      if (player.current && !player.current.paused) return
      setProblem(null)
      setVersion(m)
    })
    return () => {
      off()
      void window.gt.request({ t: 'file.unwatch', path })
    }
  }, [path])
  return (
    <div className="gallery-cell">
      <div className="gallery-label" title={path}>{label ?? baseName(path)}</div>
      {problem || !kind ? (
        <div className="pane-dead">
          <div className="pane-dead-title">{problem === 'missing' ? 'Arquivo não encontrado' : 'Não dá para mostrar aqui'}</div>
        </div>
      ) : (
        <MediaView kind={kind} path={path} version={version} fit={fit} onFitChange={setFit} alignTop playerRef={player} onError={() => setProblem('cannot-open')} />
      )}
    </div>
  )
}

/** comparação aberta pelo agente (abrir_midia): um grupo por vez, lado a lado; ← → trocam, Esc fecha */
export function GalleryPane({ paneId, floating }: { paneId: string; floating?: boolean }) {
  const gallery = useUi((s) => s.app?.filePanes[paneId]?.gallery)
  const focused = useUi((s) => s.focusedPaneId === paneId)
  const root = useRef<HTMLDivElement>(null)
  const [i, setI] = useState(0)
  const [zone, setZone] = useState<DropZone | null>(null)
  const zoneAt = (e: React.DragEvent<HTMLDivElement>): DropZone => {
    const r = e.currentTarget.getBoundingClientRect()
    return dropZone((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }
  // conteúdo novo (o agente chamou de novo): volta ao primeiro grupo
  const key = JSON.stringify(gallery?.groups ?? [])
  useEffect(() => setI(0), [key])
  useEffect(() => {
    if (focused) root.current?.focus()
  }, [focused])
  if (!gallery) return null
  const total = gallery.groups.length
  const at = Math.min(i, total - 1)
  const group = gallery.groups[at]
  const go = (d: 1 | -1) => setI(stepGroup(at, d, total))

  return (
    <div
      ref={root}
      tabIndex={0}
      className={`pane file-pane gallery-pane${focused ? ' focused' : ''}`}
      onMouseDown={() => focusPane(paneId)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(-1)
        else if (e.key === 'ArrowRight') go(1)
        else if (e.key === 'Escape') void requestCloseFile(paneId)
        else return
        e.preventDefault()
      }}
      onDragOver={(e) => {
        if (floating || !e.dataTransfer.types.includes(PANE_MIME)) return
        e.preventDefault()
        setZone(zoneAt(e))
      }}
      onDragLeave={() => setZone(null)}
      onDrop={(e) => {
        const dragged = e.dataTransfer.getData(PANE_MIME)
        setZone(null)
        if (floating || !dragged || dragged === paneId) return
        e.preventDefault()
        dropOnPane(dragged, paneId, zoneAt(e))
      }}
    >
      {zone && <div className={`drop-zone drop-${zone}`} />}
      <div
        className={`pane-header file-header${floating ? ' float-drag' : ''}`}
        draggable={!floating}
        onDragStart={(e) => !floating && e.dataTransfer.setData(PANE_MIME, paneId)}
      >
        <span className="file-name">🖼 {groupTitle(gallery, at)}</span>
        {total > 1 && (
          <span className="gallery-nav">
            <button className="st-btn" title="Anterior · ←" disabled={at === 0} onClick={() => go(-1)}>‹</button>
            <span className="file-path">{at + 1} / {total}</span>
            <button className="st-btn" title="Próximo · →" disabled={at === total - 1} onClick={() => go(1)}>›</button>
          </span>
        )}
        <span className="ph-spacer" />
        {floating ? (
          <FloatControls paneId={paneId} />
        ) : (
          <>
            <button className="ph-close" title="Flutuar · ⇧⌘F" onClick={() => floatPane(paneId)}>
              ⧉
            </button>
            <button className="ph-close" title="Fechar · Esc" onClick={() => void requestCloseFile(paneId)}>
              ✕
            </button>
          </>
        )}
      </div>
      <div className="gallery-grid" style={{ gridTemplateColumns: `repeat(${gridColumns(group.length)}, minmax(0, 1fr))` }}>
        {group.map((p, j) => (
          <Cell key={`${at}:${j}:${p}`} path={p} label={gallery.labels?.[j] ?? null} />
        ))}
      </div>
    </div>
  )
}
