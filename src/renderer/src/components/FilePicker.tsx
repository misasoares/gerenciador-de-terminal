import { ModalFrame } from './ModalFrame'
import { useEffect, useMemo, useState } from 'react'
import { openFile } from '../actions'
import { fuzzyScore } from '../search'
import { getUi, setUi } from '../store'

export function FilePicker({ root }: { root: string }) {
  const [files, setFiles] = useState<string[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const besideId = useMemo(() => getUi().focusedPaneId, [])

  useEffect(() => {
    window.gt
      .request<{ files: string[]; truncated: boolean }>({ t: 'file.list', root })
      .then((r) => {
        setFiles(r.files)
        setTruncated(r.truncated)
      })
      .catch(() => setFiles([]))
  }, [root])

  const results = useMemo(() => {
    if (!files) return []
    if (!q.trim()) return files.slice(0, 200)
    return files
      .map((f) => ({ f, s: fuzzyScore(q, f) }))
      .filter((x): x is { f: string; s: number } => x.s !== null)
      .sort((a, b) => b.s - a.s)
      .slice(0, 200)
      .map((x) => x.f)
  }, [files, q])

  const close = () => setUi({ modal: null })
  const pick = (rel: string | undefined) => {
    if (!rel) return
    close()
    void openFile(`${root}/${rel}`, { besideId })
  }

  return (
    <ModalFrame onClose={close} className="palette" backdropClassName="palette-backdrop">
      <input
        autoFocus
        className="palette-input"
        placeholder={`Abrir arquivo em ${root.split('/').pop()}…`}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setSel(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'ArrowDown') setSel((i) => Math.min(i + 1, results.length - 1))
          if (e.key === 'ArrowUp') setSel((i) => Math.max(i - 1, 0))
          if (e.key === 'Enter') pick(results[sel])
        }}
      />
      {!files && <div className="palette-empty">lendo arquivos…</div>}
      {truncated && <div className="palette-empty">lista parcial</div>}
      <div className="palette-list">
        {results.map((f, i) => (
          <div key={f} className={`palette-item${i === sel ? ' sel' : ''}`} onMouseEnter={() => setSel(i)} onMouseDown={() => pick(f)}>
            {f}
          </div>
        ))}
      </div>
    </ModalFrame>
  )
}
