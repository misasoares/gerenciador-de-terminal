/** nome de espaço: obrigatório; repetido ganha " 2", " 3"… */
export function uniqueName(name: string, taken: string[]): string {
  const base = name.trim()
  if (!base) throw new Error('nome obrigatório')
  if (!taken.includes(base)) return base
  let n = 2
  while (taken.includes(`${base} ${n}`)) n++
  return `${base} ${n}`
}
