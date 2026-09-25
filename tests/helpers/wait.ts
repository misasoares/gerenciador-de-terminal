export async function waitFor<T>(
  fn: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  ms = 5000,
  step = 25,
): Promise<T> {
  const deadline = Date.now() + ms
  let last: unknown
  while (Date.now() < deadline) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    await new Promise((r) => setTimeout(r, step))
  }
  throw new Error(`waitFor: tempo esgotado${last ? ` (último erro: ${String(last)})` : ''}`)
}
