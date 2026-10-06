import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { motion, useIsPresent } from 'motion/react'
import { useMotionPreset } from '../use-motion'
import { lastPointer, originFor } from '../pointer'

/** fundo + caixa do modal: nasce da origem (clique) e volta para ela; premium materializa */
export function ModalFrame(p: {
  /** clique no fundo (ausente = o fundo não fecha) */
  onClose?: () => void
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  className?: string
  backdropClassName?: string
  children: ReactNode
}) {
  const pr = useMotionPreset()
  const present = useIsPresent()
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = box.current
    if (el) el.style.transformOrigin = originFor(lastPointer(), performance.now(), el.getBoundingClientRect())
  }, [])
  const hidden = { opacity: 0, scale: pr.scaleFrom, filter: pr.materialize ? 'blur(12px)' : 'blur(0px)' }
  return (
    <div
      className={`modal-backdrop${p.backdropClassName ? ` ${p.backdropClassName}` : ''}`}
      // saindo: não segura cliques nem teclado de quem está atrás
      style={present ? undefined : { pointerEvents: 'none' }}
      onMouseDown={p.onClose}
    >
      {/* o escurecido é uma camada à parte: opacidade no ancestral da caixa cortaria o vidro (backdrop-filter) dela */}
      <motion.div className="modal-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: pr.enter }} exit={{ opacity: 0, transition: pr.exit }} />
      <motion.div
        ref={box}
        className={p.className ?? 'modal'}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={p.onKeyDown}
        initial={hidden}
        // no fim, filter some (blur(0px) parado ainda força camada e atrapalha o vidro)
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transition: pr.enter, transitionEnd: { filter: 'none' } }}
        exit={{ ...hidden, scale: pr.reduced ? 1 : 0.96, transition: pr.exit }}
      >
        {p.children}
      </motion.div>
    </div>
  )
}
