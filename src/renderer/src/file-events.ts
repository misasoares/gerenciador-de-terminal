const subs = new Map<string, Set<(mtimeMs: number | null) => void>>()

export function onFileChanged(path: string, fn: (mtimeMs: number | null) => void): () => void {
  let set = subs.get(path)
  if (!set) subs.set(path, (set = new Set()))
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (set!.size === 0) subs.delete(path)
  }
}

export function emitFileChanged(path: string, mtimeMs: number | null): void {
  for (const fn of subs.get(path) ?? []) fn(mtimeMs)
}
