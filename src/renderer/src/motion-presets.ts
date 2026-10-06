import type { Transition } from 'motion/react'

export type MotionPersonality = 'subtle' | 'calm' | 'crisp' | 'lively'

export interface MotionPreset {
  enter: Transition
  exit: Transition
  /** reduzir movimento: só opacidade */
  reduced: boolean
  /** desfoque → nítido junto com a escala (premium, com GPU) */
  materialize: boolean
  /** escala inicial de modais que entram */
  scaleFrom: number
}

const OUT = [0.4, 0, 1, 1] as const
const ENTER: Record<MotionPersonality, Transition> = {
  subtle: { duration: 0.15, ease: [0.2, 0, 0, 1] },
  calm: { type: 'spring', bounce: 0, visualDuration: 0.45 },
  crisp: { type: 'spring', bounce: 0, visualDuration: 0.25 },
  lively: { type: 'spring', bounce: 0.15, visualDuration: 0.4 },
}
const EXIT_S: Record<MotionPersonality, number> = { subtle: 0.12, calm: 0.16, crisp: 0.14, lively: 0.16 }

/** personalidade do tema → transições; reduzir movimento vira esmaecimento curto */
export function presetsFor(p: MotionPersonality, o: { reduced: boolean; gpu: boolean }): MotionPreset {
  if (o.reduced) {
    const fade: Transition = { duration: 0.12, ease: 'linear' }
    return { enter: fade, exit: fade, reduced: true, materialize: false, scaleFrom: 1 }
  }
  return {
    enter: ENTER[p],
    exit: { duration: EXIT_S[p], ease: [...OUT] },
    reduced: false,
    materialize: p !== 'subtle' && o.gpu,
    scaleFrom: p === 'subtle' ? 0.96 : 0.9,
  }
}
