import { describe, expect, it } from 'vitest'
import { conflictPartners } from '../../src/renderer/src/conflicts-model'
import type { ConflictReport } from '../../src/shared/types'

const rep: ConflictReport = {
  analyzedAt: 1, running: false, comparisons: 5, cleanPairs: 2, errors: [],
  vsMain: [{ worktreePath: '/w/a', files: [], dirty: false }, { worktreePath: '/w/c', files: ['x.ts'], dirty: false }],
  pairs: [{ a: '/w/a', b: '/w/b', files: ['f.ts'], dirty: false }, { a: '/w/c', b: '/w/a', files: ['g.ts'], dirty: true }],
}
const label = (p: string) => p.split('/').pop()!

describe('conflictPartners', () => {
  it('lista main e as outras worktrees em conflito', () => {
    expect(conflictPartners(rep, '/w/a', label)).toEqual(['b', 'c'])
    expect(conflictPartners(rep, '/w/c', label)).toEqual(['main', 'a'])
    expect(conflictPartners(rep, '/w/z', label)).toEqual([])
    expect(conflictPartners(null, '/w/a', label)).toEqual([])
  })
})
