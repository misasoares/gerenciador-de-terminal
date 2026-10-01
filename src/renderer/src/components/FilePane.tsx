import { useEffect, useRef, useState } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { StreamLanguage } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import { json } from '@codemirror/lang-json'
import { yaml } from '@codemirror/lang-yaml'
import { javascript } from '@codemirror/lang-javascript'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { dirtyFiles, focusPane, pendingLine, requestCloseFile } from '../actions'
import { errorMessage } from '../api'
import { onFileChanged } from '../file-events'
import { baseName, languageFor, lineSeparator, pickerRoot, relativeTo, type FileLanguage } from '../file-model'
import { setUi, useUi } from '../store'

const LANG: Record<FileLanguage, () => Extension> = {
  markdown: () => markdown(),
  json: () => json(),
  yaml: () => yaml(),
  javascript: () => javascript(),
  typescript: () => javascript({ typescript: true, jsx: true }),
  env: () => StreamLanguage.define(properties),
  text: () => [],
}

const theme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--bg)', color: 'var(--fg)' },
    '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--fg-dim)', border: 'none' },
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)' },
    '.cm-content': { caretColor: 'var(--fg)' },
  },
  { dark: true },
)

type Problem = null | 'missing' | 'cannot-open' | string

export function FilePane({ paneId }: { paneId: string }) {
  const meta = useUi((s) => s.app?.filePanes[paneId])
  const focused = useUi((s) => s.focusedPaneId === paneId)
  const root = useUi((s) => (s.app ? pickerRoot(s.app, paneId) : null))
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const mtime = useRef<number | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [problem, setProblem] = useState<Problem>(null)
  const [external, setExternal] = useState(false)
  const [flash, setFlash] = useState(false)
  const path = meta?.path ?? ''
  const mode = meta?.mode ?? 'edit'

  const markDirty = (d: boolean) => {
    setDirty(d)
    if (d) dirtyFiles.add(paneId)
    else dirtyFiles.delete(paneId)
  }

  const load = async () => {
    try {
      const r = await window.gt.request<{ content: string; mtimeMs: number }>({ t: 'file.read', path })
      mtime.current = r.mtimeMs
      setText(r.content)
      setProblem(null)
      setExternal(false)
      markDirty(false)
    } catch (e) {
      const m = errorMessage(e)
      setProblem(m.includes('file-missing') ? 'missing' : m.includes('file-too-large') || m.includes('file-binary') ? 'cannot-open' : m)
    }
  }

  const save = async (force = false) => {
    const content = view.current ? view.current.state.sliceDoc() : text ?? ''
    try {
      const r = await window.gt.request<{ mtimeMs: number }>({ t: 'file.write', path, content, expectedMtimeMs: force || problem === 'missing' ? null : mtime.current })
      mtime.current = r.mtimeMs
      setText(content)
      setExternal(false)
      setProblem(null)
      markDirty(false)
    } catch (e) {
      const m = errorMessage(e)
      if (m.includes('file-changed')) setExternal(true)
      else setProblem(m)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save
  const forceRef = useRef(false)

  useEffect(() => {
    if (!path) return
    void load()
    void window.gt.request({ t: 'file.watch', path })
    const off = onFileChanged(path, (m) => {
      if (m === null) return setProblem('missing')
      if (m === mtime.current) return
      if (!dirtyFiles.has(paneId)) {
        void load().then(() => {
          setFlash(true)
          setTimeout(() => setFlash(false), 2000)
        })
      } else setExternal(true)
    })
    return () => {
      off()
      void window.gt.request({ t: 'file.unwatch', path })
      dirtyFiles.delete(paneId)
    }
  }, [path])

  // editor: recriado quando o conteúdo é (re)carregado ou o modo muda
  useEffect(() => {
    if (mode !== 'edit' || text === null || !host.current) return
    const sep = lineSeparator(text)
    const state = EditorState.create({
      doc: text,
      extensions: [
        basicSetup,
        theme,
        LANG[languageFor(path)](),
        EditorState.lineSeparator.of(sep),
        keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (void saveRef.current(forceRef.current), true) }]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) markDirty(true)
        }),
      ],
    })
    const v = new EditorView({ state, parent: host.current })
    view.current = v
    const line = pendingLine.get(paneId)
    if (line) {
      pendingLine.delete(paneId)
      const l = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines))
      v.dispatch({ selection: { anchor: l.from }, scrollIntoView: true })
    }
    if (focused) v.focus()
    return () => {
      v.destroy()
      view.current = null
    }
  }, [text, mode, path])

  const setMode = (m: 'view' | 'edit') => window.gt.request({ t: 'filepane.set', id: paneId, path, mode: m })
  const html = mode === 'view' && text !== null ? DOMPurify.sanitize(marked.parse(text, { async: false }) as string) : ''
  const isMd = languageFor(path) === 'markdown'

  return (
    <div className={`pane file-pane${focused ? ' focused' : ''}`} onMouseDown={() => focusPane(paneId)}>
      <div className="pane-header file-header">
        <span className="file-name">📄 {baseName(path)}</span>
        <span className="file-path" title={path}>{relativeTo(root, path)}</span>
        {dirty && <span className="file-dirty">● não salvo</span>}
        {flash && <span className="file-flash">atualizado do disco</span>}
        <span className="ph-spacer" />
        {isMd && (
          <button className="st-btn" onClick={() => void setMode(mode === 'view' ? 'edit' : 'view')}>
            {mode === 'view' ? 'Editar' : 'Visualizar'}
          </button>
        )}
        <button className="ph-close" title="Fechar arquivo" onClick={() => void requestCloseFile(paneId)}>
          ✕
        </button>
      </div>
      {external && (
        <div className="file-banner">
          O arquivo mudou no disco.{' '}
          <button className="st-btn" onClick={() => void load()}>Recarregar</button>
          <button className="st-btn" onClick={() => { forceRef.current = true; setExternal(false) }}>Manter o meu</button>
        </div>
      )}
      {problem === 'cannot-open' ? (
        <div className="pane-dead">
          <div className="pane-dead-title">Não dá para abrir este arquivo aqui</div>
          <div className="pane-dead-actions">
            <button onClick={() => void window.gt.openPath(path)}>Abrir no app padrão</button>
            <button onClick={() => void window.gt.openPath(path.slice(0, path.lastIndexOf('/')) || '/')}>Mostrar no Finder</button>
          </div>
        </div>
      ) : problem === 'missing' ? (
        <div className="pane-dead">
          <div className="pane-dead-title">Arquivo não encontrado</div>
          <div className="pane-dead-actions">
            {text !== null && <button className="primary" onClick={() => void save(true)}>Salvar mesmo assim</button>}
            <button onClick={() => void requestCloseFile(paneId)}>Fechar</button>
          </div>
        </div>
      ) : problem ? (
        <div className="file-banner error">{problem}</div>
      ) : null}
      {problem !== 'cannot-open' && (problem !== 'missing' || mode === 'edit') && (
        mode === 'view' ? (
          <div
            className="file-md"
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest('a')
              if (!a) return
              e.preventDefault()
              const href = a.getAttribute('href') ?? ''
              if (/^https?:\/\//.test(href)) void window.gt.openExternal(href)
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="file-editor" ref={host} />
        )
      )}
    </div>
  )
}
