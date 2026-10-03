/** aspas simples para o shell: nada dentro é interpretado; ' vira '"'"' */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`
}
