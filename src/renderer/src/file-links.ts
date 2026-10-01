export interface PathCandidate {
  text: string
  path: string
  line: number | null
  start: number
  end: number
}

const EXT = /\.(md|mdx|txt|env|json|jsonc|ya?ml|toml|ini|cfg|conf|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|hpp|cs|php|sh|zsh|bash|sql|html|css|scss|xml|csv|log|lock|gradle|properties|dart|vue|svelte|tf)$/i
const TRAIL = /[.,:;)!?\]}>'"]+$/
const LEAD = /^[(\[{<'"]+/

function looksLikePath(p: string): boolean {
  if (!p || /^[.\/]+$/.test(p)) return false
  if (/:\/\//.test(p) || /^www\./i.test(p)) return false
  if (/^v?\d+(\.\d+)+$/i.test(p)) return false
  if (/^(e\.g|i\.e|etc)\.?$/i.test(p)) return false
  const base = p.split('/').pop() ?? p
  if (/^\.env(\..+)?$/.test(base)) return true
  if (p.includes('/') && /[A-Za-z0-9_]/.test(base)) return true
  return EXT.test(base)
}

function make(raw: string, offset: number): PathCandidate | null {
  const lead = raw.match(LEAD)?.[0].length ?? 0
  let text = raw.slice(lead)
  text = text.replace(TRAIL, '')
  const m = text.match(/^(.*?)(?::(\d+))?(?::\d+)?$/)
  const p = m?.[1] ?? text
  if (!looksLikePath(p)) return null
  const start = offset + lead
  return { text, path: p, line: m?.[2] ? Number(m[2]) : null, start, end: start + text.length }
}

export function findPathCandidates(line: string): PathCandidate[] {
  const out: PathCandidate[] = []
  const taken: [number, number][] = []
  for (const m of line.matchAll(/(["'`])([^"'`]+?)\1/g)) {
    const inner = m[2]
    if (!inner.includes(' ')) continue // sem espaço, o passo seguinte acha
    const c = make(inner, m.index! + 1)
    if (c) {
      out.push(c)
      taken.push([m.index!, m.index! + m[0].length])
    }
  }
  for (const m of line.matchAll(/[^\s]+/g)) {
    const s = m.index!
    if (taken.some(([a, b]) => s >= a && s < b)) continue
    if (/^\w+:\/\//.test(m[0].replace(LEAD, ''))) continue
    const c = make(m[0], s)
    if (c) out.push(c)
  }
  return out.sort((a, b) => a.start - b.start)
}
