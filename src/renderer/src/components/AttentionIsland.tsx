import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { revealPane } from '../actions'
import { enqueue, onIsland, type IslandItem } from '../island-queue'
import { useMotionPreset } from '../use-motion'

/** "dev-1 precisa de você": cresce no topo-centro, fica 2,5 s, recolhe; clicar leva à sessão; uma por vez */
export function AttentionIsland() {
  const pr = useMotionPreset()
  const [queue, setQueue] = useState<IslandItem[]>([])
  useEffect(() => onIsland((it) => setQueue((q) => enqueue(q, it))), [])
  const cur = queue[0]
  useEffect(() => {
    if (!cur) return
    const t = setTimeout(() => setQueue((q) => q.slice(1)), 2500)
    return () => clearTimeout(t)
  }, [cur])
  return (
    <AnimatePresence>
      {cur && (
        <motion.button
          key={cur.paneId}
          className="island"
          onClick={() => {
            revealPane(cur.paneId)
            setQueue((q) => q.slice(1))
          }}
          initial={{ opacity: 0, scale: pr.reduced ? 1 : 0.4 }}
          animate={{ opacity: 1, scale: 1, transition: pr.enter }}
          exit={{ opacity: 0, scale: pr.reduced ? 1 : 0.6, transition: pr.exit }}
        >
          <span className="island-dot" />
          {cur.label} precisa de você
        </motion.button>
      )}
    </AnimatePresence>
  )
}
