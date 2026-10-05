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
import { dirtyFiles, dropOnPane, floatPane, focusPane, openFile, PANE_MIME, pendingLine, requestCloseFile } from '../actions'
import { FloatControls } from './FloatControls'
import { MediaView } from './MediaView'
import { mediaKind } from '../../../shared/media'
import { dropZone, type DropZone } from '../layout'
import type React from 'react'
import { errorMessage } from '../api'
import { onFileChanged } from '../file-events'
import { baseName, languageFor, lineSeparator, pickerRoot, relativeTo, resolveRelative, type FileLanguage } from '../file-model'
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
    '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)' },
    '.cm-content': { caretColor: 'var(--fg)' },
  },
  { dark: true },
)

type Problem = null | 'missing' | 'cannot-open' | string

const KIND_ICON = { text: '📄', image: '🖼', video: '🎬', audio: '🎵', pdf: '📕' } as const

export function FilePane({ paneId, floating }: { paneId: string; floating?: boolean }) {
  const meta = useUi((s) => s.app?.filePanes[paneId])
  const focused = useUi((s) => s.focusedPaneId === paneId)
  const root = useUi((s) => (s.app ? pickerRoot(s.app, paneId) : null))
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const mtime = useRef<number | null>(null)
  /** até quando ignorar avisos do disco (o próprio salvamento também gera um) */
  const ownWriteUntil = useRef(0)
  const [text, setText] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [problem, setProblem] = useState<Problem>(null)
  const [external, setExternal] = useState(false)
  const [flash, setFlash] = useState(false)
  /** zona onde outro painel arrastado vai cair (igual ao terminal) */
  const [zone, setZone] = useState<DropZone | null>(null)
  const zoneAt = (e: React.DragEvent<HTMLDivElement>): DropZone => {
    const r = e.currentTarget.getBoundingClientRect()
    return dropZone((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }
  const path = meta?.path ?? ''
  const mode = meta?.mode ?? 'edit'
  /** mídia: mostrada pelo protocolo gt-file, sem ler o conteúdo como texto */
  const kind = mediaKind(path)
  const [version, setVersion] = useState(0)
  const [fit, setFit] = useState(true)
  const player = useRef<HTMLMediaElement | null>(null)

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
    ownWriteUntil.current = Date.now() + 1000
    try {
      const r = await window.gt.request<{ mtimeMs: number }>({ t: 'file.write', path, content, expectedMtimeMs: force || problem === 'missing' ? null : mtime.current })
      mtime.current = r.mtimeMs
      // com o editor aberto, não recria (manteria cursor e desfazer); só o modo visualizar usa o texto
      if (!view.current) setText(content)
      setExternal(false)
      setProblem(null)
      markDirty(false)
      forceRef.current = false
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
    if (!kind) void load()
    else setProblem(null)
    void window.gt.request({ t: 'file.watch', path })
    const off = onFileChanged(path, (m) => {
      if (m === null) return setProblem('missing')
      if (kind) {
        // mídia: recarrega sozinha (vídeo/áudio tocando ficam como estão até a próxima mudança)
        if (player.current && !player.current.paused) return
        setProblem(null)
        setVersion(m)
        setFlash(true)
        setTimeout(() => setFlash(false), 2000)
        return
      }
      if (m === mtime.current || Date.now() < ownWriteUntil.current) return
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
  }, [path, kind])

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

  const setMode = (m: 'view' | 'edit') => {
    // levar as edições para o texto antes de destruir o editor (senão a visualização mostra o antigo e a edição some)
    if (view.current) setText(view.current.state.sliceDoc())
    return window.gt.request({ t: 'filepane.set', id: paneId, path, mode: m })
  }
  const html = mode === 'view' && text !== null ? DOMPurify.sanitize(marked.parse(text, { async: false }) as string) : ''
  const isMd = languageFor(path) === 'markdown'

  return (
    <div
      className={`pane file-pane${focused ? ' focused' : ''}`}
      onMouseDown={() => focusPane(paneId)}
      onDragOver={(e) => {
        if (floating || !e.dataTransfer.types.includes(PANE_MIME)) return
        e.preventDefault()
        setZone(zoneAt(e))
      }}
      onDragLeave={() => setZone(null)}
      onDrop={(e) => {
        const dragged = e.dataTransfer.getData(PANE_MIME)
        setZone(null)
        if (floating || !dragged || dragged === paneId) return
        e.preventDefault()
        dropOnPane(dragged, paneId, zoneAt(e))
      }}
    >
      {zone && <div className={`drop-zone drop-${zone}`} />}
      <div
        className={`pane-header file-header${floating ? ' float-drag' : ''}`}
        draggable={!floating}
        onDragStart={(e) => !floating && e.dataTransfer.setData(PANE_MIME, paneId)}
      >
        <span className="file-name">{KIND_ICON[kind ?? 'text']} {baseName(path)}</span>
        <span className="file-path" title={path}>{relativeTo(root, path)}</span>
        {dirty && <span className="file-dirty">● não salvo</span>}
        {flash && <span className="file-flash">atualizado do disco</span>}
        <span className="ph-spacer" />
        {kind === 'image' && (
          <button className="st-btn" title="Alternar entre ajustar ao painel e tamanho real" onClick={() => setFit((v) => !v)}>
            {fit ? '100%' : 'Ajustar'}
          </button>
        )}
        {isMd && (
          <button className="st-btn" onClick={() => void setMode(mode === 'view' ? 'edit' : 'view')}>
            {mode === 'view' ? 'Editar' : 'Visualizar'}
          </button>
        )}
        {floating ? (
          <FloatControls paneId={paneId} />
        ) : (
          <>
            <button className="ph-close" title="Flutuar · ⇧⌘F" onClick={() => floatPane(paneId)}>
              ⧉
            </button>
            <button className="ph-close" title="Fechar arquivo" onClick={() => void requestCloseFile(paneId)}>
              ✕
            </button>
          </>
        )}
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
      {kind && !problem ? (
        <MediaView kind={kind} path={path} version={version} fit={fit} onToggleFit={() => setFit((v) => !v)} playerRef={player} onError={() => setProblem('cannot-open')} />
      ) : !kind && problem !== 'cannot-open' && (problem !== 'missing' || mode === 'edit') && (
        mode === 'view' ? (
          <div
            className="file-md"
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest('a')
              if (!a) return
              e.preventDefault()
              const href = a.getAttribute('href') ?? ''
              if (/^https?:\/\//.test(href)) void window.gt.openExternal(href)
              else {
                // link relativo para outro arquivo do projeto: abre no leitor, ao lado
                const target = resolveRelative(path, href)
                if (target) void openFile(target, { besideId: paneId })
              }
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
