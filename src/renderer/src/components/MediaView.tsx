import type { RefObject } from 'react'
import { mediaUrl, type MediaKind } from '../../../shared/media'

/** imagem (ajustar ↔ 100%), vídeo e áudio com controles nativos, pdf no visualizador do Chromium */
export function MediaView(o: {
  kind: MediaKind
  path: string
  /** muda quando o arquivo muda no disco: recarrega sem cache */
  version: number
  fit: boolean
  onToggleFit(): void
  /** vídeo/áudio: quem chama olha se está tocando antes de recarregar */
  playerRef: RefObject<HTMLMediaElement | null>
  onError(): void
}) {
  const src = mediaUrl(o.path, o.version)
  if (o.kind === 'image') {
    return (
      <div className={`media-box media-image ${o.fit ? 'fit' : 'actual'}`} onClick={o.onToggleFit} title={o.fit ? 'Clique: tamanho real' : 'Clique: ajustar ao painel'}>
        <img src={src} alt="" draggable={false} onError={o.onError} />
      </div>
    )
  }
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
