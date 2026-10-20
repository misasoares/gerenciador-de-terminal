import { useMemo, useState } from 'react'
import { openNewSessionDialog, revealPane } from '../actions'
import { buildPaletteItems, searchPalette, type PaletteItem } from '../search'
import { getUi, setUi, useUi } from '../store'
import { CascadeItem, useCascade } from './Cascade'
import { ModalFrame } from './ModalFrame'

const KIND = { session: 'sessão', team: 'grupo', worktree: 'worktree', project: 'projeto' } as const

function run(item: PaletteItem): void {
  setUi({ modal: null })
  if (item.kind === 'session' || item.kind === 'team') return revealPane(item.id)
  if (item.kind === 'worktree') return openNewSessionDialog(item.projectPath ?? undefined, item.worktreePath ?? undefined)
  const first = getUi().app?.panes.find((p) => p.alive && p.projectPath === item.projectPath)
  if (first) revealPane(first.id)
  else openNewSessionDialog(item.projectPath ?? undefined)
}

export function Palette() {
  const app = useUi((s) => s.app)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const items = useMemo(() => (app ? buildPaletteItems(app) : []), [app])
  const results = useMemo(() => searchPalette(items, q), [items, q])
  const close = () => setUi({ modal: null })
  const cascade = useCascade(results.length)
  return (
    <ModalFrame onClose={close} className="palette" backdropClassName="palette-backdrop">
      <input
        autoFocus
        className="palette-input"
        placeholder="Buscar sessão, worktree ou projeto…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setSel(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, results.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter' && results[sel]) run(results[sel])
        }}
      />
      <div className="palette-list">
        {results.map((item, i) => (
          <CascadeItem i={i} on={cascade} key={`${item.kind}:${item.id}`} className={`palette-item${i === sel ? ' sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => run(item)}>
            <span className="palette-kind">{KIND[item.kind]}</span>
            <span className="palette-label">{item.label}</span>
            <span className="palette-detail">{item.detail}</span>
          </CascadeItem>
        ))}
        {results.length === 0 && <div className="palette-empty">Nada encontrado</div>}
      </div>
    </ModalFrame>
  )
}
