import type { GitStatus, WorktreeInfo } from '../../shared/types'

export function parseStatus(out: string): Omit<GitStatus, 'error'> {
  const s: Omit<GitStatus, 'error'> = { branch: null, upstream: null, ahead: 0, behind: 0, changed: 0 }
  for (const line of out.split('\n')) {
    if (!line) continue
    if (line.startsWith('# branch.head ')) {
      const v = line.slice('# branch.head '.length)
      s.branch = v === '(detached)' ? null : v
    } else if (line.startsWith('# branch.upstream ')) {
      s.upstream = line.slice('# branch.upstream '.length)
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        s.ahead = Number(m[1])
        s.behind = Number(m[2])
      }
    } else if (/^[12u?] /.test(line)) {
      s.changed++
    }
  }
  return s
}

export function parseWorktreeList(out: string): WorktreeInfo[] {
  const result: WorktreeInfo[] = []
  let cur: WorktreeInfo | null = null
  for (const field of out.split('\0')) {
    if (field === '') {
      if (cur) result.push(cur)
      cur = null
      continue
    }
    const sp = field.indexOf(' ')
    const key = sp < 0 ? field : field.slice(0, sp)
    const val = sp < 0 ? '' : field.slice(sp + 1)
    if (key === 'worktree') {
      if (cur) result.push(cur)
      cur = { path: val, head: null, branch: null, isMain: false, locked: false, prunable: false }
    } else if (cur) {
      if (key === 'HEAD') cur.head = val
      else if (key === 'branch') cur.branch = val.replace(/^refs\/heads\//, '')
      else if (key === 'locked') cur.locked = true
      else if (key === 'prunable') cur.prunable = true
    }
  }
  if (cur) result.push(cur)
  result.forEach((w, i) => { w.isMain = i === 0 })
  return result
}
