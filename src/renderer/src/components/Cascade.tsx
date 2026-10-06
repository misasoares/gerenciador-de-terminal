import { useEffect, useRef } from 'react'
import { motion, type HTMLMotionProps } from 'motion/react'
import { useMotionPreset } from '../use-motion'

/** a cascata vale só para a primeira leva de itens (ao abrir); filtrar depois não refaz */
export function useCascade(count: number): boolean {
  const armed = useRef(true)
  useEffect(() => {
    if (count > 0) armed.current = false
  }, [count])
  return armed.current
}

/** item de lista: os 8 primeiros entram um após o outro (35 ms), o resto aparece de uma vez */
export function CascadeItem({ i, on, ...rest }: { i: number; on: boolean } & HTMLMotionProps<'div'>) {
  const pr = useMotionPreset()
  const go = on && i < 8
  return (
    <motion.div
      {...rest}
      initial={go ? { opacity: 0, y: pr.reduced ? 0 : 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...pr.enter, delay: go ? i * 0.035 : 0 }}
    />
  )
}
