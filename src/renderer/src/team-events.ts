const subs = new Set<() => void>()

export function onTeamChanged(fn: () => void): () => void {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

export function emitTeamChanged(): void {
  for (const fn of subs) fn()
}
