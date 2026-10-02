import path from 'node:path'
import type { HookPayload } from '../shared/types'

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite', 'Task', 'AskUserQuestion'])

function normalize(p: string, cwd: string, home: string): string {
  const expanded = p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p
  return path.resolve(cwd, expanded)
}

const unquote = (s: string) => s.replace(/^(['"])(.*)\1$/, '$2')

/** caminhos de um comando shell que indicam onde ele mexe: git -C, cd, > e >> (variáveis do próprio comando resolvidas) */
function bashTargets(command: string): string[] {
  const vars = new Map<string, string>()
  for (const m of command.matchAll(/(?:^|[;&|\n]\s*)([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\s;&|]+)/g)) vars.set(m[1], unquote(m[2]))
  let undefinedVar = false
  const expand = (s: string) =>
    unquote(s).replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, n: string) => {
      const v = vars.get(n)
      if (v === undefined) undefinedVar = true
      return v ?? ''
    })
  const out: string[] = []
  const take = (raw: string) => {
    undefinedVar = false
    const v = expand(raw)
    if (!undefinedVar && v) out.push(v)
  }
  const arg = `("[^"]*"|'[^']*'|[^\\s;&|<>]+)`
  for (const m of command.matchAll(new RegExp(`\\bgit\\s+-C\\s+${arg}`, 'g'))) take(m[1])
  for (const m of command.matchAll(new RegExp(`(?:^|[;&|\\n]\\s*)cd\\s+${arg}`, 'g'))) take(m[1])
  for (const m of command.matchAll(new RegExp(`(?<![0-9&])>>?\\s*${arg}`, 'g'))) {
    if (!/^&?\d$/.test(m[1]) && m[1] !== '/dev/null') take(m[1])
  }
  return out
}

export function writtenPaths(p: HookPayload, cwd: string, home: string): string[] {
  if (p.hook_event_name !== 'PreToolUse') return []
  const tool = typeof p.tool_name === 'string' ? p.tool_name : ''
  const input = (p.tool_input ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : null)
  let raw: string[] = []
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') raw = [str('file_path')].filter((x): x is string => !!x)
  else if (tool === 'NotebookEdit') raw = [str('notebook_path')].filter((x): x is string => !!x)
  else if (tool === 'Bash') raw = bashTargets(str('command') ?? '')
  else if (!READ_TOOLS.has(tool)) raw = [str('file_path') ?? str('path')].filter((x): x is string => !!x)
  return [...new Set(raw.map((r) => normalize(r, cwd, home)))]
}

export function worktreeOf(p: string, worktrees: string[]): string | null {
  let best: string | null = null
  for (const w of worktrees) if ((p === w || p.startsWith(w + '/')) && (!best || w.length > best.length)) best = w
  return best
}

export interface InferenceState {
  inferred: string | null
  candidate: { path: string; count: number } | null
}

export const EMPTY_INFERENCE: InferenceState = { inferred: null, candidate: null }

/** troca com 2 escritas seguidas na mesma worktree diferente da efetiva; escrita na efetiva zera o candidato */
export function nextInference(s: InferenceState, hit: string, shellWorktree: string | null): InferenceState {
  const effective = s.inferred ?? shellWorktree
  if (hit === effective) return { inferred: s.inferred, candidate: null }
  if (s.candidate?.path === hit) {
    if (s.candidate.count + 1 >= 2) return { inferred: hit === shellWorktree ? null : hit, candidate: null }
    return { inferred: s.inferred, candidate: { path: hit, count: s.candidate.count + 1 } }
  }
  return { inferred: s.inferred, candidate: { path: hit, count: 1 } }
}
