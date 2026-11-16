import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'
import { dropOnPane, floatPane, focusPane, PANE_MIME, requestCloseFile } from '../actions'
import { FloatControls } from './FloatControls'
import { MediaView } from './MediaView'
import { mediaKind } from '../../../shared/media'
import { dropZone, type DropZone } from '../layout'
import { onFileChanged } from '../file-events'
import { baseName } from '../file-model'
import { bestColumns, groupTitle, stepGroup, type GridMetrics } from '../gallery-model'
import { useUi } from '../store'

/** uma mídia da comparação: rótulo em cima, ajustar ↔ zoom com arraste, recarrega quando muda no disco */
function Cell({ path, label, onAspect }: { path: string; label: string | null; onAspect(aspect: number): void }) {
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
        <MediaView kind={kind} path={path} version={version} fit={fit} onFitChange={setFit} alignTop playerRef={player} onError={() => setProblem('cannot-open')} onSize={(s) => s.w > 0 && s.h > 0 && onAspect(s.w / s.h)} />
      )}
    </div>
  )
}

/** precisa bater com .gallery-grid / .gallery-label no styles.css */
const GRID: GridMetrics = { gap: 6, pad: 6, label: 22 }

/** comparação aberta pelo agente (abrir_midia): um grupo por vez, em colunas e linhas que deixam as mídias maiores; ← → trocam, Esc fecha */
export function GalleryPane({ paneId, floating }: { paneId: string; floating?: boolean }) {
  const gallery = useUi((s) => s.app?.filePanes[paneId]?.gallery)
  const focused = useUi((s) => s.focusedPaneId === paneId)
  const root = useRef<HTMLDivElement>(null)
  const [i, setI] = useState(0)
  const [zone, setZone] = useState<DropZone | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  // largura ÷ altura de cada mídia, por caminho (vídeo/pdf/áudio sem medida ficam no 16:9)
  const [aspects, setAspects] = useState<Record<string, number>>({})
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
  // encaixado, flutuante ou janela redimensionada: a grade se refaz pelo tamanho atual
  useLayoutEffect(() => {
    const el = grid.current
    if (!el) return
    const measure = () => setBox((b) => (b.w === el.clientWidth && b.h === el.clientHeight ? b : { w: el.clientWidth, h: el.clientHeight }))
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [!!gallery])
  if (!gallery) return null
  const total = gallery.groups.length
  const at = Math.min(i, total - 1)
  const group = gallery.groups[at]
  const go = (d: 1 | -1) => setI(stepGroup(at, d, total))
  const layout = gallery.layout ?? 'auto'
  const cols = layout === 'lado_a_lado' ? group.length : layout === 'empilhado' ? 1 : bestColumns(group.map((p) => aspects[p] ?? null), box, GRID)
  const setAspect = (p: string, a: number) => setAspects((m) => (Math.abs((m[p] ?? 0) - a) < 0.001 ? m : { ...m, [p]: a }))

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
      <div ref={grid} className="gallery-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {group.map((p, j) => (
          <Cell key={`${at}:${j}:${p}`} path={p} label={gallery.labels?.[j] ?? null} onAspect={(a) => setAspect(p, a)} />
        ))}
      </div>
    </div>
  )
}
