import type { AppState, FilePaneMeta, Layout, Tab } from '../../shared/types'
import { leaves, splitLeaf } from './layout'

export const isFilePane = (id: string): boolean => id.startsWith('file:')

export type FileLanguage = 'markdown' | 'json' | 'yaml' | 'javascript' | 'typescript' | 'env' | 'text'

export function baseName(p: string): string {
  return p.split('/').pop() ?? p
}

export function languageFor(p: string): FileLanguage {
  const b = baseName(p).toLowerCase()
  if (/^\.env(\..+)?$/.test(b)) return 'env'
  if (/\.(md|mdx|markdown)$/.test(b)) return 'markdown'
  if (/\.(json|jsonc)$/.test(b)) return 'json'
  if (/\.(ya?ml)$/.test(b)) return 'yaml'
  if (/\.(ts|tsx|mts|cts)$/.test(b)) return 'typescript'
  if (/\.(js|jsx|mjs|cjs)$/.test(b)) return 'javascript'
  return 'text'
}

export function lineSeparator(content: string): '\r\n' | '\n' {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

export function relativeTo(root: string | null, p: string): string {
  return root && p.startsWith(root + '/') ? p.slice(root.length + 1) : p
}

/** põe a folha do arquivo à direita do painel indicado; senão na aba ativa; sem abas, numa aba nova */
export function insertFileLeaf(l: Layout, fileId: string, besideId: string | null, fallbackTab: Tab): Layout {
  const fresh = { type: 'leaf' as const, paneId: fileId }
  const owner = besideId ? l.tabs.find((t) => leaves(t.root).includes(besideId)) : undefined
  if (owner && besideId) {
    return { ...l, tabs: l.tabs.map((t) => (t.id === owner.id ? { ...t, root: splitLeaf(t.root!, besideId, fileId, 'row') } : t)), activeTabId: owner.id }
  }
  const active = l.tabs.find((t) => t.id === l.activeTabId)
  if (!active) return { ...l, tabs: [...l.tabs, { ...fallbackTab, root: fresh }], activeTabId: fallbackTab.id }
  const last = leaves(active.root).at(-1)
  const root = active.root && last ? splitLeaf(active.root, last, fileId, 'row') : fresh
  return { ...l, tabs: l.tabs.map((t) => (t.id === active.id ? { ...t, root } : t)) }
}

export function findFilePane(filePanes: Record<string, FilePaneMeta>, layout: Layout, p: string): string | null {
  const inLayout = new Set(layout.tabs.flatMap((t) => leaves(t.root)))
  return Object.entries(filePanes).find(([id, m]) => m.path === p && inLayout.has(id))?.[0] ?? null
}

const dirName = (p: string) => p.slice(0, Math.max(1, p.lastIndexOf('/')))

export function pickerRoot(app: Pick<AppState, 'panes' | 'projects' | 'layout' | 'filePanes' | 'userHome'>, focusedId: string | null): string {
  const worktrees = app.projects.flatMap((p) => p.worktrees.map((w) => w.path)).sort((a, b) => b.length - a.length)
  const containing = (p: string) => worktrees.find((w) => p === w || p.startsWith(w + '/')) ?? null
  if (focusedId && isFilePane(focusedId)) {
    const f = app.filePanes[focusedId]
    if (f) return containing(f.path) ?? dirName(f.path)
  }
  const pane = app.panes.find((p) => p.id === focusedId)
  if (pane) return pane.worktreePath ?? pane.cwd
  return app.projects[0]?.path ?? app.userHome
}
