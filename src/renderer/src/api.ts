import type { GtApi } from '../../shared/bridge'

declare global {
  interface Window {
    gt: GtApi
  }
}

export function errorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
