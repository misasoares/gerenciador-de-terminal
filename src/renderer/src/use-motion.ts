import { useReducedMotion } from 'motion/react'
import { presetsFor, type MotionPreset } from './motion-presets'
import { useUi } from './store'
import { GPU_OK } from './view'

/** transições do tema atual (com reduzir movimento e sem desfoque animado quando não há GPU) */
export function useMotionPreset(): MotionPreset {
  const p = useUi((s) => s.motion)
  const reduced = useReducedMotion() ?? false
  return presetsFor(p, { reduced, gpu: GPU_OK })
}
