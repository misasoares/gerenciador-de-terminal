export type IslandItem = { paneId: string; label: string }

/** fila da ilha: ordem de chegada, sem repetir uma sessão que já está esperando */
export function enqueue(q: IslandItem[], it: IslandItem): IslandItem[] {
  return q.some((x) => x.paneId === it.paneId) ? q : [...q, it]
}

const subs = new Set<(it: IslandItem) => void>()
export function onIsland(fn: (it: IslandItem) => void): () => void {
  subs.add(fn)
  return () => void subs.delete(fn)
}
export function showIsland(it: IslandItem): void {
  for (const f of subs) f(it)
}
