import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { dockFloat, hideFloat } from '../actions'
import { showError, useUi } from '../store'
import { useMotionPreset } from '../use-motion'
import { GLASS } from '../view'

/** mac: fundo sobre o vidro pode ir a 0 (o texto fica inteiro); linux: é a janela toda, com piso */
const MIN = GLASS ? 0 : 30
const NAME = GLASS ? 'Fundo' : 'Opacidade'

type Prefs = { onTop?: boolean; allDesks?: boolean; opacity?: number }

/** 📌 por cima de tudo · 🌐 em todas as mesas · ◐ fundo (vidro) · ⤓ encaixar · ✕ esconder */
export function FloatControls({ paneId }: { paneId: string }) {
  const spec = useUi((s) => s.app?.workspaces.find((w) => w.id === s.app?.workspaceId)?.floating.find((f) => f.paneId === paneId))
  const onTop = spec?.onTop ?? true
  const allDesks = spec?.allDesks ?? false
  const opacity = spec?.opacity ?? 1
  const [open, setOpen] = useState(false)
  const prefs = (p: Prefs) => window.gt.request({ t: 'float.prefs', paneId, ...p }).catch(showError)
  return (
    <span className="float-controls">
      <button className={onTop ? 'on' : ''} title="Por cima de tudo" onClick={() => prefs({ onTop: !onTop })}>
        📌
      </button>
      <button className={allDesks ? 'on' : ''} title="Em todas as mesas" onClick={() => prefs({ allDesks: !allDesks })}>
        🌐
      </button>
      <button className={opacity < 1 || open ? 'on' : ''} title={`${NAME} · ${Math.round(opacity * 100)}%`} onClick={() => setOpen((v) => !v)}>
        ◐
      </button>
      <button title="Encaixar na grade · ⇧⌘F" onClick={() => dockFloat(paneId)}>
        ⤓
      </button>
      <button title="Esconder (a sessão continua rodando)" onClick={() => void hideFloat(paneId)}>
        ✕
      </button>
      {open && <OpacityPopover value={opacity} onChange={(v) => void prefs({ opacity: v })} onClose={() => setOpen(false)} />}
    </span>
  )
}

/** no body, fixo sob o cabeçalho (o cabeçalho corta o que transborda e é contêiner de layout); Esc ou clique fora fecha */
function OpacityPopover({ value, onChange, onClose }: { value: number; onChange(v: number): void; onClose(): void }) {
  const pr = useMotionPreset()
  const ref = useRef<HTMLDivElement>(null)
  // valor local: o slider responde na hora; o daemon devolve o mesmo valor pelo estado
  const [v, setV] = useState(value)
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.('.float-controls')) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])
  const set = (n: number) => {
    setV(n)
    onChange(n)
  }
  return createPortal(
    <motion.div
      className="float-opacity"
      ref={ref}
      style={{ transformOrigin: 'top right' }}
      initial={{ opacity: 0, scale: pr.reduced ? 1 : 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={pr.enter}
    >
      <input
        type="range"
        min={MIN}
        max={100}
        step={5}
        value={Math.round(v * 100)}
        onChange={(e) => set(Number(e.target.value) / 100)}
        aria-label={`${NAME} da janela flutuante`}
        autoFocus
      />
      <span className="float-opacity-val">{Math.round(v * 100)}%</span>
    </motion.div>,
    document.body,
  )
}
