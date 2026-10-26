import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type React from 'react'
import { mediaUrl, type MediaKind } from '../../../shared/media'
import { fitView, isFit, panBy, zoomTo, type Size, type ZoomView } from '../image-zoom'

/** imagem (ajustar ↔ zoom com arraste), vídeo e áudio com controles nativos, pdf no visualizador do Chromium */
export function MediaView(o: {
  kind: MediaKind
  path: string
  /** muda quando o arquivo muda no disco: recarrega sem cache */
  version: number
  /** imagem: ajustada ao painel; quem chama troca para pedir ajustar ↔ 100% e é avisado quando o zoom muda */
  fit: boolean
  onFitChange(fit: boolean): void
  /** imagem ajustada colada no topo (galeria: logo abaixo do rótulo) */
  alignTop?: boolean
  /** vídeo/áudio: quem chama olha se está tocando antes de recarregar */
  playerRef: RefObject<HTMLMediaElement | null>
  onError(): void
}) {
  const src = mediaUrl(o.path, o.version)
  if (o.kind === 'image') return <ImageView src={src} fit={o.fit} onFitChange={o.onFitChange} alignTop={!!o.alignTop} onError={o.onError} />
  if (o.kind === 'video') {
    return (
      <div className="media-box media-video">
        <video ref={o.playerRef as RefObject<HTMLVideoElement>} src={src} controls preload="metadata" onError={o.onError} />
      </div>
    )
  }
  if (o.kind === 'audio') {
    return (
      <div className="media-box media-audio">
        <audio ref={o.playerRef as RefObject<HTMLAudioElement>} src={src} controls preload="metadata" onError={o.onError} />
      </div>
    )
  }
  return <iframe className="media-pdf" src={src} title={o.path} />
}

/** até onde o ponteiro anda e ainda conta como clique (não arraste) */
const CLICK_SLOP = 4

/** pinça ou ⌘/Ctrl + roda: zoom no cursor · roda ou arraste: anda pela imagem · clique: ajustar ↔ 100% */
function ImageView(o: { src: string; fit: boolean; onFitChange(fit: boolean): void; alignTop: boolean; onError(): void }) {
  const box = useRef<HTMLDivElement>(null)
  const [boxSize, setBoxSize] = useState<Size>({ w: 0, h: 0 })
  const [img, setImg] = useState<Size | null>(null)
  const [view, setView] = useState<ZoomView | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null)
  const top = o.alignTop
  const fitted = !view || !img || isFit(view, boxSize, img)
  // os ouvintes nativos (roda) leem o estado atual daqui
  const live = useRef({ boxSize, img, view, fitted, onFitChange: o.onFitChange, top })
  live.current = { boxSize, img, view, fitted, onFitChange: o.onFitChange, top }

  const apply = (v: ZoomView) => {
    const { boxSize: b, img: i } = live.current
    if (!i) return
    setView(v)
    const f = isFit(v, b, i)
    if (f !== live.current.fitted) live.current.onFitChange(f)
  }

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setBoxSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBoxSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // painel mudou de tamanho: ajustada continua ajustada; com zoom, só segura dentro dos limites
  useLayoutEffect(() => {
    if (!img || boxSize.w === 0) return
    setView((v) => (!v || isFit(v, boxSize, img) ? fitView(boxSize, img, top) : zoomTo(v, v.scale, { x: 0, y: 0 }, boxSize, img, top)))
  }, [boxSize, img, top])

  // pedido de fora (botão 100% / Ajustar do cabeçalho)
  useEffect(() => {
    if (!img || !view || o.fit === fitted) return
    setView(o.fit ? fitView(boxSize, img, top) : zoomTo(view, 1, { x: boxSize.w / 2, y: boxSize.h / 2 }, boxSize, img, top))
    // só reage ao pedido; o resto entra pelo live
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.fit])

  // roda precisa de preventDefault (sem rolar o painel nem dar zoom na janela): ouvinte nativo não passivo
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const { boxSize: b, img: i, view: v, fitted: f } = live.current
      if (!i || !v) return
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        // pinça do trackpad chega como ctrl+roda com passos pequenos; a roda do mouse, com passos grandes
        const step = Math.max(-50, Math.min(50, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY))
        apply(zoomTo(v, v.scale * Math.exp(-step * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top }, b, i, live.current.top))
      } else if (!f) {
        e.preventDefault()
        apply(panBy(v, -e.deltaX, -e.deltaY, b, i, live.current.top))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, moved: 0 }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || !img) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    d.x = e.clientX
    d.y = e.clientY
    d.moved += Math.abs(dx) + Math.abs(dy)
    if (fitted) return
    if (d.moved > CLICK_SLOP) setDragging(true)
    // vários movimentos podem chegar antes do próximo render: anda a partir do estado mais novo
    setView((cur) => cur && panBy(cur, dx, dy, boxSize, img, top))
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    if (!d || d.moved > CLICK_SLOP || !img || !view) return
    // clique: ajustada amplia para 100% no ponto clicado; com zoom, volta a ajustar
    const r = e.currentTarget.getBoundingClientRect()
    apply(fitted ? zoomTo(view, Math.max(1, view.scale * 2), { x: e.clientX - r.left, y: e.clientY - r.top }, boxSize, img, top) : fitView(boxSize, img, top))
  }

  const v = view ?? { scale: 1, x: 0, y: 0 }
  return (
    <div
      ref={box}
      className={`media-box media-image ${fitted ? 'fit' : dragging ? 'zoomed dragging' : 'zoomed'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null
        setDragging(false)
      }}
      title={fitted ? 'Clique ou pinça: ampliar' : 'Arraste para andar · pinça ou ⌘ + roda: zoom · clique: ajustar'}
    >
      <img
        src={o.src}
        alt=""
        draggable={false}
        onError={o.onError}
        onLoad={(e) => setImg({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        style={
          img && view
            ? { left: v.x, top: v.y, width: img.w * v.scale, height: img.h * v.scale, imageRendering: v.scale >= 4 ? 'pixelated' : undefined }
            : { visibility: 'hidden' }
        }
      />
      {!fitted && <span className="media-zoom">{Math.round(v.scale * 100)}%</span>}
    </div>
  )
}
