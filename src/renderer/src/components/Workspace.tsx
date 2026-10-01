import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { tabAttention } from '../attention'
import type { Layout, LayoutNode } from '../../../shared/types'
import { activateTab, addTab, closeTab, dockPaneAt, movePaneToNewTab, moveToTab, PANE_MIME, renameTab, saveSizes } from '../actions'
import { findTab, leaves, moveTab, nodeKey, tabInsertIndex, type Side } from '../layout'

const TAB_MIME = 'application/x-gt-tab'

function tabMids(bar: HTMLElement): number[] {
  return [...bar.querySelectorAll<HTMLElement>(':scope > .tab')].map((el) => {
    const r = el.getBoundingClientRect()
    return r.left + r.width / 2
  })
}
import { tabMenu } from '../flows'
import { textOn } from '../header'
import { updateLayout, useUi } from '../store'
import { PaneFrame } from './PaneFrame'


function SplitNode({ node, tabId, path }: { node: LayoutNode; tabId: string; path: number[] }) {
  if (node.type === 'leaf') return <PaneFrame paneId={node.paneId} onAddProject={addProject} />
  return (
    <Allotment
      vertical={node.dir === 'column'}
      defaultSizes={node.sizes.length === node.children.length ? node.sizes : undefined}
      onChange={(sizes) => saveSizes(tabId, path, sizes)}
    >
      {node.children.map((c, i) => (
        <Allotment.Pane key={nodeKey(c)} minSize={160}>
          <SplitNode node={c} tabId={tabId} path={[...path, i]} />
        </Allotment.Pane>
      ))}
    </Allotment>
  )
}

function TabBar({ layout }: { layout: Layout }) {
  const panes = useUi((s) => s.app?.panes)
  const attn = useMemo(() => tabAttention(layout, panes ?? []), [layout, panes])
  const [editing, setEditing] = useState<string | null>(null)
  /** posição de inserção (0..n) enquanto uma aba é arrastada */
  const [dropAt, setDropAt] = useState<number | null>(null)
  /** painel arrastado sobre a barra: a aba alvo, ou 'new' (espaço vazio / +) */
  const [paneOver, setPaneOver] = useState<string | null>(null)
  const openTimer = useRef<{ tab: string; t: ReturnType<typeof setTimeout> } | null>(null)
  const clearPaneOver = () => {
    if (openTimer.current) clearTimeout(openTimer.current.t)
    openTimer.current = null
    setPaneOver(null)
  }
  const tabUnder = (target: EventTarget) => (target as HTMLElement).closest<HTMLElement>('.tab')?.dataset.tabId ?? null
  return (
    <div
      className="tabbar"
      // o soltar é da barra inteira: vale também o espaço vazio depois da última aba e o botão +
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(PANE_MIME)) {
          // painel sobre a barra: em cima de uma aba move para ela (segurar abre a aba); no vazio ou no + cria aba nova
          e.preventDefault()
          const over = tabUnder(e.target) ?? 'new'
          if (over !== paneOver) {
            clearPaneOver()
            setPaneOver(over)
            if (over !== 'new' && over !== layout.activeTabId) openTimer.current = { tab: over, t: setTimeout(() => activateTab(over), 600) }
          }
          return
        }
        if (!e.dataTransfer.types.includes(TAB_MIME)) return
        e.preventDefault()
        setDropAt(tabInsertIndex(tabMids(e.currentTarget), e.clientX))
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDropAt(null)
        clearPaneOver()
      }}
      onDrop={(e) => {
        const pane = e.dataTransfer.getData(PANE_MIME)
        if (pane) {
          e.preventDefault()
          const over = tabUnder(e.target)
          clearPaneOver()
          if (!over) movePaneToNewTab(pane)
          else if (findTab(layout, pane)?.id !== over) moveToTab(pane, over)
          return
        }
        const id = e.dataTransfer.getData(TAB_MIME)
        setDropAt(null)
        if (!id) return
        e.preventDefault()
        const to = tabInsertIndex(tabMids(e.currentTarget), e.clientX)
        updateLayout((l) => moveTab(l, id, to))
      }}
    >
      {layout.tabs.map((t, i) => (
        <div
          key={t.id}
          className={`tab${t.id === layout.activeTabId ? ' active' : ''}${t.color ? ' colored' : ''}${dropAt === i ? ' drop-before' : ''}${dropAt === i + 1 && i === layout.tabs.length - 1 ? ' drop-after' : ''}${paneOver === t.id ? ' pane-over' : ''}`}
          data-tab-id={t.id}
          draggable={editing !== t.id}
          onDragStart={(e) => {
            e.dataTransfer.setData(TAB_MIME, t.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
          onDragEnd={() => setDropAt(null)}
          style={t.color ? { backgroundColor: t.color, color: textOn(t.color) } : undefined}
          onClick={() => activateTab(t.id)}
          onDoubleClick={() => setEditing(t.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            void tabMenu(t).then((r) => r === 'rename' && setEditing(t.id))
          }}
        >
          {editing === t.id ? (
            <input
              autoFocus
              defaultValue={t.name}
              onBlur={(e) => {
                renameTab(t.id, e.target.value)
                setEditing(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setEditing(null)
              }}
            />
          ) : (
            <span>{t.name}</span>
          )}
          {attn[t.id] && <span className={`tab-dot ${attn[t.id]}`} title={attn[t.id] === 'needs-you' ? 'precisa de você' : 'sua vez'} />}
          {i < 9 && <span className="tab-key">⌘{i + 1}</span>}
          <button
            className="tab-close"
            title="Fechar aba (as sessões continuam rodando)"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button className={`tab-add${paneOver === 'new' ? ' pane-over' : ''}`} title="Nova aba (⇧⌘T) — solte uma sessão aqui para levá-la a uma aba nova" onClick={addTab}>
        +
      </button>
    </div>
  )
}

let addProject: ((dir: string) => void) | undefined

const SIDES: Side[] = ['top', 'bottom', 'left', 'right']

/** faixas nas bordas da área inteira, só enquanto um painel é arrastado: soltar ali põe a sessão abaixo/acima/ao lado de todas */
function DockEdges({ tabId }: { tabId: string }) {
  const [dragging, setDragging] = useState(false)
  const [side, setSide] = useState<Side | null>(null)
  useEffect(() => {
    const start = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(PANE_MIME)) setDragging(true)
    }
    const end = () => {
      setDragging(false)
      setSide(null)
    }
    window.addEventListener('dragstart', start)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      window.removeEventListener('dragstart', start)
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
    }
  }, [])
  if (!dragging) return null
  return (
    <>
      {side && <div className={`dock-preview dock-preview-${side}`} />}
      {SIDES.map((s) => (
        <div
          key={s}
          className={`dock-edge dock-edge-${s}`}
          title="Solte aqui para ocupar a borda inteira"
          onDragOver={(e) => {
            if (!e.dataTransfer.types.includes(PANE_MIME)) return
            e.preventDefault()
            setSide(s)
          }}
          onDragLeave={() => setSide(null)}
          onDrop={(e) => {
            const pane = e.dataTransfer.getData(PANE_MIME)
            setSide(null)
            if (!pane) return
            e.preventDefault()
            e.stopPropagation()
            dockPaneAt(pane, tabId, s)
          }}
        />
      ))}
    </>
  )
}

export function Workspace({ empty, onAddProject }: { empty?: React.ReactNode; onAddProject?: (dir: string) => void }) {
  addProject = onAddProject
  const layout = useUi((s) => s.app?.layout)
  const [emptyOver, setEmptyOver] = useState(false)
  if (!layout) return null
  const tab = layout.tabs.find((t) => t.id === layout.activeTabId)
  return (
    <div className="workspace">
      <TabBar layout={layout} />
      <div
        className={`tab-body${emptyOver ? ' drop-empty' : ''}`}
        // aba vazia: a área inteira aceita a sessão arrastada (não há painel nem faixa para receber)
        onDragOver={(e) => {
          if (tab?.root || !e.dataTransfer.types.includes(PANE_MIME)) return
          e.preventDefault()
          setEmptyOver(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEmptyOver(false)
        }}
        onDrop={(e) => {
          setEmptyOver(false)
          const pane = e.dataTransfer.getData(PANE_MIME)
          if (!tab || tab.root || !pane) return
          e.preventDefault()
          dockPaneAt(pane, tab.id, 'right')
        }}
      >
        {tab?.root ? (
          <SplitNode key={`${tab.id}:${tab.root.type === 'split' ? tab.root.dir : 'leaf'}`} node={tab.root} tabId={tab.id} path={[]} />
        ) : (
          (empty ?? <div className="empty">Nenhum painel aqui. ⌘T abre uma nova sessão; ⌘D abre um terminal.</div>)
        )}
        {tab && <DockEdges tabId={tab.id} />}
      </div>
    </div>
  )
}
